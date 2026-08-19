import { describe, expect, it } from "vitest";
import { normalizeDocument, validateDocument } from "../src/document/validate.js";
import type { TecofDocument } from "../src/types.js";
import { LANG, loadFixtureCatalog } from "./helpers/fixtures.js";

const title = (id: string, text = "t") => ({ type: "Title", props: { id, text: [{ code: "tr", value: text }, { code: "en", value: text }], size: "md", align: "left" } });
const features = (id: string, extra: Record<string, unknown> = {}) => ({ type: "FeaturesSection", props: { id, columns: "3", background: "cream", contentSlot: [], itemsSlot: [], ...extra } });

async function run(doc: TecofDocument, checkFields = true) {
    const snap = await loadFixtureCatalog();
    return validateDocument(doc, { catalog: snap.byName, lang: LANG, checkFields });
}

describe("validateDocument", () => {
    it("geçerli doküman ok", async () => {
        const doc: TecofDocument = { root: { props: {} }, content: [features("aaaaaaaa")], zones: { "aaaaaaaa:contentSlot": [title("bbbbbbbb")], "aaaaaaaa:itemsSlot": [] } };
        const v = await run(doc);
        expect(v.ok).toBe(true);
        expect(v.errors).toEqual([]);
    });

    it("bilinmeyen type, kökte element, allow ihlali", async () => {
        const doc: TecofDocument = {
            root: { props: {} },
            content: [{ type: "Nope", props: { id: "n1" } }, title("t1"), features("f1")],
            zones: { "f1:itemsSlot": [title("t2")] },
        };
        const v = await run(doc);
        const codes = v.errors.map((e) => `${e.code}@${e.path}`);
        expect(codes).toContain("unknown-type@content[0].type");
        expect(codes).toContain("element-at-root@content[1].type");
        expect(codes).toContain('slot-not-allowed@zones["f1:itemsSlot"][0].type');
    });

    it("select dışı değer (checkFields) ve rezervli prop UYARI değil, mevcut dokümanda meşru", async () => {
        const doc: TecofDocument = { root: { props: { _tecofTheme: {} } }, content: [features("f1", { columns: "7", _tecofStyles: { p: 1 }, _locked: true })], zones: {} };
        const v = await run(doc);
        expect(v.errors.map((e) => e.code)).toEqual(["invalid-option"]);
        // Motor prop'ları hata/uyarı üretmez
        expect(v.warnings.filter((w) => w.code === "reserved-prop")).toEqual([]);
    });

    it("duplicate id, geçersiz id, yetim zone, bozuk zone anahtarı", async () => {
        const doc: TecofDocument = {
            root: { props: {} },
            content: [features("dup"), features("dup"), { type: "FeaturesSection", props: { id: "a:b" } } as any],
            zones: { "ghost:contentSlot": [], badkey: [], "dup:nope": [] },
        };
        const v = await run(doc, false);
        const codes = v.errors.map((e) => e.code);
        expect(codes.filter((c) => c === "id")).toHaveLength(2); // duplicate + geçersiz
        expect(v.errors.find((e) => e.code === "zone-key" && e.path.includes("ghost"))?.message).toContain("Yetim");
        expect(v.errors.find((e) => e.code === "zone-key" && e.path.includes("badkey"))).toBeTruthy();
        expect(v.warnings.find((w) => w.code === "unknown-slot")?.path).toContain("dup:nope");
    });

    it("SharedComponentRef yalnız uyarı; inline slot kalıntısı hata; ortak bileşen bilgilendirme uyarısı", async () => {
        const doc: TecofDocument = {
            root: { props: {} },
            content: [
                { type: "SharedComponentRef", props: { id: "s1", sharedComponentId: "m1" } },
                features("f1", { itemsSlot: [{ type: "Card", props: { id: "c1" } }] }),
                { type: "Header", props: { id: "h1", sharedComponentId: "master1", showCart: "no" } },
            ],
            zones: {},
        };
        const v = await run(doc, false);
        // Master'ı silinmiş ref: hata değil, uyarı (backend kaydederken çıkarır; remove_section ile de kaldırılabilir)
        expect(v.errors.some((e) => e.path === "content[0].type")).toBe(false);
        expect(v.warnings.find((w) => w.code === "shared-component-ref")?.message).toContain("remove_section");
        expect(v.errors.some((e) => e.code === "inline-slot" && e.path === "content[1].props.itemsSlot")).toBe(true);
        expect(v.warnings.some((w) => w.code === "shared-component" && w.path === "content[2]")).toBe(true);
    });

    it("strict:false — mevcut düğümlerde unknown-type/element-at-root/slot-not-allowed/inline-slot UYARI; strictIds'teki düğümlerde HATA", async () => {
        const doc: TecofDocument = {
            root: { props: {} },
            content: [
                { type: "Nope", props: { id: "n1" } },
                title("t1"),
                features("f1", { contentSlot: [{ type: "Title", props: { id: "t9" } }] }),
            ],
            zones: { "f1:itemsSlot": [title("t2")] },
        };
        const snap = await loadFixtureCatalog();
        const lenient = validateDocument(doc, { catalog: snap.byName, lang: LANG, checkFields: false, strict: false });
        expect(lenient.ok).toBe(true);
        expect(lenient.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["unknown-type", "element-at-root", "slot-not-allowed", "inline-slot"]));
        expect(lenient.warnings.find((w) => w.code === "slot-not-allowed")?.message).toContain("değiştirilmedi");

        const partial = validateDocument(doc, { catalog: snap.byName, lang: LANG, checkFields: false, strict: false, strictIds: new Set(["t2"]) });
        expect(partial.ok).toBe(false);
        expect(partial.errors.map((e) => e.code)).toEqual(["slot-not-allowed"]);
    });

    it("şekil hataları ve boyut sınırları", async () => {
        expect((await run({ root: { props: {} }, content: "x" as any, zones: {} })).errors[0].code).toBe("shape");
        const many: TecofDocument = { root: { props: {} }, content: Array.from({ length: 3001 }, (_, i) => features(`n${i}`)), zones: {} };
        const v = await run(many, false);
        expect(v.errors.some((e) => e.code === "size" && e.message.includes("Düğüm sayısı"))).toBe(true);
    });
});

describe("normalizeDocument", () => {
    it("zone doluyken atılan inline çocuklar ziyaret edilmez (yetim zone üretmez); ölü SharedComponentRef düşürülür", async () => {
        const { document: doc, warnings } = normalizeDocument({
            root: { props: {} },
            content: [
                { type: "SharedComponentRef", props: { id: "ref1", type: "Header", sharedComponentId: "dead" } },
                { type: "FeaturesSection", props: { id: "f1", columns: "3", background: "cream", contentSlot: [], itemsSlot: [{ type: "Card", props: { contentSlot: [{ type: "Title", props: { text: "x" } }] } }] } } as any,
            ],
            zones: { "f1:itemsSlot": [{ type: "Card", props: { id: "c1", contentSlot: [] } }] },
        });
        expect(doc.content.map((n) => n.type)).toEqual(["FeaturesSection"]);
        expect(warnings.find((w) => w.code === "shared-component-ref-dropped")?.path).toBe("content[0]");
        expect(Object.keys(doc.zones)).toEqual(["f1:itemsSlot"]);
        expect(doc.content[0].props.itemsSlot).toEqual([]);
        const v = await run(doc, false);
        expect(v.ok).toBe(true);
    });

    it("props içindeki inline slot dizilerini zones'a taşır, id'siz düğümlere id üretir", () => {
        const { document: doc, warnings } = normalizeDocument({
            root: { props: {} },
            content: [{ type: "FeaturesSection", props: { id: "f1", itemsSlot: [{ type: "Card", props: { contentSlot: [{ type: "Title", props: { id: "t1" } }] } }] } } as any],
            zones: {},
        });
        expect(doc.content[0].props.itemsSlot).toEqual([]);
        const card = doc.zones["f1:itemsSlot"][0];
        expect(card.type).toBe("Card");
        expect(card.props.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
        expect(card.props.contentSlot).toEqual([]);
        expect(doc.zones[`${card.props.id}:contentSlot`][0].props.id).toBe("t1");
        expect(warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["inline-slot", "id-generated"]));
    });
});
