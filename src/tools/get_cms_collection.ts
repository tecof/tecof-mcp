/**
 * get_cms_collection — bir içerik tipinin ALAN ŞEMASI.
 *
 * Çıktının kalbi `fieldGuide`: her alan için `data` içinde hangi biçimin
 * beklendiğini yazar (çok dilli mi, görsel objesi mi, referans id'si mi).
 * create_cms_item/update_cms_item çağrısından ÖNCE bu araç çağrılmalıdır.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { CollectionRefSchema, fieldGuide } from "./_cms.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerGetCmsCollection(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_cms_collection",
        {
            title: "İçerik tipinin alan şemasını getir",
            description:
                "Koleksiyonun tüm alanlarını ve HER ALAN İÇİN BEKLENEN VERİ BİÇİMİNİ döner (çok dilli alan [{code,value}], görsel alanı tam dosya objesi dizisi, referans 24-hex id…). İçerik oluşturmadan/güncellemeden önce çağırın.",
            inputSchema: z.object({ collection: CollectionRefSchema }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "get_cms_collection", async ({ collection }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const found = await api.getCmsCollection(collection, site.themeId);
            return okResult({
                id: found._id,
                slug: found.slug,
                name: found.name ?? [],
                description: found.description ?? [],
                displayField: found.displayField ?? null,
                languages: site.lang.languages,
                defaultLanguage: site.lang.defaultLanguage,
                fields: fieldGuide(found),
                notes: [
                    "data anahtarları alanların shortcode'udur; tanımsız anahtar 400 verir.",
                    "Çok dilli alanları mağazanın TÜM dillerinde doldurun.",
                    "Görsel/dosya alanına list_media, import_image ya da generate_image çıktısındaki uploadValue'yu koyun.",
                ],
            });
        })
    );
}
