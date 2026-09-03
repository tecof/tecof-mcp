/**
 * Ürün araçlarının ortak parçaları: zod şemaları, çok dilli alan indirgeme,
 * ürün özeti/detayı ve panel bağlantısı.
 *
 * İki sözleşme farkı sayfa/CMS araçlarından ayrılır ve her yerde tekrarlanır:
 *  1. Ürün TEMAYA bağlı değildir → `requireTheme()` ÇAĞRILMAZ. Teması bozuk
 *     (ya da hiç kurulu olmayan) bir mağazada da katalog yönetilebilmeli.
 *  2. Ürün yazması TASLAK DEĞİLDİR → `status:"active"` doğrudan vitrine çıkar.
 */

import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import type { LanguageContext } from "../document/fields.js";
import type { Product, ProductUpsertReport } from "../types.js";

export const PRODUCT_STATUSES = ["active", "inactive", "draft"] as const;
export const PRODUCT_TYPES = ["simple", "variable", "grouped", "digital"] as const;

/** Backend sınırları — aşan istek zaten 400 döner, burada erken yakalıyoruz. */
export const MAX_UPSERT_ITEMS = 200;
export const MAX_VARIANTS_PER_PRODUCT = 200;
export const MAX_IMAGES_PER_PRODUCT = 30;

export const ProductRefSchema = z
    .string()
    .min(1)
    .describe("Ürün id'si (24 hex), adresi (slug) ya da varyant stok kodu (SKU) — backend üçünü de dener");

/**
 * Referans zaten 24-hex id mi?
 *
 * NEDEN: `DELETE /api/v1/products/:id` yalnız `products:write` ister ama
 * slug/SKU'yu id'ye çevirmek için yapılan `GET /products/:ref` `products:read`
 * ister. Ref id ise okuma tamamen ATLANIR; yalnız yazma yetkili bir anahtar da
 * ürün silebilsin diye (bkz. delete_product).
 */
export const isProductId = (ref: string): boolean => /^[0-9a-f]{24}$/i.test(ref.trim());

/** Çok dilli metin kısayolu: "metin" | {tr:"…",en:"…"} | [{code,value}] */
const LangTextSchema = z
    .union([z.string(), z.record(z.string(), z.string()), z.array(z.object({ code: z.string(), value: z.string() }))])
    .describe('Çok dilli metin: "metin" | {tr:"…",en:"…"} | [{code,value}]. Düz string varsayılan dile yazılır.');

/**
 * Varyant girdisi.
 *
 * `price` ARTIK OPSİYONEL: eskiden backend gövdede fiyat yoksa `price ?? 0`
 * varsayılanını yazıp mevcut varyantın fiyatını SIFIRLIYORDU, bu yüzden şema
 * onu zorunlu tutup ajanı "önce get_product, sonra aynı fiyatla geri gönder"
 * kalıbına zorluyordu. Backend (app/src/productService.ts) artık varyant başına
 * `explicit` bayrağı taşıyor: gövdede fiyat yoksa fiyata DOKUNMUYOR. Zorunluluk
 * kalkınca "sadece stok güncelle" gibi kısmi çağrılar doğal biçimde yazılabilir.
 */
const UpsertVariantSchema = z.looseObject({
    sku: z
        .string()
        .min(1)
        .optional()
        .describe(
            "Stok kodu — güncellemenin anahtarı. VAR OLAN ürünü güncellerken get_product'taki SKU'yu birebir kopyalayın; eşleşmeyen SKU yeni varyant EKLER (varyant silme panel işidir). Yeni üründe boş bırakılabilir: backend adres + varyant değerlerinden türetir."
        ),
    price: z.number().min(0).optional().describe("Satış fiyatı. YENİ üründe gönderilmezse 0 yazılır; MEVCUT varyantta gönderilmezse fiyata dokunulmaz."),
    compareAtPrice: z.number().min(0).nullable().optional().describe("Üstü çizili liste fiyatı"),
    barcode: z.string().optional(),
    weight: z.number().min(0).optional().describe("kg"),
    stock: z.number().int().min(0).optional().describe("Varsayılan depoya yazılır. Gönderilmezse mevcut stok KORUNUR."),
    stocks: z
        .array(z.object({ stockLocationId: z.string().min(1), quantity: z.number().int().min(0) }))
        .optional()
        .describe("Depo bazlı stok (stockLocationId 24-hex). `stock` ile birlikte gönderilirse bu kazanır."),
    isActive: z.boolean().optional(),
    options: z
        .record(z.string(), z.string())
        .optional()
        .describe('Varyant ekseni ADIYLA: {"Beden":"S","Renk":"Siyah"}. Eksen ve değer yoksa AÇILIR; eksen sırası ilk görüldüğü sıradır.'),
});

/** Görsel: kütüphane dosyası (uploadId/name) ya da indirilecek URL. */
const UpsertImageSchema = z.union([
    z.string().describe('"https://…" (indirilir) ya da kütüphanedeki dosya adı'),
    z.looseObject({
        uploadId: z.string().optional().describe("Kütüphanedeki dosyanın 24-hex id'si (list_media / import_image çıktısı)"),
        name: z.string().optional().describe("Kütüphanede DOSYA ADIYLA arar"),
        url: z.string().optional().describe("Uzak görsel — SSRF korumalı indirilir, istek başına ≤50, aynı URL bir kez"),
    }),
]);

/**
 * Tek ürün girdisi. `looseObject`: backend'in bildiği ama burada
 * numaralandırmadığımız alanlar (attributes, personalizationFields…) olduğu gibi
 * geçsin — MCP şeması backend sözleşmesini daraltmamalı.
 */
export const UpsertProductSchema = z.looseObject({
    slug: z
        .string()
        .min(1)
        .optional()
        .describe("Ürün adresi — UPSERT ANAHTARI. Aynı slug ikinci kez gönderilirse ürün GÜNCELLENİR. Boşsa addan üretilir."),
    name: LangTextSchema.optional().describe("Ürün adı. Yeni üründe slug ya da name zorunlu."),
    shortDescription: LangTextSchema.optional(),
    description: LangTextSchema.optional().describe("HTML olabilir"),
    metaTitle: LangTextSchema.optional(),
    metaDescription: LangTextSchema.optional(),
    status: z
        .enum(PRODUCT_STATUSES)
        .optional()
        .describe('Yeni üründe varsayılan "draft". DİKKAT: "active" ürünü ANINDA vitrine çıkarır (taslak değildir). Gönderilmezse mevcut durum korunur.'),
    type: z.enum(PRODUCT_TYPES).optional().describe("Verilmezse varyant sayısına göre simple/variable seçilir"),
    brand: z.string().optional().describe("Marka ADI — yoksa açılır"),
    categories: z.array(z.string()).optional().describe("Kategori adı ya da slug'ı — yoksa açılır"),
    tags: z.array(z.string()).optional().describe("Etiket adı — yoksa açılır"),
    images: z.array(UpsertImageSchema).max(MAX_IMAGES_PER_PRODUCT).optional(),
    weight: z.number().min(0).optional(),
    maxQuantityPerCart: z.number().int().min(1).nullable().optional(),
    /* `variants` ARTIK OPSİYONEL (eskiden `.min(1)` zorunluydu).
       Zorunluluk `price` zorunluyken anlamlıydı; backend
       (app/src/productService.ts, BuiltItem.explicit) artık varyant dizisinin
       gövdede VAR OLUP OLMADIĞINI ayrıca taşıyor: dizi yoksa ne sentetik
       varyant ekliyor ne de totalStock'u ezliyor. Şema zorunlu tuttuğu sürece
       "sadece durumu değiştir" gibi kısmi bir çağrı ya fazladan bir get_product
       turuna ya da uydurma bir varyant kalemine mecburdu — ikincisi backend'in
       kapattığı hayalet varyantı elle geri açıyordu. */
    variants: z
        .array(UpsertVariantSchema)
        .min(1)
        .max(MAX_VARIANTS_PER_PRODUCT)
        .optional()
        .describe(
            "Varyantlar — YALNIZ varyant fiyat/stok/durum/barkod bilgisini değiştirecekseniz gönderin. HİÇ göndermezseniz mevcut varyantlara DOKUNULMAZ (ör. {slug, status} ile yalnız durumu değiştirin); boş dizi geçersizdir. Gönderdiğinizde: sku anahtardır, gönderilmeyen price/stock/isActive korunur, listede olmayan varyant SİLİNMEZ, eşleşmeyen SKU yeni varyant EKLER. Yeni üründe fiyat/stok yazmak için tek elemanlı liste verin (verilmezse sunucu fiyatı 0 olan tek varyant üretir)."
        ),
});

const FALLBACK_LANG: LanguageContext = { languages: ["tr"], defaultLanguage: "tr" };

export type ProductSite = {
    lang: LanguageContext;
    /** Panel kökü (https://app.tecof.com) — ürün bağlantıları için */
    panelUrl: string | null;
    warning: string | null;
};

/**
 * Ürün araçlarının site bağlamı. `requireTheme` YERİNE bu kullanılır: ürün
 * temadan bağımsızdır, tema çözülemedi diye katalog kilitlenmemeli. /me hiç
 * alınamazsa varsayılan dille devam edilir — asıl yetki hatası zaten API
 * çağrısının kendisinden anlaşılır (401/403).
 */
export async function productSite(ctx: ServerContext): Promise<ProductSite> {
    try {
        const site = await ctx.site();
        return { lang: site.lang, panelUrl: site.me.panelUrl || null, warning: null };
    } catch (err: any) {
        return {
            lang: FALLBACK_LANG,
            panelUrl: null,
            warning: `Mağaza bilgisi alınamadı (${err?.message ?? err}); varsayılan dil "tr" kullanıldı.`,
        };
    }
}

export function panelProductUrl(panelUrl: string | null, productId: string | null | undefined): string | null {
    if (!panelUrl || !productId) return null;
    return `${panelUrl.replace(/\/+$/, "")}/app/ecommerce/products/${productId}`;
}

/** Çok dilli alanı ([{code,value}]) tek okunur metne indirger. */
export function langText(value: unknown, lang: LanguageContext): string {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    const rows = value as Array<{ code?: string; value?: string }>;
    const hit = rows.find((r) => r?.code === lang.defaultLanguage) ?? rows[0];
    return String(hit?.value ?? "");
}

const refNames = (list: Array<{ name: string | null }> | undefined): string[] =>
    (list ?? []).map((r) => r?.name ?? "").filter(Boolean);

/** Varyantların fiyat aralığı — listede tek satırda "349.9 – 399" göstermek için. */
function priceRange(p: Product): { min: number; max: number } | null {
    const prices = (p.variants ?? []).map((v) => Number(v.price) || 0);
    if (!prices.length) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Liste satırı — ajan için okunur, kısa. Çok dilli ad tek metne iner, görselden
 * yalnız ilki (kapak) gelir; tam gövde için get_product.
 */
export function summarizeProduct(p: Product, lang: LanguageContext, panelUrl: string | null): Record<string, unknown> {
    const range = priceRange(p);
    return {
        id: p._id,
        slug: p.slug,
        name: langText(p.name, lang),
        status: p.status,
        type: p.type,
        brand: p.brand?.name ?? null,
        categories: refNames(p.categories),
        tags: refNames(p.tags),
        totalStock: p.totalStock ?? 0,
        variantCount: p.variantCount ?? (p.variants?.length ?? 0),
        ...(range ? { price: range.min === range.max ? range.min : range } : {}),
        ...(p.variants
            ? {
                variants: p.variants.map((v) => ({ sku: v.sku, price: v.price, stock: v.stock, isActive: v.isActive })),
            }
            : {}),
        coverImage: p.images?.[0]?.url ?? null,
        modifiedDate: p.modifiedDate ?? null,
        panelUrl: panelProductUrl(panelUrl, p._id),
    };
}

/**
 * Tek ürünün tam gövdesi. Çok dilli alanlar HAM ([{code,value}]) döner —
 * upsert_products'a olduğu gibi geri verilebilsin diye; okunabilirlik için
 * ayrıca `title` (varsayılan dildeki ad) eklenir.
 */
export function detailProduct(p: Product, lang: LanguageContext, panelUrl: string | null): Record<string, unknown> {
    return {
        id: p._id,
        slug: p.slug,
        title: langText(p.name, lang),
        name: p.name ?? [],
        status: p.status,
        type: p.type,
        brand: p.brand ? { id: p.brand._id, name: p.brand.name, slug: p.brand.slug } : null,
        categories: (p.categories ?? []).map((c) => ({ id: c._id, name: c.name, slug: c.slug })),
        tags: (p.tags ?? []).map((t) => ({ id: t._id, name: t.name, slug: t.slug })),
        shortDescription: p.shortDescription ?? [],
        description: p.description ?? [],
        metaTitle: p.metaTitle ?? [],
        metaDescription: p.metaDescription ?? [],
        weight: p.weight ?? null,
        maxQuantityPerCart: p.maxQuantityPerCart ?? null,
        totalStock: p.totalStock ?? 0,
        avgRating: p.avgRating ?? 0,
        reviewCount: p.reviewCount ?? 0,
        images: (p.images ?? []).map((img) => ({
            uploadId: img.uploadId,
            name: img.name,
            url: img.url,
            order: img.order,
            variantId: img.variantId,
        })),
        variants: (p.variants ?? []).map((v) => ({
            id: v._id,
            sku: v.sku,
            barcode: v.barcode,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            weight: v.weight,
            isActive: v.isActive,
            stock: v.stock,
            stocks: v.stocks ?? [],
            /* Eksen adları ("Beden: S") yerine id'ler dönüyor — v1 çıktısında
               varyant tipi adı yok. Ajan eksen adını upsert'te `options` ile
               yeniden verebilir; buradan okuyamaz. */
            variantValues: v.variantValues ?? [],
        })),
        attributes: p.attributes ?? [],
        personalizationFields: p.personalizationFields ?? [],
        modifiedDate: p.modifiedDate ?? null,
        createDate: p.createDate ?? null,
        panelUrl: panelProductUrl(panelUrl, p._id),
    };
}

/**
 * Toplu upsert raporunu ajan için okunur hâle getirir: sayaçlar + kalem başına
 * sonuç + hata/uyarı listesi. `issues` uzun olabilir (200'e kadar), ilk 50 satır
 * yeter — kalanı sayı olarak bildirilir.
 */
export function formatUpsertReport(report: ProductUpsertReport, panelUrl: string | null): Record<string, unknown> {
    const issues = Array.isArray(report.issues) ? report.issues : [];
    const errors = issues.filter((i) => i.level === "error");
    return {
        dryRun: report.dryRun === true,
        created: report.created ?? 0,
        updated: report.updated ?? 0,
        skipped: report.skipped ?? 0,
        errorCount: errors.length,
        issueCount: report.issueCount ?? issues.length,
        issues: issues.slice(0, 50),
        ...(issues.length > 50 ? { issuesTruncated: issues.length - 50 } : {}),
        items: (report.items ?? []).map((it) => ({
            index: it.index,
            slug: it.slug,
            productId: it.productId,
            outcome: it.outcome,
            panelUrl: panelProductUrl(panelUrl, it.productId),
        })),
    };
}
