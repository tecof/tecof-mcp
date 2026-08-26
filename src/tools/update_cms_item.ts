/**
 * update_cms_item — içeriği günceller.
 *
 * İKİ TUZAK, ikisi de bilinçli olarak sert:
 *  1) `data` KISMİ DEĞİL, tümüyle değişir — önce get_cms_item ile okuyup üzerine
 *     ekleyin, yoksa göndermediğiniz alanlar silinir.
 *  2) YAYINDAKİ içerik canlıdır; değişiklik anında siteye çıkar. Bu yüzden
 *     sunucu allowPublishedEdit:true ister — ajan bunu kullanıcı onayı olmadan
 *     göndermemelidir.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { normalizeLanguageValue, type IssueSink } from "../document/fields.js";
import type { LangValue } from "../types.js";
import { cmsErrorResult, CollectionRefSchema, ItemDataSchema, ItemRefSchema, LangShortcut } from "./_cms.js";
import { errorResult, okResult, wrapTool } from "./_shared.js";

export function registerUpdateCmsItem(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "update_cms_item",
        {
            title: "İçeriği güncelle",
            description:
                "CMS içeriğini günceller. data VARSAYILAN OLARAK BİRLEŞTİRİLİR (verdiğiniz alanlar güncellenir, diğerleri korunur); alan silmek için dataMode:\"replace\". Yayındaki içeriği değiştirmek allowPublishedEdit:true ister (değişiklik anında canlıya çıkar); bunu yalnız kullanıcı onayladıysa gönderin. expectedModifiedDate ile eşzamanlı düzenleme çakışması 409 olarak yakalanır.",
            inputSchema: z.object({
                collection: CollectionRefSchema,
                item: ItemRefSchema,
                slug: z.string().optional().describe("Yeni adres — yayındaki içerikte eski adres 404 verir"),
                data: ItemDataSchema.optional(),
                dataMode: z.enum(["merge", "replace"]).optional().describe(
                    'Varsayılan "merge": verdiğiniz alanlar güncellenir, diğerleri KORUNUR. "replace": data tamamen değişir, göndermediğiniz alanlar SİLİNİR.'
                ),
                metaTitle: LangShortcut.optional(),
                metaDescription: LangShortcut.optional(),
                allowPublishedEdit: z.boolean().optional().describe("Kullanıcı, canlı içeriğin değişmesini onayladı"),
                expectedModifiedDate: z.string().optional().describe("get_cms_item'dan gelen modifiedDate"),
                status: z.string().optional().describe("KULLANILMAZ — Developer API içerik yayınlamaz; verilirse hata döner"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "update_cms_item", async ({ collection, item, slug, data, dataMode, metaTitle, metaDescription, allowPublishedEdit, expectedModifiedDate, status }) => {
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

            /* Slug ile çağrılabilsin diye id'ye çözülür (PUT id ister). */
            const target = await api.getCmsItem(collection, item, site.themeId);

            /* v1 `data`yı TAMAMEN değiştirir. Ajan kısmi gövde gönderdiğinde
               (ki en sık yaptığı şey budur: "sadece başlığı düzelt") diğer
               alanlar sessizce SİLİNİRDİ — iyimser kilit bunu yakalamaz, çünkü
               araya kimse girmiyor; kaybı ajanın kendisi yapıyor. Bu yüzden
               varsayılan MERGE: az önce okunan kaydın üzerine yazılır. Alan
               silmek isteyen açıkça dataMode:"replace" der. */
            const mergedData = data === undefined
                ? undefined
                : (dataMode === "replace" ? data : { ...(target.data ?? {}), ...data });

            try {
                const { item: updated, warnings } = await api.updateCmsItem(collection, target._id, {
                    themeId: site.themeId,
                    ...(slug !== undefined ? { slug } : {}),
                    ...(mergedData !== undefined ? { data: mergedData } : {}),
                    ...(metaTitle !== undefined ? { metaTitle: normalizeLanguageValue(metaTitle, site.lang, "metaTitle", sink) as LangValue[] } : {}),
                    ...(metaDescription !== undefined ? { metaDescription: normalizeLanguageValue(metaDescription, site.lang, "metaDescription", sink) as LangValue[] } : {}),
                    ...(allowPublishedEdit === true ? { allowPublishedEdit: true } : {}),
                    /* İyimser kilit OTOMATİK: hedefi az önce okuduk, onun
                       modifiedDate'ini geri gönderiyoruz. Ajan elle geçerse
                       onunki kazanır. Bu olmadan iki ajan/panel aynı kaydı
                       sessizce üst üste yazıyordu (update_page'de kilit var). */
                    expectedModifiedDate: expectedModifiedDate ?? target.modifiedDate ?? undefined,
                });
                return okResult({
                    itemId: updated._id,
                    slug: updated.slug,
                    status: updated.status,
                    modifiedDate: updated.modifiedDate ?? null,
                    dataMode: data === undefined ? null : (dataMode ?? "merge"),
                    warnings,
                });
            } catch (err) {
                const mapped = cmsErrorResult(err);
                if (mapped) return mapped;
                throw err;
            }
        })
    );
}
