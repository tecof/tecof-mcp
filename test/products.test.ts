/**
 * Ürün araçları — uçtan uca (gerçek McpServer + sahte backend).
 *
 * Sözleşmenin can alıcı noktaları: listenin hafifliği (detail:"full" ile
 * varyantlar), tek ürünün id|slug|SKU ile bulunması, upsert'in dryRun'da HİÇBİR
 * ŞEY yazmaması, "active" uyarısının görünmesi, silmede onay şartı ve
 * scope/404 hatalarının ajana okunur dönmesi.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ServerContext } from "../src/context.js";
import { buildServer } from "../src/server.js";
import type { TecofConfig } from "../src/config.js";
import { createFakeBackend, type FakeBackendOptions } from "./helpers/fakeBackend.js";
import { FIXTURE_THEME_DIR } from "./helpers/fixtures.js";
import { connectTestClient } from "./helpers/mcpClient.js";

const TISORT = {
    slug: "pamuklu-tisort",
    name: [{ code: "tr", value: "Pamuklu Tişört" }, { code: "en", value: "Cotton Tee" }],
    status: "active" as const,
    type: "variable" as const,
    brand: { _id: "b1", name: "Tecof", slug: "tecof" },
    categories: [{ _id: "c1", name: "Giyim", slug: "giyim" }],
    tags: [{ _id: "t1", name: "yaz", slug: "yaz" }],
    images: [{ uploadId: "u1", name: "tisort-1.jpg", folder: "/merchants/m1/products", url: "https://cdn.test/merchants/m1/products/tisort-1.jpg", order: 0, variantId: null }],
    totalStock: 8,
    variants: [
        { _id: "v1", sku: "TS-S", barcode: null, price: 349.9, compareAtPrice: 449.9, weight: 0.3, isActive: true, stock: 5, stocks: [], variantValues: [] },
        { _id: "v2", sku: "TS-M", barcode: null, price: 399, compareAtPrice: null, weight: 0.3, isActive: true, stock: 3, stocks: [], variantValues: [] },
    ],
};

const KUPA = {
    slug: "seramik-kupa",
    name: [{ code: "tr", value: "Seramik Kupa" }],
    status: "draft" as const,
    variants: [{ _id: "v3", sku: "KP-001", barcode: null, price: 129, compareAtPrice: null, weight: null, isActive: true, stock: 40, stocks: [], variantValues: [] }],
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
});

async function setup(backendOptions: FakeBackendOptions = {}) {
    const backend = createFakeBackend({
        pages: [{ slug: "home", title: "Ana Sayfa" }],
        scopes: ["products:read", "products:write"],
        products: [TISORT, KUPA],
        ...backendOptions,
    });
    const config: TecofConfig = {
        projectDir: FIXTURE_THEME_DIR,
        apiUrl: "https://api.example.com",
        themeId: backend.themeId,
        token: backend.token,
        localUrl: "http://localhost:3000",
        sources: {},
    };
    const ctx = new ServerContext({ config, fetch: backend.fetch as any, log: () => { } });
    const client = await connectTestClient(buildServer({ ctx }));
    cleanups.push(() => client.close());
    return { backend, client };
}

describe("list_products / get_product", () => {
    it("liste hafiftir; detail:\"full\" varyant ve fiyat aralığını getirir", async () => {
        const { client, backend } = await setup();

        const light = await client.callTool("list_products");
        expect(light.isError, light.text).toBe(false);
        expect(light.data.total).toBe(2);
        const tisort = light.data.items.find((p: any) => p.slug === "pamuklu-tisort");
        expect(tisort).toMatchObject({
            name: "Pamuklu Tişört",          // çok dilli alan varsayılan dile indi
            status: "active",
            brand: "Tecof",
            categories: ["Giyim"],
            tags: ["yaz"],
            variantCount: 2,
            totalStock: 8,
        });
        expect(tisort.coverImage).toContain("/merchants/m1/products/tisort-1.jpg"); // folder DÜŞMÜYOR
        expect(tisort.panelUrl).toBe("https://app.tecof.test/app/ecommerce/products/" + backend.products[0]._id);
        expect(tisort.variants).toBeUndefined(); // hafif liste varyant taşımaz
        expect(new URL(backend.calls.at(-1)!.url).searchParams.get("fields")).toBeNull();

        const full = await client.callTool("list_products", { detail: "full", search: "tisort" });
        expect(full.data.items).toHaveLength(1);
        expect(full.data.items[0].variants).toEqual([
            { sku: "TS-S", price: 349.9, stock: 5, isActive: true },
            { sku: "TS-M", price: 399, stock: 3, isActive: true },
        ]);
        expect(full.data.items[0].price).toEqual({ min: 349.9, max: 399 });
        expect(new URL(backend.calls.at(-1)!.url).searchParams.get("fields")).toBe("full");

        const draftOnly = await client.callTool("list_products", { status: "draft" });
        expect(draftOnly.data.items.map((p: any) => p.slug)).toEqual(["seramik-kupa"]);
    });

    it("get_product id|slug|SKU ile bulur, tam gövde döner; yoksa 404 ipucu list_products'a yollar", async () => {
        const { client } = await setup();

        const bySlug = await client.callTool("get_product", { product: "pamuklu-tisort" });
        expect(bySlug.isError, bySlug.text).toBe(false);
        expect(bySlug.data.title).toBe("Pamuklu Tişört");
        expect(bySlug.data.name).toEqual(TISORT.name);   // ham çok dilli dizi (upsert'e geri verilebilsin)
        expect(bySlug.data.variants.map((v: any) => v.sku)).toEqual(["TS-S", "TS-M"]);
        expect(bySlug.data.variants[0]).toMatchObject({ price: 349.9, compareAtPrice: 449.9, stock: 5 });
        expect(bySlug.data.brand).toMatchObject({ name: "Tecof" });

        const bySku = await client.callTool("get_product", { product: "TS-M" });
        expect(bySku.data.slug).toBe("pamuklu-tisort");

        const missing = await client.callTool("get_product", { product: "yok-boyle" });
        expect(missing.isError).toBe(true);
        expect(missing.text).toContain("HTTP 404");
        expect(missing.text).toContain("list_products");
    });
});

describe("upsert_products", () => {
    it("dryRun hiçbir şey yazmaz; gerçek çağrı oluşturur/günceller ve \"active\" uyarısı verir", async () => {
        const { client, backend } = await setup();
        const item = {
            slug: "deri-cuzdan",
            name: "Deri Cüzdan",
            status: "active",
            brand: "Tecof",
            categories: ["Aksesuar"],
            variants: [{ sku: "DC-001", price: 599.9, stock: 4 }],
        };

        const dry = await client.callTool("upsert_products", { items: [item], dryRun: true });
        expect(dry.isError, dry.text).toBe(false);
        expect(dry.data).toMatchObject({ dryRun: true, created: 1, updated: 0, skipped: 0 });
        expect(backend.products.map((p) => p.slug)).toEqual(["pamuklu-tisort", "seramik-kupa"]); // yazma YOK
        expect(dry.data.hint).toContain("dryRun'sız");

        const real = await client.callTool("upsert_products", { items: [item] });
        expect(real.data).toMatchObject({ dryRun: false, created: 1, updated: 0 });
        expect(real.data.items[0].panelUrl).toContain("/app/ecommerce/products/");
        /* Sayfa/CMS'te yazma taslaktı; üründe "active" ANINDA canlı — uyarı şart. */
        expect(real.data.warnings.join(" ")).toContain("YAYINDA");
        expect(backend.products.map((p) => p.slug)).toContain("deri-cuzdan");

        // Aynı slug ikinci kez → kopya değil güncelleme (idempotency anahtarı slug)
        const again = await client.callTool("upsert_products", { items: [{ ...item, status: "draft" }] });
        expect(again.data).toMatchObject({ created: 0, updated: 1 });
        expect(backend.products.filter((p) => p.slug === "deri-cuzdan")).toHaveLength(1);
        expect(again.data.warnings).toBeUndefined(); // "active" yok → uyarı da yok
    });

    it("varyantsız gövde uca olduğu gibi gider (varyantlar korunur); fiyatsız varyant canlı fiyatı BOZMAZ", async () => {
        const { client, backend } = await setup();
        const variantsBefore = backend.products[0].variants.length;

        /* `variants` GÖNDERİLMEZSE varyantlara dokunulmamalı. Şema eskiden listeyi
           zorunlu tutuyordu; ajan "yalnız durumu değiştir" için ya fazladan
           get_product turu atıyor ya da uydurma bir varyant kalemi yazıyordu —
           ikincisi backend'in kapattığı hayalet varyantı elle geri açıyordu. */
        const noVariants = await client.callTool("upsert_products", { items: [{ slug: "pamuklu-tisort", status: "inactive" }] });
        expect(noVariants.isError, noVariants.text).toBe(false);
        expect(noVariants.data).toMatchObject({ updated: 1 });
        // Gövdede `variants` ANAHTARI hiç yok — sunucunun explicit bayrağı buna bakıyor.
        expect(Object.keys(backend.calls.at(-1)!.body.items[0])).not.toContain("variants");
        expect(backend.products[0].status).toBe("inactive");
        expect(backend.products[0].variants).toHaveLength(variantsBefore);

        // Boş dizi hâlâ geçersiz: ya hiç gönderme ya da en az bir kalem koy.
        const emptyVariants = await client.callTool("upsert_products", { items: [{ slug: "pamuklu-tisort", variants: [] }] });
        expect(emptyVariants.isError).toBe(true);

        /* `price` ARTIK OPSİYONEL: backend varyant başına "bu alan gönderildi mi"
           bayrağı taşıyor ve fiyat yoksa DOKUNMUYOR. Eskiden şema onu zorunlu
           tutuyordu çünkü sunucu `price ?? 0` yazıp canlı fiyatı sıfırlıyordu. */
        const noPrice = await client.callTool("upsert_products", {
            items: [{ slug: "pamuklu-tisort", variants: [{ sku: "TS-S", stock: 9 }] }],
        });
        expect(noPrice.isError).toBeFalsy();
        expect(noPrice.data).toMatchObject({ updated: 1 });

        // Gövdede price ANAHTARI hiç yok — sunucunun bayrağı buna bakıyor.
        const sent = backend.calls[backend.calls.length - 1];
        expect(Object.keys(sent.body.items[0].variants[0])).not.toContain("price");

        expect(backend.products[0].variants[0].price).toBe(349.9);
        expect(backend.products[0].variants[0].stock).toBe(9);
    });

    it("kalem hatası diğerlerini düşürmez; rapor issues[] ile döner", async () => {
        const { client } = await setup();
        const res = await client.callTool("upsert_products", {
            items: [
                { name: "", variants: [{ price: 10 }] },                                  // slug/name yok → skipped
                { slug: "seramik-kupa", variants: [{ sku: "KP-001", price: 139 }] },      // güncellenir
            ],
        });
        expect(res.isError, res.text).toBe(false);
        expect(res.data).toMatchObject({ created: 0, updated: 1, skipped: 1, errorCount: 1 });
        expect(res.data.issues[0]).toMatchObject({ index: 0, level: "error" });
        expect(res.data.warnings.join(" ")).toContain("atlandı");
    });
});

describe("delete_product", () => {
    it("confirm olmadan silmez; sildiğinde yayındaki ürünü uyarır", async () => {
        const { client, backend } = await setup();

        const noConfirm = await client.callTool("delete_product", { product: "seramik-kupa" });
        expect(noConfirm.isError).toBe(true);   // zod: confirm literal true

        const ok = await client.callTool("delete_product", { product: "pamuklu-tisort", confirm: true });
        expect(ok.isError, ok.text).toBe(false);
        expect(ok.data).toMatchObject({ slug: "pamuklu-tisort", title: "Pamuklu Tişört", previousStatus: "active", deleted: true });
        expect(ok.data.warnings.join(" ")).toContain("YAYINDAYDI");
        expect(backend.products.map((p) => p.slug)).toEqual(["seramik-kupa"]);
        /* Uç yalnız id kabul ediyor: araç önce okuyup slug'ı id'ye çevirmeli. */
        expect(backend.calls.at(-1)!.method).toBe("DELETE");
        expect(backend.calls.at(-1)!.url).toMatch(/\/products\/[0-9a-f]{24}$/);
    });

    it("id verilirse OKUMA atlanır — yalnız products:write yetkili anahtar da silebilir", async () => {
        const { client, backend } = await setup({ scopes: ["products:write"] });
        const id = backend.products[0]._id;
        const callsBefore = backend.calls.length;

        const ok = await client.callTool("delete_product", { product: id, confirm: true });
        expect(ok.isError, ok.text).toBe(false);
        expect(ok.data).toMatchObject({ productId: id, deleted: true });
        expect(backend.products.map((p) => p.slug)).toEqual(["seramik-kupa"]);
        /* GET /products/:id `products:read` ister; ref zaten id olduğu için hiç
           çağrılmamalı — tek ürün isteği DELETE olmalı. */
        const productCalls = backend.calls
            .slice(callsBefore)
            .filter((c) => new URL(c.url).pathname.startsWith("/api/v1/products"));
        expect(productCalls.map((c) => c.method)).toEqual(["DELETE"]);
    });

    it("slug/SKU ile silerken products:read yoksa hata EKSİK SCOPE'u adıyla söyler", async () => {
        const { client, backend } = await setup({ scopes: ["products:write"] });

        const res = await client.callTool("delete_product", { product: "pamuklu-tisort", confirm: true });
        expect(res.isError).toBe(true);
        expect(res.text).toContain("products:read");
        expect(backend.products).toHaveLength(2);   // silme hiç denenmedi
    });
});

describe("get_product_import_template", () => {
    it("ham CSV'yi (JSON zarfı değil) sütunlara ayırır; tırnaklı virgül bozulmaz", async () => {
        const { client } = await setup();
        const res = await client.callTool("get_product_import_template");
        expect(res.isError, res.text).toBe(false);
        expect(res.data.format).toBe("csv");
        expect(res.data.columns).toEqual(["Adres", "Ürün adı", "Stok kodu", "Fiyat", "Kısa açıklama"]);
        expect(res.data.columnCount).toBe(5);
        expect(res.data.sampleRows).toHaveLength(2);
        expect(res.data.sampleRows[0]["Kısa açıklama"]).toBe("%100 pamuk, nefes alan kumaş");
        /* Uç BOM'lu gönderir, fetch metin çözümünde BOM'u DÜŞÜRÜR: ajan dosyaya
           yazacaksa başına kendisi eklemeli — hint bunu söylüyor. */
        expect(res.data.csv.startsWith("﻿")).toBe(false);
        expect(res.data.csv.startsWith("Adres,")).toBe(true);
        expect(res.data.hint).toContain("\\uFEFF");
    });
});

describe("scope ve plan kapıları", () => {
    it("products:write olmayan anahtarda yazma 403; okuma çalışır", async () => {
        const { client } = await setup({ scopes: ["products:read"] });

        const list = await client.callTool("list_products");
        expect(list.isError).toBe(false);

        const write = await client.callTool("upsert_products", { items: [{ slug: "x", name: "X", variants: [{ price: 1 }] }] });
        expect(write.isError).toBe(true);
        expect(write.text).toContain("products:write");
    });

    it("plan-quota-exceeded ve plan-feature-unavailable ajana eyleme dönük mesaj verir", async () => {
        const quota = await setup({
            intercept: ({ method, url }) =>
                method === "POST" && url.pathname.endsWith("/products/bulk")
                    ? { status: 403, body: { success: false, messageCode: "plan-quota-exceeded", message: "quota", data: { max: 100 } } }
                    : null,
        });
        const q = await quota.client.callTool("upsert_products", { items: [{ slug: "x", name: "X", variants: [{ price: 1 }] }] });
        expect(q.isError).toBe(true);
        expect(q.text).toContain("ürün limiti dolu (100)");

        const plan = await setup({
            intercept: ({ url }) =>
                url.pathname.endsWith("/products")
                    ? { status: 403, body: { success: false, messageCode: "plan-feature-unavailable", message: "no plan" } }
                    : null,
        });
        const p = await plan.client.callTool("list_products");
        expect(p.isError).toBe(true);
        expect(p.text).toContain("ecommerceEnabled");
    });
});
