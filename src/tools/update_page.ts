/**
 * update_page — GET (tam) → normalize → operations uygula (ya da document ile
 * tamamen değiştir) → validate → PUT (expectedModifiedDate ile iyimser kilit).
 * 409'da ajan sayfayı yeniden okuyup işlemleri tekrar uygular; kör üzerine yazma yok.
 *
 * Hata/uyarı ayrımı (operations modu): ajanın bu turda eklediği/değiştirdiği
 * düğümler katı denetlenir; önceden var olan ve dokunulmayan düğümlerdeki
 * katalog ihlalleri (tema değişmiş olabilir) yalnız uyarıdır — aksi halde
 * ilgisiz bir değişiklik eski içerik yüzünden kaydedilemezdi.
 *
 * Hazırlık adımı (`prepareUpdatePage`) ayrı export edilir: remote modda aynı
 * GET/normalize/apply/validate istemcide koşar, sonuç doküman kayıt defterinin
 * `update_page` aracına gider (src/remote/pagesHybrid.ts).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ApiError } from "../api.js";
import type { CatalogSnapshot } from "../catalog/index.js";
import type { ServerContext, SiteContext } from "../context.js";
import { normalizeLanguageValue, type IssueSink } from "../document/fields.js";
import { applyOperations } from "../document/operations.js";
import { buildOutline } from "../document/outline.js";
import { emptyDocument } from "../document/tree.js";
import { normalizeDocument, validateDocument } from "../document/validate.js";
import type { Issue, LangValue, PageDetail, TecofDocument } from "../types.js";
import {
    DocumentSchema,
    errorResult,
    fetchPage,
    formatIssueLines,
    formatServerWarnings,
    LangShortcutSchema,
    okResult,
    OperationSchema,
    PageRefSchema,
    panelUrlFor,
    tryPreviewUrls,
    validationErrorResult,
    wrapTool,
    type ToolResult,
} from "./_shared.js";
import { normalizeMeta } from "./create_page.js";

/** update_page girdisi — yerel ve hibrit (remote) araç aynı şemayı yayınlar. */
export const UpdatePageInputSchema = z.object({
    page: PageRefSchema,
    operations: z.array(OperationSchema).optional(),
    document: DocumentSchema.optional(),
    meta: z
        .object({
            title: z.string().optional(),
            slug: z.string().optional(),
            /* Kısmi gönderilebilir: yalnız {en:"about"} verirseniz
               TR adresi olduğu gibi kalır (backend eskisini korur). */
            slugs: LangShortcutSchema.optional(),
            titles: LangShortcutSchema.optional(),
            metaTitle: LangShortcutSchema.optional(),
            metaDescription: LangShortcutSchema.optional(),
        })
        .optional(),
    dryRun: z.boolean().optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;

export type PreparedUpdatePage = {
    site: SiteContext & { themeId: string };
    snapshot: CatalogSnapshot;
    detail: PageDetail;
    /** Operations uygulanmış ya da verilen doküman; yalnız-meta güncellemede null */
    doc: TecofDocument | null;
    applied: string[];
    /** draftData gerçekten değişti mi (yalnız-meta güncellemede false) */
    sendDraft: boolean;
    /** Outline için kullanılacak doküman (doc ∨ mevcut taslak ∨ boş) */
    outlineDoc: TecofDocument;
    warnings: Issue[];
    localizedSlugs?: LangValue[];
    localizedTitles?: LangValue[];
    metaFields: { metaTitle?: LangValue[]; metaDescription?: LangValue[] };
};

/**
 * GET → normalize → operations/document → validate → meta normalizasyonu. KAYDETMEZ.
 * Hata → hazır ToolResult (isError); çağıran onu olduğu gibi döndürür.
 */
export async function prepareUpdatePage(ctx: ServerContext, args: Omit<UpdatePageInput, "dryRun">): Promise<{ ok: true; prepared: PreparedUpdatePage } | { ok: false; result: ToolResult }> {
    const { page, operations, document, meta } = args;
    if (operations && document) return { ok: false, result: errorResult("operations ve document aynı anda verilemez.") };
    const hasMeta = !!meta && Object.values(meta).some((v) => v !== undefined);
    if (!operations && !document && !hasMeta) return { ok: false, result: errorResult("operations, document ya da meta verin.") };
    if (operations && operations.length === 0 && !document && !hasMeta) {
        return { ok: false, result: errorResult("operations boş — uygulanacak işlem yok; sayfa değiştirilmedi. En az bir operation ya da meta verin.") };
    }

    ctx.requireApi();
    const site = await ctx.requireTheme();
    const snapshot = await ctx.catalog.load();
    const detail = await fetchPage(ctx, page);
    if (detail.isTemplate) return { ok: false, result: errorResult(`"${detail.slug}" bir şablon sayfa; API üzerinden değiştirilemez (panelden düzenleyin).`) };

    const warnings: Issue[] = [];
    let doc: TecofDocument | null = null;
    let applied: string[] = [];
    let touchedIds = new Set<string>();
    let strict = true;

    if (operations && operations.length > 0) {
        // GET'ten gelen doküman önce normalize edilir (props'ta kalmış inline slot
        // dizileri → zones, ölü SharedComponentRef'ler düşer) — backend'in PUT'ta
        // yaptığıyla aynı; eski bir sayfa bu yüzden kilitlenmesin.
        const normalized = normalizeDocument(detail.draftData ?? emptyDocument());
        warnings.push(...normalized.warnings);
        const result = applyOperations(normalized.document, operations, { catalog: snapshot.byName, lang: site.lang });
        warnings.push(...result.warnings);
        if (result.errors.length) return { ok: false, result: validationErrorResult("Operation'lar uygulanamadı (hiçbiri kaydedilmedi):", result.errors, warnings) };
        doc = result.document;
        applied = result.applied;
        touchedIds = result.touchedIds;
        strict = false;
    } else if (document) {
        const normalized = normalizeDocument(document as unknown as TecofDocument);
        warnings.push(...normalized.warnings);
        doc = normalized.document;
        strict = true;
    }

    if (doc) {
        const v = validateDocument(doc, { catalog: snapshot.byName, lang: site.lang, checkFields: !!document, strict, strictIds: touchedIds });
        warnings.push(...v.warnings.filter((w) => w.code !== "shared-component"));
        if (!v.ok) return { ok: false, result: validationErrorResult("Güncellenmiş doküman doğrulamadan geçmedi (kaydedilmedi):", v.errors, warnings) };
    }

    const metaSink: IssueSink = { errors: [], warnings: [] };
    const metaFields = normalizeMeta(meta, site.lang, metaSink);
    /* slugs/titles meta alanlarıyla aynı kısayol biçimlerini kabul eder
       ("metin" | {tr,en} | [{code,value}]); backend kısmi gönderimde
       verilmeyen dilin eski değerini korur. */
    const localizedSlugs = meta?.slugs !== undefined
        ? (normalizeLanguageValue(meta.slugs, site.lang, "meta.slugs", metaSink) as LangValue[])
        : undefined;
    const localizedTitles = meta?.titles !== undefined
        ? (normalizeLanguageValue(meta.titles, site.lang, "meta.titles", metaSink) as LangValue[])
        : undefined;
    warnings.push(...metaSink.warnings);
    if (metaSink.errors.length) return { ok: false, result: validationErrorResult("meta alanları geçersiz:", metaSink.errors, warnings) };

    const outlineDoc = doc ?? detail.draftData ?? emptyDocument();
    // draftData yalnız gerçekten değiştiyse gönderilir (yalnız-meta güncellemede
    // status published→changed olmasın, gereksiz revizyon açılmasın).
    const sendDraft = !!doc && (!!document || applied.length > 0);

    return { ok: true, prepared: { site, snapshot, detail, doc, applied, sendDraft, outlineDoc, warnings, localizedSlugs, localizedTitles, metaFields } };
}

export function registerUpdatePage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "update_page",
        {
            title: "Sayfayı güncelle (taslak)",
            description:
                "Sayfa taslağını günceller. Dile göre adres/ad için meta.slugs / meta.titles kullanın (kısmi gönderim eski dilleri korur). Ya `operations` (append/insert/replace/remove/move_section, set_props, set_slot, set_root_props — id'ler get_page outline'dan; append_section ve anchor'sız insert_section yeni bölümü Footer'ın ÖNÜNE koyar) ya da `document` (tam doküman) verin; `meta` ile başlık/slug/meta alanları (yalnız meta verilirse draftData'ya dokunulmaz). Ortak bileşenler (Header/Footer) ve onların ALT düğümleri değiştirilemez. dryRun:true kaydetmez.",
            inputSchema: UpdatePageInputSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "update_page", async (args) => {
            const { meta, dryRun } = args;
            const prep = await prepareUpdatePage(ctx, args);
            if (!prep.ok) return prep.result;
            const { site, snapshot, detail, doc, applied, sendDraft, outlineDoc, warnings, localizedSlugs, localizedTitles, metaFields } = prep.prepared;
            const api = ctx.requireApi();
            const allWarnings = formatIssueLines(warnings);

            if (dryRun) {
                return okResult({
                    dryRun: true,
                    pageId: detail._id,
                    slug: detail.slug,
                    applied,
                    wouldSaveDraft: sendDraft,
                    outline: buildOutline(outlineDoc, snapshot.byName, site.lang),
                    warnings: allWarnings,
                });
            }

            let updated;
            let serverWarnings: Issue[] = [];
            try {
                const res = await api.updatePage(detail._id, {
                    ...(sendDraft && doc ? { draftData: doc } : {}),
                    ...(meta?.title !== undefined ? { title: meta.title } : {}),
                    ...(meta?.slug !== undefined ? { slug: meta.slug } : {}),
                    ...(localizedSlugs ? { slugs: localizedSlugs } : {}),
                    ...(localizedTitles ? { titles: localizedTitles } : {}),
                    ...metaFields,
                    expectedModifiedDate: detail.modifiedDate ?? undefined,
                });
                updated = res.page;
                serverWarnings = res.warnings;
            } catch (err) {
                if (err instanceof ApiError && err.status === 409) {
                    return errorResult(
                        `Sayfa "${detail.slug}" siz okuduktan sonra değişti (sunucu modifiedDate: ${(err.data as any)?.modifiedDate ?? "?"}). get_page ile güncel hâli alıp operation'ları tekrar uygulayın; hiçbir şey kaydedilmedi.`,
                        { code: "page-modified" }
                    );
                }
                throw err;
            }
            allWarnings.push(...formatServerWarnings(serverWarnings));

            const preview = await tryPreviewUrls(ctx, updated._id, site.lang.defaultLanguage);
            if (preview.warning) allWarnings.push(preview.warning);

            return okResult({
                pageId: updated._id,
                slug: updated.slug,
                title: updated.title,
                ...(updated.slugs?.length ? { slugs: updated.slugs, slugAlternates: updated.slugAlternates ?? {} } : {}),
                status: updated.status,
                modifiedDate: updated.modifiedDate ?? null,
                applied,
                savedDraft: sendDraft,
                outline: buildOutline(updated.draftData ?? outlineDoc, snapshot.byName, site.lang),
                urls: {
                    panel: panelUrlFor(ctx, updated, site),
                    storefrontPreview: preview.storefrontPreview,
                    localPreview: preview.localPreview,
                },
                warnings: allWarnings,
                next: "Değişiklik taslakta; yayınlamayı kullanıcı panelden yapar.",
            });
        })
    );
}
