/**
 * create_page `layoutFrom` — kaynak sayfadaki ortak Header/Footer'ı yeni sayfaya taşır.
 *
 * Neden yalnız sharedComponentId taşıyanlar: ortak bileşen örneği master'a
 * referanstır; backend bunu SharedComponentRef'e indirger, sayfa master
 * güncellenince otomatik güncel kalır. Ortak olmayan bir Header kopyalansa
 * içerik kopyası olur, iki sayfa birbirinden koparak yönetilemez hale gelirdi.
 * Düğüm id'si dahil AYNEN kopyalanır (aynı symbol örneğinin id'si sayfalar
 * arasında tekil olmak zorunda değil; doküman içinde tekil olması yeter).
 */

import type { TecofDocument, TecofNode } from "../types.js";
import { SHARED_COMPONENT_PROP } from "../types.js";
import { collectDescendantZoneKeys, deepClone, isNodeLike } from "./tree.js";

export type LayoutPart = { node: TecofNode; zones: Record<string, TecofNode[]> };

export type ExtractedLayout = {
    header: LayoutPart | null;
    footer: LayoutPart | null;
    warnings: string[];
};

const HEADER_RE = /Header/i;
const FOOTER_RE = /Footer/i;

function pick(source: TecofDocument, node: TecofNode | undefined, re: RegExp, label: string, warnings: string[]): LayoutPart | null {
    if (!node || !isNodeLike(node) || !re.test(node.type)) {
        warnings.push(`Kaynak sayfada ${label} bulunamadı; yeni sayfa ${label.toLowerCase()}'sız oluşturuldu.`);
        return null;
    }
    if (!node.props[SHARED_COMPONENT_PROP]) {
        warnings.push(`Kaynak sayfadaki ${node.type} ortak bileşen değil (sharedComponentId yok); kopyalanmadı. Panelden "ortak bileşen yap" ile paylaşın.`);
        return null;
    }
    const zones: Record<string, TecofNode[]> = {};
    for (const key of collectDescendantZoneKeys(source, node.props.id)) {
        zones[key] = deepClone(source.zones[key]);
    }
    return { node: deepClone(node), zones };
}

export function extractLayout(source: TecofDocument): ExtractedLayout {
    const warnings: string[] = [];
    const content = Array.isArray(source?.content) ? source.content : [];
    const first = content[0];
    const last = content.length > 1 ? content[content.length - 1] : undefined;
    const header = pick(source, first, HEADER_RE, "Header", warnings);
    const footer = pick(source, last, FOOTER_RE, "Footer", warnings);
    return { header, footer, warnings };
}

/** Header'ı başa, footer'ı sona ekler (id çakışması çağıranın sorumluluğunda — usedIds'i tohumlayın). */
export function applyLayout(doc: TecofDocument, layout: ExtractedLayout): TecofDocument {
    if (layout.header) {
        doc.content.unshift(layout.header.node);
        Object.assign(doc.zones, layout.header.zones);
    }
    if (layout.footer) {
        doc.content.push(layout.footer.node);
        Object.assign(doc.zones, layout.footer.zones);
    }
    return doc;
}

/** Layout parçalarındaki tüm id'ler — build'den önce usedIds'e eklenir ki çakışma olmasın. */
export function layoutIds(layout: ExtractedLayout): string[] {
    const ids: string[] = [];
    for (const part of [layout.header, layout.footer]) {
        if (!part) continue;
        ids.push(part.node.props.id);
        for (const list of Object.values(part.zones)) for (const n of list) if (n?.props?.id) ids.push(n.props.id);
    }
    return ids;
}
