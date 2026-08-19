/**
 * Tam doküman doğrulaması (sözleşme §2.8 yapısal kurallar + §3.3 katalog kuralları).
 *
 * Backend'in yapacağı yapısal kontrolleri burada ÖNCEDEN yapıyoruz ki ajan
 * hatayı bir HTTP turu beklemeden, alan/yol bilgisiyle görsün. Katalog
 * kuralları (bilinmeyen type, allow ihlali, select dışı değer) backend'de yok
 * — tema şemasını yalnız MCP bilir; o yüzden burası tek savunma hattı.
 *
 * Mevcut (backend'den okunan) dokümanlarda `_tecofStyles`, `_locked` gibi motor
 * prop'ları meşru — bunlar UYARI bile değil; yalnız ajanın yeni yazdığı
 * prop'larda (build.ts) hata olur.
 */

import type { CatalogComponent, Issue, ParsedField, TecofDocument, TecofNode, ValidationResult } from "../types.js";
import { SHARED_COMPONENT_PROP } from "../types.js";
import { normalizeFieldValue, type IssueSink, type LanguageContext } from "./fields.js";
import { isValidNodeId, uniqueId } from "./ids.js";
import { collectAllIds, collectSharedSubtreeIds, deepClone, isInlineNodeArray, isNodeLike, parseZoneKey, zoneKey } from "./tree.js";

export const LIMITS = {
    maxJsonBytes: 2 * 1024 * 1024,
    maxNodes: 3000,
    maxDepth: 24,
};

export type ValidateOptions = {
    catalog: Map<string, CatalogComponent>;
    lang: LanguageContext | null;
    /** Seçenek/dil gibi alan düzeyi kontrolleri de yap (varsayılan true) */
    checkFields?: boolean;
    /**
     * Katalog kuralları (unknown-type, element-at-root, slot-not-allowed) ve
     * inline-slot kalıntısı → hata (true, varsayılan) ya da uyarı (false).
     *
     * update_page operations modunda false: ajanın dokunmadığı, önceden var olan
     * düğümler tema değişince kurallara uymuyor olabilir (bileşen yeniden
     * adlandırıldı, allow listesi daraltıldı, element bölüme taşındı) — bunun
     * yüzünden ajanın ilgisiz değişikliğini kaydedememesi anlamsız olur.
     * `strictIds` içindeki düğümler (bu turda ajanın eklediği/değiştirdiği)
     * her durumda katı denetlenir.
     */
    strict?: boolean;
    strictIds?: Set<string>;
};

/**
 * Dokümanı kaydedilebilir biçime getirir: props içinde kalmış inline slot
 * dizilerini zones'a çıkarır (backend aynı şeyi uyarıyla yapar — biz de
 * uyarıyla yapıp ajana normalizedDocument'i geri veriyoruz), id'si olmayan
 * düğümlere id üretir. Girdi değiştirilmez; kopya döner.
 */
export function normalizeDocument(input: TecofDocument): { document: TecofDocument; warnings: Issue[] } {
    const warnings: Issue[] = [];
    const doc = deepClone(input) as TecofDocument;
    doc.root = doc.root && typeof doc.root === "object" ? doc.root : { props: {} };
    doc.root.props = doc.root.props && typeof doc.root.props === "object" ? doc.root.props : {};
    doc.content = Array.isArray(doc.content) ? doc.content : [];
    doc.zones = doc.zones && typeof doc.zones === "object" && !Array.isArray(doc.zones) ? doc.zones : {};

    /* Master'ı silinmiş ortak bileşen referansı (SharedComponentRef): backend GET'te
       olduğu gibi döndürür, PUT'ta uyarıyla dokümandan çıkarır (sözleşme §2.8).
       Aynısını burada yapıyoruz ki ajan hata yerine ne olduğunu gören bir uyarı
       alsın ve sayfa kilitlenmesin. */
    const dropRefs = (list: TecofNode[], where: string) => {
        for (let i = list.length - 1; i >= 0; i--) {
            const node = list[i];
            if (!isNodeLike(node) || node.type !== "SharedComponentRef") continue;
            const ref = node.props[SHARED_COMPONENT_PROP];
            warnings.push({
                code: "shared-component-ref-dropped",
                path: `${where}[${i}]`,
                message: ref
                    ? `Master'ı bulunamayan ortak bileşen referansı (${node.props.type ?? "?"} → ${ref}) dokümandan çıkarıldı; backend de kaydederken aynısını yapar. Gerekirse bölümü yeniden ekleyin.`
                    : "sharedComponentId'siz SharedComponentRef düğümü dokümandan çıkarıldı (geçersiz).",
            });
            list.splice(i, 1);
        }
    };
    dropRefs(doc.content, "content");
    for (const [key, list] of Object.entries(doc.zones)) if (Array.isArray(list)) dropRefs(list, `zones["${key}"]`);

    const used = collectAllIds(doc);

    const visit = (node: TecofNode, path: string) => {
        if (!isNodeLike(node)) return;
        if (!isValidNodeId(node.props.id)) {
            const fresh = uniqueId(used);
            warnings.push({ code: "id-generated", path: `${path}.props.id`, message: `Geçersiz/eksik id yerine "${fresh}" üretildi.` });
            node.props.id = fresh;
        }
        for (const [key, value] of Object.entries(node.props)) {
            if (!isInlineNodeArray(value)) continue;
            const zk = zoneKey(node.props.id, key);
            const children = value as TecofNode[];
            node.props[key] = [];
            if (Array.isArray(doc.zones[zk]) && doc.zones[zk].length) {
                // Zone zaten dolu: inline kopya atılır; atılan dal ZİYARET EDİLMEZ
                // (yoksa dokümanda olmayan ebeveyne yetim zone üretirdi).
                warnings.push({ code: "inline-slot", path: `${path}.props.${key}`, message: `props.${key} içindeki düğümler atıldı; zones["${zk}"] zaten dolu.` });
                continue;
            }
            doc.zones[zk] = children;
            warnings.push({ code: "inline-slot", path: `${path}.props.${key}`, message: `props.${key} içindeki düğümler zones["${zk}"] altına taşındı.` });
            children.forEach((child, i) => visit(child, `zones["${zk}"][${i}]`));
        }
    };

    doc.content.forEach((node, i) => visit(node, `content[${i}]`));
    // zones'a taşınanlar yukarıda ziyaret edildi; mevcut zones'u da gez
    for (const [key, list] of Object.entries(doc.zones)) {
        if (!Array.isArray(list)) continue;
        list.forEach((node, i) => visit(node, `zones["${key}"][${i}]`));
    }

    return { document: doc, warnings };
}

export function validateDocument(doc: TecofDocument, opts: ValidateOptions): ValidationResult {
    const sink: IssueSink = { errors: [], warnings: [] };
    const { catalog } = opts;
    const checkFields = opts.checkFields !== false;
    const strict = opts.strict !== false;
    const strictIds = opts.strictIds ?? new Set<string>();
    /** Bu düğüm için katalog ihlali hata mı (katı) uyarı mı? */
    const pushRule = (nodeId: unknown, issue: Issue) => {
        const isStrict = strict || (typeof nodeId === "string" && strictIds.has(nodeId));
        if (isStrict) sink.errors.push(issue);
        else sink.warnings.push({ ...issue, message: `${issue.message} (mevcut düğüm; bu turda değiştirilmedi)` });
    };

    // ── shape ────────────────────────────────────────────────────────────
    if (!doc || typeof doc !== "object") {
        sink.errors.push({ code: "shape", path: "document", message: "Doküman {root, content, zones} nesnesi olmalı." });
        return { ok: false, ...sink };
    }
    if (!doc.root || typeof doc.root !== "object" || !doc.root.props || typeof doc.root.props !== "object" || Array.isArray(doc.root.props)) {
        sink.errors.push({ code: "shape", path: "root.props", message: "root.props bir nesne olmalı." });
    }
    if (!Array.isArray(doc.content)) {
        sink.errors.push({ code: "shape", path: "content", message: "content bir dizi olmalı." });
    }
    if (!doc.zones || typeof doc.zones !== "object" || Array.isArray(doc.zones)) {
        sink.errors.push({ code: "shape", path: "zones", message: "zones bir nesne olmalı." });
    }
    if (sink.errors.length) return { ok: false, ...sink };

    // ── size ─────────────────────────────────────────────────────────────
    let json = "";
    try {
        json = JSON.stringify(doc);
    } catch {
        sink.errors.push({ code: "shape", path: "document", message: "Doküman JSON'a çevrilemiyor (döngüsel referans?)." });
        return { ok: false, ...sink };
    }
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > LIMITS.maxJsonBytes) {
        sink.errors.push({ code: "size", path: "document", message: `Doküman ${(bytes / 1024 / 1024).toFixed(2)} MB; sınır 2 MB.` });
    }

    // ── düğümler: id, type, props ────────────────────────────────────────
    const seenIds = new Map<string, string>(); // id → path
    const nodeTypeById = new Map<string, string>();
    const sharedIds = collectSharedSubtreeIds(doc);
    let nodeCount = 0;

    const checkNode = (node: TecofNode, path: string, parent: { type: string; slot: string; allow?: string[] } | null) => {
        nodeCount++;
        if (!isNodeLike(node)) {
            sink.errors.push({ code: "shape", path, message: "Düğüm {type: string, props: object} biçiminde olmalı." });
            return;
        }
        if (node.type === "SharedComponentRef") {
            // normalizeDocument bunları düşürür; buraya kalmışsa yalnız uyarı (ajanın çıkış yolu: remove_section)
            const ref = node.props[SHARED_COMPONENT_PROP];
            sink.warnings.push({
                code: "shared-component-ref",
                path: `${path}.type`,
                message: ref
                    ? `Master'ı bulunamayan ortak bileşen referansı (${ref}); backend kaydederken çıkaracak. remove_section ile kaldırabilir ya da bölümü yeniden ekleyebilirsiniz.`
                    : "sharedComponentId'siz SharedComponentRef düğümü; backend reddeder (normalize ile düşürülür).",
            });
            nodeCount--; // sayıma katma
            return;
        }
        const id = node.props.id;
        if (!isValidNodeId(id)) {
            sink.errors.push({ code: "id", path: `${path}.props.id`, message: "props.id boş olmayan, ':' içermeyen bir string olmalı ([A-Za-z0-9_-])." });
        } else if (seenIds.has(id)) {
            sink.errors.push({ code: "id", path: `${path}.props.id`, message: `"${id}" id'si birden fazla düğümde (ilk: ${seenIds.get(id)}).` });
        } else {
            seenIds.set(id, path);
            nodeTypeById.set(id, node.type);
        }

        // Ortak bileşen alt ağacı: katalog denetimi yok (master'dan gelir, salt-okunur)
        const inShared = isValidNodeId(id) && sharedIds.has(id);
        if (inShared) return;

        const schema = catalog.get(node.type);
        if (!schema) {
            pushRule(id, { code: "unknown-type", path: `${path}.type`, message: `"${node.type}" katalogda yok. list_components ile geçerli adları görün.` });
        } else {
            if (!parent && schema.category === "element") {
                pushRule(id, { code: "element-at-root", path: `${path}.type`, message: `"${node.type}" bir element; sayfa köküne yalnız section konabilir.` });
            }
            if (parent?.allow?.length && !parent.allow.includes(node.type)) {
                pushRule(id, {
                    code: "slot-not-allowed",
                    path: `${path}.type`,
                    message: `"${node.type}", ${parent.type}.${parent.slot} içine konamaz. İzin verilenler: ${parent.allow.join(", ")}.`,
                });
            }
        }

        // inline slot kalıntısı (normalizeDocument bunları zones'a taşır; kalmışsa kural ihlali)
        for (const [key, value] of Object.entries(node.props)) {
            if (isInlineNodeArray(value)) {
                pushRule(id, { code: "inline-slot", path: `${path}.props.${key}`, message: `props.${key} içinde düğüm dizisi var; slot içerikleri zones["<id>:${key}"] altında olmalı (validate_document normalizedDocument verir).` });
            }
        }

        // alan düzeyi kontroller (select seçenekleri, dil eksikleri) — yalnız şema varsa
        if (schema && checkFields && opts.lang) {
            const fieldsByKey = new Map<string, ParsedField>(schema.fields.map((f) => [f.key, f]));
            for (const [key, value] of Object.entries(node.props)) {
                const field = fieldsByKey.get(key);
                if (!field || field.fieldType === "slot") continue;
                // normalize yalnız doğrulama için — doküman değiştirilmez
                normalizeFieldValue(field, deepClone(value), opts.lang, `${path}.props.${key}`, sink);
            }
        }
    };

    doc.content.forEach((node, i) => checkNode(node, `content[${i}]`, null));

    // ── zones ────────────────────────────────────────────────────────────
    const zoneEntries = Object.entries(doc.zones);
    // Ebeveyn id'leri content + zones'un tümünden toplanmalı (iç içe slotlar)
    const allIds = collectAllIds(doc);

    for (const [key, list] of zoneEntries) {
        const parsed = parseZoneKey(key);
        if (!parsed) {
            sink.errors.push({ code: "zone-key", path: `zones["${key}"]`, message: 'Zone anahtarı "<parentId>:<slot>" biçiminde olmalı.' });
            continue;
        }
        if (!Array.isArray(list)) {
            sink.errors.push({ code: "shape", path: `zones["${key}"]`, message: "Zone değeri düğüm dizisi olmalı." });
            continue;
        }
        if (!allIds.has(parsed.parentId)) {
            sink.errors.push({ code: "zone-key", path: `zones["${key}"]`, message: `Yetim zone: "${parsed.parentId}" id'li düğüm dokümanda yok.` });
            continue;
        }
        const parentType = nodeTypeById.get(parsed.parentId) ?? findTypeById(doc, parsed.parentId);
        const parentSchema = parentType ? catalog.get(parentType) : undefined;
        const slotField = parentSchema?.fields.find((f) => f.key === parsed.slot && f.fieldType === "slot");
        if (parentSchema && !slotField) {
            sink.warnings.push({ code: "unknown-slot", path: `zones["${key}"]`, message: `${parentType} bileşeninde "${parsed.slot}" adlı slot yok; bu zone render edilmeyecek.` });
        }
        list.forEach((node, i) =>
            checkNode(node, `zones["${key}"][${i}]`, { type: parentType ?? "?", slot: parsed.slot, allow: slotField?.allow })
        );
    }

    if (nodeCount > LIMITS.maxNodes) {
        sink.errors.push({ code: "size", path: "document", message: `Düğüm sayısı ${nodeCount}; sınır ${LIMITS.maxNodes}.` });
    }

    // ── derinlik ─────────────────────────────────────────────────────────
    const depth = measureDepth(doc);
    if (depth > LIMITS.maxDepth) {
        sink.errors.push({ code: "size", path: "document", message: `Ağaç derinliği ${depth}; sınır ${LIMITS.maxDepth}.` });
    }

    // ── ortak bileşen bilgilendirmesi ────────────────────────────────────
    for (const node of doc.content) {
        if (isNodeLike(node) && node.props[SHARED_COMPONENT_PROP]) {
            sink.warnings.push({
                code: "shared-component",
                path: `content[${doc.content.indexOf(node)}]`,
                message: `${node.type} (${node.props.id}) ortak bileşen; içeriği master'dan gelir, burada yapılan değişiklikler kaydedilmez.`,
            });
        }
    }

    return { ok: sink.errors.length === 0, errors: sink.errors, warnings: sink.warnings };
}

function findTypeById(doc: TecofDocument, id: string): string | undefined {
    for (const node of doc.content) if (node?.props?.id === id) return node.type;
    for (const list of Object.values(doc.zones)) {
        if (!Array.isArray(list)) continue;
        for (const node of list) if (node?.props?.id === id) return node.type;
    }
    return undefined;
}

/** content kökten en derin zone zincirine kadar düğüm derinliği. */
function measureDepth(doc: TecofDocument): number {
    const childrenOf = (id: string): TecofNode[] => {
        const out: TecofNode[] = [];
        const prefix = `${id}:`;
        for (const [key, list] of Object.entries(doc.zones)) {
            if (key.startsWith(prefix) && Array.isArray(list)) out.push(...list);
        }
        return out;
    };
    let max = 0;
    const seen = new Set<string>();
    const walk = (node: TecofNode, d: number) => {
        if (d > max) max = d;
        if (d > LIMITS.maxDepth + 1) return; // sonsuz döngü koruması
        const id = node?.props?.id;
        if (!id || seen.has(`${id}@${d}`)) return;
        seen.add(`${id}@${d}`);
        for (const child of childrenOf(id)) walk(child, d + 1);
    };
    for (const node of doc.content) walk(node, 1);
    return max;
}
