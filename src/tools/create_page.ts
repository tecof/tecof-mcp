/**
 * create_page — yazarlık biçiminden taslak sayfa oluşturur.
 *
 * Akış: tema/dil → layoutFrom sayfasını oku (Header/Footer ref'leri) → bölümleri
 * build et → validate → (dryRun değilse) POST → önizleme URL'leri. Sayfa
 * TASLAK doğar; yayınlamayı kullanıcı panelden yapar (publish scope'u yok).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ApiError } from "../api.js";
import type { ServerContext } from "../context.js";
import { buildDocument } from "../document/build.js";
import { normalizeLanguageValue, type IssueSink } from "../document/fields.js";
import { applyLayout, extractLayout, layoutIds, type ExtractedLayout } from "../document/layout.js";
import { buildOutline } from "../document/outline.js";
import { validateDocument } from "../document/validate.js";
import type { Issue, LangValue } from "../types.js";
import { formatServerWarnings, LangShortcutSchema, okResult, panelUrlFor, SectionSchema, tryPreviewUrls, validationErrorResult, wrapTool } from "./_shared.js";

export const MetaSchema = z
    .object({
        metaTitle: LangShortcutSchema.optional(),
        metaDescription: LangShortcutSchema.optional(),
    })
    .optional();

export function normalizeMeta(meta: { metaTitle?: unknown; metaDescription?: unknown } | undefined, lang: { languages: string[]; defaultLanguage: string }, sink: IssueSink): { metaTitle?: LangValue[]; metaDescription?: LangValue[] } {
    const out: { metaTitle?: LangValue[]; metaDescription?: LangValue[] } = {};
    if (!meta) return out;
    if (meta.metaTitle !== undefined) out.metaTitle = normalizeLanguageValue(meta.metaTitle, lang, "meta.metaTitle", sink) as LangValue[];
    if (meta.metaDescription !== undefined) out.metaDescription = normalizeLanguageValue(meta.metaDescription, lang, "meta.metaDescription", sink) as LangValue[];
    return out;
}

export function registerCreatePage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "create_page",
        {
            title: "Sayfa oluştur (taslak)",
            description:
                "Yazarlık biçimindeki bölümlerden yeni bir TASLAK sayfa oluşturur. Header/Footer, layoutFrom sayfasındaki ortak bileşenlerden otomatik kopyalanır (varsayılan: home) — bunları sections içinde vermeyin. Önce list_components (full) ile alanları doğrulayın; dryRun:true ile kaydetmeden deneyin.",
            inputSchema: z.object({
                slug: z.string().min(1).describe("URL slug'ı, örn. 'hakkimizda' (sunucu normalize eder)"),
                title: z.string().min(1).describe("Panelde görünen sayfa adı"),
                meta: MetaSchema,
                sections: z.array(SectionSchema).describe("Sayfa bölümleri (Header/Footer HARİÇ), sırayla"),
                layoutFrom: z.string().optional().describe('Header/Footer kaynağı: "home" (varsayılan), başka bir slug, ya da "none"'),
                dryRun: z.boolean().optional().describe("true: kaydetme, yalnız doğrula + outline döndür"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "create_page", async ({ slug, title, meta, sections, layoutFrom, dryRun }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const snapshot = await ctx.catalog.load();
            const warnings: Issue[] = [];
            const noteWarnings: string[] = [];

            // ── 1) Layout (Header/Footer) ─────────────────────────────────
            const layoutRef = (layoutFrom ?? "home").trim();
            let layout: ExtractedLayout = { header: null, footer: null, warnings: [] };
            if (layoutRef && layoutRef !== "none") {
                try {
                    const source = await api.getPage(layoutRef, { themeId: site.themeId });
                    if (source.draftData) {
                        layout = extractLayout(source.draftData);
                        noteWarnings.push(...layout.warnings.map((w) => `layoutFrom=${layoutRef}: ${w}`));
                    } else {
                        noteWarnings.push(`layoutFrom=${layoutRef}: sayfanın draftData'sı boş; Header/Footer kopyalanmadı.`);
                    }
                } catch (err: any) {
                    const msg = err instanceof ApiError ? err.toDisplayString() : String(err?.message ?? err);
                    noteWarnings.push(`layoutFrom=${layoutRef} okunamadı (${msg}); Header/Footer kopyalanmadı. Farklı bir slug ya da "none" verin.`);
                }
            }

            // ── 2) Build ─────────────────────────────────────────────────
            const usedIds = new Set(layoutIds(layout));
            const built = buildDocument(sections, { catalog: snapshot.byName, lang: site.lang, usedIds });
            warnings.push(...built.warnings);
            if (built.errors.length) {
                return validationErrorResult("Bölümler dönüştürülemedi; hataları düzeltip tekrar deneyin:", built.errors, warnings);
            }
            const doc = applyLayout(built.document, layout);

            // ── 3) Validate ──────────────────────────────────────────────
            const v = validateDocument(doc, { catalog: snapshot.byName, lang: site.lang, checkFields: false });
            warnings.push(...v.warnings.filter((w) => w.code !== "shared-component"));
            if (!v.ok) return validationErrorResult("Doküman doğrulamadan geçmedi:", v.errors, warnings);

            // ── 4) Meta ──────────────────────────────────────────────────
            const metaSink: IssueSink = { errors: [], warnings: [] };
            const metaFields = normalizeMeta(meta, site.lang, metaSink);
            warnings.push(...metaSink.warnings);
            if (metaSink.errors.length) return validationErrorResult("meta alanları geçersiz:", metaSink.errors, warnings);

            const outline = buildOutline(doc, snapshot.byName, site.lang);
            const allWarnings = [...noteWarnings, ...warnings.map((w) => `[${w.code}] ${w.path}: ${w.message}`)];

            if (dryRun) {
                return okResult({
                    dryRun: true,
                    slug,
                    title,
                    outline,
                    layout: { header: layout.header?.node.type ?? null, footer: layout.footer?.node.type ?? null },
                    warnings: allWarnings,
                    document: doc,
                });
            }

            // ── 5) POST ──────────────────────────────────────────────────
            const { page: created, warnings: serverWarnings } = await api.createPage({
                themeId: site.themeId,
                slug,
                title,
                ...metaFields,
                draftData: doc,
            });
            // Sunucu uyarıları (zarf kökünde): örn. master'ı silinmiş Header bağı düşürüldü
            allWarnings.push(...formatServerWarnings(serverWarnings));

            const preview = await tryPreviewUrls(ctx, created._id, site.lang.defaultLanguage);
            if (preview.warning) allWarnings.push(preview.warning);

            return okResult({
                pageId: created._id,
                slug: created.slug,
                title: created.title,
                status: created.status,
                outline: buildOutline(created.draftData ?? doc, snapshot.byName, site.lang),
                urls: {
                    panel: panelUrlFor(ctx, created, site),
                    storefrontPreview: preview.storefrontPreview,
                    localPreview: preview.localPreview,
                },
                warnings: allWarnings,
                next: "Önizlemeyi kontrol edin; yayınlamayı kullanıcı panelden yapar.",
            });
        })
    );
}
