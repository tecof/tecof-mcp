import { describe, expect, it } from "vitest";
import { buildDocument, buildSection, nodeToSection } from "../src/document/build.js";
import { validateDocument } from "../src/document/validate.js";
import { LANG, loadFixtureCatalog } from "./helpers/fixtures.js";

const ID_RE = /^[A-Za-z0-9_-]{8}$/;

async function ctx() {
    const snap = await loadFixtureCatalog();
    return { catalog: snap.byName, lang: LANG, usedIds: new Set<string>() };
}

describe("buildDocument — FeaturesSection + Card + Title", () => {
    it("slot çocuklarını zones'a yazar, props[slot]=[] bırakır, id'ler tekil 8 karakter", async () => {
        const c = await ctx();
        const { document: doc, errors, warnings } = buildDocument(
            [
                {
                    type: "FeaturesSection",
                    props: { columns: "2", background: "dark" },
                    slots: {
                        contentSlot: [{ type: "Title", props: { text: { tr: "Neden biz?", en: "Why us?" }, size: "lg" } }],
                        itemsSlot: [
                            {
                                type: "Card",
                                props: { href: "/hakkimizda" },
                                slots: { contentSlot: [{ type: "Title", props: { text: { tr: "Hızlı", en: "Fast" } } }] },
                            },
                        ],
                    },
                },
            ],
            c
        );
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);

        expect(doc.content).toHaveLength(1);
        const section = doc.content[0];
        expect(section.type).toBe("FeaturesSection");
        expect(section.props.id).toMatch(ID_RE);
        expect(section.props.columns).toBe("2");
        expect(section.props.background).toBe("dark");
        // slot prop'ları boş dizi; içerik zones'ta
        expect(section.props.contentSlot).toEqual([]);
        expect(section.props.itemsSlot).toEqual([]);

        const content = doc.zones[`${section.props.id}:contentSlot`];
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe("Title");
        expect(content[0].props.text).toEqual([{ code: "tr", value: "Neden biz?" }, { code: "en", value: "Why us?" }]);
        expect(content[0].props.size).toBe("lg");
        expect(content[0].props.align).toBe("left"); // Title defaultProps'tan

        const items = doc.zones[`${section.props.id}:itemsSlot`];
        expect(items).toHaveLength(1);
        const card = items[0];
        expect(card.type).toBe("Card");
        expect(card.props.href).toEqual([{ code: "tr", value: { url: "/hakkimizda", target: "_self" } }]);
        expect(card.props.contentSlot).toEqual([]);
        const cardContent = doc.zones[`${card.props.id}:contentSlot`];
        expect(cardContent).toHaveLength(1);
        expect(cardContent[0].type).toBe("Title");

        // Tüm id'ler tekil
        const ids = [section.props.id, ...Object.values(doc.zones).flat().map((n) => n.props.id)];
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(ID_RE);

        // Doğrulamadan geçer
        const v = validateDocument(doc, { catalog: c.catalog, lang: LANG });
        expect(v.ok).toBe(true);
    });

    it("slot verilmezse defaultProps'taki örnek çocuklar (yeni id'lerle) kullanılır; [] verilirse boş kalır", async () => {
        const c = await ctx();
        const { document: doc, errors } = buildDocument([{ type: "FeaturesSection" }, { type: "FeaturesSection", slots: { itemsSlot: [], contentSlot: [] } }], c);
        expect(errors).toEqual([]);
        const [a, b] = doc.content;
        expect(doc.zones[`${a.props.id}:itemsSlot`]).toHaveLength(3);
        expect(doc.zones[`${a.props.id}:itemsSlot`].every((n) => n.type === "Card")).toBe(true);
        // Card'ın kendi varsayılan çocukları da açılmış olmalı
        const firstCard = doc.zones[`${a.props.id}:itemsSlot`][0];
        expect(doc.zones[`${firstCard.props.id}:contentSlot`].map((n) => n.type)).toEqual(["Paragraph", "Title", "Paragraph"]);
        // Tema dosyasındaki sabit id'ler ("features-card-1") kullanılmaz
        expect(firstCard.props.id).toMatch(ID_RE);
        expect(doc.zones[`${b.props.id}:itemsSlot`]).toEqual([]);
        expect(doc.zones[`${b.props.id}:contentSlot`]).toEqual([]);
    });

    it("variant: props birleşir ve _variant basılır; bilinmeyen varyant hata", async () => {
        const c = await ctx();
        const ok = buildSection({ type: "ProcessSteps", variant: "dikey", props: { background: "koyu" } }, c, { root: true, path: "s" });
        expect(ok.errors).toEqual([]);
        expect(ok.built!.node.props).toMatchObject({ orientation: "dikey", cardStyle: "sade", background: "koyu", _variant: "dikey" });
        // helper ile üretilen steps varsayılanı atlandı → uyarı + boş dizi
        expect(ok.warnings.some((w) => w.code === "default-unresolved")).toBe(true);
        expect(ok.built!.node.props.steps).toEqual([]);

        const bad = buildSection({ type: "ProcessSteps", variant: "yok" }, c, { root: true, path: "s" });
        expect(bad.errors[0]).toMatchObject({ code: "unknown-variant", path: "s.variant" });
        expect(bad.errors[0].message).toContain("yatay3");

        const none = buildSection({ type: "FeaturesSection", variant: "x" }, c, { root: true, path: "s" });
        expect(none.errors[0].message).toContain("varyantı yok");
    });

    it("hatalar: bilinmeyen type (öneriyle), kökte element, allow ihlali, select dışı, rezervli prop, bilinmeyen slot", async () => {
        const c = await ctx();
        const { errors } = buildDocument(
            [
                { type: "FeatureSection" },
                { type: "Title", props: { text: "x" } },
                { type: "FeaturesSection", props: { columns: "9", _locked: true, sharedComponentId: "abc" }, slots: { itemsSlot: [{ type: "Title" }], bogus: [] } },
            ],
            c
        );
        const codes = errors.map((e) => `${e.code}@${e.path}`);
        expect(codes).toContain("unknown-type@sections[0].type");
        expect(errors[0].message).toContain("FeaturesSection");
        expect(codes).toContain("element-at-root@sections[1].type");
        expect(codes).toContain("invalid-option@sections[2].props.columns");
        expect(codes).toContain("reserved-prop@sections[2].props._locked");
        expect(codes).toContain("shared-component@sections[2].props.sharedComponentId");
        expect(codes).toContain("slot-not-allowed@sections[2].slots.itemsSlot[0].type");
        expect(codes).toContain("unknown-slot@sections[2].slots.bogus");
    });

    it("props içine yazılmış slot dizisi slots'a taşınır (uyarı); bilinmeyen prop uyarı; className serbest", async () => {
        const c = await ctx();
        const r = buildSection(
            { type: "FeaturesSection", props: { itemsSlot: [{ type: "Card" }], className: "py-10", foo: 1 } } as any,
            c,
            { root: true, path: "s" }
        );
        expect(r.errors).toEqual([]);
        expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["inline-slot", "unknown-prop"]));
        expect(r.warnings.find((w) => w.code === "unknown-prop")?.path).toBe("s.props.foo");
        expect(r.built!.node.props.className).toBe("py-10");
        expect(r.built!.zones[`${r.built!.node.props.id}:itemsSlot`]).toHaveLength(1);
    });

    it("geçerli ve tekil açık id kabul edilir; çakışan/yanlış id yerine yeni üretilir", async () => {
        const c = await ctx();
        c.usedIds.add("takenid1");
        const a = buildSection({ type: "FeaturesSection", props: { id: "myhero01" } }, c, { root: true, path: "s" });
        expect(a.built!.node.props.id).toBe("myhero01");
        const b = buildSection({ type: "FeaturesSection", props: { id: "takenid1" } }, c, { root: true, path: "s" });
        expect(b.built!.node.props.id).not.toBe("takenid1");
        expect(b.warnings.some((w) => w.code === "id-ignored")).toBe(true);
        const bad = buildSection({ type: "FeaturesSection", props: { id: "has:colon" } }, c, { root: true, path: "s" });
        expect(bad.built!.node.props.id).toMatch(ID_RE);
    });

    it("dil kısayolu ve eksik dil uyarısı build içinde çalışır", async () => {
        const c = await ctx();
        const r = buildSection({ type: "Title", props: { text: "Tek dil" } }, c, { root: false, path: "s" });
        expect(r.built!.node.props.text).toEqual([{ code: "tr", value: "Tek dil" }]);
        expect(r.warnings[0]).toMatchObject({ code: "missing-language", path: "s.props.text" });
    });

    it("nodeToSection inline çocukları slots'a çevirir ve id'yi düşürür", () => {
        const s = nodeToSection({ type: "Card", props: { id: "x", href: "#", contentSlot: [{ type: "Title", props: { id: "y", text: "a" } }] } });
        expect(s).toEqual({ type: "Card", props: { href: "#" }, slots: { contentSlot: [{ type: "Title", props: { text: "a" } }] } });
    });
});
