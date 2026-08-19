/**
 * update_page operation'ları (sözleşme §3.3).
 *
 * Tüm işlemler dokümanın KOPYASI üzerinde sırayla uygulanır; herhangi biri
 * hata verirse sonraki işlemler de denenir (ajan tüm sorunları tek turda
 * görsün) ama sonuç kaydedilmez — çağıran `errors` boşsa PUT atar.
 *
 * Ortak bileşen kuralı: sharedComponentId taşıyan düğüm VE onun zones altındaki
 * tüm torunları (Header'ın Logo/NavLink'i gibi) salt-okunur. Backend master'dan
 * açtığı alt düğümlere sharedComponentId basmaz; bu yüzden kontrol atalara
 * çıkarak yapılır (findSharedAncestor). Aksi halde değişiklik "başarılı" görünür
 * ama PUT'ta backend alt ağacı master'dan yeniden açar — sessizce kaybolurdu.
 *
 * `touchedIds`: bu turda ajanın eklediği/değiştirdiği düğüm id'leri. validate
 * bunlara katı, önceden var olan (dokunulmamış) düğümlere gevşek davranır.
 */

import type { CatalogComponent, Issue, Operation, Section, TecofDocument, TecofNode } from "../types.js";
import { SHARED_COMPONENT_PROP } from "../types.js";
import { buildSection, type BuildContext } from "./build.js";
import { normalizeFieldValue, type IssueSink } from "./fields.js";
import {
    collectAllIds,
    collectDescendantZoneKeys,
    collectSubtreeIds,
    deepClone,
    findNode,
    findSharedAncestor,
    isInlineNodeArray,
    zoneKey,
    type NodeLocation,
} from "./tree.js";

export type ApplyResult = {
    document: TecofDocument;
    errors: Issue[];
    warnings: Issue[];
    /** Uygulanan işlem başına kısa özet (ajan yanıtına eklenir) */
    applied: string[];
    /** Bu turda eklenen/değiştirilen düğüm id'leri (validate bunlara katı davranır) */
    touchedIds: Set<string>;
};

export type ApplyContext = Omit<BuildContext, "usedIds">;

function sharedError(path: string, target: TecofNode, root: TecofNode): Issue {
    const self = target.props.id === root.props.id;
    return {
        code: "shared-component",
        path,
        message: self
            ? `${root.type} (${root.props.id}) ortak bileşen — panel editöründen düzenleyin; MCP master'ı değiştiremez.`
            : `${target.type} (${target.props.id}), ortak bileşen ${root.type} (${root.props.id}) içinde — panel editöründen düzenleyin; buradaki değişiklik kaydedilmez.`,
    };
}

/** "Sona ekle" = sayfa gövdesinin sonu: son düğüm Footer ise onun önü. */
function appendIndex(doc: TecofDocument): { index: number; beforeFooter: boolean } {
    const last = doc.content[doc.content.length - 1];
    const beforeFooter = !!last && /Footer/i.test(last.type);
    return { index: beforeFooter ? doc.content.length - 1 : doc.content.length, beforeFooter };
}

/** Kök düzey (content) içinde before/after hedefini indeks'e çevirir; ikisi de yoksa appendIndex. */
function resolveRootIndex(doc: TecofDocument, op: { before?: string; after?: string }, path: string, errors: Issue[]): { index: number; note: string } | null {
    if (op.before && op.after) {
        errors.push({ code: "invalid-operation", path, message: "before ve after aynı anda verilemez." });
        return null;
    }
    const ref = op.before ?? op.after;
    if (!ref) {
        const { index, beforeFooter } = appendIndex(doc);
        return { index, note: beforeFooter ? " (Footer'ın önüne)" : "" };
    }
    const idx = doc.content.findIndex((n) => n?.props?.id === ref);
    if (idx < 0) {
        const nested = findNode(doc, ref);
        errors.push({
            code: "not-found",
            path,
            message: nested
                ? `"${ref}" kök düzeyde bir bölüm değil (${nested.zoneKey} içinde); before/after yalnız kök bölümlere işaret edebilir.`
                : `"${ref}" id'li bölüm yok. get_page outline ile id'leri doğrulayın.`,
        });
        return null;
    }
    return { index: op.before ? idx : idx + 1, note: "" };
}

export function applyOperations(input: TecofDocument, operations: Operation[], ctx: ApplyContext): ApplyResult {
    const doc = deepClone(input) as TecofDocument;
    doc.root = doc.root ?? { props: {} };
    doc.root.props = doc.root.props ?? {};
    doc.content = Array.isArray(doc.content) ? doc.content : [];
    doc.zones = doc.zones ?? {};

    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const applied: string[] = [];
    const touchedIds = new Set<string>();
    const usedIds = collectAllIds(doc);
    const buildCtx: BuildContext = { ...ctx, usedIds };

    const build = (section: Section, path: string, opts: { root: boolean; allow?: string[]; parentType?: string; slot?: string }) => {
        const outcome = buildSection(section, buildCtx, { ...opts, path });
        errors.push(...outcome.errors);
        warnings.push(...outcome.warnings);
        return outcome.built;
    };

    /** Yeni inşa edilen alt ağacın tüm id'lerini "dokunuldu" olarak işaretle */
    const markBuilt = (built: { node: TecofNode; zones: Record<string, TecofNode[]> }) => {
        touchedIds.add(built.node.props.id);
        for (const list of Object.values(built.zones)) for (const n of list) touchedIds.add(n.props.id);
    };

    /** Alt ağacın zone'larını sil ve id'lerini serbest bırak */
    const dropSubtree = (node: TecofNode) => {
        for (const id of collectSubtreeIds(doc, node.props.id)) usedIds.delete(id);
        for (const key of collectDescendantZoneKeys(doc, node.props.id)) delete doc.zones[key];
    };

    /** Hedef düğümü bul; ortak bileşen (kendisi ya da atası) ise hata. */
    const locateWritable = (id: string, path: string): NodeLocation | null => {
        const loc = locate(doc, id, path, errors);
        if (!loc) return null;
        const sharedRoot = findSharedAncestor(doc, id);
        if (sharedRoot) {
            errors.push(sharedError(path, loc.node, sharedRoot));
            return null;
        }
        return loc;
    };

    operations.forEach((op, i) => {
        const path = `operations[${i}]`;
        if (!op || typeof op !== "object" || typeof (op as any).op !== "string") {
            errors.push({ code: "invalid-operation", path, message: "Her operation {op: string, …} biçiminde olmalı." });
            return;
        }

        switch (op.op) {
            case "append_section": {
                const built = build(op.section, `${path}.section`, { root: true });
                if (!built) return;
                const { index, beforeFooter } = appendIndex(doc);
                doc.content.splice(index, 0, built.node);
                Object.assign(doc.zones, built.zones);
                markBuilt(built);
                applied.push(`append_section → ${built.node.type} (${built.node.props.id})${beforeFooter ? " (Footer'ın önüne)" : ""}`);
                return;
            }

            case "insert_section": {
                const target = resolveRootIndex(doc, op, path, errors);
                const built = build(op.section, `${path}.section`, { root: true });
                if (!target || !built) return;
                doc.content.splice(target.index, 0, built.node);
                Object.assign(doc.zones, built.zones);
                markBuilt(built);
                applied.push(`insert_section → ${built.node.type} (${built.node.props.id}) @${target.index}${target.note}`);
                return;
            }

            case "replace_section": {
                const loc = locateWritable(op.id, path);
                if (!loc) return;
                const parentInfo = slotInfoFor(doc, loc, ctx.catalog);
                const built = build(op.section, `${path}.section`, {
                    root: loc.zoneKey === null,
                    allow: parentInfo?.allow,
                    parentType: parentInfo?.parentType,
                    slot: loc.slot ?? undefined,
                });
                if (!built) return;
                dropSubtree(loc.node);
                loc.list[loc.index] = built.node;
                Object.assign(doc.zones, built.zones);
                markBuilt(built);
                applied.push(`replace_section ${op.id} → ${built.node.type} (${built.node.props.id})`);
                return;
            }

            case "remove_section": {
                const loc = locate(doc, op.id, path, errors);
                if (!loc) return;
                const sharedRoot = findSharedAncestor(doc, op.id);
                if (sharedRoot && sharedRoot.props.id !== op.id) {
                    // Ortak bileşenin ALT düğümü: kaldırılsa da PUT'ta master'dan geri gelir
                    errors.push(sharedError(path, loc.node, sharedRoot));
                    return;
                }
                if (sharedRoot) {
                    warnings.push({
                        code: "shared-component",
                        path,
                        message: `${loc.node.type} (${op.id}) ortak bileşen örneği sayfadan kaldırıldı; master etkilenmez.`,
                    });
                }
                dropSubtree(loc.node);
                loc.list.splice(loc.index, 1);
                applied.push(`remove_section ${op.id} (${loc.node.type})`);
                return;
            }

            case "move_section": {
                const fromIdx = doc.content.findIndex((n) => n?.props?.id === op.id);
                if (fromIdx < 0) {
                    const nested = findNode(doc, op.id);
                    errors.push({
                        code: "not-found",
                        path,
                        message: nested ? `"${op.id}" kök düzeyde değil; move_section yalnız kök bölümleri taşır.` : `"${op.id}" id'li bölüm yok.`,
                    });
                    return;
                }
                if (!op.before && !op.after) {
                    errors.push({ code: "invalid-operation", path, message: "move_section için before ya da after verin." });
                    return;
                }
                const [node] = doc.content.splice(fromIdx, 1);
                const target = resolveRootIndex(doc, op, path, errors);
                if (!target) {
                    doc.content.splice(fromIdx, 0, node); // geri koy
                    return;
                }
                doc.content.splice(target.index, 0, node);
                applied.push(`move_section ${op.id} → @${target.index}`);
                return;
            }

            case "set_props": {
                const loc = locateWritable(op.id, path);
                if (!loc) return;
                if (!op.props || typeof op.props !== "object" || Array.isArray(op.props)) {
                    errors.push({ code: "invalid-operation", path: `${path}.props`, message: "props bir nesne olmalı." });
                    return;
                }
                const schema = ctx.catalog.get(loc.node.type);
                const sink: IssueSink = { errors, warnings };
                const fieldsByKey = new Map(schema?.fields.map((f) => [f.key, f]) ?? []);
                const changed: string[] = [];
                for (const [key, value] of Object.entries(op.props)) {
                    const propPath = `${path}.props.${key}`;
                    if (key === "id") {
                        warnings.push({ code: "id-ignored", path: propPath, message: "id değiştirilemez; yok sayıldı." });
                        continue;
                    }
                    if (key.startsWith("_") || key === SHARED_COMPONENT_PROP) {
                        errors.push({ code: "reserved-prop", path: propPath, message: `"${key}" rezerve; ajan bu anahtarı yazamaz.` });
                        continue;
                    }
                    const field = fieldsByKey.get(key);
                    if (field?.fieldType === "slot" || isInlineNodeArray(value)) {
                        errors.push({ code: "invalid-slot-value", path: propPath, message: `"${key}" bir slot; içeriğini set_slot ile değiştirin.` });
                        continue;
                    }
                    if (!field && key !== "className") {
                        warnings.push({ code: "unknown-prop", path: propPath, message: `"${key}" ${loc.node.type} alanları arasında yok; olduğu gibi kaydedildi.` });
                    }
                    loc.node.props[key] = field ? normalizeFieldValue(field, value, ctx.lang, propPath, sink) : value;
                    changed.push(key);
                }
                touchedIds.add(op.id);
                applied.push(`set_props ${op.id} (${changed.join(", ") || "—"})`);
                return;
            }

            case "set_slot": {
                const loc = locateWritable(op.id, path);
                if (!loc) return;
                const schema = ctx.catalog.get(loc.node.type);
                const slotField = schema?.fields.find((f) => f.key === op.slot && f.fieldType === "slot");
                if (schema && !slotField) {
                    const slots = schema.fields.filter((f) => f.fieldType === "slot").map((f) => f.key);
                    errors.push({ code: "unknown-slot", path: `${path}.slot`, message: `${loc.node.type} bileşeninde "${op.slot}" slot'u yok. Slot'lar: ${slots.join(", ") || "(yok)"}.` });
                    return;
                }
                if (!Array.isArray(op.children)) {
                    errors.push({ code: "invalid-operation", path: `${path}.children`, message: "children bir Section dizisi olmalı." });
                    return;
                }
                // Önce YENİ çocukları inşa et; hepsi başarılıysa eskileri düşür
                // (yarım kalan set_slot sonraki operation'lara yetim/yanıltıcı hata sızdırmasın).
                const newChildren: TecofNode[] = [];
                const newZones: Record<string, TecofNode[]> = {};
                let failed = false;
                op.children.forEach((child, ci) => {
                    const built = build(child, `${path}.children[${ci}]`, {
                        root: false,
                        allow: slotField?.allow,
                        parentType: loc.node.type,
                        slot: op.slot,
                    });
                    if (!built) {
                        failed = true;
                        return;
                    }
                    newChildren.push(built.node);
                    Object.assign(newZones, built.zones);
                    markBuilt(built);
                });
                if (failed) return;
                const zk = zoneKey(op.id, op.slot);
                for (const child of doc.zones[zk] ?? []) dropSubtree(child);
                doc.zones[zk] = newChildren;
                Object.assign(doc.zones, newZones);
                loc.node.props[op.slot] = [];
                touchedIds.add(op.id);
                applied.push(`set_slot ${op.id}.${op.slot} (${newChildren.length} çocuk)`);
                return;
            }

            case "set_root_props": {
                if (!op.props || typeof op.props !== "object" || Array.isArray(op.props)) {
                    errors.push({ code: "invalid-operation", path: `${path}.props`, message: "props bir nesne olmalı." });
                    return;
                }
                for (const [key, value] of Object.entries(op.props)) {
                    if (key.startsWith("_")) {
                        errors.push({ code: "reserved-prop", path: `${path}.props.${key}`, message: `"${key}" rezerve (tema/şema ayarları panelden yönetilir).` });
                        continue;
                    }
                    doc.root.props[key] = value;
                }
                applied.push(`set_root_props (${Object.keys(op.props).join(", ")})`);
                return;
            }

            default:
                errors.push({
                    code: "invalid-operation",
                    path: `${path}.op`,
                    message: `Bilinmeyen operation "${(op as any).op}". Geçerli: append_section, insert_section, replace_section, remove_section, move_section, set_props, set_slot, set_root_props.`,
                });
        }
    });

    return { document: doc, errors, warnings, applied, touchedIds };
}

function locate(doc: TecofDocument, id: string, path: string, errors: Issue[]): NodeLocation | null {
    if (typeof id !== "string" || !id) {
        errors.push({ code: "invalid-operation", path: `${path}.id`, message: "id zorunlu." });
        return null;
    }
    const loc = findNode(doc, id);
    if (!loc) {
        errors.push({ code: "not-found", path: `${path}.id`, message: `"${id}" id'li düğüm yok. get_page (outline) ile id'leri doğrulayın.` });
    }
    return loc;
}

/** Zone içindeki düğüm için ebeveyn slot'un allow listesi. */
function slotInfoFor(doc: TecofDocument, loc: NodeLocation, catalog: Map<string, CatalogComponent>): { parentType: string; allow?: string[] } | null {
    if (!loc.parentId || !loc.slot) return null;
    const parent = findNode(doc, loc.parentId);
    if (!parent) return null;
    const schema = catalog.get(parent.node.type);
    const field = schema?.fields.find((f) => f.key === loc.slot && f.fieldType === "slot");
    return { parentType: parent.node.type, allow: field?.allow };
}
