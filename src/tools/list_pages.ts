/**
 * list_pages — temanın sayfaları (slug artan). Şablon sayfalar varsayılan dışarıda:
 * API onları değiştiremez, ajanı yanıltmasın.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerListPages(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "list_pages",
        {
            title: "Sayfaları listele",
            description: "Aktif temadaki sayfaları listeler (id, slug, başlık, durum: draft/published/changed, tarihler).",
            inputSchema: z.object({
                includeTemplates: z.boolean().optional().describe("Şablon sayfaları da dahil et (salt-okunur)"),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "list_pages", async ({ includeTemplates }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const res = await api.listPages({ themeId: site.themeId, includeTemplates: !!includeTemplates });
            return okResult({
                themeId: res.themeId ?? site.themeId,
                total: res.total,
                pages: res.items.map((p) => ({
                    id: p._id,
                    slug: p.slug,
                    title: p.title,
                    status: p.status,
                    isTemplate: !!p.isTemplate,
                    templateType: p.templateType ?? null,
                    publishedDate: p.publishedDate ?? null,
                    modifiedDate: p.modifiedDate ?? null,
                })),
            });
        })
    );
}
