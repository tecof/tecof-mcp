/**
 * get_cms_item — tek içeriğin tam gövdesi.
 * update_cms_item `data`yı TÜMÜYLE değiştirdiği için güncellemeden önce bu araçla
 * okumak ZORUNLUDUR; ayrıca `modifiedDate` iyimser kilit için kullanılır.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { CollectionRefSchema, ItemRefSchema } from "./_cms.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerGetCmsItem(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_cms_item",
        {
            title: "İçeriği getir",
            description:
                "Bir CMS içeriğinin tamamını döner (data, meta, durum, modifiedDate). update_cms_item data'yı tamamen değiştirdiği için önce bunu çağırın; modifiedDate'i expectedModifiedDate olarak geri gönderirseniz eşzamanlı düzenleme 409 ile korunur.",
            inputSchema: z.object({ collection: CollectionRefSchema, item: ItemRefSchema }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "get_cms_item", async ({ collection, item }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const found = await api.getCmsItem(collection, item, site.themeId);
            return okResult({
                id: found._id,
                collectionId: found.collectionId,
                slug: found.slug,
                status: found.status,
                data: found.data ?? {},
                metaTitle: found.metaTitle ?? [],
                metaDescription: found.metaDescription ?? [],
                publishedDate: found.publishedDate ?? null,
                modifiedDate: found.modifiedDate ?? null,
            });
        })
    );
}
