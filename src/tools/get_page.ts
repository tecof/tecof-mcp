/**
 * get_page — outline (varsayılan): kök props + bölüm/slot ağacı (id, type, kısa
 * metin); full: draftData JSON. update_page için id'ler outline'dan alınır.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { buildOutline } from "../document/outline.js";
import { emptyDocument } from "../document/tree.js";
import { fetchPage, okResult, PageRefSchema, panelUrlFor, wrapTool } from "./_shared.js";

export function registerGetPage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_page",
        {
            title: "Sayfayı getir",
            description:
                "Bir sayfanın taslağını döner. mode=outline (varsayılan): bölümler ve slot çocukları id/type/kısa metinle — update_page için id'leri buradan alın. mode=full: tam draftData JSON.",
            inputSchema: z.object({
                page: PageRefSchema,
                mode: z.enum(["outline", "full"]).optional(),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "get_page", async ({ page, mode }) => {
            const site = await ctx.requireTheme();
            const detail = await fetchPage(ctx, page);
            const snapshot = await ctx.catalog.load();
            const doc = detail.draftData ?? emptyDocument();

            const base = {
                page: {
                    id: detail._id,
                    slug: detail.slug,
                    title: detail.title,
                    status: detail.status,
                    isTemplate: !!detail.isTemplate,
                    hasPublished: !!detail.hasPublished,
                    modifiedDate: detail.modifiedDate ?? null,
                    publishedDate: detail.publishedDate ?? null,
                    metaTitle: detail.metaTitle ?? [],
                    metaDescription: detail.metaDescription ?? [],
                    urls: { panel: panelUrlFor(ctx, detail, site) },
                },
                warnings: [
                    ...(detail.draftData ? [] : ["Sayfanın draftData'sı boş; önizleme 404 verir. update_page ile bölüm ekleyin."]),
                    ...(detail.isTemplate ? ["Şablon sayfa: API üzerinden değiştirilemez."] : []),
                ],
            };

            if (mode === "full") {
                return okResult({ ...base, draftData: doc });
            }
            return okResult({ ...base, outline: buildOutline(doc, snapshot.byName, site.lang) });
        })
    );
}
