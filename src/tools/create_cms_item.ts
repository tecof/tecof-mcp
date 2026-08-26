/**
 * create_cms_item — TASLAK içerik oluşturur.
 *
 * Yayınlama yoktur (sayfa araçlarındaki sözleşmenin aynısı): kayıt taslak doğar,
 * yayına almayı kullanıcı panelden yapar. `data` sunucuda alan şemasına göre
 * katı doğrulanır — biçimler için önce get_cms_collection.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { normalizeLanguageValue, type IssueSink } from "../document/fields.js";
import type { LangValue } from "../types.js";
import { cmsErrorResult, CollectionRefSchema, ItemDataSchema, LangShortcut } from "./_cms.js";
import { errorResult, okResult, wrapTool } from "./_shared.js";

export function registerCreateCmsItem(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "create_cms_item",
        {
            title: "İçerik oluştur (taslak)",
            description:
                "CMS koleksiyonuna TASLAK içerik ekler; yayınlamayı kullanıcı panelden yapar. data anahtarları alanların shortcode'udur — beklenen biçimler için önce get_cms_collection çağırın (çok dilli alan [{code,value}], görsel alanı uploadValue dizisi, referans 24-hex id).",
            inputSchema: z.object({
                collection: CollectionRefSchema,
                slug: z.string().min(1).describe("İçerik adresi — sunucu normalize eder (ör. 'ilk-yazi')"),
                data: ItemDataSchema.optional(),
                metaTitle: LangShortcut.optional(),
                metaDescription: LangShortcut.optional(),
                status: z.string().optional().describe("KULLANILMAZ — Developer API içerik yayınlamaz; verilirse hata döner"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "create_cms_item", async ({ collection, slug, data, metaTitle, metaDescription, status }) => {
            /* Yayınlama v1'de yok. Alanı şemadan tamamen çıkarmak yerine
               tanımlayıp REDDEDİYORUZ: zod bilinmeyen anahtarı sessizce
               atardı ve ajan "yayınladım" sanıp kullanıcıya yanlış rapor
               verirdi. Açık hata, ajanı panele yönlendirir. */
            if (status !== undefined) {
                return errorResult(
                    "Developer API içerik yayınlamaz: kayıt taslak olarak oluşur/güncellenir, yayınlamayı kullanıcı panelden yapar. `status` alanını göndermeyin."
                );
            }
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const sink: IssueSink = { errors: [], warnings: [] };

            try {
                const created = await api.createCmsItem(collection, {
                    themeId: site.themeId,
                    slug,
                    ...(data !== undefined ? { data } : {}),
                    ...(metaTitle !== undefined ? { metaTitle: normalizeLanguageValue(metaTitle, site.lang, "metaTitle", sink) as LangValue[] } : {}),
                    ...(metaDescription !== undefined ? { metaDescription: normalizeLanguageValue(metaDescription, site.lang, "metaDescription", sink) as LangValue[] } : {}),
                });
                return okResult({
                    itemId: created._id,
                    slug: created.slug,
                    status: created.status,
                    next: "İçerik TASLAK durumda; yayınlamayı kullanıcı panelden yapar.",
                });
            } catch (err) {
                const mapped = cmsErrorResult(err);
                if (mapped) return mapped;
                throw err;
            }
        })
    );
}
