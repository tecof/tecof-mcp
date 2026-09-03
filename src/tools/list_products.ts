/**
 * list_products — katalog listesi (sayfalı, filtreli).
 * Satırlar HAFİFTİR: açıklama dönmez, görselden yalnız kapak gelir. Varyant
 * fiyat/stoğu için `detail:"full"`, tam gövde için get_product.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { PRODUCT_STATUSES, productSite, summarizeProduct } from "./_products.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerListProducts(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "list_products",
        {
            title: "Ürünleri listele",
            description:
                "Mağaza kataloğunu listeler (ad, adres, durum, marka/kategori/etiket adları, stok, kapak görseli). Filtreler: arama, durum, kategori/marka/etiket (id, slug ya da ad), son değişiklik tarihi. detail:\"full\" varyant sku/fiyat/stok değerlerini de getirir — güncelleme yapmadan önce buna ya da get_product'a bakın.",
            inputSchema: z.object({
                search: z.string().optional().describe("Ürün adı, adresi ya da SKU içinde arama"),
                status: z.enum(PRODUCT_STATUSES).optional(),
                category: z.string().optional().describe("Kategori id / slug / ad"),
                brand: z.string().optional().describe("Marka id / slug / ad"),
                tag: z.string().optional().describe("Etiket id / slug / ad"),
                updatedSince: z.string().optional().describe("ISO 8601 — bu tarihten sonra değişenler"),
                page: z.number().int().min(1).optional(),
                limit: z.number().int().min(1).max(200).optional().describe("varsayılan 30, en fazla 200"),
                detail: z
                    .enum(["summary", "full"])
                    .optional()
                    .describe('varsayılan "summary". "full": her satıra varyantlar (sku, fiyat, stok) ve fiyat aralığı eklenir.'),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "list_products", async ({ search, status, category, brand, tag, updatedSince, page, limit, detail }) => {
            const api = ctx.requireApi();
            const site = await productSite(ctx);
            const full = detail === "full";

            const { items, total } = await api.listProducts({
                search,
                status,
                category,
                brand,
                tag,
                updatedSince,
                page,
                limit,
                fields: full ? "full" : undefined,
            });

            return okResult({
                total,
                page: page ?? 1,
                limit: limit ?? 30,
                detail: full ? "full" : "summary",
                items: items.map((p) => summarizeProduct(p, site.lang, site.panelUrl)),
                ...(site.warning ? { warnings: [site.warning] } : {}),
            });
        })
    );
}
