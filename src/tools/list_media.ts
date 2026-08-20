/**
 * list_media — mağazanın medya kütüphanesindeki görselleri listeler. Dönen her
 * öğe doğrudan bir bölümün `upload` alanına konabilir (create_page/update_page).
 * Hassas (KYC/private) dosyalar backend'de dışlanır.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerListMedia(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "list_media",
        {
            title: "Medya kütüphanesini listele",
            description:
                "Mağazanın yüklü görsellerini listeler. Dönen obje doğrudan bir bölümün görsel (upload) alanına konabilir. search ile ada göre süz.",
            inputSchema: z.object({
                search: z.string().optional().describe("Dosya adında arama"),
                page: z.number().int().positive().optional(),
                limit: z.number().int().positive().max(100).optional().describe("Sayfa başına (varsayılan 30, en fazla 100)"),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "list_media", async ({ search, page, limit }) => {
            const api = ctx.requireApi();
            const res = await api.listMedia({ search, page, limit });
            return okResult({
                total: res.total,
                media: res.items.map((m) => ({
                    _id: m._id,
                    name: m.name,
                    type: m.type,
                    folder: m.folder,
                    url: m.url,
                    width: (m.meta as any)?.width ?? null,
                    height: (m.meta as any)?.height ?? null,
                    // upload alanına konacak TAM obje (ajan bunu section props'una yerleştirir)
                    uploadValue: [m],
                })),
                hint: "Bir görseli kullanmak için o öğenin uploadValue'sini ilgili bölümün görsel alanına koyun.",
            });
        })
    );
}
