/**
 * get_page outline modu — ajanın sayfayı tam JSON yüklemeden kavraması için
 * sıkıştırılmış görünüm: kök props + bölüm listesi + slot çocukları (id, type,
 * kısa metin). Tam draftData onlarca KB olabilir; outline bir ekrana sığar ve
 * update_page operation'ları için gereken id'leri verir.
 */

import type { CatalogComponent, TecofDocument, TecofNode } from "../types.js";
import { SHARED_COMPONENT_PROP } from "../types.js";
import { pickText, type LanguageContext } from "./fields.js";
import { collectSharedSubtreeIds } from "./tree.js";

export type OutlineNode = {
    id: string;
    type: string;
    label?: string;
    /** Varsa çok dilli ilk metin alanının kısaltılmış değeri */
    text?: string;
    variant?: string;
    /** Ortak bileşen (Header/Footer) ya da onun alt düğümü — salt-okunur */
    shared?: boolean;
    slots?: Record<string, OutlineNode[]>;
};

export type PageOutline = {
    root: Record<string, unknown>;
    sections: OutlineNode[];
    stats: { sections: number; nodes: number; zones: number };
};

const TEXT_FIELD_TYPES = new Set(["language", "editor"]);
const MAX_OUTLINE_DEPTH = 6;

export function buildOutline(doc: TecofDocument, catalog: Map<string, CatalogComponent>, lang: LanguageContext): PageOutline {
    let nodes = 0;
    // Ortak bileşenin torunları da salt-okunur; ajan outline'dan görsün
    const sharedIds = collectSharedSubtreeIds(doc);

    const describe = (node: TecofNode, depth: number): OutlineNode => {
        nodes++;
        const schema = catalog.get(node.type);
        const out: OutlineNode = { id: node.props.id, type: node.type };
        if (schema?.label) out.label = schema.label;
        if (typeof node.props._variant === "string") out.variant = node.props._variant;
        if (node.props[SHARED_COMPONENT_PROP] || sharedIds.has(node.props.id)) out.shared = true;

        // Metin: şemadaki ilk language/editor alanı; şema yoksa yaygın anahtarlar
        const textKeys = schema
            ? schema.fields.filter((f) => TEXT_FIELD_TYPES.has(f.fieldType)).map((f) => f.key)
            : ["text", "title", "label", "heading"];
        for (const key of textKeys) {
            const text = pickText(node.props[key], lang);
            if (text) {
                out.text = text;
                break;
            }
        }

        if (depth < MAX_OUTLINE_DEPTH) {
            const prefix = `${node.props.id}:`;
            const slots: Record<string, OutlineNode[]> = {};
            for (const [key, list] of Object.entries(doc.zones ?? {})) {
                if (!key.startsWith(prefix) || !Array.isArray(list)) continue;
                slots[key.slice(prefix.length)] = list.map((child) => describe(child, depth + 1));
            }
            if (Object.keys(slots).length) out.slots = slots;
        }
        return out;
    };

    const sections = (doc.content ?? []).map((node) => describe(node, 1));
    return {
        root: doc.root?.props ?? {},
        sections,
        stats: { sections: sections.length, nodes, zones: Object.keys(doc.zones ?? {}).length },
    };
}
