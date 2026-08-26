/**
 * CMS araçları — uçtan uca (gerçek McpServer + sahte backend).
 *
 * Sözleşmenin can alıcı noktaları: şema keşfi (get_cms_collection'ın alan
 * rehberi), taslak-doğar kuralı, yayındaki içeriğin kilidi, silmede onay ve
 * doğrulama hatalarının ajana okunur dönmesi.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ServerContext } from "../src/context.js";
import { buildServer } from "../src/server.js";
import type { TecofConfig } from "../src/config.js";
import { createFakeBackend, type FakeBackendOptions } from "./helpers/fakeBackend.js";
import { FIXTURE_THEME_DIR } from "./helpers/fixtures.js";
import { connectTestClient } from "./helpers/mcpClient.js";

const BLOG_FIELDS = [
    { shortcode: "baslik", type: "text", isMultilingual: true, required: true, label: [{ code: "tr", value: "Başlık" }] },
    { shortcode: "govde", type: "rich-text", isMultilingual: true, label: [{ code: "tr", value: "Gövde" }] },
    { shortcode: "kapak", type: "image", label: [{ code: "tr", value: "Kapak" }] },
    { shortcode: "etiket", type: "option", options: [{ value: "haber" }, { value: "rehber" }], label: [{ code: "tr", value: "Etiket" }] },
];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
});

async function setup(backendOptions: FakeBackendOptions = {}) {
    const backend = createFakeBackend({
        pages: [{ slug: "home", title: "Ana Sayfa" }],
        cmsCollections: [{ slug: "blog", displayField: "baslik", fields: BLOG_FIELDS }],
        cmsItems: [
            { collectionSlug: "blog", slug: "ilk-yazi", status: "draft", data: { baslik: [{ code: "tr", value: "İlk yazı" }] } },
            { collectionSlug: "blog", slug: "canli-yazi", status: "published", data: { baslik: [{ code: "tr", value: "Canlı" }] } },
        ],
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

describe("CMS araçları", () => {
    it("koleksiyonları listeler ve alan rehberini biçimleriyle döner", async () => {
        const { client } = await setup();

        const list = await client.callTool("list_cms_collections", {});
        expect(list.isError).toBe(false);
        expect(list.data.collections.map((c: any) => c.slug)).toEqual(["blog"]);
        expect(list.data.collections[0].itemCount).toBe(2);

        const schema = await client.callTool("get_cms_collection", { collection: "blog" });
        expect(schema.isError).toBe(false);
        const byCode = Object.fromEntries(schema.data.fields.map((f: any) => [f.shortcode, f]));
        /* Ajanın yazma biçimini buradan öğrenmesi bekleniyor. */
        expect(byCode.baslik.multilingual).toBe(true);
        expect(byCode.baslik.expects).toContain("[{code,value}]");
        expect(byCode.kapak.expects).toContain("dosya objesi");
        expect(byCode.etiket.options).toEqual(["haber", "rehber"]);
        expect(schema.data.languages).toEqual(["tr", "en"]);
    });

    it("içerik TASLAK doğar ve status göndermek reddedilir", async () => {
        const { client, backend } = await setup();

        const created = await client.callTool("create_cms_item", {
            collection: "blog",
            slug: "yeni-yazi",
            data: { baslik: [{ code: "tr", value: "Yeni" }, { code: "en", value: "New" }] },
        });
        expect(created.isError).toBe(false);
        expect(created.data.status).toBe("draft");
        expect(backend.cmsItems.find((i: any) => i.slug === "yeni-yazi")).toBeTruthy();

        /* Yayınlama v1'de yok: ajan status göndermeye kalkarsa açık hata alır. */
        const published = await client.callTool("create_cms_item", {
            collection: "blog",
            slug: "yayinli",
            data: { baslik: [{ code: "tr", value: "X" }] },
            status: "published",
        } as any);
        /* Şema `status` tanımlamadığı için istek MCP katmanında reddedilir. */
        expect(published.isError).toBe(true);
    });

    it("geçersiz içerik verisini okunur hata satırlarıyla döner", async () => {
        const { client } = await setup();

        const res = await client.callTool("create_cms_item", {
            collection: "blog",
            slug: "hatali",
            /* İki klasik ajan hatası: düz metin (çok dilli olmalı) + yazım hatalı alan adı */
            data: { baslik: "Merhaba", govdee: "<p>x</p>" },
        });

        expect(res.isError).toBe(true);
        expect(res.text).toContain("data.baslik");
        expect(res.text).toContain("data.govdee");
    });

    it("yayındaki içeriği değiştirmek ve silmek açık onay ister", async () => {
        const { client } = await setup();

        const blocked = await client.callTool("update_cms_item", {
            collection: "blog",
            item: "canli-yazi",
            data: { baslik: [{ code: "tr", value: "Değişti" }] },
        });
        expect(blocked.isError).toBe(true);
        expect(blocked.text).toContain("yayında");

        const allowed = await client.callTool("update_cms_item", {
            collection: "blog",
            item: "canli-yazi",
            data: { baslik: [{ code: "tr", value: "Değişti" }] },
            allowPublishedEdit: true,
        });
        expect(allowed.isError).toBe(false);

        const deleteBlocked = await client.callTool("delete_cms_item", {
            collection: "blog",
            item: "canli-yazi",
            confirm: true,
        });
        expect(deleteBlocked.isError).toBe(true);

        const deleted = await client.callTool("delete_cms_item", {
            collection: "blog",
            item: "canli-yazi",
            confirm: true,
            allowPublishedEdit: true,
        });
        expect(deleted.isError).toBe(false);
        expect(deleted.data.deleted).toBe(true);
    });

    it("taslak içerik onaysız silinebilir ama confirm zorunludur", async () => {
        const { client } = await setup();

        const noConfirm = await client.callTool("delete_cms_item", { collection: "blog", item: "ilk-yazi" } as any);
        expect(noConfirm.isError).toBe(true);

        const ok = await client.callTool("delete_cms_item", { collection: "blog", item: "ilk-yazi", confirm: true });
        expect(ok.isError).toBe(false);
    });

    it("veri taşıyan alanı silmek onay ister", async () => {
        const { client } = await setup();

        const blocked = await client.callTool("update_cms_collection", {
            collection: "blog",
            fields: BLOG_FIELDS.filter((f) => f.shortcode !== "baslik"),
        });
        expect(blocked.isError).toBe(true);
        expect(blocked.text.toLowerCase()).toContain("onay");

        const allowed = await client.callTool("update_cms_collection", {
            collection: "blog",
            fields: BLOG_FIELDS.filter((f) => f.shortcode !== "baslik"),
            allowFieldLoss: true,
        });
        expect(allowed.isError).toBe(false);
    });

    it("data varsayılan olarak BİRLEŞTİRİLİR; replace açıkça istenir", async () => {
        const { client, backend } = await setup();

        /* Kısmi gövde: yalnız başlık gönderiliyor — govde alanı KORUNMALI. */
        const before = backend.cmsItems.find((i: any) => i.slug === "ilk-yazi");
        before.data = { baslik: [{ code: "tr", value: "İlk yazı" }], govde: [{ code: "tr", value: "<p>gövde</p>" }] };

        const merged = await client.callTool("update_cms_item", {
            collection: "blog",
            item: "ilk-yazi",
            data: { baslik: [{ code: "tr", value: "Yeni başlık" }] },
        });
        expect(merged.isError).toBe(false);
        expect(merged.data.dataMode).toBe("merge");
        const afterMerge = backend.cmsItems.find((i: any) => i.slug === "ilk-yazi");
        expect(afterMerge.data.govde).toBeTruthy();
        expect(afterMerge.data.baslik[0].value).toBe("Yeni başlık");

        /* replace: göndermediğin alan SİLİNİR (bilinçli tercih). */
        const replaced = await client.callTool("update_cms_item", {
            collection: "blog",
            item: "ilk-yazi",
            data: { baslik: [{ code: "tr", value: "Tek alan" }] },
            dataMode: "replace",
        });
        expect(replaced.isError).toBe(false);
        expect(replaced.data.dataMode).toBe("replace");
        expect(backend.cmsItems.find((i: any) => i.slug === "ilk-yazi").data.govde).toBeUndefined();
    });

    it("cms scope'u olmayan anahtar okunur hata alır", async () => {
        const { client } = await setup({ scopes: ["pages:read", "pages:write"] });
        const res = await client.callTool("list_cms_collections", {});
        expect(res.isError).toBe(true);
        expect(res.text).toContain("cms:read");
    });
});
