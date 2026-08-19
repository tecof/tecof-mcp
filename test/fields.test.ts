import { describe, expect, it } from "vitest";
import { normalizeFieldValue, normalizeLanguageValue, normalizeLinkValue, normalizeUploadValue, pickText, type IssueSink } from "../src/document/fields.js";
import { LANG } from "./helpers/fixtures.js";

const sink = (): IssueSink => ({ errors: [], warnings: [] });

describe("çok dilli kısayollar", () => {
    it('düz string → [{code: defaultLanguage}] + eksik dil uyarısı', () => {
        const s = sink();
        expect(normalizeLanguageValue("Merhaba", LANG, "p", s)).toEqual([{ code: "tr", value: "Merhaba" }]);
        expect(s.warnings[0]).toMatchObject({ code: "missing-language", path: "p" });
        expect(s.warnings[0].message).toContain("en");
    });

    it("{tr,en} haritası → dizi, uyarı yok", () => {
        const s = sink();
        expect(normalizeLanguageValue({ tr: "A", en: "B" }, LANG, "p", s)).toEqual([
            { code: "tr", value: "A" },
            { code: "en", value: "B" },
        ]);
        expect(s.warnings).toEqual([]);
    });

    it("bilinmeyen dil uyarı, yanlış tip hata", () => {
        const s = sink();
        normalizeLanguageValue({ tr: "A", en: "B", de: "C" }, LANG, "p", s);
        expect(s.warnings.map((w) => w.code)).toContain("unknown-language");
        const s2 = sink();
        normalizeLanguageValue(42, LANG, "p", s2);
        expect(s2.errors[0].code).toBe("invalid-language-value");
    });

    it("#13 tek {code,value} nesnesi dil haritası sanılmaz, tek elemanlı diziye sarılır; bilinmeyen kod uyarı", () => {
        const s = sink();
        expect(normalizeLanguageValue({ code: "tr", value: "Merhaba" }, LANG, "p", s)).toEqual([{ code: "tr", value: "Merhaba" }]);
        expect(s.errors).toEqual([]);
        expect(s.warnings.map((w) => w.code)).toEqual(["missing-language"]);

        const s2 = sink();
        normalizeLanguageValue([{ code: "de", value: "Hallo" }, { code: "tr", value: "M" }, { code: "en", value: "H" }], LANG, "p", s2);
        expect(s2.warnings.map((w) => w.code)).toEqual(["unknown-language"]);
    });

    it("[{code,value}] olduğu gibi geçer; eksik dil uyarılır", () => {
        const s = sink();
        const v = [{ code: "tr", value: "A" }];
        expect(normalizeLanguageValue(v, LANG, "p", s)).toBe(v);
        expect(s.warnings[0].code).toBe("missing-language");
    });
});

describe("link ve upload kısayolları", () => {
    it('string URL → [{code, value:{url, target:"_self"}}]', () => {
        expect(normalizeLinkValue("/iletisim", LANG, "p", sink())).toEqual([{ code: "tr", value: { url: "/iletisim", target: "_self" } }]);
        expect(normalizeLinkValue({ url: "https://x.y", target: "_blank" }, LANG, "p", sink())).toEqual([{ code: "tr", value: { url: "https://x.y", target: "_blank" } }]);
    });

    it("geçersiz link hata", () => {
        const s = sink();
        normalizeLinkValue(123, LANG, "p", s);
        expect(s.errors[0].code).toBe("invalid-link-value");
    });

    it("upload: URL string → external dosya kaydı", () => {
        const out = normalizeUploadValue("https://cdn.example.com/img/hero.png?v=1", "p", sink()) as any[];
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ name: "hero.png", type: "external", provider: "external", url: "https://cdn.example.com/img/hero.png?v=1" });
        expect(out[0]._id).toMatch(/^external-/);
    });
});

describe("normalizeFieldValue", () => {
    it("select dışı değer hata", () => {
        const s = sink();
        normalizeFieldValue({ key: "bg", fieldType: "select", label: "", options: [{ label: "A", value: "a" }] }, "z", LANG, "p", s);
        expect(s.errors[0]).toMatchObject({ code: "invalid-option", path: "p" });
    });

    it("array alanında alt alanlar (language) dönüştürülür", () => {
        const s = sink();
        const out = normalizeFieldValue(
            { key: "steps", fieldType: "array", label: "", arrayFields: [{ key: "title", fieldType: "language", label: "" }, { key: "icon", fieldType: "icon", label: "" }] },
            [{ title: { tr: "A", en: "B" }, icon: "Apple" }],
            LANG,
            "p",
            s
        );
        expect(out).toEqual([{ title: [{ code: "tr", value: "A" }, { code: "en", value: "B" }], icon: "Apple" }]);
        expect(s.errors).toEqual([]);
    });

    it("pickText HTML soyar ve kısaltır", () => {
        expect(pickText([{ code: "tr", value: "<p>Merhaba <b>dünya</b></p>" }], LANG)).toBe("Merhaba dünya");
        expect(pickText("x".repeat(100), LANG, 10)).toHaveLength(10);
        expect(pickText(undefined, LANG)).toBeUndefined();
    });
});
