/**
 * update_page — GET (tam) → normalize → operations uygula (ya da document ile
 * tamamen değiştir) → validate → PUT (expectedModifiedDate ile iyimser kilit).
 * 409'da ajan sayfayı yeniden okuyup işlemleri tekrar uygular; kör üzerine yazma yok.
 *
 * Hata/uyarı ayrımı (operations modu): ajanın bu turda eklediği/değiştirdiği
 * düğümler katı denetlenir; önceden var olan ve dokunulmayan düğümlerdeki
 * katalog ihlalleri (tema değişmiş olabilir) yalnız uyarıdır — aksi halde
 * ilgisiz bir değişiklik eski içerik yüzünden kaydedilemezdi.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ApiError } from "../api.js";
import type { ServerContext } from "../context.js";
import type { IssueSink } from "../document/fields.js";
import { applyOperations } from "../document/operations.js";
import { buildOutline } from "../document/outline.js";
import { emptyDocument } from "../document/tree.js";
import { normalizeDocument, validateDocument } from "../document/validate.js";
import type { Issue, TecofDocument } from "../types.js";
import {
    DocumentSchema,
    errorResult,
    fetchPage,
    formatServerWarnings,
    LangShortcutSchema,
    okResult,
    OperationSchema,
    PageRefSchema,
    panelUrlFor,
    tryPreviewUrls,
    validationErrorResult,
    wrapTool,
} from "./_shared.js";
import { normalizeMeta } from "./create_page.js";

export function registerUpdatePage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "update_page",
        {
            title: "Sayfayı güncelle (taslak)",
            description:
                "Sayfa taslağını günceller. Ya `operations` (append/insert/replace/remove/move_section, set_props, set_slot, set_root_props — id'ler get_page outline'dan; append_section ve anchor'sız insert_section yeni bölümü Footer'ın ÖNÜNE koyar) ya da `document` (tam doküman) verin; `meta` ile başlık/slug/meta alanları (yalnız meta verilirse draftData'ya dokunulmaz). Ortak bileşenler (Header/Footer) ve onların ALT düğümleri değiştirilemez. dryRun:true kaydetmez.",
            inputSchema: z.object({
                page: PageRefSchema,
                operations: z.array(OperationSchema).optional(),
                document: DocumentSchema.optional(),
                meta: z
                    .object({
                        title: z.string().optional(),
                        slug: z.string().optional(),
                        metaTitle: LangShortcutSchema.optional(),
                        metaDescription: LangShortcutSchema.optional(),
                    })
                    .optional(),
                dryRun: z.boolean().optional(),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "update_page", async ({ page, operations, document, meta, dryRun }) => {
            if (operations && document) return errorResult("operations ve document aynı anda verilemez.");
            const hasMeta = !!meta && Object.values(meta).some((v) => v !== undefined);
            if (!operations && !document && !hasMeta) return errorResult("operations, document ya da meta verin.");
            if (operations && operations.length === 0 && !document && !hasMeta) {
                return errorResult("operations boş — uygulanacak işlem yok; sayfa değiştirilmedi. En az bir operation ya da meta verin.");
            }

            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const snapshot = await ctx.catalog.load();
            const detail = await fetchPage(ctx, page);
            if (detail.isTemplate) return errorResult(`"${detail.slug}" bir şablon sayfa; API üzerinden değiştirilemez (panelden düzenleyin).`);

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
                if (result.errors.length) return validationErrorResult("Operation'lar uygulanamadı (hiçbiri kaydedilmedi):", result.errors, warnings);
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
                if (!v.ok) return validationErrorResult("Güncellenmiş doküman doğrulamadan geçmedi (kaydedilmedi):", v.errors, warnings);
            }

            const metaSink: IssueSink = { errors: [], warnings: [] };
            const metaFields = normalizeMeta(meta, site.lang, metaSink);
            warnings.push(...metaSink.warnings);
            if (metaSink.errors.length) return validationErrorResult("meta alanları geçersiz:", metaSink.errors, warnings);

            const allWarnings = warnings.map((w) => `[${w.code}] ${w.path}: ${w.message}`);
            const outlineDoc = doc ?? detail.draftData ?? emptyDocument();
            // draftData yalnız gerçekten değiştiyse gönderilir (yalnız-meta güncellemede
            // status published→changed olmasın, gereksiz revizyon açılmasın).
            const sendDraft = !!doc && (!!document || applied.length > 0);

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
