/**
 * get_preview_url — taslak önizleme linkleri (storefront + local). Token 1 saat
 * geçerli; draftData boşsa tema 404 verir, uyarı ekleriz.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { fetchPage, okResult, PageRefSchema, panelUrlFor, rewriteLocalUrl, wrapTool } from "./_shared.js";

export function registerGetPreviewUrl(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_preview_url",
        {
            title: "Önizleme URL'si al",
            description:
                "Sayfanın TASLAK hâli için 1 saat geçerli önizleme bağlantıları: yayındaki domain (storefront) ve yerel geliştirme (TECOF_LOCAL_URL). Yayınlama panelden yapılır.",
            inputSchema: z.object({
                page: PageRefSchema,
                locale: z.string().optional().describe("Dil kodu (varsayılan: mağazanın varsayılan dili)"),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "get_preview_url", async ({ page, locale }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const detail = await fetchPage(ctx, page);
            const res = await api.previewUrl(detail._id, { locale });
            const warnings: string[] = [];
            if (!detail.draftData) warnings.push("Sayfanın draftData'sı boş; önizleme 404 verir.");
            if (!res.storefrontUrl) warnings.push("Temaya bağlı domain yok; yalnız yerel önizleme kullanılabilir.");
            return okResult({
                pageId: detail._id,
                slug: detail.slug,
                locale: res.locale,
                expiresAt: res.expiresAt,
                urls: {
                    storefrontPreview: res.storefrontUrl ?? null,
                    localPreview: rewriteLocalUrl(res.localUrlTemplate, ctx.config.localUrl),
                    panel: panelUrlFor(ctx, detail, site),
                },
                warnings,
            });
        })
    );
}
