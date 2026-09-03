/**
 * Test için sahte Tecof backend'i — `fetch` imzasıyla çalışır, gerçek ağa çıkmaz.
 * Sözleşme §2'deki uçları ve zarfı taklit eder; iyimser kilit (409), slug
 * çakışması (400 already-exists), scope (403) senaryoları için kancalar var.
 */

import type { TecofDocument } from "../../src/types.js";

export type FakePage = {
    _id: string;
    themeId: string;
    slug: string;
    title: string;
    status: "draft" | "published" | "changed";
    isTemplate: boolean;
    metaTitle?: unknown;
    metaDescription?: unknown;
    draftData: TecofDocument | null;
    hasPublished: boolean;
    modifiedDate: string;
    createDate: string;
    publishedDate?: string | null;
};

/** v1 `serializeProduct` çıktısının test karşılığı (varyantlar hep saklanır). */
export type FakeProduct = {
    _id: string;
    slug: string;
    name: Array<{ code: string; value: string }>;
    status: "active" | "inactive" | "draft";
    type: "simple" | "variable" | "grouped" | "digital";
    brand: { _id: string; name: string; slug: string } | null;
    categories: Array<{ _id: string; name: string; slug: string }>;
    tags: Array<{ _id: string; name: string; slug: string }>;
    images: Array<{ uploadId: string | null; name: string | null; folder: string | null; url: string | null; order: number; variantId: string | null }>;
    description: Array<{ code: string; value: string }>;
    totalStock: number;
    avgRating: number;
    reviewCount: number;
    variants: Array<{
        _id: string; sku: string; barcode: string | null; price: number; compareAtPrice: number | null;
        weight: number | null; isActive: boolean; stock: number;
        stocks: Array<{ stockLocationId: string; quantity: number }>;
        variantValues: Array<{ variantTypeId: string; variantValueId: string | null }>;
    }>;
    modifiedDate: string;
    createDate: string;
};

export type FakeBackendOptions = {
    token?: string;
    themeId?: string;
    languages?: string[];
    defaultLanguage?: string;
    scopes?: string[];
    pages?: Partial<FakePage>[];
    /** CMS koleksiyonları (içerik tipleri) ve içerikleri */
    cmsCollections?: Array<{ _id?: string; slug: string; name?: any; displayField?: string; fields?: any[] }>;
    cmsItems?: Array<{ _id?: string; collectionSlug: string; slug: string; data?: any; status?: string; modifiedDate?: string }>;
    /** E-ticaret kataloğu (v1 /products uçları) */
    products?: Array<Partial<FakeProduct> & { slug: string }>;
    /** Her istekte çağrılır — 429 vb. simülasyonu için {status, body} dönebilir */
    intercept?: (req: { method: string; url: URL; body: any }) => { status: number; body: any } | null | undefined;
    /** POST/PUT yanıtlarının zarf KÖKÜNE konacak sunucu uyarıları (gerçek backend biçimi: DocIssue[]) */
    writeWarnings?: Array<{ code: string; path: string; message: string }>;
};

export function createFakeBackend(opts: FakeBackendOptions = {}) {
    const token = opts.token ?? "tcf_test_token";
    const themeId = opts.themeId ?? "64b000000000000000000001";
    const scopes = opts.scopes ?? ["pages:read", "pages:write", "cms:read", "cms:write"];
    const languages = opts.languages ?? ["tr", "en"];
    const defaultLanguage = opts.defaultLanguage ?? "tr";

    let counter = 1;
    const newId = () => (counter++).toString(16).padStart(24, "0");
    const now = () => new Date().toISOString();

    const pages: FakePage[] = (opts.pages ?? []).map((p) => ({
        _id: p._id ?? newId(),
        themeId: p.themeId ?? themeId,
        slug: p.slug ?? "page",
        title: p.title ?? "Page",
        status: p.status ?? "draft",
        isTemplate: p.isTemplate ?? false,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        draftData: (p.draftData as TecofDocument) ?? null,
        hasPublished: p.hasPublished ?? false,
        modifiedDate: p.modifiedDate ?? "2026-08-19T09:00:00.000Z",
        createDate: p.createDate ?? "2026-08-19T08:00:00.000Z",
        publishedDate: p.publishedDate ?? null,
    }));

    const cmsCollections = (opts.cmsCollections ?? []).map((c) => ({
        _id: c._id ?? newId(),
        themeId,
        slug: c.slug,
        name: c.name ?? [{ code: "tr", value: c.slug }],
        displayField: c.displayField ?? (c.fields?.[0]?.shortcode ?? "title"),
        fields: c.fields ?? [],
    }));

    const cmsItems = (opts.cmsItems ?? []).map((i) => {
        const collection = cmsCollections.find((c) => c.slug === i.collectionSlug);
        return {
            _id: i._id ?? newId(),
            collectionId: collection?._id ?? newId(),
            slug: i.slug,
            data: i.data ?? {},
            metaTitle: [] as any[],
            metaDescription: [] as any[],
            status: i.status ?? "draft",
            publishedDate: null as string | null,
            modifiedDate: i.modifiedDate ?? "2026-08-19T09:00:00.000Z",
            createDate: "2026-08-19T08:00:00.000Z",
        };
    });

    const products: FakeProduct[] = (opts.products ?? []).map((p) => ({
        _id: p._id ?? newId(),
        slug: p.slug,
        name: p.name ?? [{ code: defaultLanguage, value: p.slug }],
        status: p.status ?? "draft",
        type: p.type ?? "simple",
        brand: p.brand ?? null,
        categories: p.categories ?? [],
        tags: p.tags ?? [],
        images: p.images ?? [],
        description: p.description ?? [],
        totalStock: p.totalStock ?? 0,
        avgRating: p.avgRating ?? 0,
        reviewCount: p.reviewCount ?? 0,
        variants: p.variants ?? [],
        modifiedDate: p.modifiedDate ?? "2026-08-19T09:00:00.000Z",
        createDate: p.createDate ?? "2026-08-19T08:00:00.000Z",
    }));

    const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: any }> = [];

    const envelope = (status: number, body: any) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    // Gerçek backend (_respond.ts ok()): extra alanlar zarfın KÖKÜNE yayılır → { success, message, messageCode, data, warnings }
    const ok = (data: any, extra: Record<string, unknown> = {}) => envelope(200, { success: true, message: "ok", messageCode: "success", data, ...extra });
    const writeExtra = () => (opts.writeWarnings ? { warnings: opts.writeWarnings } : {});
    const fail = (status: number, messageCode: string, message = messageCode, data?: any) =>
        envelope(status, { success: false, message, messageCode, data });

    const pageView = (p: FakePage) => ({
        ...p,
        urls: { panel: `https://app.tecof.test/app/themes/mt-1/design/${p._id}` },
    });

    const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(input);
        const method = (init.method ?? "GET").toUpperCase();
        const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url: url.toString(), headers, body });

        const intercepted = opts.intercept?.({ method, url, body });
        if (intercepted) return envelope(intercepted.status, intercepted.body);

        if (headers.Authorization !== `Bearer ${token}`) return fail(401, "token-invalid", "Token geçersiz");

        const path = url.pathname.replace(/^\/api\/v1/, "");
        const requireScope = (s: string) => (scopes.includes(s) ? null : fail(403, "insufficient-scope", "Yetersiz scope", { required: [s] }));

        if (path === "/me" && method === "GET") {
            return ok({
                merchant: { _id: "m1", name: "Test Mağaza", slug: "test", productType: "physical", languages, defaultLanguage, currentThemeId: themeId },
                user: { _id: "u1", name: "Ada", surname: "Lovelace", email: "ada@example.com" },
                token: { _id: "t1", name: "mcp", scopes, expiresAt: "2027-01-01T00:00:00.000Z" },
                themes: [{ themeId, merchantThemeId: "mt-1", name: "Core", domain: "shop.example.com", isCurrent: true }],
                panelUrl: "https://app.tecof.test",
            });
        }

        const qTheme = url.searchParams.get("themeId");
        if (qTheme && qTheme !== themeId) return fail(400, "theme-not-installed", "Tema kurulu değil");

        if (path === "/pages" && method === "GET") {
            const denied = requireScope("pages:read");
            if (denied) return denied;
            const includeTemplates = url.searchParams.get("includeTemplates") === "true";
            const list = pages.filter((p) => includeTemplates || !p.isTemplate).sort((a, b) => a.slug.localeCompare(b.slug));
            return ok(
                list.map(({ draftData: _d, ...rest }) => rest),
                { totalData: list.length, meta: { themeId } }
            );
        }

        if (path === "/pages" && method === "POST") {
            const denied = requireScope("pages:write");
            if (denied) return denied;
            if (!body?.themeId || !body?.slug || !body?.title) return fail(400, "validation-error", "themeId, slug, title zorunlu");
            const slug = String(body.slug).toLowerCase();
            const existing = pages.find((p) => p.slug === slug);
            if (existing) return fail(400, "already-exists", "Slug kullanımda", { slug, existingPageId: existing._id });
            const page: FakePage = {
                _id: newId(),
                themeId: body.themeId,
                slug,
                title: body.title,
                status: "draft",
                isTemplate: false,
                metaTitle: body.metaTitle,
                metaDescription: body.metaDescription,
                draftData: body.draftData ?? null,
                hasPublished: false,
                modifiedDate: now(),
                createDate: now(),
                publishedDate: null,
            };
            pages.push(page);
            return envelope(201, { success: true, message: "created", messageCode: "created", data: pageView(page), ...writeExtra() });
        }

        const m = path.match(/^\/pages\/([^/]+)(\/preview-url)?$/);
        if (m) {
            const ref = decodeURIComponent(m[1]);
            const page = pages.find((p) => (/^[0-9a-f]{24}$/i.test(ref) ? p._id === ref : p.slug === ref));
            if (m[2]) {
                const denied = requireScope("pages:read");
                if (denied) return denied;
                if (!page) return fail(404, "not-found", "Sayfa yok");
                const locale = body?.locale ?? defaultLanguage;
                const slugPath = page.slug === "home" ? "" : page.slug;
                const q = `?showDraftData=true&previewToken=tok`;
                return ok({
                    previewToken: "tok",
                    expiresAt: "2026-08-19T11:00:00.000Z",
                    locale,
                    slugPath,
                    storefrontUrl: `https://shop.example.com/${locale}/${slugPath}${q}`,
                    localUrlTemplate: `http://localhost:3000/${locale}/${slugPath}${q}`,
                });
            }
            if (method === "GET") {
                const denied = requireScope("pages:read");
                if (denied) return denied;
                if (!page) return fail(404, "not-found", "Sayfa yok");
                return ok(pageView(page));
            }
            if (method === "PUT") {
                const denied = requireScope("pages:write");
                if (denied) return denied;
                if (!page) return fail(404, "not-found", "Sayfa yok");
                if (page.isTemplate) return fail(400, "template-pages-not-supported", "Şablon");
                if (body?.expectedModifiedDate && body.expectedModifiedDate !== page.modifiedDate) {
                    return fail(409, "page-modified", "Sayfa değişti", { modifiedDate: page.modifiedDate });
                }
                if (body?.draftData) {
                    page.draftData = body.draftData;
                    if (page.status === "published") page.status = "changed";
                }
                if (body?.title) page.title = body.title;
                if (body?.slug) page.slug = body.slug;
                if (body?.metaTitle) page.metaTitle = body.metaTitle;
                if (body?.metaDescription) page.metaDescription = body.metaDescription;
                page.modifiedDate = now();
                return ok(pageView(page), writeExtra());
            }
            if (method === "DELETE") {
                const denied = requireScope("pages:write");
                if (denied) return denied;
                if (!page) return fail(404, "not-found", "Sayfa yok");
                if (page.isTemplate) return fail(400, "template-pages-not-supported", "Şablon");
                pages.splice(pages.indexOf(page), 1);
                return ok({ _id: page._id, slug: page.slug, status: "deleted" });
            }
        }

        /* ── CMS ────────────────────────────────────────────────────────────
           Gerçek uçların (routes/api/v1/cms.ts) davranışını taklit eder:
           koleksiyon/içerik id VEYA slug ile bulunur, yazmalar taslak doğar,
           yayındaki içerik allowPublishedEdit ister. */
        const findCollection = (ref: string) =>
            cmsCollections.find((c) => (/^[0-9a-f]{24}$/i.test(ref) ? c._id === ref : c.slug === ref));
        const findItem = (collectionId: string, ref: string) =>
            cmsItems.find((i) => i.collectionId === collectionId && (/^[0-9a-f]{24}$/i.test(ref) ? i._id === ref : i.slug === ref));

        if (path === "/cms/collections" && method === "GET") {
            const denied = requireScope("cms:read");
            if (denied) return denied;
            return ok(
                cmsCollections.map((c) => ({ ...c, fieldCount: c.fields.length, itemCount: cmsItems.filter((i) => i.collectionId === c._id).length })),
                { totalData: cmsCollections.length }
            );
        }

        if (path === "/cms/collections" && method === "POST") {
            const denied = requireScope("cms:write");
            if (denied) return denied;
            if (cmsCollections.some((c) => c.slug === body?.slug)) return fail(400, "already-exists", "Slug kullanımda", { slug: body.slug });
            const created = {
                _id: newId(), themeId, slug: String(body?.slug ?? "koleksiyon"),
                name: body?.name ?? [], displayField: body?.displayField ?? "title", fields: body?.fields ?? [],
            };
            cmsCollections.push(created);
            return envelope(201, { success: true, message: "ok", messageCode: "success-add", data: created });
        }

        const cmsMatch = path.match(/^\/cms\/collections\/([^/]+)(?:\/items(?:\/([^/]+))?)?$/);
        if (cmsMatch) {
            const collection = findCollection(cmsMatch[1]);
            const itemRef = cmsMatch[2];
            const isItemsPath = path.includes("/items");

            if (!collection) {
                const denied = requireScope(method === "GET" ? "cms:read" : "cms:write");
                if (denied) return denied;
                return fail(404, "not-found", "Koleksiyon bulunamadı");
            }

            if (!isItemsPath) {
                if (method === "GET") {
                    const denied = requireScope("cms:read");
                    if (denied) return denied;
                    return ok(collection);
                }
                if (method === "PUT") {
                    const denied = requireScope("cms:write");
                    if (denied) return denied;
                    if (body?.fields !== undefined) {
                        const removed = collection.fields.filter((f: any) => !body.fields.some((n: any) => n.shortcode === f.shortcode));
                        const holdsData = removed.some((f: any) => cmsItems.some((i) => i.collectionId === collection._id && i.data?.[f.shortcode] !== undefined));
                        if (holdsData && body.allowFieldLoss !== true) {
                            return fail(400, "field-loss-requires-confirm", "Veri kaybı onayı gerekli", {
                                removed: removed.map((f: any) => f.shortcode), affectedItems: 1,
                            });
                        }
                        collection.fields = body.fields;
                    }
                    if (body?.slug !== undefined) collection.slug = body.slug;
                    if (body?.displayField !== undefined) collection.displayField = body.displayField;
                    return ok(collection, { warnings: [] });
                }
            }

            if (isItemsPath && !itemRef) {
                if (method === "GET") {
                    const denied = requireScope("cms:read");
                    if (denied) return denied;
                    const list = cmsItems.filter((i) => i.collectionId === collection._id);
                    return ok(list, { totalData: list.length, meta: { collectionId: collection._id, collectionSlug: collection.slug, displayField: collection.displayField } });
                }
                if (method === "POST") {
                    const denied = requireScope("cms:write");
                    if (denied) return denied;
                    if (body?.status !== undefined) return fail(400, "publish-not-supported", "Yayınlama desteklenmiyor", { fields: ["status"] });
                    /* Gerçek sunucu gibi: bilinmeyen alan ve çok dilli biçim hatası 400 */
                    const errors: any[] = [];
                    for (const key of Object.keys(body?.data ?? {})) {
                        const field = collection.fields.find((f: any) => f.shortcode === key);
                        if (!field) errors.push({ code: "unknown-field", path: `data.${key}`, message: "böyle bir alan yok" });
                        else if (field.isMultilingual && !Array.isArray(body.data[key])) {
                            errors.push({ code: "localized-shape", path: `data.${key}`, message: "[{code,value}] bekler" });
                        }
                    }
                    if (errors.length) return fail(400, "invalid-item-data", "Geçersiz içerik", { errors });
                    const created = {
                        _id: newId(), collectionId: collection._id, slug: String(body?.slug ?? "icerik"),
                        data: body?.data ?? {}, metaTitle: body?.metaTitle ?? [], metaDescription: body?.metaDescription ?? [],
                        status: "draft", publishedDate: null, modifiedDate: now(), createDate: now(),
                    };
                    cmsItems.push(created);
                    return envelope(201, { success: true, message: "ok", messageCode: "success-add", data: created });
                }
            }

            if (isItemsPath && itemRef) {
                const item = findItem(collection._id, itemRef);
                if (!item) {
                    const denied = requireScope(method === "GET" ? "cms:read" : "cms:write");
                    if (denied) return denied;
                    return fail(404, "not-found", "İçerik bulunamadı");
                }
                if (method === "GET") {
                    const denied = requireScope("cms:read");
                    if (denied) return denied;
                    return ok(item);
                }
                if (method === "PUT") {
                    const denied = requireScope("cms:write");
                    if (denied) return denied;
                    if (body?.status !== undefined) return fail(400, "publish-not-supported", "Yayınlama desteklenmiyor", { fields: ["status"] });
                    if (item.status === "published" && body?.allowPublishedEdit !== true) {
                        return fail(400, "published-item-requires-confirm", "İçerik yayında", { status: item.status });
                    }
                    if (body?.data !== undefined) item.data = body.data;
                    if (body?.slug !== undefined) item.slug = body.slug;
                    item.modifiedDate = now();
                    return ok(item, { warnings: [] });
                }
                if (method === "DELETE") {
                    const denied = requireScope("cms:write");
                    if (denied) return denied;
                    if (item.status === "published" && body?.allowPublishedEdit !== true) {
                        return fail(400, "published-item-requires-confirm", "İçerik yayında", { status: item.status });
                    }
                    cmsItems.splice(cmsItems.indexOf(item), 1);
                    return ok({ _id: item._id, slug: item.slug, status: item.status, deleted: true });
                }
            }
        }

        /* ── Ürünler ────────────────────────────────────────────────────────
           routes/api/v1/products.ts + src/productService.ts davranışını taklit
           eder: liste hafif (variants/description yalnız fields=full), tek ürün
           id|slug|SKU ile bulunur, toplu upsert anahtarı slug → varyant SKU,
           şablon ucu JSON ZARFI DEĞİL ham CSV döndürür. */

        /* Şablon /products/:idOrSlug'tan ÖNCE eşleşmeli — gerçek router'da da
           sıra böyle (yoksa "import-template" bir slug sanılır). */
        if (path === "/products/import-template" && method === "GET") {
            const denied = requireScope("products:read");
            if (denied) return denied;
            /* BOM + tırnaklı virgüllü alan: aracın CSV çözümleyicisi sınanır. */
            const csv = "﻿Adres,Ürün adı,Stok kodu,Fiyat,Kısa açıklama\n"
                + 'pamuklu-tisort,Pamuklu Tişört,TS-001,349.90,"%100 pamuk, nefes alan kumaş"\n'
                + "seramik-kupa,Seramik Kupa,KP-001,129.00,El yapımı kupa\n";
            return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8" } });
        }

        const productView = (p: FakeProduct, full: boolean) => {
            const { variants, description, ...rest } = p;
            return {
                ...rest,
                variantCount: variants.length,
                ...(full
                    ? { description, variants, weight: 0, maxQuantityPerCart: null, attributes: [], personalizationFields: [] }
                    : {}),
            };
        };
        const findProduct = (ref: string) =>
            products.find((p) => (/^[0-9a-f]{24}$/i.test(ref) && p._id === ref) || p.slug === ref || p.variants.some((v) => v.sku === ref));

        if (path === "/products" && method === "GET") {
            const denied = requireScope("products:read");
            if (denied) return denied;
            const full = url.searchParams.get("fields") === "full";
            const status = url.searchParams.get("status");
            const search = (url.searchParams.get("search") ?? "").toLowerCase();
            const list = products.filter((p) => {
                if (status && p.status !== status) return false;
                if (!search) return true;
                return p.slug.toLowerCase().includes(search)
                    || p.name.some((n) => n.value.toLowerCase().includes(search))
                    || p.variants.some((v) => v.sku.toLowerCase().includes(search));
            });
            return ok(list.map((p) => productView(p, full)), { totalData: list.length });
        }

        if (path === "/products/bulk" && method === "POST") {
            const denied = requireScope("products:write");
            if (denied) return denied;
            const items = Array.isArray(body?.items) ? body.items : [];
            if (!items.length) return fail(400, "validation-error", "Geçersiz", { issues: [{ path: "items", message: "En az bir ürün gerekli" }] });
            if (items.length > 200) return fail(400, "validation-error", "Geçersiz", { issues: [{ path: "items", message: "En fazla 200 ürün" }] });
            const dryRun = body?.dryRun === true;
            const report: any = { dryRun, created: 0, updated: 0, skipped: 0, issueCount: 0, issues: [], items: [] };
            items.forEach((item: any, index: number) => {
                const slug = String(item?.slug ?? "").trim()
                    || String(item?.name ?? "").toLowerCase().replace(/\s+/g, "-");
                if (!slug) {
                    report.skipped++;
                    report.items.push({ index, slug: null, productId: null, outcome: "skipped" });
                    report.issues.push({ index, level: "error", path: "slug", message: "slug ya da name zorunlu" });
                    return;
                }
                const skus: string[] = (item?.variants ?? []).map((v: any) => v?.sku).filter(Boolean);
                const existing = products.find((p) => p.slug === slug || p.variants.some((v) => skus.includes(v.sku)));
                if (existing) {
                    if (!dryRun) {
                        if (item.status) existing.status = item.status;
                        for (const v of item.variants ?? []) {
                            const match = existing.variants.find((x) => x.sku === v.sku);
                            if (match) {
                                if (typeof v.price === "number") match.price = v.price;
                                if (typeof v.stock === "number") match.stock = v.stock;
                            } else {
                                existing.variants.push({
                                    _id: newId(), sku: String(v.sku ?? slug.toUpperCase()), barcode: v.barcode ?? null,
                                    price: Number(v.price) || 0, compareAtPrice: v.compareAtPrice ?? null, weight: v.weight ?? null,
                                    isActive: true, stock: Number(v.stock) || 0, stocks: [], variantValues: [],
                                });
                            }
                        }
                        existing.modifiedDate = now();
                    }
                    report.updated++;
                    report.items.push({ index, slug: existing.slug, productId: existing._id, outcome: "updated" });
                    return;
                }
                if (dryRun) {
                    report.created++;
                    report.items.push({ index, slug, productId: null, outcome: "created" });
                    return;
                }
                const created: FakeProduct = {
                    _id: newId(), slug,
                    name: typeof item?.name === "string" ? [{ code: defaultLanguage, value: item.name }] : (item?.name ?? []),
                    status: item?.status ?? "draft",
                    type: item?.type ?? ((item?.variants ?? []).length > 1 ? "variable" : "simple"),
                    brand: item?.brand ? { _id: newId(), name: String(item.brand), slug: String(item.brand).toLowerCase() } : null,
                    categories: (item?.categories ?? []).map((c: string) => ({ _id: newId(), name: c, slug: String(c).toLowerCase() })),
                    tags: (item?.tags ?? []).map((t: string) => ({ _id: newId(), name: t, slug: String(t).toLowerCase() })),
                    images: [], description: [], totalStock: 0, avgRating: 0, reviewCount: 0,
                    variants: (item?.variants ?? []).map((v: any) => ({
                        _id: newId(), sku: String(v?.sku ?? slug.toUpperCase()), barcode: v?.barcode ?? null,
                        price: Number(v?.price) || 0, compareAtPrice: v?.compareAtPrice ?? null, weight: v?.weight ?? null,
                        isActive: true, stock: Number(v?.stock) || 0, stocks: [], variantValues: [],
                    })),
                    modifiedDate: now(), createDate: now(),
                };
                created.totalStock = created.variants.reduce((s, v) => s + v.stock, 0);
                products.push(created);
                report.created++;
                report.items.push({ index, slug, productId: created._id, outcome: "created" });
            });
            report.issueCount = report.issues.length;
            return ok(report);
        }

        const productMatch = path.match(/^\/products\/([^/]+)$/);
        if (productMatch) {
            const ref = decodeURIComponent(productMatch[1]);
            if (method === "GET") {
                const denied = requireScope("products:read");
                if (denied) return denied;
                const found = findProduct(ref);
                if (!found) return fail(404, "not-found", "Ürün bulunamadı");
                return ok(productView(found, true));
            }
            if (method === "DELETE") {
                const denied = requireScope("products:write");
                if (denied) return denied;
                /* Gerçek uç YALNIZ id kabul eder (slug/SKU ile silinmez). */
                const found = /^[0-9a-f]{24}$/i.test(ref) ? products.find((p) => p._id === ref) : null;
                if (!found) return fail(404, "not-found", "Ürün bulunamadı");
                products.splice(products.indexOf(found), 1);
                return ok({ _id: found._id });
            }
        }

        return fail(404, "not-found", `Bilinmeyen uç: ${method} ${path}`);
    };

    return { fetch: fetchImpl, calls, pages, cmsCollections, cmsItems, products, token, themeId };
}
