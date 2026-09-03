/**
 * delete_product — soft delete (deleteCode:1). delete_page / delete_cms_item ile
 * aynı sözleşme: `confirm:true` kullanıcı onayını temsil eder.
 *
 * Silmeden önce ürün OKUNUR ama YALNIZ gerekiyorsa: uç (DELETE /products/:id)
 * yalnız id kabul ettiği için slug/SKU'nun id'ye çevrilmesi gerekir, okuma
 * ayrıca "hangi ürünü sildim" bilgisini verir. Ref zaten 24-hex id ise okuma
 * ATLANIR — çünkü GET /products/:ref `products:read`, DELETE ise yalnız
 * `products:write` ister: yalnız yazma yetkili bir anahtarda zorunlu okuma
 * silmeyi 403 ile düşürüyordu ve ajan yanlış scope'u arıyordu.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ApiError } from "../api.js";
import type { ServerContext } from "../context.js";
import { isProductId, langText, ProductRefSchema, productSite } from "./_products.js";
import { errorResult, okResult, wrapTool } from "./_shared.js";

export function registerDeleteProduct(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "delete_product",
        {
            title: "Ürünü sil",
            description:
                "Ürünü siler (soft delete: kayıt korunur, vitrinden ve panelden kalkar). Kullanıcı onayı olmadan ÇAĞIRMAYIN — confirm:true açık onayı temsil eder. Yayındaki bir ürünü silmek canlı bir adresi yok eder; geçici olarak gizlemek için upsert_products ile status:\"inactive\" tercih edin.",
            inputSchema: z.object({
                product: ProductRefSchema,
                confirm: z.literal(true).describe("Kullanıcı silmeyi açıkça onayladı"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
            _meta: { "anthropic/requiresUserInteraction": true },
        },
        wrapTool(ctx, "delete_product", async ({ product, confirm }) => {
            if (confirm !== true) return errorResult("Silme için confirm:true gerekir (kullanıcı onayı).");
            const api = ctx.requireApi();
            const site = await productSite(ctx);

            const ref = String(product).trim();

            /* Ref id ise okuma yapma (scope: bkz. dosya başı). Slug/SKU'da okuma
               şart; okuma yetkisi yoksa 403'ü ajanın çözebileceği bir yönergeye
               çevir — genel "yetki yok" mesajı kullanıcıyı products:write'ı
               aramaya itiyordu, eksik olan products:read. */
            let target: Awaited<ReturnType<typeof api.getProduct>> | null = null;
            if (!isProductId(ref)) {
                try {
                    target = await api.getProduct(ref);
                } catch (err) {
                    if (err instanceof ApiError && err.status === 403 && err.messageCode === "insufficient-scope") {
                        return errorResult(
                            `"${ref}" bir ürün id'si değil; adres/SKU'yu id'ye çevirmek için ürünü okumak gerekiyor ama API anahtarında products:read yok (silmenin kendisi yalnız products:write ister). Ürünün 24 haneli id'sini verip tekrar deneyin ya da panelden (Ayarlar → API Anahtarları) products:read yetkisi de olan bir anahtar üretin.`
                        );
                    }
                    throw err;
                }
            }

            const res = await api.deleteProduct(String(target?._id ?? ref));

            return okResult({
                productId: res._id ?? target?._id ?? ref,
                deleted: true,
                /* Okuma atlandıysa ürünün adı/durumu bilinmiyor — uydurma alan
                   basmak yerine hiç basmıyoruz; ajan gerekirse önceden okur. */
                ...(target
                    ? {
                        slug: target.slug,
                        title: langText(target.name, site.lang),
                        previousStatus: target.status,
                    }
                    : {}),
                ...(target?.status === "active"
                    ? { warnings: ["Ürün YAYINDAYDI — vitrindeki adresi artık 404 verir."] }
                    : {}),
            });
        })
    );
}
