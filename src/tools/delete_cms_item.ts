/**
 * delete_cms_item — soft delete. delete_page ile aynı sözleşme: confirm:true
 * kullanıcı onayını temsil eder, yayındaki içerik ayrıca allowPublishedEdit ister
 * (canlı bir URL yok olur).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { cmsErrorResult, CollectionRefSchema, ItemRefSchema } from "./_cms.js";
import { errorResult, okResult, wrapTool } from "./_shared.js";

export function registerDeleteCmsItem(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "delete_cms_item",
        {
            title: "İçeriği sil",
            description:
                "CMS içeriğini siler (soft delete; panelden geri alınabilir). Kullanıcı onayı olmadan ÇAĞIRMAYIN — confirm:true açık onayı temsil eder. Yayındaki içerik için ayrıca allowPublishedEdit:true gerekir: canlı bir adres yok olur.",
            inputSchema: z.object({
                collection: CollectionRefSchema,
                item: ItemRefSchema,
                confirm: z.literal(true).describe("Kullanıcı silmeyi açıkça onayladı"),
                allowPublishedEdit: z.boolean().optional().describe("Yayındaki içeriğin silinmesi de onaylandı"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
            _meta: { "anthropic/requiresUserInteraction": true },
        },
        wrapTool(ctx, "delete_cms_item", async ({ collection, item, confirm, allowPublishedEdit }) => {
            if (confirm !== true) return errorResult("Silme için confirm:true gerekir (kullanıcı onayı).");
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const target = await api.getCmsItem(collection, item, site.themeId);

            try {
                const res = await api.deleteCmsItem(collection, target._id, {
                    themeId: site.themeId,
                    ...(allowPublishedEdit === true ? { allowPublishedEdit: true } : {}),
                });
                return okResult({
                    itemId: res._id ?? target._id,
                    slug: res.slug ?? target.slug,
                    status: res.status ?? "deleted",
                    deleted: true,
                });
            } catch (err) {
                const mapped = cmsErrorResult(err);
                if (mapped) return mapped;
                throw err;
            }
        })
    );
}
