/**
 * delete_page — soft delete. confirm:true zorunlu + requiresUserInteraction meta:
 * geri alınması panel gerektiren bir işlem; ajan kullanıcıya sormadan çağırmasın.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { errorResult, fetchPage, okResult, PageRefSchema, wrapTool } from "./_shared.js";

export function registerDeletePage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "delete_page",
        {
            title: "Sayfayı sil",
            description:
                "Sayfayı siler (soft delete; panelden geri alınabilir). Kullanıcı onayı olmadan ÇAĞIRMAYIN — confirm:true kullanıcının açık onayını temsil eder. Şablon sayfalar silinemez.",
            inputSchema: z.object({
                page: PageRefSchema,
                confirm: z.literal(true).describe("Kullanıcı silmeyi açıkça onayladı"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
            _meta: { "anthropic/requiresUserInteraction": true },
        },
        wrapTool(ctx, "delete_page", async ({ page, confirm }) => {
            if (confirm !== true) return errorResult("Silme için confirm:true gerekir (kullanıcı onayı).");
            const api = ctx.requireApi();
            const detail = await fetchPage(ctx, page);
            if (detail.isTemplate) return errorResult(`"${detail.slug}" bir şablon sayfa; API üzerinden silinemez.`);
            const res = await api.deletePage(detail._id);
            return okResult({ pageId: res._id ?? detail._id, slug: res.slug ?? detail.slug, status: res.status ?? "deleted", deleted: true });
        })
    );
}
