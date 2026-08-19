/**
 * Tema bileşen dosyasından (TSX) şema çıkaran AST parser'ı.
 *
 * tecof-theme-core/lib/parseComponentSchema.ts'in taşınmış + genişletilmiş hali
 * (sözleşme §3.2): `variants`, `_tecofStyles`, ikon/repeater/cms/api-list/external
 * ve e-ticaret factory eşlemeleri eklendi. Parser bileşeni ÇALIŞTIRMAZ — tema
 * reposu Next/React bağımlılıklarıyla dolu, MCP süreci bunları yüklememeli;
 * yalnız kaynak metni statik okunur. Bu yüzden çağrı sonucu değerler (helper
 * fonksiyon çıktıları) `{__raw: "CallExpression"}` olarak işaretlenir ve üst
 * katman (build) bunları atlar.
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { NodePath, TraverseOptions } from "@babel/traverse";
import * as t from "@babel/types";
import type { ParsedComponentSchema, ParsedField, ParsedVariant } from "../types.js";

/* Düz Node ESM'de @babel/traverse CJS paketi `{ default: fn }` namespace'i olarak
   gelebilir (tsc/Node interop farkı). İki biçimi de güvenle çağırmak için default'u
   açıyoruz; yoksa modülün kendisi zaten fonksiyondur. */
type TraverseFn = (parent: t.Node, opts?: TraverseOptions) => void;
const traverse: TraverseFn = ((_traverse as any).default ?? _traverse) as TraverseFn;

export type { ParsedComponentSchema, ParsedField, ParsedVariant };

/** Stil panelinin node üzerindeki prop anahtarı (theme-editor `STYLES_PROP`). */
const STYLES_PROP = "_tecofStyles";

// ── Factory function → fieldType mapping ─────────────────────────────────────

/*
 * Fabrika adı → alan tipi. Eşleşme olmazsa fieldType fabrika adına düşer
 * ("createFooField") ve ajan ne dolduracağını çözemez; bu yüzden theme-editor'ün
 * dışa açtığı her create*Field burada olmalı. Liste theme-editor
 * src/components/fields/** içindeki `_fieldType` işaretleriyle birebir.
 */
const FACTORY_MAP: Record<string, string> = {
    createLanguageField: "language",
    createEditorField: "editor",
    createLinkField: "link",
    createUploadField: "upload",
    createColorField: "color",
    createCodeEditorField: "code",
    createIconField: "icon",
    createRepeaterField: "repeater",
    createCmsCollectionField: "cmsCollection",
    createApiListField: "api-list",
    createExternalField: "external",
    createEcommerceField: "ecommerce",
    /* E-ticaret seçicileri — alanın hangi VARLIĞA baktığını ajan bilmeli. */
    createCategoryField: "category",
    createCategoryListField: "category-list",
    createProductField: "product",
    createProductListField: "product-list",
    createBrandField: "brand",
    createBrandListField: "brand-list",
    createTagField: "tag",
    createTagListField: "tag-list",
    createAttributeField: "attribute",
    createAttributeListField: "attribute-list",
    createVariantTypeField: "variant-type",
    createVariantField: "variant",
    createFlashSaleField: "flash-sale",
    createCampaignField: "campaign",
    createDiscountField: "discount",
};

// ── TS sarmalayıcı soyucu ────────────────────────────────────────────────────
// `"slot" as const`, `[...] as unknown as SlotRenderer`, `{...} satisfies X`
// gibi ifadeler AST'de TSAsExpression vb. düğümlerle sarılı gelir; değere
// bakmadan önce soyulmazsa alanlar "unknown", defaultProps "__unsupported" olur.

const WRAPPER_TYPES = new Set([
    "TSAsExpression",
    "TSTypeAssertion",
    "TSNonNullExpression",
    "TSSatisfiesExpression",
    "ParenthesizedExpression",
]);

/* Arch temasında alan tanımları ArchitectureShared'dan import edilen sabitlerle
   yazılır (themeMode: themeModeField, allow: textSlotAllow). AST parser'ı
   identifier'ı tek dosyada çözemez — parse başında dosya-içi + paylaşılan
   sabitler bu haritaya konur, unwrap sırasında çözülür.
   parseComponentSchema senkron çalıştığı için modül-seviyesi state güvenli. */
let CONSTANTS: Record<string, t.Node> = {};

function unwrapExpression(node: t.Node): t.Node {
    let current: any = node;
    const visited = new Set<string>(); // döngüsel referans koruması
    while (current) {
        if (WRAPPER_TYPES.has(current.type)) {
            current = current.expression;
            continue;
        }
        if (t.isIdentifier(current) && CONSTANTS[current.name] && !visited.has(current.name)) {
            visited.add(current.name);
            current = CONSTANTS[current.name];
            continue;
        }
        break;
    }
    return current;
}

/** Bir dosyadaki top-level `export const NAME = <expr>` tanımlarını toplar —
 *  discover bunu ArchitectureShared gibi ortak dosyalar için çağırıp parser'a verir. */
export function collectExportedConstants(code: string): Record<string, t.Node> {
    const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
    const out: Record<string, t.Node> = {};
    for (const stmt of ast.program.body) {
        if (!t.isExportNamedDeclaration(stmt) || !t.isVariableDeclaration(stmt.declaration)) continue;
        for (const d of stmt.declaration.declarations) {
            if (t.isIdentifier(d.id) && d.init) out[d.id.name] = d.init;
        }
    }
    return out;
}

// ── Main Parser ──────────────────────────────────────────────────────────────

export function parseComponentSchema(
    code: string,
    targetName?: string,
    sharedConstants?: Record<string, t.Node>
): ParsedComponentSchema {
    const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
    });

    // Identifier çözümleme haritası: paylaşılan sabitler + bu dosyanın kendi
    // top-level const'ları (yerel tanım aynı isimli paylaşılanı ezer)
    CONSTANTS = { ...(sharedConstants || {}) };
    for (const stmt of ast.program.body) {
        const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
        if (!t.isVariableDeclaration(decl)) continue;
        for (const d of decl.declarations) {
            if (t.isIdentifier(d.id) && d.init) CONSTANTS[d.id.name] = d.init;
        }
    }

    const result: { name: string | null; obj: t.ObjectExpression | null } = {
        name: null,
        obj: null,
    };

    traverse(ast, {
        ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
            const decl = path.node.declaration;
            if (!t.isVariableDeclaration(decl)) return;

            for (const item of decl.declarations) {
                if (!t.isIdentifier(item.id) || !item.init) continue;

                // `export const X = {...} as Config` gibi sarmalayıcıları soy
                const init = unwrapExpression(item.init);
                if (!t.isObjectExpression(init)) continue;

                const name = item.id.name;
                if (targetName && name !== targetName) continue;

                // Component sözleşmesi: fields/render/defaultProps'tan en az biri
                // olmalı — exported sabit objeler yanlış eşleşmesin
                const looksLikeComponent = init.properties.some(
                    (p) => t.isObjectProperty(p) && ["fields", "render", "defaultProps"].includes(getObjectKeyName(p.key) || "")
                );
                if (!targetName && !looksLikeComponent) continue;

                result.name = name;
                result.obj = init;
                path.stop();
                return;
            }
        },
    });

    if (!result.obj) {
        throw new Error(
            targetName
                ? `Component "${targetName}" not found`
                : "No exported component object found"
        );
    }

    const componentName = result.name;
    const componentObject = result.obj;

    let label: string | null = null;
    let fields: ParsedField[] = [];
    let defaultProps: Record<string, unknown> | null = null;
    let variants: Record<string, ParsedVariant> | null = null;
    let tecofStyles: Record<string, unknown> | null = null;

    for (const prop of componentObject.properties) {
        if (!t.isObjectProperty(prop)) continue;

        const propName = getObjectKeyName(prop.key);
        if (!propName) continue;

        const propValue = unwrapExpression(prop.value);

        if (propName === "label") {
            label = extractStaticString(propValue);
        }

        if (propName === "fields" && t.isObjectExpression(propValue)) {
            fields = parseFieldsObject(propValue);
        }

        if (propName === "defaultProps" && t.isObjectExpression(propValue)) {
            defaultProps = astToSerializableValue(propValue) as Record<string, unknown>;
        }

        /* Varyantlar (theme-editor ComponentConfig.variants): `{ key: { label, props } }`.
           Ajan `variant: "dark"` dediğinde build katmanı props'u buradan alır ve
           `_variant` işaretini basar — editördeki chip'le aynı davranış. */
        if (propName === "variants" && t.isObjectExpression(propValue)) {
            variants = parseVariants(propValue);
        }

        /* Bileşen nesnesinin TEPESİNDE `_tecofStyles` — konvansiyonel yer değil
           (asıl yeri defaultProps'un içi), ama biri böyle yazarsa kaybolmasın. */
        if (propName === STYLES_PROP && t.isObjectExpression(propValue)) {
            tecofStyles = astToSerializableValue(propValue) as Record<string, unknown>;
        }
    }

    /* Asıl kaynak: defaultProps._tecofStyles. Yukarıdaki tepe-seviye dal
       doldurmadıysa buradan alıyoruz — böylece iki yazım da destekleniyor,
       çakışırsa tepedeki kazanıyor. */
    if (!tecofStyles) {
        const fromDefaults = defaultProps?.[STYLES_PROP];
        if (fromDefaults && typeof fromDefaults === "object" && !Array.isArray(fromDefaults)) {
            tecofStyles = fromDefaults as Record<string, unknown>;
        }
    }

    return { componentName, label, fields, defaultProps, variants, _tecofStyles: tecofStyles };
}

// ── Variants ─────────────────────────────────────────────────────────────────

function parseVariants(node: t.ObjectExpression): Record<string, ParsedVariant> | null {
    const raw = astToSerializableValue(node);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out: Record<string, ParsedVariant> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const v = value as Record<string, unknown>;
        const props = v.props && typeof v.props === "object" && !Array.isArray(v.props)
            ? (v.props as Record<string, unknown>)
            : {};
        out[key] = { label: typeof v.label === "string" ? v.label : key, props };
    }
    return Object.keys(out).length ? out : null;
}

// ── Field Object Parser (recursive) ──────────────────────────────────────────

/**
 * Puck/Tecof `fields` nesnesini ParsedField[]'e çevirir.
 *
 * 3 kalıp:
 *   1. Fabrika çağrısı: `title: createLanguageField({ label: "..." })`
 *   2. Düz nesne:       `phone: { type: "text", label: "Telefon" }`
 *   3. İç içe dizi:     `columns: { type: "array", arrayFields: { ... } }`
 */
function parseFieldsObject(fieldsNode: t.ObjectExpression): ParsedField[] {
    const out: ParsedField[] = [];
    for (const p of fieldsNode.properties) {
        if (t.isSpreadElement(p)) {
            // `...sharedFields` — çözülebiliyorsa içindeki alanları düzleştir
            const inner = unwrapExpression(p.argument);
            if (t.isObjectExpression(inner)) out.push(...parseFieldsObject(inner));
            continue;
        }
        if (!t.isObjectProperty(p)) continue;
        const key = getObjectKeyName(p.key) ?? "unknown";
        out.push(parseFieldValue(key, p.value));
    }
    return out;
}

function readAllow(node: t.Node | null | undefined): string[] | undefined {
    if (!node) return undefined;
    const v = unwrapExpression(node);
    if (!t.isArrayExpression(v)) return undefined;
    return v.elements
        .map((el) => (el ? extractStaticString(el as t.Node) : null))
        .filter((x): x is string => !!x);
}

function readOptions(node: t.Node | null | undefined): Array<{ label: string; value: string }> | undefined {
    if (!node) return undefined;
    const v = unwrapExpression(node);
    if (!t.isArrayExpression(v)) return undefined;
    return v.elements
        .map((el) => (el ? unwrapExpression(el) : el))
        .filter((el): el is t.ObjectExpression => t.isObjectExpression(el))
        .map((el) => {
            const optLabel = findObjectProperty(el, "label");
            const optValue = findObjectProperty(el, "value");
            return {
                label: optLabel ? (extractStaticString(optLabel.value) || "") : "",
                value: optValue ? (extractStaticString(optValue.value) || "") : "",
            };
        });
}

/**
 * Tek bir alan değerini ParsedField'e çözer.
 */
function parseFieldValue(key: string, rawNode: t.Node): ParsedField {
    const node = unwrapExpression(rawNode);

    // ── Kalıp 1: Fabrika çağrısı ─────────────────────────────────────────
    if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const calleeName = node.callee.name;

        // Arch'ın slot factory'si: createSlotField(label, allow) → { type: "slot", label, allow }
        if (calleeName === "createSlotField") {
            const result: ParsedField = {
                key,
                fieldType: "slot",
                label: (node.arguments[0] ? extractStaticString(node.arguments[0] as t.Node) : null) || key,
            };
            const allow = readAllow(node.arguments[1] as t.Node | undefined);
            if (allow) result.allow = allow;
            return result;
        }

        const fieldType = FACTORY_MAP[calleeName] || calleeName;
        let label = key;
        const result: ParsedField = { key, fieldType, label };

        /* createEcommerceField(SOURCE, { label }) — ilk argüman kaynak nesnesi,
           seçenekler ikinci argümanda. Diğer fabrikalarda seçenekler ilk argüman. */
        const optionsArg = calleeName === "createEcommerceField" ? node.arguments[1] : node.arguments[0];
        const optionsObj = optionsArg ? unwrapExpression(optionsArg as t.Node) : null;

        if (optionsObj && t.isObjectExpression(optionsObj)) {
            const labelProp = findObjectProperty(optionsObj, "label");
            if (labelProp) {
                label = extractStaticString(labelProp.value) || key;
                result.label = label;
            }

            // Repeater alt alanları (`subFields`) — ajan satır yapısını bilmeli
            const subFieldsProp = findObjectProperty(optionsObj, "subFields") ?? findObjectProperty(optionsObj, "fields");
            const subFieldsVal = subFieldsProp ? unwrapExpression(subFieldsProp.value) : null;
            if (fieldType === "repeater" && subFieldsVal && t.isObjectExpression(subFieldsVal)) {
                result.arrayFields = parseFieldsObject(subFieldsVal);
            }

            // Fabrikaya verilmiş options/allow (nadir ama ucuz)
            const opts = readOptions(findObjectProperty(optionsObj, "options")?.value);
            if (opts && opts.length) result.options = opts;
            const allow = readAllow(findObjectProperty(optionsObj, "allow")?.value);
            if (allow) result.allow = allow;
        }

        return result;
    }

    // ── Kalıp 2 & 3: Düz nesne ───────────────────────────────────────────
    if (t.isObjectExpression(node)) {
        const typeProp = findObjectProperty(node, "type");
        const labelProp = findObjectProperty(node, "label");

        const fieldType = typeProp ? (extractStaticString(typeProp.value) || "unknown") : "unknown";
        const label = labelProp ? (extractStaticString(labelProp.value) || key) : key;

        const result: ParsedField = { key, fieldType, label };

        // Nested arrayFields (recursive)
        const arrayFieldsProp = findObjectProperty(node, "arrayFields");
        const arrayFieldsVal = arrayFieldsProp ? unwrapExpression(arrayFieldsProp.value) : null;
        if (fieldType === "array" && arrayFieldsVal && t.isObjectExpression(arrayFieldsVal)) {
            result.arrayFields = parseFieldsObject(arrayFieldsVal);
        }

        // Nested objectFields (recursive)
        const objectFieldsProp = findObjectProperty(node, "objectFields");
        const objectFieldsVal = objectFieldsProp ? unwrapExpression(objectFieldsProp.value) : null;
        if (fieldType === "object" && objectFieldsVal && t.isObjectExpression(objectFieldsVal)) {
            result.objectFields = parseFieldsObject(objectFieldsVal);
        }

        // Slot alanları: izin verilen çocuk element tipleri (allow: ["IconFeature"])
        if (fieldType === "slot") {
            const allow = readAllow(findObjectProperty(node, "allow")?.value);
            if (allow) result.allow = allow;
        }

        // Select / radio options
        if (fieldType === "select" || fieldType === "radio") {
            const opts = readOptions(findObjectProperty(node, "options")?.value);
            if (opts) result.options = opts;
        }

        return result;
    }

    // ── Fallback: tanınmayan kalıp ───────────────────────────────────────
    return { key, fieldType: "unknown", label: key };
}

// ── AST Helpers ──────────────────────────────────────────────────────────────

function findObjectProperty(
    obj: t.ObjectExpression,
    name: string
): t.ObjectProperty | null {
    // Spread destekli: { ...gridGapField, label: "override" } — spread edilen
    // sabit CONSTANTS'tan çözülür, sonra gelen property öncekini ezer.
    let found: t.ObjectProperty | null = null;
    for (const prop of obj.properties) {
        if (t.isSpreadElement(prop)) {
            const inner = unwrapExpression(prop.argument);
            if (t.isObjectExpression(inner)) {
                const p = findObjectProperty(inner, name);
                if (p) found = p;
            }
            continue;
        }
        if (t.isObjectProperty(prop) && getObjectKeyName(prop.key) === name) {
            found = prop;
        }
    }
    return found;
}

function getObjectKeyName(
    key: t.Expression | t.Identifier | t.PrivateName
): string | null {
    if (t.isIdentifier(key)) return key.name;
    if (t.isStringLiteral(key)) return key.value;
    if (t.isNumericLiteral(key)) return String(key.value);
    return null;
}

function extractStaticString(rawNode: t.Node): string | null {
    const node = unwrapExpression(rawNode); // "slot" as const → StringLiteral
    if (t.isStringLiteral(node)) return node.value;
    if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
        return node.quasis.map((q) => q.value.cooked ?? "").join("");
    }
    return null;
}

// ── defaultProps serializer (AST → JSON) ─────────────────────────────────────

export function astToSerializableValue(rawNode: t.Node): unknown {
    const node = unwrapExpression(rawNode); // [...] as unknown as SlotRenderer → ArrayExpression
    if (t.isStringLiteral(node)) return node.value;
    if (t.isNumericLiteral(node)) return node.value;
    if (t.isBooleanLiteral(node)) return node.value;
    if (t.isNullLiteral(node)) return null;
    // `-1` gibi tekli eksi: UnaryExpression(-, NumericLiteral)
    if (t.isUnaryExpression(node) && node.operator === "-" && t.isNumericLiteral(node.argument)) {
        return -node.argument.value;
    }

    if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
        return node.quasis.map((q) => q.value.cooked ?? "").join("");
    }

    if (t.isArrayExpression(node)) {
        return node.elements.map((el) => {
            if (!el) return null;
            if (t.isSpreadElement(el)) return { __unsupported: "SpreadElement" };
            return astToSerializableValue(el);
        });
    }

    if (t.isObjectExpression(node)) {
        const out: Record<string, unknown> = {};
        for (const prop of node.properties) {
            if (t.isSpreadElement(prop)) {
                // Spread edilen sabit çözülebiliyorsa değerlerini birleştir
                const inner = unwrapExpression(prop.argument);
                if (t.isObjectExpression(inner)) {
                    Object.assign(out, astToSerializableValue(inner) as Record<string, unknown>);
                } else {
                    out.__hasSpread = true;
                }
                continue;
            }
            if (!t.isObjectProperty(prop)) continue;
            const key = getObjectKeyName(prop.key);
            if (!key) continue;
            out[key] = astToSerializableValue(prop.value);
        }
        return out;
    }

    if (t.isIdentifier(node)) return { __identifier: node.name };
    if (t.isCallExpression(node)) return { __raw: "CallExpression" };

    return { __unsupported: node.type };
}
