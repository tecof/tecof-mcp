/**
 * get_product — tek ürünün tamamı (varyantlar, görseller, çok dilli alanlar).
 *
 * upsert_products ürünün TÜM varyantlarını fiyatıyla birlikte istediği için
 * güncellemeden önce bu araç ZORUNLUDUR: buradaki sku + price değerleri
 * kopyalanmazsa sunucu fiyatı 0'a düşürür ya da ikiz varyant açar.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { detailProduct, ProductRefSchema, productSite } from "./_products.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerGetProduct(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_product",
        {
            title: "Ürünü getir",
            description:
                "Bir ürünün tamamını döner: çok dilli ad/açıklamalar, marka, kategoriler, etiketler, görseller (CDN URL'leriyle) ve varyantlar (sku, fiyat, liste fiyatı, stok). Fiyat/stok güncellemeden ÖNCE çağırın — upsert_products varyantların tamamını güncel fiyatlarıyla ister.",
            inputSchema: z.object({ product: ProductRefSchema }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "get_product", async ({ product }) => {
            const api = ctx.requireApi();
            const site = await productSite(ctx);
            const found = await api.getProduct(String(product).trim());
            return okResult({
                ...detailProduct(found, site.lang, site.panelUrl),
                ...(site.warning ? { warnings: [site.warning] } : {}),
            });
        })
    );
}
