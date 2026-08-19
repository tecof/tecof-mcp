import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectExportedConstants, parseComponentSchema } from "../src/catalog/parseComponentSchema.js";
import { discoverComponents } from "../src/catalog/discover.js";
import { FIXTURE_THEME_DIR, loadFixtureCatalog } from "./helpers/fixtures.js";

const read = (rel: string) => fs.readFileSync(path.join(FIXTURE_THEME_DIR, "components", rel), "utf8");

describe("parseComponentSchema (fixture port)", () => {
    it("FeaturesSection: radio/select options, slot allow, defaultProps inline children", () => {
        const s = parseComponentSchema(read("sections/FeaturesSection.tsx"));
        expect(s.componentName).toBe("FeaturesSection");
        expect(s.label).toBe("Özellikler / Değerler Vitrini");

        const columns = s.fields.find((f) => f.key === "columns")!;
        expect(columns.fieldType).toBe("radio");
        expect(columns.options?.map((o) => o.value)).toEqual(["2", "3", "4"]);

        const background = s.fields.find((f) => f.key === "background")!;
        expect(background.fieldType).toBe("select");
        expect(background.options?.map((o) => o.value)).toEqual(["white", "cream", "dark"]);

        const items = s.fields.find((f) => f.key === "itemsSlot")!;
        expect(items.fieldType).toBe("slot");
        expect(items.allow).toEqual(["Card"]);
        const content = s.fields.find((f) => f.key === "contentSlot")!;
        expect(content.allow).toEqual(["Title", "Paragraph", "Spacer", "Divider"]);

        // `as unknown as SlotRenderer` sarmalayıcısı soyulmuş olmalı
        expect(Array.isArray(s.defaultProps?.itemsSlot)).toBe(true);
        expect((s.defaultProps!.itemsSlot as any[]).length).toBe(3);
        expect((s.defaultProps!.itemsSlot as any[])[0].type).toBe("Card");
        expect(s.defaultProps?.columns).toBe("3");
        expect(s.variants).toBeNull();
    });

    it("Elements: factory eşlemeleri (language/editor/link/upload/icon) ve _tecofStyles", () => {
        const title = parseComponentSchema(read("elements/Title.tsx"));
        expect(title.fields.find((f) => f.key === "text")).toMatchObject({ fieldType: "language", label: "Metin" });

        const paragraph = parseComponentSchema(read("elements/Paragraph.tsx"));
        expect(paragraph.fields.find((f) => f.key === "text")?.fieldType).toBe("editor");

        const card = parseComponentSchema(read("elements/Card.tsx"));
        expect(card.fields.find((f) => f.key === "href")?.fieldType).toBe("link");
        expect(card.fields.find((f) => f.key === "contentSlot")?.allow).toContain("Picture");

        const button = parseComponentSchema(read("elements/Button.tsx"));
        expect(button.fields.find((f) => f.key === "icon")?.fieldType).toBe("icon");
        expect(button.fields.find((f) => f.key === "variant")?.options?.map((o) => o.value)).toEqual(["underline", "solid", "outline"]);

        const picture = parseComponentSchema(read("elements/Picture.tsx"));
        expect(picture.fields.find((f) => f.key === "media")?.fieldType).toBe("upload");
        expect(picture.fields.find((f) => f.key === "alt")).toMatchObject({ fieldType: "text", label: "Alt Metin" });
        expect(picture._tecofStyles).toBeNull();
    });

    it("ProcessSteps (vita): variants, array arrayFields, çözülemeyen helper çağrıları __raw", () => {
        const s = parseComponentSchema(read("sections/ProcessSteps.tsx"));
        expect(s.variants).not.toBeNull();
        expect(Object.keys(s.variants!)).toEqual(["yatay3", "kutulu", "dikey"]);
        expect(s.variants!.kutulu).toEqual({ label: "Kutulu Kartlar", props: { orientation: "yatay", columns: "3", cardStyle: "kutulu" } });

        const steps = s.fields.find((f) => f.key === "steps")!;
        expect(steps.fieldType).toBe("array");
        expect(steps.arrayFields?.map((f) => `${f.key}:${f.fieldType}`)).toEqual(["icon:icon", "title:language", "description:language"]);

        // step(...) helper çağrıları statik çözülemez → işaretçi
        expect((s.defaultProps!.steps as any[])[0]).toEqual({ __raw: "CallExpression" });
    });

    it("Header: `type: \"radio\"` (as const'suz) ve helper ile üretilen nav çocukları", () => {
        const s = parseComponentSchema(read("sections/Header.tsx"));
        expect(s.fields.find((f) => f.key === "showCart")?.options?.map((o) => o.value)).toEqual(["yes", "no"]);
        expect(s.fields.find((f) => f.key === "navSlot")?.allow).toEqual(["NavLink"]);
        const nav = s.defaultProps!.navSlot as any[];
        expect(nav.every((n) => n.__raw === "CallExpression")).toBe(true);
        // logoSlot statik — çözülmüş olmalı
        expect((s.defaultProps!.logoSlot as any[])[0].type).toBe("Logo");
    });

    it("paylaşılan sabitlerle identifier çözümü (Arch kalıbı)", () => {
        const shared = collectExportedConstants(`
            export const textSlotAllow = ["Title", "Paragraph"];
            export const themeModeField = { type: "select" as const, label: "Mod", options: [{ label: "A", value: "a" }] };
        `);
        const s = parseComponentSchema(
            `
            import { textSlotAllow, themeModeField } from "./ArchitectureShared";
            export const ArchHero = {
                label: "Hero",
                fields: {
                    themeMode: themeModeField,
                    contentSlot: { type: "slot" as const, label: "İçerik", allow: textSlotAllow },
                    extra: { ...themeModeField, label: "Ekstra" },
                },
                defaultProps: { id: "ArchHero-1", themeMode: "a" },
                render: () => null,
            };
            `,
            undefined,
            shared
        );
        expect(s.fields.find((f) => f.key === "themeMode")).toMatchObject({ fieldType: "select", label: "Mod" });
        expect(s.fields.find((f) => f.key === "contentSlot")?.allow).toEqual(["Title", "Paragraph"]);
        expect(s.fields.find((f) => f.key === "extra")).toMatchObject({ fieldType: "select", label: "Ekstra" });
    });

    it("repeater subFields, createSlotField, ecommerce factory'leri", () => {
        const s = parseComponentSchema(`
            export const Shop = {
                label: "Shop",
                fields: {
                    products: createProductListField({ label: "Ürünler" }),
                    category: createCategoryField({ label: "Kategori" }),
                    brand: createEcommerceField(BRANDS, { label: "Marka" }),
                    rows: createRepeaterField({ label: "Satırlar", subFields: { name: createLanguageField({ label: "Ad" }), qty: { type: "number", label: "Adet" } } }),
                    slot: createSlotField("Alan", ["Title"]),
                    cms: createCmsCollectionField({ label: "Koleksiyon" }),
                },
                defaultProps: { id: "Shop-1", count: -1 },
                render: () => null,
            };
        `);
        const byKey = Object.fromEntries(s.fields.map((f) => [f.key, f]));
        expect(byKey.products.fieldType).toBe("product-list");
        expect(byKey.category.fieldType).toBe("category");
        expect(byKey.brand).toMatchObject({ fieldType: "ecommerce", label: "Marka" });
        expect(byKey.rows.fieldType).toBe("repeater");
        expect(byKey.rows.arrayFields?.map((f) => `${f.key}:${f.fieldType}`)).toEqual(["name:language", "qty:number"]);
        expect(byKey.slot).toMatchObject({ fieldType: "slot", label: "Alan", allow: ["Title"] });
        expect(byKey.cms.fieldType).toBe("cmsCollection");
        expect(s.defaultProps?.count).toBe(-1);
    });

    it("bileşen içermeyen dosyada hata fırlatır", () => {
        expect(() => parseComponentSchema(`export const helper = 1;`)).toThrow(/No exported component object/);
    });
});

describe("discoverComponents + ComponentCatalog", () => {
    it("sections/** ve elements/** altını kategorilerle tarar (alt klasör dahil)", async () => {
        const found = await discoverComponents(FIXTURE_THEME_DIR);
        const names = found.map((f) => `${f.category}:${f.name}`);
        expect(names).toContain("section:FeaturesSection");
        expect(names).toContain("section:HeroCentered"); // sections/hero/
        expect(names).toContain("element:Title");
        expect(found.find((f) => f.name === "HeroCentered")?.filePath).toBe(path.join("components", "sections", "hero", "HeroCentered.tsx"));
    });

    it("katalog snapshot'ı byName haritası ve özet üretir", async () => {
        const snap = await loadFixtureCatalog();
        expect(snap.byName.get("Card")?.category).toBe("element");
        expect(snap.byName.get("ProcessSteps")?.variants).toBeTruthy();
        expect(snap.skipped).toEqual([]);
    });
});
