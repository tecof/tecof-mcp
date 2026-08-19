/**
 * Tema dizininden bileşen dosyalarını keşfeder (theme-core
 * app/api/component-schemas/route.ts içindeki discoverComponents mantığının portu).
 *
 *   components/sections/**  → category "section" (alt klasörler dahil: hero/, ecommerce/)
 *   components/elements/**  → category "element" (slot çocukları: Title, Button, Picture…)
 *
 * Element'ler ajanın slot'ları doldurabilmesi için ŞARTTIR — yalnız section
 * dönseydi ajan slot'a ne koyacağını bilemezdi.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ComponentCategory } from "../types.js";

export type DiscoveredComponent = {
    /** Dosya adından türetilen bileşen adı (FeaturesSection.tsx → FeaturesSection) */
    name: string;
    /** Tema köküne göre göreli yol */
    filePath: string;
    absPath: string;
    category: ComponentCategory;
};

export type DiscoveredSharedFile = {
    filePath: string;
    absPath: string;
};

export const COMPONENT_ROOTS: Array<{ dir: string; category: ComponentCategory }> = [
    { dir: "sections", category: "section" },
    { dir: "elements", category: "element" },
];

function isSkippedEntry(name: string): boolean {
    return name.startsWith("_") || name.startsWith(".");
}

/** Bir kök klasörü RECURSIVE tarar. */
async function walkTsxFiles(absDir: string, relDir: string): Promise<Array<{ name: string; filePath: string; absPath: string }>> {
    let entries;
    try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const out: Array<{ name: string; filePath: string; absPath: string }> = [];
    for (const entry of entries) {
        if (isSkippedEntry(entry.name)) continue;

        if (entry.isDirectory()) {
            out.push(...(await walkTsxFiles(path.join(absDir, entry.name), path.join(relDir, entry.name))));
            continue;
        }

        if (!entry.name.endsWith(".tsx")) continue;
        // Context/Provider dosyaları bileşen değil, React bağlam sarmalayıcıları
        if (entry.name.includes("Context") || entry.name.includes("Provider")) continue;

        out.push({
            name: entry.name.replace(/\.tsx$/, ""),
            filePath: path.join(relDir, entry.name),
            absPath: path.join(absDir, entry.name),
        });
    }
    return out;
}

export async function discoverComponents(projectDir: string): Promise<DiscoveredComponent[]> {
    const results: DiscoveredComponent[] = [];
    for (const { dir, category } of COMPONENT_ROOTS) {
        const relDir = path.join("components", dir);
        const files = await walkTsxFiles(path.join(projectDir, relDir), relDir);
        results.push(...files.map((f) => ({ ...f, category })));
    }
    // Deterministik sıra — tool çıktısı çağrıdan çağrıya oynamasın
    results.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return results;
}

/**
 * Paylaşılan sabit dosyaları: `components/**` altında `_` ile başlayan ya da
 * adında `Shared` geçen .ts/.tsx dosyaları (Arch temasının ArchitectureShared
 * kalıbı). Bunlar bileşen olarak keşfedilmez; exported sabitleri parser'a
 * identifier çözümü için verilir (allow: textSlotAllow gibi).
 */
export async function discoverSharedFiles(projectDir: string): Promise<DiscoveredSharedFile[]> {
    const out: DiscoveredSharedFile[] = [];
    const walk = async (absDir: string, relDir: string) => {
        let entries;
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const abs = path.join(absDir, entry.name);
            const rel = path.join(relDir, entry.name);
            if (entry.isDirectory()) {
                await walk(abs, rel);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            if (entry.name.startsWith("_") || /Shared/.test(entry.name)) {
                out.push({ filePath: rel, absPath: abs });
            }
        }
    };
    await walk(path.join(projectDir, "components"), "components");
    out.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return out;
}
