/**
 * Doküman ağacı yardımcıları — content + zones üzerinde gezinme.
 *
 * theme-editor engine'inde karşılıkları var (findNodeById, getDescendantZoneKeys)
 * ama o paket React/zustand taşıdığı için burada saf kopyaları tutuluyor.
 */

import type { TecofDocument, TecofNode } from "../types.js";

export const ZONE_SEPARATOR = ":";

export function isNodeLike(value: unknown): value is { type: string; props: Record<string, any> } {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof (value as any).type === "string" &&
        !!(value as any).props &&
        typeof (value as any).props === "object" &&
        !Array.isArray((value as any).props)
    );
}

/** `[{type, props}, …]` biçiminde, boş olmayan düğüm dizisi mi? (inline slot işareti) */
export function isInlineNodeArray(value: unknown): value is Array<{ type: string; props: Record<string, any> }> {
    return Array.isArray(value) && value.length > 0 && value.every(isNodeLike);
}

export function deepClone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function emptyDocument(): TecofDocument {
    return { root: { props: {} }, content: [], zones: {} };
}

export function parseZoneKey(key: string): { parentId: string; slot: string } | null {
    const idx = key.indexOf(ZONE_SEPARATOR);
    if (idx <= 0 || idx === key.length - 1) return null;
    return { parentId: key.slice(0, idx), slot: key.slice(idx + 1) };
}

export function zoneKey(parentId: string, slot: string): string {
    return `${parentId}${ZONE_SEPARATOR}${slot}`;
}

export type NodeLocation = {
    node: TecofNode;
    /** İçinde bulunduğu liste (content ya da bir zone dizisi) */
    list: TecofNode[];
    index: number;
    /** null → kök content */
    zoneKey: string | null;
    /** Kök düğümler için null; zone çocukları için ebeveyn id + slot */
    parentId: string | null;
    slot: string | null;
};

/** Düğümü content + tüm zones içinde arar. */
export function findNode(doc: TecofDocument, id: string): NodeLocation | null {
    for (const [index, node] of doc.content.entries()) {
        if (node?.props?.id === id) return { node, list: doc.content, index, zoneKey: null, parentId: null, slot: null };
    }
    for (const [key, list] of Object.entries(doc.zones ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const [index, node] of list.entries()) {
            if (node?.props?.id === id) {
                const parsed = parseZoneKey(key);
                return { node, list, index, zoneKey: key, parentId: parsed?.parentId ?? null, slot: parsed?.slot ?? null };
            }
        }
    }
    return null;
}

/** Düğümün kendi alt ağacına ait TÜM zone anahtarları (recursive). */
export function collectDescendantZoneKeys(doc: TecofDocument, id: string): string[] {
    const out: string[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        const prefix = `${current}${ZONE_SEPARATOR}`;
        for (const [key, list] of Object.entries(doc.zones ?? {})) {
            if (!key.startsWith(prefix)) continue;
            out.push(key);
            for (const child of list ?? []) {
                if (child?.props?.id) stack.push(child.props.id);
            }
        }
    }
    return out;
}

/** Dokümandaki tüm düğümler (content + zones), konumlarıyla. */
export function* iterateNodes(doc: TecofDocument): Generator<{ node: TecofNode; path: string; zoneKey: string | null; index: number }> {
    for (const [index, node] of (doc.content ?? []).entries()) {
        yield { node, path: `content[${index}]`, zoneKey: null, index };
    }
    for (const [key, list] of Object.entries(doc.zones ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const [index, node] of list.entries()) {
            yield { node, path: `zones["${key}"][${index}]`, zoneKey: key, index };
        }
    }
}

export function collectAllIds(doc: TecofDocument): Set<string> {
    const ids = new Set<string>();
    for (const { node } of iterateNodes(doc)) {
        if (node?.props?.id) ids.add(String(node.props.id));
    }
    return ids;
}

/** Kaldırılan düğümün alt zone'larını da temizler (yetim zone kalmasın). */
export function removeNodeWithZones(doc: TecofDocument, id: string): boolean {
    const loc = findNode(doc, id);
    if (!loc) return false;
    loc.list.splice(loc.index, 1);
    for (const key of collectDescendantZoneKeys(doc, id)) delete doc.zones[key];
    return true;
}

/**
 * Düğümün kendisi ya da atalarından biri ortak bileşen (sharedComponentId) mi?
 * Backend master'dan açtığı alt düğümlere sharedComponentId BASMAZ; yalnız kök
 * taşır. Bu yüzden "salt-okunur mu" sorusu zones grafında yukarı çıkılarak
 * yanıtlanır. Döndürülen düğüm ortak kök (mesajda adı geçsin diye).
 */
export function findSharedAncestor(doc: TecofDocument, id: string): TecofNode | null {
    let currentId: string | null = id;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const loc: NodeLocation | null = findNode(doc, currentId);
        if (!loc) return null;
        if (loc.node.props?.sharedComponentId) return loc.node;
        currentId = loc.parentId;
    }
    return null;
}

/**
 * Ortak bileşen alt ağaçlarındaki TÜM düğüm id'leri (kökler + torunlar).
 * validate/outline gibi toplu geçişlerde findSharedAncestor'ı düğüm başına
 * çağırmak yerine tek seferde hesaplanır.
 */
export function collectSharedSubtreeIds(doc: TecofDocument): Set<string> {
    const ids = new Set<string>();
    const roots: string[] = [];
    for (const { node } of iterateNodes(doc)) {
        if (isNodeLike(node) && node.props.sharedComponentId && node.props.id) roots.push(node.props.id);
    }
    const stack = [...roots];
    while (stack.length) {
        const id = stack.pop()!;
        if (ids.has(id)) continue;
        ids.add(id);
        const prefix = `${id}${ZONE_SEPARATOR}`;
        for (const [key, list] of Object.entries(doc.zones ?? {})) {
            if (!key.startsWith(prefix) || !Array.isArray(list)) continue;
            for (const child of list) if (child?.props?.id) stack.push(child.props.id);
        }
    }
    return ids;
}

/** Bir düğümün alt ağacındaki tüm id'ler (kendisi dahil). */
export function collectSubtreeIds(doc: TecofDocument, id: string): string[] {
    const out = [id];
    for (const key of collectDescendantZoneKeys(doc, id)) {
        for (const child of doc.zones[key] ?? []) if (child?.props?.id) out.push(child.props.id);
    }
    return out;
}
