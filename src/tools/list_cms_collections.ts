/**
 * list_cms_collections — mağazanın içerik tipleri (koleksiyonlar).
 * Ajanın CMS akışındaki İLK adımı: hangi içerik tipleri var, kaç kayıt tutuyor.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerListCmsCollections(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "list_cms_collections",
        {
            title: "İçerik tiplerini listele",
            description:
                "Headless CMS koleksiyonlarını (içerik tipleri) listeler: id, slug, ad, alan sayısı, içerik sayısı. İçerik yazmadan önce get_cms_collection ile alan şemasını alın.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "list_cms_collections", async () => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            /* CMS koleksiyonu tema kapsamlıdır — hangi temanın içeriğiyle
               çalıştığımız açıkça gönderilir (yanlış temaya yazma riski). */
            const { items, total } = await api.listCmsCollections(site.themeId);
            return okResult({
                total,
                collections: items.map((c) => ({
                    id: c._id,
                    slug: c.slug,
                    name: c.name ?? [],
                    displayField: c.displayField ?? null,
                    fieldCount: c.fieldCount ?? (c.fields || []).length,
                    itemCount: c.itemCount ?? 0,
                })),
                next: "Alan şeması için: get_cms_collection(collection: \"<slug>\")",
            });
        })
    );
}
