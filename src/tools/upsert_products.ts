/**
 * upsert_products — ürün oluşturur ya da günceller (tek çağrıda ≤200 kalem).
 *
 * Anahtar sırası: `slug` → gövdedeki varyant `sku`'larından biri. Aynı anahtarla
 * ikinci çağrı ürünü GÜNCELLER, kopya açmaz.
 *
 * Sayfa/CMS araçlarından ayrılan iki nokta ısrarla tekrarlanır:
 *  - Yazma TASLAK DEĞİLDİR: `status:"active"` ürünü anında vitrine çıkarır.
 *  - Gönderilmeyen alan KORUNUR ("yalnız dolu alan yazılır"); bu artık varyant
 *    listesi için de geçerli: `variants` hiç gönderilmezse mevcut varyantlara
 *    dokunulmaz. Gönderildiğinde eşleşme SKU iledir ve listede olmayan varyant
 *    SİLİNMEZ — bkz. _products.ts UpsertProductSchema/UpsertVariantSchema yorumu.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { formatUpsertReport, MAX_UPSERT_ITEMS, productSite, UpsertProductSchema } from "./_products.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerUpsertProducts(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "upsert_products",
        {
            title: "Ürünleri oluştur / güncelle",
            description:
                "Ürün oluşturur ya da günceller (tek çağrıda en fazla 200 kalem; tek ürün için tek elemanlı liste verin). Anahtar: slug, yoksa varyant SKU'su — aynı anahtar ikinci kez gönderilirse ürün güncellenir, kopya açılmaz. Marka/kategori/etiket ADIYLA çözülür, yoksa açılır; görsel URL'i sunucuda indirilir. Kısmi güncelleme doğaldır: yalnız değiştireceğiniz alanları gönderin — varyantlara dokunmayacaksanız `variants` alanını HİÇ göndermeyin (ör. {slug, status}); varyant fiyat/stoğu değişecekse yalnız o varyantları sku ile gönderin. Hangi SKU'ların olduğundan emin değilseniz önce get_product çağırın. DİKKAT: yazma taslak değildir, status:\"active\" ürünü anında vitrine çıkarır — önce dryRun:true ile deneyin.",
            inputSchema: z.object({
                items: z
                    .array(UpsertProductSchema)
                    .min(1)
                    .max(MAX_UPSERT_ITEMS)
                    .describe(`Ürün listesi (1-${MAX_UPSERT_ITEMS}). Bir kalemin hatası diğerlerini düşürmez; o kalem "skipped" olur ve issues[]'a yazılır.`),
                dryRun: z
                    .boolean()
                    .optional()
                    .describe("true → hiçbir şey yazılmaz, yalnız ne olacağı (created/updated/skipped + hatalar) raporlanır. Toplu aktarımdan önce çalıştırın."),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "upsert_products", async ({ items, dryRun }) => {
            const api = ctx.requireApi();
            const site = await productSite(ctx);

            const report = await api.upsertProducts(items, { dryRun: dryRun === true });
            const formatted = formatUpsertReport(report, site.panelUrl);

            /* Vitrine çıkan ürünü kullanıcıya AÇIKÇA söyle: sayfa/CMS'te yazma
               taslaktı, burada değil. Ajanın raporu "kaydedildi" diye özetleyip
               canlıya çıktığını atlamaması için ayrı bir alan. */
            const published = dryRun !== true
                ? items.filter((it: any) => it?.status === "active").length
                : 0;

            const warnings: string[] = [];
            if (site.warning) warnings.push(site.warning);
            if (published > 0) warnings.push(`${published} ürün status:"active" ile YAYINDA — vitrinde görünür.`);
            if (report.skipped > 0) warnings.push(`${report.skipped} kalem atlandı; issues[] içindeki "error" satırlarına bakın.`);

            return okResult({
                ...formatted,
                ...(warnings.length ? { warnings } : {}),
                hint: dryRun === true
                    ? "Ön kontrol tamam. Aynı items ile dryRun'sız çağırarak yazın."
                    : "Sonucu get_product ile doğrulayabilirsiniz; fiyat değişiklikleri fiyat geçmişine yazıldı.",
            });
        })
    );
}
