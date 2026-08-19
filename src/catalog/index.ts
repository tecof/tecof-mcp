/**
 * Bileşen kataloğu — diskten AST ile okunan şemaların mtime-bazlı önbelleği.
 *
 * Neden her tool çağrısında yenileniyor: kullanıcı tema reposunda bir bileşen
 * düzenlerken (yeni alan, yeni allow) MCP süreci açık kalır; eski şemayla
 * doğrulama yaparsak ajan "alan yok" diye yanlış hata alır. readdir + stat
 * ucuz, parse pahalı — bu yüzden yalnız mtime'ı değişen dosya yeniden parse edilir.
 */

import fs from "node:fs/promises";
import type * as t from "@babel/types";
import { discoverComponents, discoverSharedFiles } from "./discover.js";
import { collectExportedConstants, parseComponentSchema } from "./parseComponentSchema.js";
import type { CatalogComponent, ComponentCategory } from "../types.js";

type CacheEntry = {
    mtimeMs: number;
    component: CatalogComponent | null; // null = parse edilemedi (şema içermeyen dosya)
    error?: string;
};

export type CatalogSnapshot = {
    components: CatalogComponent[];
    byName: Map<string, CatalogComponent>;
    /** Parse edilemeyen dosyalar — list_components çıktısında uyarı olarak gösterilir */
    skipped: Array<{ filePath: string; reason: string }>;
    projectDir: string;
};

export type ComponentSummary = {
    componentName: string;
    label: string | null;
    category: ComponentCategory;
    filePath: string;
    slots: Array<{ key: string; allow?: string[] }>;
    variants?: string[];
};

export class ComponentCatalog {
    private readonly projectDir: string;
    private cache = new Map<string, CacheEntry>();
    private sharedSignature = "";
    private sharedConstants: Record<string, t.Node> = {};
    private inflight: Promise<CatalogSnapshot> | null = null;

    constructor(projectDir: string) {
        this.projectDir = projectDir;
    }

    /** Eşzamanlı tool çağrıları aynı yenilemeyi paylaşsın diye tek uçuş. */
    load(): Promise<CatalogSnapshot> {
        if (!this.inflight) {
            this.inflight = this.refresh().finally(() => {
                this.inflight = null;
            });
        }
        return this.inflight;
    }

    private async refresh(): Promise<CatalogSnapshot> {
        // 1) Paylaşılan sabitler — imza değiştiyse tüm cache geçersiz
        //    (bir sabitin değişmesi onu kullanan her bileşeni etkiler).
        const sharedFiles = await discoverSharedFiles(this.projectDir);
        const sharedStats = await Promise.all(
            sharedFiles.map(async (f) => {
                try {
                    const st = await fs.stat(f.absPath);
                    return `${f.filePath}@${st.mtimeMs}`;
                } catch {
                    return `${f.filePath}@missing`;
                }
            })
        );
        const signature = sharedStats.join("|");
        if (signature !== this.sharedSignature) {
            this.sharedSignature = signature;
            this.sharedConstants = {};
            for (const f of sharedFiles) {
                try {
                    const code = await fs.readFile(f.absPath, "utf8");
                    Object.assign(this.sharedConstants, collectExportedConstants(code));
                } catch {
                    /* paylaşılan dosya parse edilemiyorsa sessizce atla — bileşenler yine de okunur */
                }
            }
            this.cache.clear();
        }

        // 2) Bileşen dosyaları
        const discovered = await discoverComponents(this.projectDir);
        const seen = new Set<string>();
        const components: CatalogComponent[] = [];
        const skipped: Array<{ filePath: string; reason: string }> = [];

        for (const d of discovered) {
            seen.add(d.absPath);
            let mtimeMs = 0;
            try {
                mtimeMs = (await fs.stat(d.absPath)).mtimeMs;
            } catch {
                continue;
            }

            let entry = this.cache.get(d.absPath);
            if (!entry || entry.mtimeMs !== mtimeMs) {
                entry = await this.parseOne(d.absPath, d.filePath, d.category, mtimeMs);
                this.cache.set(d.absPath, entry);
            }

            if (entry.component) components.push(entry.component);
            else skipped.push({ filePath: d.filePath, reason: entry.error ?? "şema bulunamadı" });
        }

        // Silinen dosyaların cache kaydını temizle
        for (const key of [...this.cache.keys()]) {
            if (!seen.has(key)) this.cache.delete(key);
        }

        const byName = new Map<string, CatalogComponent>();
        for (const c of components) {
            /* Aynı ada sahip iki dosya (sections/Foo.tsx + elements/Foo.tsx) olursa
               ilk gelen kazanır; tema konvansiyonu adların tekil olmasıdır. */
            if (!byName.has(c.componentName)) byName.set(c.componentName, c);
            else skipped.push({ filePath: c.filePath, reason: `"${c.componentName}" adı zaten kayıtlı (çakışma)` });
        }

        return { components: [...byName.values()], byName, skipped, projectDir: this.projectDir };
    }

    private async parseOne(absPath: string, filePath: string, category: ComponentCategory, mtimeMs: number): Promise<CacheEntry> {
        try {
            const code = await fs.readFile(absPath, "utf8");
            const schema = parseComponentSchema(code, undefined, this.sharedConstants);
            if (!schema.componentName) {
                return { mtimeMs, component: null, error: "export edilen bileşen adı çözülemedi" };
            }
            return {
                mtimeMs,
                component: { ...schema, componentName: schema.componentName, category, filePath },
            };
        } catch (err: any) {
            return { mtimeMs, component: null, error: err?.message ?? String(err) };
        }
    }
}

/** list_components summary modu için hafif görünüm. */
export function summarizeComponent(c: CatalogComponent): ComponentSummary {
    const out: ComponentSummary = {
        componentName: c.componentName,
        label: c.label,
        category: c.category,
        filePath: c.filePath,
        slots: c.fields.filter((f) => f.fieldType === "slot").map((f) => ({ key: f.key, ...(f.allow ? { allow: f.allow } : {}) })),
    };
    if (c.variants) out.variants = Object.keys(c.variants);
    return out;
}
