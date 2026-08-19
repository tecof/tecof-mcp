import { describe, expect, it } from "vitest";
import { applyOperations } from "../src/document/operations.js";
import { extractLayout, applyLayout, layoutIds } from "../src/document/layout.js";
import type { TecofDocument } from "../src/types.js";
import { LANG, loadFixtureCatalog } from "./helpers/fixtures.js";

function baseDoc(): TecofDocument {
    return {
        root: { props: { _schemaVersion: 2 } },
        content: [
            { type: "Header", props: { id: "hdr00001", sharedComponentId: "master-h", showCart: "no", logoSlot: [], navSlot: [], ctaSlot: [] } },
            { type: "FeaturesSection", props: { id: "feat0001", columns: "3", background: "cream", contentSlot: [], itemsSlot: [] } },
            { type: "HeroCentered", props: { id: "hero0001", contentSlot: [] } },
            { type: "Footer", props: { id: "ftr00001", sharedComponentId: "master-f", brandSlot: [], contactSlot: [], columnsSlot: [], socialsSlot: [] } },
        ],
        zones: {
            "hdr00001:logoSlot": [{ type: "Logo", props: { id: "logo0001" } }],
            "feat0001:contentSlot": [{ type: "Title", props: { id: "ttl00001", text: [{ code: "tr", value: "Eski" }], size: "md", align: "left" } }],
            "feat0001:itemsSlot": [
                { type: "Card", props: { id: "card0001", contentSlot: [] } },
                { type: "Card", props: { id: "card0002", contentSlot: [] } },
            ],
            "card0001:contentSlot": [{ type: "Title", props: { id: "ttl00002", text: [{ code: "tr", value: "Kart" }] } }],
            "hero0001:contentSlot": [],
        },
    };
}

async function apply(ops: any[], doc = baseDoc()) {
    const snap = await loadFixtureCatalog();
    return applyOperations(doc, ops, { catalog: snap.byName, lang: LANG });
}

describe("applyOperations", () => {
    it("append_section gövdenin sonuna (Footer'ın önüne) ekler; Footer yoksa en sona; girdi dokümanı değişmez", async () => {
        const input = baseDoc();
        const r = await apply([{ op: "append_section", section: { type: "FeaturesSection", slots: { itemsSlot: [], contentSlot: [] } } }], input);
        expect(r.errors).toEqual([]);
        expect(r.document.content).toHaveLength(5);
        expect(r.document.content.map((n) => n.type)).toEqual(["Header", "FeaturesSection", "HeroCentered", "FeaturesSection", "Footer"]);
        expect(input.content).toHaveLength(4);
        expect(r.applied[0]).toMatch(/^append_section .*Footer'ın önüne/);

        const noFooter = baseDoc();
        noFooter.content.pop();
        const r2 = await apply([{ op: "append_section", section: { type: "HeroCentered", slots: { contentSlot: [] } } }], noFooter);
        expect(r2.document.content.at(-1)!.type).toBe("HeroCentered");
    });

    it("insert_section before/after kök id; iç içe id'ye hata", async () => {
        const r = await apply([
            { op: "insert_section", before: "feat0001", section: { type: "HeroCentered", slots: { contentSlot: [] } } },
            { op: "insert_section", after: "hero0001", section: { type: "HeroCentered", slots: { contentSlot: [] } } },
        ]);
        expect(r.errors).toEqual([]);
        expect(r.document.content.map((n) => n.type)).toEqual(["Header", "HeroCentered", "FeaturesSection", "HeroCentered", "HeroCentered", "Footer"]);

        const bad = await apply([{ op: "insert_section", before: "card0001", section: { type: "HeroCentered" } }]);
        expect(bad.errors[0]).toMatchObject({ code: "not-found" });
        expect(bad.errors[0].message).toContain("kök düzeyde");
    });

    it("replace_section eski alt ağacı temizler, yeni düğüm aynı konuma gelir; zone içindeki düğüm allow'a tabi", async () => {
        const r = await apply([{ op: "replace_section", id: "feat0001", section: { type: "HeroCentered", slots: { contentSlot: [{ type: "Title", props: { text: { tr: "Yeni", en: "New" } } }] } } }]);
        expect(r.errors).toEqual([]);
        expect(r.document.content[1].type).toBe("HeroCentered");
        expect(r.document.zones["feat0001:contentSlot"]).toBeUndefined();
        expect(r.document.zones["card0001:contentSlot"]).toBeUndefined();
        const newId = r.document.content[1].props.id;
        expect(r.document.zones[`${newId}:contentSlot`][0].props.text[0].value).toBe("Yeni");

        const nested = await apply([{ op: "replace_section", id: "card0001", section: { type: "Title" } }]);
        expect(nested.errors[0]).toMatchObject({ code: "slot-not-allowed" });
        const nestedOk = await apply([{ op: "replace_section", id: "card0001", section: { type: "Card", slots: { contentSlot: [] } } }]);
        expect(nestedOk.errors).toEqual([]);
        expect(nestedOk.document.zones["feat0001:itemsSlot"][0].type).toBe("Card");
        expect(nestedOk.document.zones["feat0001:itemsSlot"][0].props.id).not.toBe("card0001");
    });

    it("remove_section alt zone'larıyla siler; ortak bileşende uyarı", async () => {
        const r = await apply([{ op: "remove_section", id: "feat0001" }, { op: "remove_section", id: "hdr00001" }]);
        expect(r.errors).toEqual([]);
        expect(r.document.content.map((n) => n.props.id)).toEqual(["hero0001", "ftr00001"]);
        expect(Object.keys(r.document.zones)).toEqual(["hero0001:contentSlot"]);
        expect(r.warnings.some((w) => w.code === "shared-component")).toBe(true);

        const missing = await apply([{ op: "remove_section", id: "nope" }]);
        expect(missing.errors[0].code).toBe("not-found");
    });

    it("move_section before/after", async () => {
        const r = await apply([{ op: "move_section", id: "hero0001", before: "feat0001" }]);
        expect(r.errors).toEqual([]);
        expect(r.document.content.map((n) => n.props.id)).toEqual(["hdr00001", "hero0001", "feat0001", "ftr00001"]);
        const r2 = await apply([{ op: "move_section", id: "feat0001", after: "hero0001" }]);
        expect(r2.document.content.map((n) => n.props.id)).toEqual(["hdr00001", "hero0001", "feat0001", "ftr00001"]);
        const r3 = await apply([{ op: "move_section", id: "feat0001" }]);
        expect(r3.errors[0].code).toBe("invalid-operation");
    });

    it("set_props sığ birleştirir, kısayolları açar, select/rezervli/slot denetler; ortak bileşende hata", async () => {
        const r = await apply([{ op: "set_props", id: "feat0001", props: { columns: "4", className: "x" } }, { op: "set_props", id: "ttl00001", props: { text: { tr: "Yeni", en: "New" } } }]);
        expect(r.errors).toEqual([]);
        expect(r.document.content[1].props).toMatchObject({ columns: "4", background: "cream", className: "x" });
        expect(r.document.zones["feat0001:contentSlot"][0].props.text).toEqual([{ code: "tr", value: "Yeni" }, { code: "en", value: "New" }]);

        const bad = await apply([
            { op: "set_props", id: "feat0001", props: { columns: "9", _hidden: true, itemsSlot: [{ type: "Card" }], id: "zzz" } },
            { op: "set_props", id: "hdr00001", props: { showCart: "yes" } },
        ]);
        const codes = bad.errors.map((e) => e.code);
        expect(codes).toEqual(expect.arrayContaining(["invalid-option", "reserved-prop", "invalid-slot-value", "shared-component"]));
        expect(bad.warnings.some((w) => w.code === "id-ignored")).toBe(true);
    });

    it("set_slot slotu komple değiştirir, eski alt ağacı temizler; allow ve bilinmeyen slot denetimi", async () => {
        const r = await apply([{ op: "set_slot", id: "feat0001", slot: "itemsSlot", children: [{ type: "Card", slots: { contentSlot: [{ type: "Title", props: { text: { tr: "A", en: "B" } } }] } }] }]);
        expect(r.errors).toEqual([]);
        const items = r.document.zones["feat0001:itemsSlot"];
        expect(items).toHaveLength(1);
        expect(items[0].props.id).not.toBe("card0001");
        expect(r.document.zones["card0001:contentSlot"]).toBeUndefined();
        expect(r.document.zones[`${items[0].props.id}:contentSlot`][0].type).toBe("Title");
        expect(r.document.content[1].props.itemsSlot).toEqual([]);

        const bad = await apply([
            { op: "set_slot", id: "feat0001", slot: "itemsSlot", children: [{ type: "Title" }] },
            { op: "set_slot", id: "feat0001", slot: "nope", children: [] },
            { op: "set_slot", id: "ftr00001", slot: "brandSlot", children: [] },
        ]);
        expect(bad.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["slot-not-allowed", "unknown-slot", "shared-component"]));
        // hatalı set_slot mevcut içeriği bozmamalı
        expect(bad.document.zones["feat0001:itemsSlot"]).toHaveLength(2);
    });

    it("set_root_props: _ önekli anahtar hata, diğerleri birleşir", async () => {
        const r = await apply([{ op: "set_root_props", props: { title: "x", _schemaVersion: 9 } }]);
        expect(r.errors[0].code).toBe("reserved-prop");
        expect(r.document.root.props).toEqual({ _schemaVersion: 2, title: "x" });
    });

    it("#4 ortak bileşenin ALT düğümleri (Logo) salt-okunur: set_props/set_slot/replace/remove hata", async () => {
        const r = await apply([
            { op: "set_props", id: "logo0001", props: { text: "x" } },
            { op: "set_slot", id: "logo0001", slot: "contentSlot", children: [] },
            { op: "replace_section", id: "logo0001", section: { type: "Title" } },
            { op: "remove_section", id: "logo0001" },
        ]);
        expect(r.errors).toHaveLength(4);
        expect(r.errors.every((e) => e.code === "shared-component")).toBe(true);
        expect(r.errors[0].message).toContain("Header (hdr00001) içinde");
        expect(r.errors[0].message).toContain("panel editöründen");
        expect(r.applied).toEqual([]);
        // doküman dokunulmamış
        expect(r.document.zones["hdr00001:logoSlot"][0].props).toEqual({ id: "logo0001" });
    });

    it("#7 başarısız set_slot eski alt ağacı bozmaz; aynı batch'teki sonraki operation'lar gerçek düğümü bulur", async () => {
        const r = await apply([
            { op: "set_slot", id: "feat0001", slot: "itemsSlot", children: [{ type: "Title" }] },
            { op: "set_props", id: "ttl00002", props: { text: { tr: "A", en: "B" } } },
        ]);
        expect(r.errors.map((e) => e.code)).toEqual(["slot-not-allowed"]);
        expect(r.document.zones["card0001:contentSlot"]).toHaveLength(1);
        expect(r.applied).toEqual(["set_props ttl00002 (text)"]);
    });

    it("#9 anchor'sız insert_section append gibi Footer'ın önüne ekler", async () => {
        const r = await apply([{ op: "insert_section", section: { type: "HeroCentered", slots: { contentSlot: [] } } }]);
        expect(r.errors).toEqual([]);
        expect(r.document.content.map((n) => n.type)).toEqual(["Header", "FeaturesSection", "HeroCentered", "HeroCentered", "Footer"]);
        expect(r.applied[0]).toContain("Footer'ın önüne");
    });

    it("touchedIds: eklenen alt ağaç + set_props/set_slot hedefleri", async () => {
        const r = await apply([
            { op: "append_section", section: { type: "HeroCentered", slots: { contentSlot: [{ type: "Title", props: { text: { tr: "a", en: "b" } } }] } } },
            { op: "set_props", id: "feat0001", props: { columns: "2" } },
        ]);
        expect(r.errors).toEqual([]);
        const hero = r.document.content[3];
        const heroTitle = r.document.zones[`${hero.props.id}:contentSlot`][0];
        expect(r.touchedIds.has(hero.props.id)).toBe(true);
        expect(r.touchedIds.has(heroTitle.props.id)).toBe(true);
        expect(r.touchedIds.has("feat0001")).toBe(true);
        expect(r.touchedIds.has("hero0001")).toBe(false);
    });

    it("bilinmeyen op hata", async () => {
        const r = await apply([{ op: "explode" }]);
        expect(r.errors[0].code).toBe("invalid-operation");
    });
});

describe("layoutFrom — extractLayout", () => {
    it("ilk Header + son Footer yalnız sharedComponentId taşıyorsa kopyalanır (alt zone'larıyla)", () => {
        const layout = extractLayout(baseDoc());
        expect(layout.header?.node.props.id).toBe("hdr00001");
        expect(Object.keys(layout.header!.zones)).toEqual(["hdr00001:logoSlot"]);
        expect(layout.footer?.node.type).toBe("Footer");
        expect(layout.warnings).toEqual([]);
        expect(layoutIds(layout)).toEqual(expect.arrayContaining(["hdr00001", "logo0001", "ftr00001"]));

        const doc: TecofDocument = { root: { props: {} }, content: [{ type: "FeaturesSection", props: { id: "f1" } }], zones: {} };
        applyLayout(doc, layout);
        expect(doc.content.map((n) => n.type)).toEqual(["Header", "FeaturesSection", "Footer"]);
        expect(doc.zones["hdr00001:logoSlot"]).toHaveLength(1);
    });

    it("ortak olmayan Header kopyalanmaz + uyarı; Header yoksa uyarı", () => {
        const doc = baseDoc();
        delete doc.content[0].props.sharedComponentId;
        const layout = extractLayout(doc);
        expect(layout.header).toBeNull();
        expect(layout.warnings[0]).toContain("ortak bileşen değil");
        expect(layout.footer).not.toBeNull();

        const empty = extractLayout({ root: { props: {} }, content: [], zones: {} });
        expect(empty.header).toBeNull();
        expect(empty.footer).toBeNull();
        expect(empty.warnings).toHaveLength(2);
    });
});
