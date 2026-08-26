/**
 * list_cms_items — bir koleksiyonun içerik kayıtları (özet).
 * `data` gövdesi listede DÖNMEZ (uzun olur); tek kaydın tamamı için get_cms_item.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import type { CmsItem } from "../types.js";
import { CollectionRefSchema } from "./_cms.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerListCmsItems(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "list_cms_items",
        {
            title: "İçerikleri listele",
            description:
                "Bir CMS koleksiyonundaki içerikleri listeler (id, slug, durum, tarihler). Durum: draft | scheduled | published. Kaydın alan verisi için get_cms_item kullanın.",
            inputSchema: z.object({
                collection: CollectionRefSchema,
                status: z.enum(["draft", "scheduled", "published"]).optional(),
                search: z.string().optional().describe("slug içinde arama"),
                page: z.number().int().min(1).optional(),
                limit: z.number().int().min(1).max(200).optional().describe("varsayılan 50, en fazla 200"),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "list_cms_items", async ({ collection, status, search, page, limit }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const { items, total, meta } = await api.listCmsItems(collection, { themeId: site.themeId, status, search, page, limit });

            /* Etiket (displayField) listede DÖNER: yoksa ajan "AI trendleri
               başlıklı yazıyı güncelle" isteğinde her kayıt için ayrı
               get_cms_item çağırmak zorunda kalıyordu (N+1). `data` gövdesi
               yine dönmez — uzun içerik listeyi şişirir. */
            const displayField = meta.displayField || "title";
            const labelOf = (item: CmsItem): string => {
                const raw = (item.data ?? {})[displayField];
                if (typeof raw === "string") return raw;
                if (Array.isArray(raw)) {
                    const rows = raw as Array<{ code?: string; value?: string }>;
                    const hit = rows.find((r) => r?.code === site.lang.defaultLanguage) ?? rows[0];
                    return String(hit?.value ?? "");
                }
                return "";
            };

            return okResult({
                collectionId: meta.collectionId ?? null,
                collectionSlug: meta.collectionSlug ?? null,
                displayField,
                total,
                items: items.map((item) => ({
                    id: item._id,
                    slug: item.slug,
                    title: labelOf(item),
                    status: item.status,
                    publishedDate: item.publishedDate ?? null,
                    modifiedDate: item.modifiedDate ?? null,
                })),
            });
        })
    );
}
