import { describe, expect, it } from "vitest";
import { ApiError, describeInsecureApiUrl, TecofApiClient } from "../src/api.js";
import { createFakeBackend } from "./helpers/fakeBackend.js";

describe("TecofApiClient (fetch mock — gerçek ağ yok)", () => {
    it("Bearer header + /api/v1 yolu + zarf çözümü; baseUrl normalize", async () => {
        const be = createFakeBackend();
        const client = new TecofApiClient({ baseUrl: "https://api.example.com/api/v1/", token: be.token, fetch: be.fetch });
        const me = await client.me();
        expect(me.merchant.slug).toBe("test");
        expect(be.calls[0].url).toBe("https://api.example.com/api/v1/me");
        expect(be.calls[0].headers.Authorization).toBe(`Bearer ${be.token}`);
        expect(be.calls[0].headers["User-Agent"]).toContain("@tecof/mcp");
    });

    it("listPages query + totalData + meta.themeId", async () => {
        const be = createFakeBackend({ pages: [{ slug: "b" }, { slug: "a" }, { slug: "tpl", isTemplate: true }] });
        const client = new TecofApiClient({ baseUrl: "https://api.example.com", token: be.token, fetch: be.fetch });
        const res = await client.listPages({ themeId: be.themeId });
        expect(res.items.map((p) => p.slug)).toEqual(["a", "b"]);
        expect(res.total).toBe(2);
        expect(res.themeId).toBe(be.themeId);
        const url = new URL(be.calls[0].url);
        expect(url.searchParams.get("themeId")).toBe(be.themeId);
        expect(url.searchParams.get("includeTemplates")).toBeNull();
        const all = await client.listPages({ themeId: be.themeId, includeTemplates: true });
        expect(all.total).toBe(3);
    });

    it("401/403/409/429/400 ayrımı ve ipuçları", async () => {
        const be401 = createFakeBackend({ token: "tcf_other" });
        const c401 = new TecofApiClient({ baseUrl: "https://x", token: "tcf_wrong", fetch: be401.fetch });
        const e401 = await c401.me().catch((e) => e);
        expect(e401).toBeInstanceOf(ApiError);
        expect(e401.status).toBe(401);
        expect(e401.messageCode).toBe("token-invalid");
        expect(e401.toDisplayString()).toContain("TECOF_API_TOKEN");

        const be403 = createFakeBackend({ scopes: ["pages:read"] });
        const c403 = new TecofApiClient({ baseUrl: "https://x", token: be403.token, fetch: be403.fetch });
        const e403 = await c403.createPage({ themeId: be403.themeId, slug: "a", title: "A" }).catch((e) => e);
        expect(e403.status).toBe(403);
        expect(e403.message).toContain("pages:write");

        const be409 = createFakeBackend({ pages: [{ slug: "home", modifiedDate: "2026-01-01T00:00:00.000Z" }] });
        const c409 = new TecofApiClient({ baseUrl: "https://x", token: be409.token, fetch: be409.fetch });
        const e409 = await c409.updatePage(be409.pages[0]._id, { title: "x", expectedModifiedDate: "2025-01-01T00:00:00.000Z" }).catch((e) => e);
        expect(e409.status).toBe(409);
        expect(e409.hint).toContain("get_page");
        expect((e409.data as any).modifiedDate).toBe("2026-01-01T00:00:00.000Z");

        const be429 = createFakeBackend({ intercept: () => ({ status: 429, body: { success: false, messageCode: "rate-limited", message: "slow" } }) });
        const c429 = new TecofApiClient({ baseUrl: "https://x", token: be429.token, fetch: be429.fetch });
        const e429 = await c429.me().catch((e) => e);
        expect(e429.status).toBe(429);
        expect(e429.message).toContain("sınırı");

        const beDup = createFakeBackend({ pages: [{ slug: "hakkimizda" }] });
        const cDup = new TecofApiClient({ baseUrl: "https://x", token: beDup.token, fetch: beDup.fetch });
        const eDup = await cDup.createPage({ themeId: beDup.themeId, slug: "hakkimizda", title: "x" }).catch((e) => e);
        expect(eDup.status).toBe(400);
        expect(eDup.messageCode).toBe("already-exists");
        expect(eDup.message).toContain("hakkimizda");

        const eTheme = await cDup.getPage("home", { themeId: "000000000000000000000000" }).catch((e) => e);
        expect(eTheme.messageCode).toBe("theme-not-installed");
    });

    it("sunucu uyarıları zarfın KÖKÜNDEN okunur (DocIssue nesneleri); string de kabul", async () => {
        const be = createFakeBackend({
            pages: [{ slug: "home" }],
            writeWarnings: [{ code: "shared-component-missing", path: "content[0]", message: "sharedComponentId abc bağı düşürüldü" }],
        });
        const client = new TecofApiClient({ baseUrl: "https://x", token: be.token, fetch: be.fetch });
        const upd = await client.updatePage(be.pages[0]._id, { title: "t" });
        expect(upd.warnings).toEqual([{ code: "shared-component-missing", path: "content[0]", message: "sharedComponentId abc bağı düşürüldü" }]);
        expect((upd.page as any).warnings).toBeUndefined();
        const cr = await client.createPage({ themeId: be.themeId, slug: "n", title: "N" });
        expect(cr.warnings[0].code).toBe("shared-component-missing");

        const beStr = createFakeBackend({ pages: [{ slug: "home" }], intercept: ({ method }) => (method === "PUT" ? { status: 200, body: { success: true, data: { _id: "x", slug: "home", title: "t", status: "draft" }, warnings: ["düz metin uyarı"] } } : null) });
        const cStr = new TecofApiClient({ baseUrl: "https://x", token: beStr.token, fetch: beStr.fetch });
        const r = await cStr.updatePage("x", { title: "t" });
        expect(r.warnings).toEqual([{ code: "server", path: "", message: "düz metin uyarı" }]);
    });

    it("zaman aşımı gövde okumasını da kapsar; 3xx yönlendirme açık hataya çevrilir; http uyarısı", async () => {
        // Header'lar gelir, gövde hiç bitmez → timeoutMs içinde ApiError
        // Mock fetch sinyali gövdeye taşımıyor (en kötü durum): race yine de döndürmeli
        const hanging = async () =>
            new Response(new ReadableStream({ start() { /* asla close/enqueue yok */ } }), { status: 200, headers: { "Content-Type": "application/json" } });
        const cHang = new TecofApiClient({ baseUrl: "https://x", token: "t", fetch: hanging as any, timeoutMs: 150 });
        const t0 = Date.now();
        const eHang = await cHang.me().catch((e) => e);
        expect(eHang).toBeInstanceOf(ApiError);
        expect(eHang.message).toContain("yanıt vermedi");
        expect(Date.now() - t0).toBeLessThan(5000);

        let seenRedirect: string | undefined;
        const redirecting = async (_u: string, init?: RequestInit) => {
            seenRedirect = init?.redirect as string;
            return new Response("", { status: 301, headers: { Location: "https://api.example.com/api/v1/me" } });
        };
        const cRedir = new TecofApiClient({ baseUrl: "http://api.example.com", token: "t", fetch: redirecting as any });
        const eRedir = await cRedir.me().catch((e) => e);
        expect(seenRedirect).toBe("manual");
        expect(eRedir.status).toBe(301);
        expect(eRedir.message).toContain("yönlendirme");
        expect(eRedir.hint).toContain("https://");

        expect(describeInsecureApiUrl("http://api.example.com")).toContain("şifresiz");
        expect(describeInsecureApiUrl("http://localhost:5001")).toBeNull();
        expect(describeInsecureApiUrl("http://127.0.0.1:5001/api/v1")).toBeNull();
        expect(describeInsecureApiUrl("https://api.tecof.com")).toBeNull();
        expect(describeInsecureApiUrl("not a url")).toContain("geçerli bir URL değil");
    });

    it("ağ hatası ve JSON olmayan yanıt anlamlı ApiError üretir", async () => {
        const cNet = new TecofApiClient({ baseUrl: "https://x", token: "t", fetch: async () => { throw new Error("ECONNREFUSED"); } });
        const eNet = await cNet.me().catch((e) => e);
        expect(eNet.status).toBe(0);
        expect(eNet.message).toContain("ulaşılamadı");

        const cHtml = new TecofApiClient({ baseUrl: "https://x", token: "t", fetch: async () => new Response("<html>502</html>", { status: 502 }) });
        const eHtml = await cHtml.me().catch((e) => e);
        expect(eHtml.status).toBe(502);
    });

    it("success:false zarfı 200 ile gelse de hata sayılır; createPage/deletePage/previewUrl body'leri doğru", async () => {
        const be = createFakeBackend({ intercept: ({ url }) => (url.pathname.endsWith("/me") ? { status: 200, body: { success: false, messageCode: "weird", message: "nope" } } : null) });
        const client = new TecofApiClient({ baseUrl: "https://x", token: be.token, fetch: be.fetch });
        await expect(client.me()).rejects.toMatchObject({ messageCode: "weird" });

        const { page: created, warnings } = await client.createPage({ themeId: be.themeId, slug: "Yeni", title: "Yeni", draftData: { root: { props: {} }, content: [], zones: {} } });
        expect(created.status).toBe("draft");
        expect(warnings).toEqual([]);
        expect(be.calls.at(-1)?.body.slug).toBe("Yeni");
        const pv = await client.previewUrl(created._id, { locale: "en" });
        expect(pv.storefrontUrl).toContain("/en/yeni");
        expect(be.calls.at(-1)?.body).toEqual({ locale: "en" });
        const del = await client.deletePage(created._id);
        expect(del.status).toBe("deleted");
        expect(be.calls.at(-1)?.method).toBe("DELETE");
    });
});
