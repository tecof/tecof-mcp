/**
 * Remote (proxy) modu — uçtan uca: gerçek McpServer + InMemoryTransport + sahte
 * Tools API (node:http, 127.0.0.1). Gerçek ağa çıkılmaz; tema kataloğu
 * test/fixtures/theme'den okunur.
 *
 * Sözleşmenin can alıcı noktaları: katalogtan araç üretimi (fromJsonSchema),
 * SSE → sonuç/progress (yalnız progressToken varsa), JSON'a düşme, hata zarfı →
 * errorResult, snapshot fallback + başlangıç bütçesi, toolsets, arka plan
 * yenileme (tools/list_changed), hibrit create/update_page ve yerel katalog
 * yokken tam proxy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import snapshotJson from "../src/remote/catalog.snapshot.json" with { type: "json" };
import { loadConfig, parseToolsets, type TecofConfig } from "../src/config.js";
import { ServerContext } from "../src/context.js";
import { loadCatalogSnapshot } from "../src/remote/catalog.js";
import { RegistryClient, SseParser, type CatalogTool } from "../src/remote/registryClient.js";
import { buildServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import type { TecofDocument } from "../src/types.js";
import { startFakeRegistry, toolDef, type FakeHandler, type FakeRegistryOptions } from "./helpers/fakeRegistry.js";
import { FIXTURE_THEME_DIR } from "./helpers/fixtures.js";
import { connectTestClient } from "./helpers/mcpClient.js";
/* Snapshot yeniden üretilince (backend `tools:list --json`) sayı değişir — sabit yazılmaz */
const SNAPSHOT_TOOL_COUNT: number = (snapshotJson as { tools: unknown[] }).tools.length;

const SNAPSHOT_TOOLS = (snapshotJson as any).tools as CatalogTool[];
const fromSnapshot = (name: string): CatalogTool => {
    const t = SNAPSHOT_TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`snapshot'ta ${name} yok`);
    return t;
};

const HOME_DOC: TecofDocument = {
    root: { props: { _schemaVersion: 2 } },
    content: [
        { type: "Header", props: { id: "hdr00001", sharedComponentId: "master-h", showCart: "no", logoSlot: [], navSlot: [], ctaSlot: [] } },
        { type: "HeroCentered", props: { id: "hero0001", contentSlot: [] } },
        { type: "Footer", props: { id: "ftr00001", sharedComponentId: "master-f", brandSlot: [], contactSlot: [], columnsSlot: [], socialsSlot: [], copyright: [{ code: "tr", value: "©" }] } },
    ],
    zones: {
        "hdr00001:logoSlot": [{ type: "Logo", props: { id: "logo0001" } }],
        "hero0001:contentSlot": [{ type: "Title", props: { id: "ttl00001", text: [{ code: "tr", value: "Hoş geldiniz" }, { code: "en", value: "Welcome" }], size: "lg", align: "center" } }],
    },
};

const CUSTOM_PING = toolDef({ name: "custom_ping", module: "general", title: "Ping", description: "Sahte araç", inputSchema: { type: "object", properties: { echo: { type: "string" } } } });

/** Sahte katalog: snapshot'tan gerçek tanımlar + bir özel araç */
const CATALOG_TOOLS: CatalogTool[] = [
    fromSnapshot("get_site_context"),
    fromSnapshot("delete_page"),
    fromSnapshot("create_page"),
    fromSnapshot("update_page"),
    fromSnapshot("list_components"),
    fromSnapshot("validate_document"),
    fromSnapshot("domain_list"),
    fromSnapshot("generate_image"),
    CUSTOM_PING,
];

const HANDLERS: Record<string, FakeHandler> = {
    get_site_context: () => ({
        progress: [{ message: "bağlanıyor", percent: 10 }, { message: "ok", percent: 100 }],
        data: { merchant: { name: "Test Mağaza" }, token: { scopes: ["pages:read"] } },
        credit: { charged: 0, balance: 12 },
        warnings: ["w1"],
    }),
    domain_list: () => ({ mode: "json", status: 200, body: { success: true, message: "success", messageCode: "success", data: { domains: [] } }, headers: { "Idempotency-Replayed": "true" } }),
    delete_page: (input) =>
        input.confirm === true
            ? { data: { pageId: "p0", deleted: true, confirmId: input.confirmId ?? null } }
            : { mode: "sse-error", status: 409, messageCode: "confirmation-required", message: "Onay gerekli.", data: { needsConfirmation: true, confirmId: "cf1", summary: `"${input.page}" sayfası silinecek`, expiresAt: "2026-09-05T10:00:00.000Z" } },
    generate_image: () => ({ mode: "sse-error", status: 403, messageCode: "insufficient-scope", message: "Yetki yetersiz.", data: { required: ["ai:generate"], missing: ["ai:generate"] } }),
    custom_ping: (input) => ({ data: { pong: true, echo: input.echo ?? null } }),
    list_components: () => ({ data: { source: "server", count: 0, components: [] } }),
    validate_document: () => ({ data: { source: "server", ok: true } }),
    create_page: (input) => ({
        data: {
            pageId: "p1",
            slug: input.slug,
            title: input.title,
            status: "draft",
            outline: [],
            urls: { panel: "https://app.example.com/p1" },
            warnings: ["sunucu: ok"],
            next: "Önizlemeyi kontrol edin; yayınlamayı kullanıcı panelden yapar.",
            ...(input.dryRun ? { dryRun: true } : {}),
        },
    }),
    update_page: (input) => ({
        data: { pageId: input.page, slug: "home", status: "changed", applied: [], savedDraft: !!input.document, outline: [], urls: {}, warnings: ["sunucu: güncellendi"] },
    }),
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
});

type SetupOptions = {
    registry?: FakeRegistryOptions;
    /** Verilirse sahte sunucu kurulmaz (kapalı port vb.) */
    apiUrl?: string;
    token?: string;
    projectDir?: string;
    toolsets?: string[] | null;
    catalogTimeoutMs?: number;
    /** false: buildServer'dan önce ready() beklenmez */
    ready?: boolean;
};

async function setup(options: SetupOptions = {}) {
    const reg = options.apiUrl ? null : await startFakeRegistry({ tools: CATALOG_TOOLS, handlers: HANDLERS, ...options.registry });
    const config: TecofConfig = {
        projectDir: options.projectDir ?? FIXTURE_THEME_DIR,
        apiUrl: options.apiUrl ?? reg!.url,
        themeId: reg?.themeId ?? "64b000000000000000000001",
        token: options.token ?? reg?.token ?? "tcf_registry_test",
        localUrl: "http://localhost:3000",
        sources: {},
        mode: "remote",
        toolsets: options.toolsets ?? null,
    };
    const logs: string[] = [];
    const ctx = new ServerContext({ config, log: (m) => logs.push(m), catalogTimeoutMs: options.catalogTimeoutMs });
    if (options.ready !== false) await ctx.remoteCatalog.ready();
    const server = buildServer({ ctx });
    const client = await connectTestClient(server);
    cleanups.push(async () => {
        await client.close();
        ctx.remoteCatalog.stop();
        await reg?.close();
    });
    return { reg: reg!, ctx, client, logs };
}

describe("remote mod — katalogtan araç üretimi", () => {
    it("canlı katalog: proxy + yerel + hibrit araçlar; annotations/_meta/inputSchema geçer; instructions kataloğun", async () => {
        const { client, ctx, reg } = await setup();
        expect(ctx.remoteCatalog.current().source).toBe("live");
        expect(client.init.instructions).toBe("Tecof sayfa/CMS/ürün araçları (SAHTE KATALOG).");

        const tools = await client.listTools();
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
        expect(Object.keys(byName).sort()).toEqual(CATALOG_TOOLS.map((t) => t.name).sort());

        /* Proxy: katalog tanımı aynen (JSON Schema $defs/const dahil) */
        expect(byName.delete_page._meta["anthropic/requiresUserInteraction"]).toBe(true);
        expect(byName.delete_page.annotations.destructiveHint).toBe(true);
        expect(byName.delete_page.inputSchema.properties.confirm.const).toBe(true);
        expect(byName.delete_page.inputSchema.properties.confirmId.type).toBe("string");
        expect(byName.domain_list.description).toBe(fromSnapshot("domain_list").description);
        expect(byName.generate_image._meta).toBeUndefined();

        /* Hibrit: yerel şema (sections zorunlu, document yok) */
        expect(byName.create_page.inputSchema.required).toEqual(["slug", "title", "sections"]);
        expect(byName.create_page.inputSchema.properties.document).toBeUndefined();
        expect(byName.update_page.inputSchema.properties.expectedModifiedDate).toBeUndefined();

        /* Yerel: diskten okuyan tanım */
        expect(byName.list_components.description).toContain("diskten");
        expect(byName.validate_document.annotations.readOnlyHint).toBe(true);
        expect(byName.list_components.inputSchema.properties.themeId).toBeUndefined();

        /* Katalog isteği: surface=mcp + başlıklar */
        const cat = reg.calls.find((c) => c.path === "/api/v1/tools");
        expect(cat?.query.surface).toBe("mcp");
        expect(cat?.query.toolsets).toBeUndefined();
        expect(cat?.headers.authorization).toBe(`Bearer ${reg.token}`);
        expect(cat?.headers["x-tecof-surface"]).toBe("mcp");
    });

    it("SseParser: chunk sınırı, CRLF, yorum satırı, çok satırlı data", () => {
        const p = new SseParser();
        expect(p.push(': keepalive\n\ndata: {"a":')).toEqual([]);
        expect(p.push('1}\n\ndata: {"b":2}\r\n\r\n')).toEqual([{ a: 1 }, { b: 2 }]);
        expect(p.push("data: {\ndata: \"c\":3}\n\n")).toEqual([{ c: 3 }]);
        expect(p.push("data: {\"d\":4}")).toEqual([]);
        expect(p.flush()).toEqual([{ d: 4 }]);
        expect(p.push("data: bozuk\n\n")).toEqual([]);
    });
});

describe("remote mod — çağrı, SSE ve hata zarfı", () => {
    it("SSE: progress yalnız progressToken varsa iletilir; sonuç okResult (credit/warnings dahil); POST başlıkları", async () => {
        const { client, reg } = await setup();
        const r1 = await client.callTool("get_site_context", {}, { meta: { progressToken: "pt-1" } });
        expect(r1.isError).toBe(false);
        expect(r1.data).toEqual({ merchant: { name: "Test Mağaza" }, token: { scopes: ["pages:read"] }, credit: { charged: 0, balance: 12 }, warnings: ["w1"] });
        expect(r1.text).toBe(JSON.stringify(r1.data, null, 2));
        const progress = client.notifications.filter((n) => n.method === "notifications/progress").map((n) => n.params);
        expect(progress).toEqual([
            { progressToken: "pt-1", progress: 10, total: 100, message: "bağlanıyor" },
            { progressToken: "pt-1", progress: 100, total: 100, message: "ok" },
        ]);

        client.notifications.length = 0;
        const r2 = await client.callTool("get_site_context", {});
        expect(r2.isError).toBe(false);
        expect(client.notifications.filter((n) => n.method === "notifications/progress")).toEqual([]);

        const post = reg.calls.filter((c) => c.method === "POST");
        expect(post).toHaveLength(2);
        expect(post[0].path).toBe("/api/v1/tools/get_site_context");
        expect(post[0].query.stream).toBe("1");
        expect(post[0].headers.authorization).toBe(`Bearer ${reg.token}`);
        expect(post[0].headers["x-tecof-surface"]).toBe("mcp");
        expect(post[0].headers["content-type"]).toBe("application/json");
        expect(post[0].headers.accept).toContain("text/event-stream");
        expect(post[0].body).toEqual({});
    });

    it("application/json yanıt (idempotency replay) düz zarf olarak okunur", async () => {
        const { client } = await setup();
        const r = await client.callTool("domain_list", {});
        expect(r.isError).toBe(false);
        expect(r.data).toEqual({ domains: [] });
    });

    it("hata zarfı → errorResult: confirmation-required (confirmId ipucu), insufficient-scope, tool-not-found; şema hatası SDK'da", async () => {
        const { client } = await setup();
        const d = await client.callTool("delete_page", { page: "home" });
        expect(d.isError).toBe(true);
        expect(d.data.error).toBe("confirmation-required");
        expect(d.data.status).toBe(409);
        expect(d.data.needsConfirmation).toBe(true);
        expect(d.data.confirmId).toBe("cf1");
        expect(d.text.startsWith("confirmation-required: Onay gerekli.")).toBe(true);
        expect(d.text).toContain('confirmId:"cf1"');
        expect(d.text).toContain('"home" sayfası silinecek');

        const ok = await client.callTool("delete_page", { page: "home", confirm: true, confirmId: "cf1" });
        expect(ok.isError).toBe(false);
        expect(ok.data).toEqual({ pageId: "p0", deleted: true, confirmId: "cf1" });

        const g = await client.callTool("generate_image", { prompt: "x" });
        expect(g.isError).toBe(true);
        expect(g.data.error).toBe("insufficient-scope");
        expect(g.data.status).toBe(403);
        expect(g.data.missing).toEqual(["ai:generate"]);
        expect(g.text).toContain("API Anahtarları");

        /* confirm:false şemada reddedilir (fromJsonSchema const:true) — sunucuya gitmez */
        const bad = await client.callTool("delete_page", { page: "home", confirm: false });
        expect(bad.isError).toBe(true);
        expect(bad.text).toContain("confirm");

        /* Sunucuda handler'ı olmayan araç: 404 tool-not-found zarfı (SSE değil, JSON) */
        const nf = await client.callTool("custom_ping", { echo: "x" });
        expect(nf.isError).toBe(false);
        expect(nf.data).toEqual({ pong: true, echo: "x" });
    });

    it("yanlış token: katalog 401 → snapshot; çağrı 401 açıklaması + TECOF_API_TOKEN ipucu", async () => {
        const { client, ctx, logs } = await setup({ token: "tcf_wrong" });
        expect(ctx.remoteCatalog.current().source).toBe("snapshot");
        expect(logs.some((l) => /snapshot/.test(l) && /token-invalid/.test(l))).toBe(true);
        const r = await client.callTool("get_site_context", {});
        expect(r.isError).toBe(true);
        expect(r.data.error).toBe("token-invalid");
        expect(r.text).toContain("TECOF_API_TOKEN");
    });
});

describe("remote mod — snapshot fallback ve toolsets", () => {
    it("backend erişilemez: snapshot (tüm araçlar), stderr uyarısı, başlangıç bütçesi; çağrı ulaşılamadı hatası", async () => {
        const t0 = Date.now();
        const { client, ctx, logs } = await setup({ apiUrl: "http://127.0.0.1:9" });
        expect(Date.now() - t0).toBeLessThan(3500);
        expect(ctx.remoteCatalog.current().source).toBe("snapshot");
        expect(logs.some((l) => /snapshot/.test(l))).toBe(true);
        expect(client.init.instructions).toBe((snapshotJson as any).instructions);

        const names = (await client.listTools()).map((t) => t.name);
        expect(names).toHaveLength(SNAPSHOT_TOOL_COUNT);
        expect(names).toEqual(expect.arrayContaining(["get_site_context", "create_page", "domain_dns_upsert", "store_health_check", "remember"]));

        const r = await client.callTool("list_pages", {});
        expect(r.isError).toBe(true);
        expect(r.text).toContain("ulaşılamadı");
    });

    it("katalog isteği zaman aşımı (asılı sunucu) → snapshot, süre bütçesi aşılmaz", async () => {
        const t0 = Date.now();
        const { ctx, logs } = await setup({ registry: { catalogDelayMs: 2_000 }, catalogTimeoutMs: 250 });
        expect(Date.now() - t0).toBeLessThan(1_500);
        expect(ctx.remoteCatalog.current().source).toBe("snapshot");
        expect(logs.some((l) => /0\.25 sn/.test(l))).toBe(true);
    });

    it("TECOF_TOOLSETS: katalog sorgusuna eklenir; snapshot da modüle göre daralır", async () => {
        const live = await setup({ toolsets: ["pages", "cms"] });
        const cat = live.reg.calls.find((c) => c.path === "/api/v1/tools");
        expect(cat?.query.toolsets).toBe("pages,cms");

        const offline = await setup({ apiUrl: "http://127.0.0.1:9", toolsets: ["pages"] });
        const names = (await offline.client.listTools()).map((t) => t.name).sort();
        expect(names).toEqual(["create_page", "delete_page", "get_page", "get_preview_url", "list_components", "list_pages", "update_page", "validate_document"]);
        expect(loadCatalogSnapshot(["products"]).tools.map((t) => t.module)).toEqual(["products", "products", "products", "products", "products"]);
    });

    it("arka plan yenileme: snapshot ile başlayan sunucuya canlı katalog gelince yeni araç eklenir + tools/list_changed", async () => {
        const { client, ctx, reg } = await setup({ registry: { catalogFailFirst: 1 } });
        expect(ctx.remoteCatalog.current().source).toBe("snapshot");
        expect((await client.listTools()).map((t) => t.name)).not.toContain("custom_ping");

        const state = await ctx.remoteCatalog.refresh();
        expect(state.source).toBe("live");
        expect(reg.catalogRequests).toBe(2);
        expect((await client.listTools()).map((t) => t.name)).toContain("custom_ping");
        expect(client.notifications.some((n) => n.method === "notifications/tools/list_changed")).toBe(true);
        const r = await client.callTool("custom_ping", { echo: "merhaba" });
        expect(r.data).toEqual({ pong: true, echo: "merhaba" });
    });

    it("token/url yoksa: snapshot listelenir, çağrı yapılandırma hatası döner, ağa gidilmez", async () => {
        const config: TecofConfig = { projectDir: FIXTURE_THEME_DIR, apiUrl: null, themeId: null, token: null, localUrl: "http://localhost:3000", sources: {}, mode: "remote" };
        const logs: string[] = [];
        const ctx = new ServerContext({ config, log: (m) => logs.push(m) });
        await ctx.remoteCatalog.ready();
        expect(ctx.registry).toBeNull();
        const client = await connectTestClient(buildServer({ ctx }));
        cleanups.push(() => client.close());
        expect((await client.listTools()).length).toBe(SNAPSHOT_TOOL_COUNT);
        const r = await client.callTool("list_pages", {});
        expect(r.isError).toBe(true);
        expect(r.text).toContain("TECOF_API_TOKEN");
    });
});

describe("remote mod — hibrit sayfa araçları", () => {
    it("create_page: yerel build/validate → registry'ye document (sections yok, layoutFrom yok) → yanıt birleşimi", async () => {
        const { client, reg } = await setup({ registry: { pages: [{ slug: "home", draftData: HOME_DOC }] } });
        const r = await client.callTool("create_page", {
            slug: "kurumsal",
            title: "Kurumsal",
            titles: { tr: "Kurumsal", en: "Corporate" },
            meta: { metaTitle: "Kurumsal" },
            sections: [{ type: "FeaturesSection", props: { columns: "3" } }],
        });
        expect(r.isError).toBe(false);
        expect(r.data.pageId).toBe("p1");
        expect(r.data.warnings).toContain("sunucu: ok");

        const call = reg.calls.find((c) => c.method === "POST" && c.path === "/api/v1/tools/create_page");
        expect(call).toBeTruthy();
        expect(call!.body.sections).toBeUndefined();
        expect(call!.body.layoutFrom).toBeUndefined();
        expect(call!.body.themeId).toBe(reg.themeId);
        expect(call!.body.slug).toBe("kurumsal");
        expect(call!.body.titles).toEqual([{ code: "tr", value: "Kurumsal" }, { code: "en", value: "Corporate" }]);
        expect(Array.isArray(call!.body.meta.metaTitle)).toBe(true);
        expect(call!.body.document.content.map((n: any) => n.type)).toEqual(["Header", "FeaturesSection", "Footer"]);
        expect(call!.body.document.content[1].props.columns).toBe("3");
        expect(call!.body.document.zones["hdr00001:logoSlot"]).toHaveLength(1);

        /* dryRun sunucuya dryRun:true ile gider; layout bilgisi yerelden eklenir */
        const dry = await client.callTool("create_page", { slug: "x", title: "X", sections: [{ type: "FeaturesSection" }], dryRun: true });
        expect(dry.isError).toBe(false);
        expect(dry.data.dryRun).toBe(true);
        expect(dry.data.layout).toEqual({ header: "Header", footer: "Footer" });
        const dryCall = reg.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/tools/create_page")[1];
        expect(dryCall.body.dryRun).toBe(true);
    });

    it("create_page: yerel build hatası registry'ye gitmeden döner; sunucu doğrulama hatası errorResult", async () => {
        const { client, reg } = await setup({
            registry: {
                pages: [{ slug: "home", draftData: HOME_DOC }],
                handlers: { ...HANDLERS, create_page: () => ({ mode: "sse-error", status: 400, messageCode: "invalid-document", message: "Doküman doğrulamadan geçmedi.", data: { errors: [{ code: "unknown-type", path: "content[1]", message: "yok" }] } }) },
            },
        });
        const bad = await client.callTool("create_page", { slug: "x", title: "X", sections: [{ type: "NopeSection" }] });
        expect(bad.isError).toBe(true);
        expect(bad.text).toContain("unknown-type");
        expect(reg.calls.some((c) => c.method === "POST" && c.path === "/api/v1/tools/create_page")).toBe(false);

        const srv = await client.callTool("create_page", { slug: "x", title: "X", sections: [{ type: "FeaturesSection" }] });
        expect(srv.isError).toBe(true);
        expect(srv.data.error).toBe("invalid-document");
        expect(srv.data.errors[0].code).toBe("unknown-type");
    });

    it("update_page: operations yerelde uygulanır → document + expectedModifiedDate; yalnız meta → document yok; applied yerelden", async () => {
        const modifiedDate = "2026-09-02T12:00:00.000Z";
        const { client, reg } = await setup({ registry: { pages: [{ slug: "home", draftData: HOME_DOC, modifiedDate }] } });
        const home = reg.pages[0];

        const r = await client.callTool("update_page", { page: "home", operations: [{ op: "append_section", section: { type: "FeaturesSection", props: { columns: "2" } } }] });
        expect(r.isError).toBe(false);
        expect(r.data.applied).toHaveLength(1);
        expect(r.data.warnings).toContain("sunucu: güncellendi");
        const call = reg.calls.find((c) => c.method === "POST" && c.path === "/api/v1/tools/update_page");
        expect(call!.body.page).toBe(home._id);
        expect(call!.body.operations).toBeUndefined();
        expect(call!.body.expectedModifiedDate).toBe(modifiedDate);
        expect(call!.body.document.content.map((n: any) => n.type)).toEqual(["Header", "HeroCentered", "FeaturesSection", "Footer"]);

        const m = await client.callTool("update_page", { page: "home", meta: { title: "Yeni", slugs: { en: "home-en" } } });
        expect(m.isError).toBe(false);
        const call2 = reg.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/tools/update_page")[1];
        expect(call2.body.document).toBeUndefined();
        expect(call2.body.meta).toEqual({ title: "Yeni", slugs: [{ code: "en", value: "home-en" }] });

        /* Ortak bileşen değişikliği yerelde reddedilir; sunucuya gidilmez */
        const shared = await client.callTool("update_page", { page: "home", operations: [{ op: "set_props", id: "hdr00001", props: { showCart: "yes" } }] });
        expect(shared.isError).toBe(true);
        expect(shared.text).toContain("ortak bileşen");
        expect(reg.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/tools/update_page")).toHaveLength(2);
    });

    it("components/ dizini yoksa dört sayfa aracı da proxy (katalog şeması + sunucu)", async () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tecof-mcp-empty-"));
        cleanups.push(async () => fs.rmSync(emptyDir, { recursive: true, force: true }));
        const { client, ctx } = await setup({ projectDir: emptyDir });
        expect(ctx.hasLocalCatalog()).toBe(false);
        const byName = Object.fromEntries((await client.listTools()).map((t) => [t.name, t]));
        expect(byName.create_page.inputSchema.required).toEqual(["slug", "title"]);
        expect(byName.create_page.inputSchema.properties.document).toBeDefined();
        expect(byName.list_components.inputSchema.properties.themeId).toBeDefined();
        const lc = await client.callTool("list_components", {});
        expect(lc.data).toEqual({ source: "server", count: 0, components: [] });
        const vd = await client.callTool("validate_document", { sections: [] });
        expect(vd.data).toEqual({ source: "server", ok: true });
    });
});

describe("remote mod — konfigürasyon", () => {
    it("TECOF_MCP_MODE ve TECOF_TOOLSETS çözümü; tanınmayan mod local + uyarı; varsayılan local", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tecof-mcp-cfg-"));
        cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
        const remote = loadConfig({ env: { TECOF_MCP_MODE: "Remote", TECOF_TOOLSETS: "Pages, cms,,bad-name" }, projectDir: dir });
        expect(remote.mode).toBe("remote");
        expect(remote.toolsets).toEqual(["pages", "cms"]);
        expect(remote.warnings).toEqual([]);
        expect(remote.sources.TECOF_MCP_MODE).toBe("env");

        const bad = loadConfig({ env: { TECOF_MCP_MODE: "proxy", TECOF_TOOLSETS: "-" }, projectDir: dir });
        expect(bad.mode).toBe("local");
        expect(bad.toolsets).toBeNull();
        expect(bad.warnings).toHaveLength(2);

        const def = loadConfig({ env: {}, projectDir: dir });
        expect(def.mode).toBe("local");
        expect(def.sources.TECOF_MCP_MODE).toBe("default");
        expect(parseToolsets("")).toBeNull();
        expect(parseToolsets("pages,pages")).toEqual(["pages"]);
    });

    it("RegistryClient: baseUrl normalize + katalog URL'si; local modda instructions paketinki", async () => {
        const c = new RegistryClient({ baseUrl: "https://api.example.com/api/v1/", token: "tcf_x", toolsets: ["pages"] });
        expect(c.catalogUrl).toBe("https://api.example.com/api/v1/tools?surface=mcp&toolsets=pages");
        const config: TecofConfig = { projectDir: FIXTURE_THEME_DIR, apiUrl: "https://api.example.com", themeId: null, token: "tcf_x", localUrl: "http://localhost:3000", sources: {} };
        const ctx = new ServerContext({ config, log: () => undefined, fetch: (async () => { throw new Error("ağ yok"); }) as any });
        expect(ctx.mode).toBe("local");
        const client = await connectTestClient(buildServer({ ctx }));
        cleanups.push(() => client.close());
        expect(client.init.instructions).toBe(SERVER_INSTRUCTIONS);
        expect((await client.listTools()).length).toBe(26);
    });
});
