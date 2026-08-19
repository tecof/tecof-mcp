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

export type FakeBackendOptions = {
    token?: string;
    themeId?: string;
    languages?: string[];
    defaultLanguage?: string;
    scopes?: string[];
    pages?: Partial<FakePage>[];
    /** Her istekte çağrılır — 429 vb. simülasyonu için {status, body} dönebilir */
    intercept?: (req: { method: string; url: URL; body: any }) => { status: number; body: any } | null | undefined;
    /** POST/PUT yanıtlarının zarf KÖKÜNE konacak sunucu uyarıları (gerçek backend biçimi: DocIssue[]) */
    writeWarnings?: Array<{ code: string; path: string; message: string }>;
};

export function createFakeBackend(opts: FakeBackendOptions = {}) {
    const token = opts.token ?? "tcf_test_token";
    const themeId = opts.themeId ?? "64b000000000000000000001";
    const scopes = opts.scopes ?? ["pages:read", "pages:write"];
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

        return fail(404, "not-found", `Bilinmeyen uç: ${method} ${path}`);
    };

    return { fetch: fetchImpl, calls, pages, token, themeId };
}
