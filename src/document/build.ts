/**
 * Yazarlık biçimi (Section) → TecofDocument dönüşümü (sözleşme §3.3 kuralları 1-6).
 *
 * Ajan `{type, props, variant, slots}` yazar; biz:
 *   - type'ı katalogda doğrular (kökte element yasak, slot'ta allow dışı yasak),
 *   - props'u defaultProps ← variant.props ← kullanıcı props sırasıyla birleştirir,
 *   - çok dilli/link/upload kısayollarını açar, select değerlerini denetler,
 *   - slot çocuklarını `zones["<id>:<slot>"]`'a yazar ve `props[slot] = []` bırakır,
 *   - 8 karakterlik tekil id üretir.
 *
 * Neden defaultProps'taki inline çocuklar kullanılıyor: editörde "Bölüm Ekle"
 * aynı şeyi yapar (extractDefaultSlots) — ajan slot vermezse bileşen boş bir
 * kabuk değil, tema tasarımcısının öngördüğü örnek içerikle gelir.
 */

import type { CatalogComponent, Issue, ParsedField, Section, TecofDocument, TecofNode } from "../types.js";
import { normalizeFieldValue, type IssueSink, type LanguageContext } from "./fields.js";
import { isValidNodeId, uniqueId } from "./ids.js";
import { deepClone, isInlineNodeArray, isNodeLike, zoneKey } from "./tree.js";

export type BuildContext = {
    catalog: Map<string, CatalogComponent>;
    lang: LanguageContext;
    /** Dokümanda zaten kullanılan id'ler — yeni üretilenler buraya eklenir */
    usedIds: Set<string>;
};

export type BuiltNode = {
    node: TecofNode;
    zones: Record<string, TecofNode[]>;
};

export type BuildOutcome = {
    built: BuiltNode | null;
    errors: Issue[];
    warnings: Issue[];
};

/** Parser'ın çözemediği AST değerleri (`{__raw}`, `{__identifier}`, …) */
function isUnresolvedMarker(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value as object);
    return keys.length > 0 && keys.every((k) => k === "__raw" || k === "__identifier" || k === "__unsupported" || k === "__hasSpread");
}

/**
 * defaultProps'u dokümana yazılabilir hale getirir: id düşer, inline slot
 * dizileri ayrılır (çocuk olarak dönülür), çözülemeyen helper çağrıları atılır.
 */
function splitDefaultProps(defaultProps: Record<string, unknown> | null, slotKeys: Set<string>): {
    props: Record<string, unknown>;
    inlineChildren: Record<string, Array<{ type: string; props: Record<string, any> }>>;
    dropped: string[];
} {
    const props: Record<string, unknown> = {};
    const inlineChildren: Record<string, Array<{ type: string; props: Record<string, any> }>> = {};
    const dropped: string[] = [];

    for (const [key, rawValue] of Object.entries(deepClone(defaultProps ?? {}))) {
        if (key === "id") continue;
        if (isUnresolvedMarker(rawValue)) {
            dropped.push(key);
            continue;
        }
        if (slotKeys.has(key) || isInlineNodeArray(rawValue)) {
            if (Array.isArray(rawValue)) {
                // Helper çağrısıyla üretilen çocuklar ({__raw}) çözülemez — atla
                const kids = rawValue.filter(isNodeLike);
                if (kids.length !== rawValue.length) dropped.push(`${key}[]`);
                inlineChildren[key] = kids;
            }
            props[key] = [];
            continue;
        }
        props[key] = scrubUnresolved(rawValue, `${key}`, dropped);
    }
    return { props, inlineChildren, dropped };
}

/** İç içe değerlerde çözülemeyen işaretçileri temizler (dizi öğesi atılır, nesne anahtarı düşer). */
function scrubUnresolved(value: unknown, path: string, dropped: string[]): unknown {
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        value.forEach((item, i) => {
            if (isUnresolvedMarker(item)) dropped.push(`${path}[${i}]`);
            else out.push(scrubUnresolved(item, `${path}[${i}]`, dropped));
        });
        return out;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (k === "__hasSpread") continue;
            if (isUnresolvedMarker(v)) dropped.push(`${path}.${k}`);
            else out[k] = scrubUnresolved(v, `${path}.${k}`, dropped);
        }
        return out;
    }
    return value;
}

/**
 * Doküman düğümü (defaultProps'tan gelen inline çocuk) → Section (yeniden inşa için).
 * İç içe defaultProps'larda helper çağrısıyla üretilmiş çocuklar (`{__raw}`) olabilir
 * (vita Header → NavLink → panelSlot → linksSlot gibi); düğüm olanlar alınır,
 * çözülemeyenler atılır — aksi halde build "şekil hatası" verip tüm bölümü düşürürdü.
 */
export function nodeToSection(node: { type: string; props: Record<string, any> }): Section {
    const props: Record<string, unknown> = {};
    const slots: Record<string, Section[]> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(node.props ?? {})) {
        if (key === "id") continue;
        if (Array.isArray(value) && value.length > 0 && value.some(isNodeLike)) {
            slots[key] = value.filter(isNodeLike).map(nodeToSection);
            continue;
        }
        if (isUnresolvedMarker(value)) continue;
        props[key] = scrubUnresolved(value, key, dropped);
    }
    const section: Section = { type: node.type, props };
    if (Object.keys(slots).length) section.slots = slots;
    return section;
}

export type BuildSectionOptions = {
    /** Kök düzey mi (true → element yasak) */
    root: boolean;
    /** Ebeveyn slot'un allow listesi (varsa) */
    allow?: string[];
    parentType?: string;
    slot?: string;
    /** Hata yollarında kullanılacak önek */
    path: string;
    /** Çağrı derinliği — döngüsel defaultProps koruması */
    depth?: number;
    /**
     * Kaynağı tema (defaultProps'tan gelen varsayılan çocuk) olan bölümler için
     * true: `_tecofStyles` gibi motor prop'ları tema tasarımcısının verisidir,
     * ajan girdisi gibi reddedilmez.
     */
    trusted?: boolean;
};

const MAX_DEPTH = 24;

/** Katalogdaki ada yakın öneriler (yazım hatası için). */
function suggestTypes(type: string, catalog: Map<string, CatalogComponent>, limit = 5): string[] {
    const lower = type.toLowerCase();
    const scored = [...catalog.keys()]
        .map((name) => {
            const n = name.toLowerCase();
            let score = 0;
            if (n === lower) score = 100;
            else if (n.includes(lower) || lower.includes(n)) score = 50;
            else if (n.slice(0, 3) === lower.slice(0, 3)) score = 10;
            return { name, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((x) => x.name);
}

/**
 * Tek bölümü (ve alt slot ağacını) doküman düğümüne çevirir.
 * Hata varsa `built` null olabilir ama tüm hatalar toplanır (ajan tek seferde görsün).
 */
export function buildSection(section: Section, ctx: BuildContext, opts: BuildSectionOptions): BuildOutcome {
    const sink: IssueSink = { errors: [], warnings: [] };
    const built = buildInner(section, ctx, opts, sink);
    return { built, errors: sink.errors, warnings: sink.warnings };
}

function buildInner(section: Section, ctx: BuildContext, opts: BuildSectionOptions, sink: IssueSink): BuiltNode | null {
    const path = opts.path;
    const depth = opts.depth ?? 0;

    if (depth > MAX_DEPTH) {
        sink.errors.push({ code: "too-deep", path, message: `Ağaç derinliği ${MAX_DEPTH}'ü aştı.` });
        return null;
    }

    if (!section || typeof section !== "object" || typeof section.type !== "string" || !section.type) {
        sink.errors.push({ code: "shape", path, message: "Bölüm {type, props?, variant?, slots?} biçiminde olmalı." });
        return null;
    }

    const schema = ctx.catalog.get(section.type);
    if (!schema) {
        const suggestions = suggestTypes(section.type, ctx.catalog);
        sink.errors.push({
            code: "unknown-type",
            path: `${path}.type`,
            message: `"${section.type}" katalogda yok.${suggestions.length ? ` Benzer: ${suggestions.join(", ")}.` : ""} list_components ile geçerli adları görün.`,
        });
        return null;
    }

    if (opts.root && schema.category === "element") {
        sink.errors.push({
            code: "element-at-root",
            path: `${path}.type`,
            message: `"${section.type}" bir element; sayfa köküne yalnız section konabilir. Bir section'ın slot'una yerleştirin.`,
        });
        return null;
    }

    if (opts.allow && opts.allow.length && !opts.allow.includes(section.type)) {
        sink.errors.push({
            code: "slot-not-allowed",
            path: `${path}.type`,
            message: `"${section.type}", ${opts.parentType ?? "ebeveyn"}.${opts.slot ?? "slot"} içine konamaz. İzin verilenler: ${opts.allow.join(", ")}.`,
        });
        return null;
    }

    const fieldsByKey = new Map<string, ParsedField>(schema.fields.map((f) => [f.key, f]));
    const slotKeys = new Set(schema.fields.filter((f) => f.fieldType === "slot").map((f) => f.key));

    // ── 1) defaultProps tabanı ───────────────────────────────────────────
    const base = splitDefaultProps(schema.defaultProps, slotKeys);
    if (base.dropped.length) {
        sink.warnings.push({
            code: "default-unresolved",
            path,
            message: `${section.type} defaultProps içinde statik çözülemeyen değerler atlandı (${base.dropped.slice(0, 6).join(", ")}${base.dropped.length > 6 ? ", …" : ""}). Gerekirse bu alanları props ile verin.`,
        });
    }
    const props: Record<string, unknown> = { ...base.props };

    // ── 2) Varyant ───────────────────────────────────────────────────────
    if (section.variant !== undefined && section.variant !== null && section.variant !== "") {
        const variant = schema.variants?.[section.variant];
        if (!variant) {
            const available = schema.variants ? Object.keys(schema.variants) : [];
            sink.errors.push({
                code: "unknown-variant",
                path: `${path}.variant`,
                message: available.length
                    ? `"${section.variant}" varyantı yok. ${section.type} varyantları: ${available.join(", ")}.`
                    : `${section.type} bileşeninin varyantı yok; variant alanını kaldırın.`,
            });
        } else {
            for (const [k, v] of Object.entries(deepClone(variant.props))) {
                if (slotKeys.has(k)) continue; // varyant slot içeriği taşımaz
                props[k] = v;
            }
            props._variant = section.variant;
        }
    }

    // ── 3) Kullanıcı props'u ─────────────────────────────────────────────
    const userProps = section.props ?? {};
    const userSlots: Record<string, Section[]> = { ...(section.slots ?? {}) };
    let explicitId: string | null = null;

    if (userProps && (typeof userProps !== "object" || Array.isArray(userProps))) {
        sink.errors.push({ code: "shape", path: `${path}.props`, message: "props bir nesne olmalı." });
    } else {
        for (const [key, value] of Object.entries(userProps)) {
            const propPath = `${path}.props.${key}`;

            if (key.startsWith("_")) {
                if (opts.trusted) {
                    props[key] = value;
                    continue;
                }
                sink.errors.push({
                    code: "reserved-prop",
                    path: propPath,
                    message: `"${key}" motor tarafından rezerve edilmiş; ajan bu anahtarı yazamaz${key === "_variant" ? ' (varyant için "variant" alanını kullanın)' : ""}.`,
                });
                continue;
            }

            if (key === "id") {
                // Açık id: geçerli + tekil ise kabul, değilse üretilen kullanılır
                if (isValidNodeId(value) && !ctx.usedIds.has(value)) explicitId = value;
                else sink.warnings.push({ code: "id-ignored", path: propPath, message: "Verilen id geçersiz ya da kullanımda; yeni id üretildi." });
                continue;
            }

            if (key === "sharedComponentId") {
                sink.errors.push({ code: "shared-component", path: propPath, message: "sharedComponentId ajan tarafından yazılamaz; ortak bileşenler panelden yönetilir." });
                continue;
            }

            if (slotKeys.has(key)) {
                // Slot içeriği props'a yazılmış — slots'a taşı (inline-slot kuralı)
                if (Array.isArray(value)) {
                    if (value.length && !(key in userSlots)) {
                        userSlots[key] = value
                            .filter((v) => !isUnresolvedMarker(v))
                            .map((v) => (isNodeLike(v) && (v as any).props?.id !== undefined ? nodeToSection(v) : (v as Section)));
                        sink.warnings.push({ code: "inline-slot", path: propPath, message: `"${key}" bir slot; çocuklar props yerine slots altına taşındı.` });
                    }
                } else {
                    sink.errors.push({ code: "invalid-slot-value", path: propPath, message: `"${key}" bir slot; içeriğini slots.${key} altında Section dizisi olarak verin.` });
                }
                continue;
            }

            const field = fieldsByKey.get(key);
            if (!field) {
                if (key !== "className" && !opts.trusted) {
                    sink.warnings.push({
                        code: "unknown-prop",
                        path: propPath,
                        message: `"${key}" ${section.type} alanları arasında yok (${[...fieldsByKey.keys()].join(", ") || "alan yok"}); olduğu gibi kaydedildi.`,
                    });
                }
                props[key] = value;
                continue;
            }

            props[key] = normalizeFieldValue(field, value, ctx.lang, propPath, sink);
        }
    }

    // ── 4) id ────────────────────────────────────────────────────────────
    const id = explicitId ? (ctx.usedIds.add(explicitId), explicitId) : uniqueId(ctx.usedIds);
    const node: TecofNode = { type: section.type, props: { ...props, id } };
    const zones: Record<string, TecofNode[]> = {};

    // ── 5) Slot'lar ──────────────────────────────────────────────────────
    for (const key of Object.keys(userSlots)) {
        if (!slotKeys.has(key)) {
            sink.errors.push({
                code: "unknown-slot",
                path: `${path}.slots.${key}`,
                message: `${section.type} bileşeninde "${key}" adlı slot yok. Slot'lar: ${[...slotKeys].join(", ") || "(yok)"}.`,
            });
        }
    }

    for (const field of schema.fields) {
        if (field.fieldType !== "slot") continue;
        const key = field.key;
        let children: Section[];
        let source: "user" | "default" | "empty";
        if (key in userSlots) {
            children = Array.isArray(userSlots[key]) ? userSlots[key] : [];
            source = "user";
            if (!Array.isArray(userSlots[key])) {
                sink.errors.push({ code: "invalid-slot-value", path: `${path}.slots.${key}`, message: "Slot içeriği Section dizisi olmalı." });
            }
        } else if (base.inlineChildren[key]?.length) {
            children = base.inlineChildren[key].map(nodeToSection);
            source = "default";
        } else {
            children = [];
            source = "empty";
        }

        const builtChildren: TecofNode[] = [];
        children.forEach((child, i) => {
            const childOutcome = buildInner(
                child,
                ctx,
                {
                    root: false,
                    allow: field.allow,
                    parentType: section.type,
                    slot: key,
                    path: `${path}.slots.${key}[${i}]`,
                    depth: depth + 1,
                    trusted: source === "default" ? true : opts.trusted,
                },
                // Varsayılan çocuklardan gelen uyarılar gürültü yapmasın diye ayrı havuza
                source === "default" ? { errors: sink.errors, warnings: [] } : sink
            );
            if (childOutcome) {
                builtChildren.push(childOutcome.node);
                Object.assign(zones, childOutcome.zones);
            }
        });

        node.props[key] = [];
        zones[zoneKey(id, key)] = builtChildren;
    }

    return { node, zones };
}

/** Birden çok kök bölümü tam dokümana çevirir. */
export function buildDocument(sections: Section[], ctx: BuildContext, rootProps: Record<string, unknown> = {}): { document: TecofDocument; errors: Issue[]; warnings: Issue[] } {
    const doc: TecofDocument = { root: { props: { ...rootProps } }, content: [], zones: {} };
    const errors: Issue[] = [];
    const warnings: Issue[] = [];

    if (!Array.isArray(sections)) {
        errors.push({ code: "shape", path: "sections", message: "sections bir dizi olmalı." });
        return { document: doc, errors, warnings };
    }

    sections.forEach((section, i) => {
        const outcome = buildSection(section, ctx, { root: true, path: `sections[${i}]` });
        errors.push(...outcome.errors);
        warnings.push(...outcome.warnings);
        if (outcome.built) {
            doc.content.push(outcome.built.node);
            Object.assign(doc.zones, outcome.built.zones);
        }
    });

    return { document: doc, errors, warnings };
}
