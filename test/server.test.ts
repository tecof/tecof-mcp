/**
 * Uçtan uca: gerçek McpServer + InMemoryTransport + sahte backend (fetch mock).
 * Gerçek ağa çıkılmaz; tema kataloğu test/fixtures/theme'den okunur.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ServerContext } from "../src/context.js";
import { buildServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import type { TecofConfig } from "../src/config.js";
import type { TecofDocument } from "../src/types.js";
import { createFakeBackend, type FakeBackendOptions } from "./helpers/fakeBackend.js";
import { FIXTURE_THEME_DIR } from "./helpers/fixtures.js";
import { connectTestClient } from "./helpers/mcpClient.js";

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

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
});

async function setup(options: { backend?: FakeBackendOptions; config?: Partial<TecofConfig> } = {}) {
    const backend = createFakeBackend({
        pages: [{ slug: "home", title: "Ana Sayfa", status: "published", hasPublished: true, draftData: HOME_DOC }],
        ...options.backend,
    });
    const config: TecofConfig = {
        projectDir: FIXTURE_THEME_DIR,
        apiUrl: "https://api.example.com",
        themeId: backend.themeId,
        token: backend.token,
        localUrl: "http://localhost:3000",
        sources: {},
        ...options.config,
    };
    const logs: string[] = [];
    const ctx = new ServerContext({ config, fetch: backend.fetch as any, log: (m) => logs.push(m) });
    const server = buildServer({ ctx });
    const client = await connectTestClient(server);
    cleanups.push(() => client.close());
    return { backend, client, ctx, logs };
}

describe("MCP sunucusu — tools/list ve instructions", () => {
    it("26 tool, annotations ve _meta doğru; instructions sözleşme metniyle başlar", async () => {
        const { client } = await setup();
        expect(client.init.serverInfo.name).toBe("tecof");
        expect(client.init.instructions).toBe(SERVER_INSTRUCTIONS);
        /* 512 karakter BÜTÇE: Codex gibi istemciler yalnız ilk 512 karakteri
           gösteriyor — kritik akışlar oraya sığmalı, metin de bütçeyi aşmamalı. */
        expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
        expect(SERVER_INSTRUCTIONS).toContain("TASLAK");
        expect(SERVER_INSTRUCTIONS).toContain("get_site_context → list_components → create_page/update_page → get_preview_url");
        expect(SERVER_INSTRUCTIONS).toContain("list_cms_collections → get_cms_collection");

        const tools = await client.listTools();
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
        expect(Object.keys(byName).sort()).toEqual(
            [
                "create_cms_collection", "create_cms_item", "create_page",
                "delete_cms_item", "delete_page",
                "generate_image",
                "get_cms_collection", "get_cms_item", "get_page", "get_preview_url", "get_site_context",
                "import_image",
                "list_cms_collections", "list_cms_items", "list_components", "list_media", "list_pages",
                "update_cms_collection", "update_cms_item", "update_page",
                "validate_document",
                /* Ürün araçları (scope products:read/write) */
                "delete_product", "get_product", "get_product_import_template", "list_products", "upsert_products"
            ].sort()
        );
        for (const n of [
            "get_site_context", "list_components", "list_pages", "get_page", "validate_document", "get_preview_url", "list_media",
            "list_cms_collections", "get_cms_collection", "list_cms_items", "get_cms_item",
            "list_products", "get_product", "get_product_import_template"
        ]) {
            expect(byName[n].annotations.readOnlyHint, n).toBe(true);
        }
        // Görsel yazma araçları: yıkıcı değil ama salt-okunur da değil
        for (const n of ["import_image", "generate_image"]) {
            expect(byName[n].annotations.readOnlyHint, n).toBe(false);
            expect(byName[n].annotations.destructiveHint, n).toBe(false);
        }
        expect(byName.delete_page.annotations.destructiveHint).toBe(true);
        expect(byName.delete_page._meta["anthropic/requiresUserInteraction"]).toBe(true);
        expect(byName.delete_page.inputSchema.properties.confirm.const).toBe(true);
        expect(byName.create_page.annotations.readOnlyHint).toBe(false);
        expect(byName.create_page.inputSchema.required).toEqual(["slug", "title", "sections"]);

        /* CMS silme, sayfa silmeyle AYNI sözleşmeye tabidir: onay + yıkıcı işaret. */
        expect(byName.delete_cms_item.annotations.destructiveHint).toBe(true);
        expect(byName.delete_cms_item._meta["anthropic/requiresUserInteraction"]).toBe(true);
        expect(byName.delete_cms_item.inputSchema.properties.confirm.const).toBe(true);
        /* Şema değişikliği veri kaybettirebildiği için koleksiyon güncelleme de yıkıcı sayılır. */
        expect(byName.update_cms_collection.annotations.destructiveHint).toBe(true);
        expect(byName.create_cms_item.inputSchema.required).toEqual(["collection", "slug"]);

        /* Ürün silme de sayfa/CMS silmesiyle aynı sözleşmede: onay + yıkıcı. */
        expect(byName.delete_product.annotations.destructiveHint).toBe(true);
        expect(byName.delete_product._meta["anthropic/requiresUserInteraction"]).toBe(true);
        expect(byName.delete_product.inputSchema.properties.confirm.const).toBe(true);
        /* upsert şemasında ÜRÜN KALEMİNİN hiçbir alanı zorunlu değil: `variants`
           de, varyant içindeki `price`/`sku` de. Sunucu hem varyant başına hem
           dizinin kendisi için "bu gövdede gerçekten var mıydı" bayrağı taşıyor;
           gönderilmeyen alana dokunmuyor. Şema bunu daraltırsa kısmi güncelleme
           (ör. yalnız status) fazladan okuma ya da uydurma varyant gerektirir
           (bkz. src/tools/_products.ts UpsertProductSchema yorumu). */
        expect(byName.upsert_products.annotations.readOnlyHint).toBe(false);
        expect(byName.upsert_products.inputSchema.required).toEqual(["items"]);
        const itemSchema = byName.upsert_products.inputSchema.properties.items.items;
        expect(itemSchema.required).toBeUndefined();
        expect(itemSchema.properties.variants.minItems).toBe(1);   // gönderilirse boş olamaz
        expect(itemSchema.properties.variants.items.required).toBeUndefined();
    });
});

describe("get_site_context / list_pages / get_page / get_preview_url", () => {
    it("site bağlamı: mağaza, diller, tema, token, sayfa sayısı", async () => {
        const { client } = await setup();
        const r = await client.callTool("get_site_context");
        expect(r.isError).toBe(false);
        expect(r.data.merchant).toMatchObject({ slug: "test", languages: ["tr", "en"], defaultLanguage: "tr" });
        expect(r.data.theme).toMatchObject({ merchantThemeId: "mt-1", domain: "shop.example.com" });
        /* Sahte backend varsayılanı artık CMS scope'larını da içerir (CMS araçları). */
        expect(r.data.token.scopes).toEqual(["pages:read", "pages:write", "cms:read", "cms:write"]);
        expect(r.data.pageCount).toBe(1);
        expect(r.data.warnings).toEqual([]);
    });

    it("list_pages ve get_page outline/full", async () => {
        const { client } = await setup();
        const list = await client.callTool("list_pages");
        expect(list.data.pages.map((p: any) => p.slug)).toEqual(["home"]);
        expect(list.data.pages[0].status).toBe("published");

        const outline = await client.callTool("get_page", { page: "home" });
        expect(outline.isError).toBe(false);
        expect(outline.data.page.slug).toBe("home");
        expect(outline.data.page.urls.panel).toContain("/design/");
        const sections = outline.data.outline.sections;
        expect(sections.map((s: any) => s.type)).toEqual(["Header", "HeroCentered", "Footer"]);
        expect(sections[0].shared).toBe(true);
        expect(sections[1].slots.contentSlot[0]).toMatchObject({ id: "ttl00001", type: "Title", text: "Hoş geldiniz" });

        const full = await client.callTool("get_page", { page: "home", mode: "full" });
        expect(full.data.draftData.content).toHaveLength(3);

        const missing = await client.callTool("get_page", { page: "yok" });
        expect(missing.isError).toBe(true);
        expect(missing.text).toContain("HTTP 404");
    });

    it("get_preview_url: storefront + TECOF_LOCAL_URL ile yeniden yazılmış yerel URL", async () => {
        const { client } = await setup({ config: { localUrl: "http://localhost:3100" } });
        const r = await client.callTool("get_preview_url", { page: "home", locale: "en" });
        expect(r.isError).toBe(false);
        expect(r.data.urls.storefrontPreview).toBe("https://shop.example.com/en/?showDraftData=true&previewToken=tok");
        expect(r.data.urls.localPreview).toBe("http://localhost:3100/en/?showDraftData=true&previewToken=tok");
        expect(r.data.urls.panel).toContain("/design/");
    });
});

describe("create_page", () => {
    const sections = [
        {
            type: "FeaturesSection",
            props: { columns: "2", background: "dark" },
            slots: {
                contentSlot: [{ type: "Title", props: { text: { tr: "Neden biz?", en: "Why us?" }, size: "lg" } }],
                itemsSlot: [{ type: "Card", props: { href: "/hakkimizda" }, slots: { contentSlot: [{ type: "Paragraph", props: { text: { tr: "<p>A</p>", en: "<p>B</p>" } } }] } }],
            },
        },
    ];

    it("layoutFrom=home: Header başa, Footer sona (id ve zone'larıyla); POST gövdesi ve yanıt", async () => {
        const { client, backend } = await setup();
        const r = await client.callTool("create_page", { slug: "hakkimizda", title: "Hakkımızda", sections, meta: { metaTitle: { tr: "Hakkımızda", en: "About" } } });
        expect(r.isError, r.text).toBe(false);
        expect(r.data.status).toBe("draft");
        expect(r.data.slug).toBe("hakkimizda");
        expect(r.data.outline.sections.map((s: any) => s.type)).toEqual(["Header", "FeaturesSection", "Footer"]);
        expect(r.data.urls.panel).toContain("/design/");
        expect(r.data.urls.storefrontPreview).toContain("/tr/hakkimizda");
        expect(r.data.urls.localPreview).toContain("http://localhost:3000/tr/hakkimizda");
        expect(r.data.warnings).toEqual([]);

        const post = backend.calls.find((c) => c.method === "POST" && c.url.endsWith("/pages"))!;
        expect(post.body.themeId).toBe(backend.themeId);
        expect(post.body.metaTitle).toEqual([{ code: "tr", value: "Hakkımızda" }, { code: "en", value: "About" }]);
        const doc = post.body.draftData as TecofDocument;
        expect(doc.content[0]).toMatchObject({ type: "Header", props: { id: "hdr00001", sharedComponentId: "master-h" } });
        expect(doc.content[2]).toMatchObject({ type: "Footer", props: { id: "ftr00001" } });
        expect(doc.zones["hdr00001:logoSlot"]).toHaveLength(1);
        const feat = doc.content[1];
        expect(feat.props.itemsSlot).toEqual([]);
        expect(doc.zones[`${feat.props.id}:itemsSlot`][0].type).toBe("Card");
        // home'un hero'su kopyalanmadı
        expect(doc.content.some((n) => n.type === "HeroCentered")).toBe(false);
    });

    it('layoutFrom="none" Header/Footer eklemez; ortak olmayan Header uyarı verir; dryRun POST atmaz', async () => {
        const { client, backend } = await setup();
        const none = await client.callTool("create_page", { slug: "p1", title: "P1", sections, layoutFrom: "none" });
        expect(none.data.outline.sections.map((s: any) => s.type)).toEqual(["FeaturesSection"]);

        const dry = await client.callTool("create_page", { slug: "p2", title: "P2", sections, dryRun: true });
        expect(dry.isError).toBe(false);
        expect(dry.data.dryRun).toBe(true);
        expect(dry.data.layout).toEqual({ header: "Header", footer: "Footer" });
        expect(backend.calls.filter((c) => c.method === "POST" && c.url.endsWith("/pages"))).toHaveLength(1);

        const other = await client.callTool("create_page", { slug: "p3", title: "P3", sections, layoutFrom: "yok-sayfa", dryRun: true });
        expect(other.data.warnings.join(" ")).toContain("layoutFrom=yok-sayfa okunamadı");
    });

    it("dönüşüm hataları isError ile, yol bilgisiyle döner; slug çakışması 400 anlamlı", async () => {
        const { client } = await setup();
        const bad = await client.callTool("create_page", { slug: "x", title: "X", sections: [{ type: "Nope" }, { type: "Title" }, { type: "FeaturesSection", props: { columns: "9" } }] });
        expect(bad.isError).toBe(true);
        expect(bad.text).toContain("[unknown-type] sections[0].type");
        expect(bad.text).toContain("[element-at-root] sections[1].type");
        expect(bad.text).toContain("[invalid-option] sections[2].props.columns");
        expect(bad.data.errors).toHaveLength(3);

        const dup = await client.callTool("create_page", { slug: "home", title: "Home2", sections, layoutFrom: "none" });
        expect(dup.isError).toBe(true);
        expect(dup.text).toContain("slug zaten kullanımda");
    });
});

describe("update_page", () => {
    it("operations → PUT (expectedModifiedDate) → yanıt; applied listesi", async () => {
        const { client, backend } = await setup();
        const before = backend.pages[0].modifiedDate;
        const r = await client.callTool("update_page", {
            page: "home",
            operations: [
                { op: "append_section", section: { type: "FeaturesSection", slots: { itemsSlot: [], contentSlot: [] } } },
                { op: "set_props", id: "ttl00001", props: { text: { tr: "Merhaba", en: "Hello" } } },
                { op: "move_section", id: "hero0001", after: "hdr00001" },
            ],
            meta: { title: "Ana Sayfa v2" },
        });
        expect(r.isError, r.text).toBe(false);
        expect(r.data.applied).toHaveLength(3);
        expect(r.data.status).toBe("changed"); // published → changed
        expect(r.data.title).toBe("Ana Sayfa v2");
        const put = backend.calls.find((c) => c.method === "PUT")!;
        expect(put.body.expectedModifiedDate).toBe(before);
        expect(put.body.title).toBe("Ana Sayfa v2");
        const doc = put.body.draftData as TecofDocument;
        expect(doc.content.map((n) => n.type)).toEqual(["Header", "HeroCentered", "FeaturesSection", "Footer"]);
        expect(doc.zones["hero0001:contentSlot"][0].props.text[0].value).toBe("Merhaba");
    });

    it("409: sayfa arada değiştiyse net mesaj, kayıt yok", async () => {
        const { client, backend } = await setup({
            backend: {
                intercept: ({ method }) => (method === "PUT" ? { status: 409, body: { success: false, messageCode: "page-modified", message: "x", data: { modifiedDate: "2026-08-19T10:00:00.000Z" } } } : null),
                pages: [{ slug: "home", title: "Ana Sayfa", draftData: HOME_DOC }],
            },
        });
        const r = await client.callTool("update_page", { page: "home", operations: [{ op: "set_root_props", props: { note: 1 } }] });
        expect(r.isError).toBe(true);
        expect(r.text).toContain("siz okuduktan sonra değişti");
        expect(r.text).toContain("2026-08-19T10:00:00.000Z");
        expect(backend.pages[0].draftData).toEqual(HOME_DOC);
    });

    it("ortak bileşen değişikliği, şablon sayfa, dryRun, document modu", async () => {
        const { client, backend } = await setup({
            backend: { pages: [{ slug: "home", draftData: HOME_DOC }, { slug: "urun", isTemplate: true, draftData: HOME_DOC }] },
        });
        const shared = await client.callTool("update_page", { page: "home", operations: [{ op: "set_props", id: "hdr00001", props: { showCart: "yes" } }] });
        expect(shared.isError).toBe(true);
        expect(shared.text).toContain("ortak bileşen");

        const tpl = await client.callTool("update_page", { page: "urun", operations: [{ op: "set_root_props", props: { a: 1 } }] });
        expect(tpl.isError).toBe(true);
        expect(tpl.text).toContain("şablon");

        const putCountBefore = backend.calls.filter((c) => c.method === "PUT").length;
        const dry = await client.callTool("update_page", { page: "home", dryRun: true, operations: [{ op: "remove_section", id: "hero0001" }] });
        expect(dry.isError).toBe(false);
        expect(dry.data.outline.sections.map((s: any) => s.type)).toEqual(["Header", "Footer"]);
        expect(backend.calls.filter((c) => c.method === "PUT").length).toBe(putCountBefore);

        const docMode = await client.callTool("update_page", {
            page: "home",
            document: { root: { props: {} }, content: [{ type: "FeaturesSection", props: { id: "f1", columns: "3", background: "white", itemsSlot: [{ type: "Card", props: { contentSlot: [] } }] } }], zones: {} },
        });
        expect(docMode.isError, docMode.text).toBe(false);
        expect(docMode.data.warnings.join(" ")).toContain("inline-slot");
        const saved = backend.pages[0].draftData!;
        expect(saved.content[0].props.itemsSlot).toEqual([]);
        expect(saved.zones["f1:itemsSlot"][0].type).toBe("Card");

        const nothing = await client.callTool("update_page", { page: "home" });
        expect(nothing.isError).toBe(true);
    });
});

describe("update_page — inceleme bulguları", () => {
    it("#12 operations:[] (meta yok) → 'uygulanacak işlem yok' hatası, PUT atılmaz; yalnız meta → draftData gönderilmez", async () => {
        const { client, backend } = await setup();
        const empty = await client.callTool("update_page", { page: "home", operations: [] });
        expect(empty.isError).toBe(true);
        expect(empty.text).toContain("uygulanacak işlem yok");
        expect(backend.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

        const metaOnly = await client.callTool("update_page", { page: "home", operations: [], meta: { title: "Yeni Başlık" } });
        expect(metaOnly.isError, metaOnly.text).toBe(false);
        expect(metaOnly.data.savedDraft).toBe(false);
        const put = backend.calls.find((c) => c.method === "PUT")!;
        expect(put.body.draftData).toBeUndefined();
        expect(put.body.title).toBe("Yeni Başlık");
        expect(backend.pages[0].status).toBe("published"); // draftData gitmedi → status değişmedi
    });

    it("#5 sunucu uyarıları (zarf kökü, DocIssue) create/update yanıtında ajana gösterilir", async () => {
        const { client } = await setup({
            backend: {
                pages: [{ slug: "home", draftData: HOME_DOC }],
                writeWarnings: [{ code: "shared-component-missing", path: "content[0]", message: "sharedComponentId master-h bulunamadı; bağ düşürüldü" }],
            },
        });
        const upd = await client.callTool("update_page", { page: "home", operations: [{ op: "set_root_props", props: { note: 1 } }] });
        expect(upd.isError, upd.text).toBe(false);
        expect(upd.data.warnings).toContain("sunucu: [shared-component-missing] content[0]: sharedComponentId master-h bulunamadı; bağ düşürüldü");
        const cr = await client.callTool("create_page", { slug: "x1", title: "X1", sections: [{ type: "HeroCentered", slots: { contentSlot: [] } }], layoutFrom: "none" });
        expect(cr.isError, cr.text).toBe(false);
        expect(cr.data.warnings.some((w: string) => w.startsWith("sunucu: [shared-component-missing]"))).toBe(true);
    });

    it("#11/#10/#6 operations modu: eski sayfa (inline slot, allow ihlali, ölü SharedComponentRef) normalize edilir, uyarıyla kaydedilir", async () => {
        const legacy: TecofDocument = {
            root: { props: {} },
            content: [
                { type: "SharedComponentRef", props: { id: "ref00001", type: "Header", sharedComponentId: "dead-master" } },
                { type: "FeaturesSection", props: { id: "feat0001", columns: "3", background: "cream", contentSlot: [{ type: "Title", props: { id: "inl00001", text: [{ code: "tr", value: "inline" }] } }], itemsSlot: [] } } as any,
                { type: "HeroCentered", props: { id: "hero0001", contentSlot: [] } },
            ],
            zones: { "feat0001:itemsSlot": [{ type: "Title", props: { id: "bad00001", text: [{ code: "tr", value: "allow ihlali" }] } }] },
        };
        const { client, backend } = await setup({ backend: { pages: [{ slug: "home", draftData: legacy }] } });
        const r = await client.callTool("update_page", { page: "home", operations: [{ op: "set_root_props", props: { note: 1 } }] });
        expect(r.isError, r.text).toBe(false);
        const codes = r.data.warnings.join("\n");
        expect(codes).toContain("[shared-component-ref-dropped]");
        expect(codes).toContain("[inline-slot]");
        expect(codes).toContain("[slot-not-allowed]");
        const saved = backend.pages[0].draftData!;
        expect(saved.content.map((n) => n.type)).toEqual(["FeaturesSection", "HeroCentered"]);
        expect(saved.content[0].props.contentSlot).toEqual([]);
        expect(saved.zones["feat0001:contentSlot"][0].props.id).toBe("inl00001");
        expect(saved.root.props.note).toBe(1);

        // Ama ajanın BU TURDA eklediği düğümde allow ihlali hâlâ hata
        const strict = await client.callTool("update_page", { page: "home", operations: [{ op: "set_slot", id: "feat0001", slot: "itemsSlot", children: [{ type: "Title" }] }] });
        expect(strict.isError).toBe(true);
        expect(strict.text).toContain("slot-not-allowed");
    });

    it("#4 ortak bileşenin alt düğümü update_page'de reddedilir; outline alt düğümü shared işaretler", async () => {
        const { client } = await setup();
        const outline = await client.callTool("get_page", { page: "home" });
        expect(outline.data.outline.sections[0].slots.logoSlot[0]).toMatchObject({ id: "logo0001", shared: true });
        const r = await client.callTool("update_page", { page: "home", operations: [{ op: "set_props", id: "logo0001", props: { text: "x" } }] });
        expect(r.isError).toBe(true);
        expect(r.text).toContain("ortak bileşen Header (hdr00001) içinde");
    });

    it("#3 geçersiz /me yanıtı anlamlı hata; #1 http TECOF_API_URL uyarısı tool hatalarına ipucu olarak eklenir", async () => {
        const { client } = await setup({
            backend: { intercept: ({ url }) => (url.pathname.endsWith("/me") ? { status: 200, body: { success: true, data: {} } } : null) },
        });
        const r = await client.callTool("list_pages");
        expect(r.isError).toBe(true);
        expect(r.text).toContain("Geçersiz /me yanıtı");

        const { client: insecure, ctx } = await setup({ config: { apiUrl: "http://api.example.com", token: "tcf_wrong" } });
        expect(ctx.insecureApiUrlWarning).toContain("şifresiz");
        const e = await insecure.callTool("list_pages");
        expect(e.isError).toBe(true);
        expect(e.text).toContain("İpucu: TECOF_API_URL şifresiz");
    });
});

describe("delete_page ve validate_document", () => {
    it("delete_page confirm:true ile siler; confirm:false şemada reddedilir", async () => {
        const { client, backend } = await setup({ backend: { pages: [{ slug: "home", draftData: HOME_DOC }, { slug: "eski" }] } });
        const r = await client.callTool("delete_page", { page: "eski", confirm: true });
        expect(r.isError).toBe(false);
        expect(r.data).toMatchObject({ slug: "eski", deleted: true });
        expect(backend.pages.map((p) => p.slug)).toEqual(["home"]);

        const refused = await client.callTool("delete_page", { page: "home", confirm: false }).catch((e) => ({ isError: true, text: String(e), data: undefined, raw: null }));
        expect(refused.isError).toBe(true);
        expect(backend.pages.map((p) => p.slug)).toEqual(["home"]);
    });

    it("validate_document sections ve document modları", async () => {
        const { client } = await setup();
        const ok = await client.callTool("validate_document", { sections: [{ type: "HeroCentered", slots: { contentSlot: [{ type: "Title", props: { text: { tr: "a", en: "b" } } }] } }] });
        expect(ok.data.ok).toBe(true);
        expect(ok.data.normalizedDocument.content[0].type).toBe("HeroCentered");
        expect(ok.data.outline.sections[0].slots.contentSlot[0].text).toBe("a");

        const bad = await client.callTool("validate_document", { document: { root: { props: {} }, content: [{ type: "Title", props: { id: "t" } }, { type: "Title", props: { id: "t" } }], zones: { "zzz:slot": [] } } });
        expect(bad.data.ok).toBe(false);
        expect(bad.data.errors.map((e: any) => e.code)).toEqual(expect.arrayContaining(["element-at-root", "id", "zone-key"]));
        expect(bad.data.normalizedDocument).toBeUndefined();
    });
});

describe("hatalı konfigürasyon", () => {
    it("token yoksa: list_components çalışır, sayfa tool'ları yol gösteren hata döner; /me'ye gidilmez", async () => {
        const { client, backend } = await setup({ config: { token: null } });
        const lc = await client.callTool("list_components", { category: "element" });
        expect(lc.isError).toBe(false);
        expect(lc.data.components.every((c: any) => c.category === "element")).toBe(true);

        const lp = await client.callTool("list_pages");
        expect(lp.isError).toBe(true);
        expect(lp.text).toContain("TECOF_API_TOKEN");
        expect(backend.calls).toHaveLength(0);

        // validate_document dil bilgisi olmadan "tr" ile devam eder ve uyarır
        const v = await client.callTool("validate_document", { sections: [{ type: "HeroCentered", slots: { contentSlot: [] } }] });
        expect(v.data.ok).toBe(true);
        expect(v.data.warnings.some((w: any) => w.code === "context")).toBe(true);
    });

    it("TECOF_THEME_ID mağazaya kurulu değilse sayfa tool'ları net hata, get_site_context uyarı", async () => {
        const { client } = await setup({ config: { themeId: "ffffffffffffffffffffffff" } });
        const sc = await client.callTool("get_site_context");
        expect(sc.isError).toBe(false);
        expect(sc.data.theme).toBeNull();
        expect(sc.data.warnings[0]).toContain("kurulu değil");
        const lp = await client.callTool("list_pages");
        expect(lp.isError).toBe(true);
        expect(lp.text).toContain("Kurulu temalar");
    });

    it("yanlış token: 401 açıklaması ve .env ipucu", async () => {
        const { client } = await setup({ config: { token: "tcf_wrong" } });
        const r = await client.callTool("get_site_context");
        expect(r.isError).toBe(true);
        expect(r.text).toContain("API anahtarı geçersiz");
        expect(r.text).toContain("TECOF_API_TOKEN");
    });

    it("list_components: bileşen bulunamadı → available listesi; proje dizini boşsa uyarı", async () => {
        const { client } = await setup();
        const r = await client.callTool("list_components", { component: "Yok" });
        expect(r.isError).toBe(true);
        expect(r.data.available).toContain("FeaturesSection");

        const full = await client.callTool("list_components", { component: "featuressection" });
        expect(full.data.detail).toBe("full");
        expect(full.data.components[0].fields.find((f: any) => f.key === "itemsSlot").allow).toEqual(["Card"]);
        expect(full.data.components[0].defaultProps.itemsSlot).toEqual(["<Card>", "<Card>", "<Card>"]);

        const { client: empty } = await setup({ config: { projectDir: "/nonexistent/dir" } });
        const e = await empty.callTool("list_components");
        expect(e.data.count).toBe(0);
        expect(e.data.warnings[0]).toContain("TECOF_PROJECT_DIR");
    });
});
