/**
 * list_components — tema kataloğu (diskten AST). summary: ad/label/kategori/slot
 * adları (kısa, ilk bakış için); full: fields + defaultProps + variants (bölüm
 * yazmadan önce alan adları ve seçenekleri için).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { summarizeComponent } from "../catalog/index.js";
import type { ServerContext } from "../context.js";
import type { CatalogComponent } from "../types.js";
import { errorResult, okResult, wrapTool } from "./_shared.js";

/** full görünümde defaultProps'taki inline çocuk ağaçlarını kısaltır — yoksa çıktı şişer. */
function compactDefaults(c: CatalogComponent): Record<string, unknown> | null {
    if (!c.defaultProps) return null;
    const out: Record<string, unknown> = {};
    const slotKeys = new Set(c.fields.filter((f) => f.fieldType === "slot").map((f) => f.key));
    for (const [k, v] of Object.entries(c.defaultProps)) {
        if (k === "id") continue;
        if (slotKeys.has(k) && Array.isArray(v)) {
            out[k] = v.map((child: any) => (child && typeof child === "object" && child.type ? `<${child.type}>` : "<?>"));
            continue;
        }
        out[k] = v;
    }
    return out;
}

export function registerListComponents(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "list_components",
        {
            title: "Tema bileşenlerini listele",
            description:
                "Tema reposundaki section ve element bileşenlerini diskten okur. summary: ad, label, kategori, slot adları. full: alanlar (tip, seçenekler, slot allow listesi), defaultProps, variants. Bölüm yazmadan önce full ile alan adlarını doğrulayın.",
            inputSchema: z.object({
                category: z.enum(["section", "element"]).optional().describe("Yalnız bu kategori"),
                component: z.string().optional().describe("Tek bileşen adı (büyük/küçük harf duyarsız)"),
                detail: z.enum(["summary", "full"]).optional().describe("Varsayılan: summary (component verilmişse full)"),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        wrapTool(ctx, "list_components", async ({ category, component, detail }) => {
            const snapshot = await ctx.catalog.load();
            let items = snapshot.components;
            if (category) items = items.filter((c) => c.category === category);

            if (component) {
                const needle = component.trim().toLowerCase();
                const hit = items.find((c) => c.componentName.toLowerCase() === needle);
                if (!hit) {
                    return errorResult(`"${component}" bileşeni bulunamadı.`, {
                        available: items.map((c) => c.componentName),
                        projectDir: snapshot.projectDir,
                    });
                }
                items = [hit];
            }

            const mode = detail ?? (component ? "full" : "summary");
            const warnings: string[] = [];
            if (snapshot.components.length === 0) {
                warnings.push(
                    `${snapshot.projectDir}/components/sections ve components/elements altında bileşen bulunamadı. TECOF_PROJECT_DIR tema reposunu göstermeli.`
                );
            }
            for (const s of snapshot.skipped) warnings.push(`${s.filePath}: ${s.reason}`);

            const components =
                mode === "full"
                    ? items.map((c) => ({
                        componentName: c.componentName,
                        label: c.label,
                        category: c.category,
                        filePath: c.filePath,
                        fields: c.fields,
                        defaultProps: compactDefaults(c),
                        variants: c.variants,
                        hasStyles: !!c._tecofStyles,
                    }))
                    : items.map(summarizeComponent);

            return okResult({
                projectDir: snapshot.projectDir,
                count: components.length,
                detail: mode,
                components,
                warnings,
            });
        })
    );
}
