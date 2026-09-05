/**
 * Hibrit sayfa araçları (remote mod + yerel tema kataloğu).
 *
 * create_page / update_page'in build/validate adımı İSTEMCİDE koşar
 * (diskteki bileşen şemaları, çalışma ağacındaki hâliyle), hazır `document`
 * kayıt defterinin aynı adlı aracına gider. Backend `document` XOR `sections`
 * (create) / `document` XOR `operations` (update) kabul eder; `document`
 * verildiğinde layoutFrom uygulanmaz (Header/Footer dokümanın içindedir) ve
 * sunucu dokümanı KENDİ kataloğuna göre bir kez daha doğrular.
 *
 * Bilinçli sonuç: yerelde var olup yayındaki temada henüz bulunmayan bir
 * bileşen sunucuda `unknown-type` ile reddedilir — remote modda kayıt sunucu
 * kataloğuna bağlıdır; sadece yerel bileşenlerle çalışmak için local mod.
 *
 * Girdi şemaları yerel araçlarla BİREBİR aynı (CreatePageInputSchema /
 * UpdatePageInputSchema): ajan iki modda da aynı yazarlık biçimini kullanır.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import type { ServerContext } from "../context.js";
import { formatIssueLines, wrapTool } from "../tools/_shared.js";
import { CreatePageInputSchema, prepareCreatePage } from "../tools/create_page.js";
import { prepareUpdatePage, UpdatePageInputSchema } from "../tools/update_page.js";
import { asObject, progressForwarder, remoteErrorResult, remoteOkResult, type McpCallCtx } from "./registerRemoteTools.js";
import { RegistryError, type ToolCallResult } from "./registryClient.js";

/** Sunucu yanıtındaki `warnings` dizisinin ÖNÜNE yerel build/validate uyarılarını koyar. */
function mergeWarnings(data: Record<string, unknown>, local: string[]): Record<string, unknown> {
    const server = Array.isArray(data.warnings) ? (data.warnings as unknown[]) : [];
    return { ...data, warnings: [...local, ...server] };
}

async function runRegistry(ctx: ServerContext, name: string, input: Record<string, unknown>, mcpCtx: McpCallCtx | undefined): Promise<ToolCallResult | RegistryError> {
    const registry = ctx.requireRegistry();
    try {
        return await registry.callTool(name, input, { onProgress: progressForwarder(mcpCtx), signal: mcpCtx?.mcpReq?.signal });
    } catch (err) {
        if (err instanceof RegistryError) return err;
        throw err;
    }
}

export function registerHybridCreatePage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "create_page",
        {
            title: "Sayfa oluştur (taslak)",
            description:
                "Yazarlık biçimindeki bölümlerden yeni bir TASLAK sayfa oluşturur. Header/Footer, layoutFrom sayfasındaki ortak bileşenlerden otomatik kopyalanır (varsayılan: home) — bunları sections içinde vermeyin. Bölümler yerel tema kataloğuyla (diskten) inşa edilip doğrulanır, hazır doküman sunucuya gider; sunucu kendi kataloğuyla bir kez daha doğrular. Önce list_components (full) ile alanları doğrulayın; dryRun:true ile kaydetmeden deneyin.",
            inputSchema: CreatePageInputSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "create_page", async (args, mcpCtx: McpCallCtx) => {
            const { slug, title, dryRun } = args;
            const prep = await prepareCreatePage(ctx, args);
            if (!prep.ok) return prep.result;
            const { site, doc, layout, warnings, noteWarnings, localizedSlugs, localizedTitles, metaFields } = prep.prepared;
            const localWarnings = [...noteWarnings, ...formatIssueLines(warnings)];

            const r = await runRegistry(
                ctx,
                "create_page",
                {
                    themeId: site.themeId,
                    slug,
                    title,
                    ...(localizedSlugs ? { slugs: localizedSlugs } : {}),
                    ...(localizedTitles ? { titles: localizedTitles } : {}),
                    ...(Object.keys(metaFields).length ? { meta: metaFields } : {}),
                    document: doc,
                    ...(dryRun ? { dryRun: true } : {}),
                },
                mcpCtx
            );
            if (r instanceof RegistryError) return remoteErrorResult(r);
            const data = mergeWarnings(asObject(r.data), localWarnings);
            /* dryRun'da yerel araç Header/Footer kaynağını da söyler; sunucu `document`
               yolunda layout uygulamadığı için bunu biz ekliyoruz. */
            if (dryRun) data.layout = { header: layout.header?.node.type ?? null, footer: layout.footer?.node.type ?? null };
            return remoteOkResult({ ...r, data });
        })
    );
}

export function registerHybridUpdatePage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "update_page",
        {
            title: "Sayfayı güncelle (taslak)",
            description:
                "Sayfa taslağını günceller. Dile göre adres/ad için meta.slugs / meta.titles kullanın (kısmi gönderim eski dilleri korur). Ya `operations` (append/insert/replace/remove/move_section, set_props, set_slot, set_root_props — id'ler get_page outline'dan; append_section ve anchor'sız insert_section yeni bölümü Footer'ın ÖNÜNE koyar) ya da `document` (tam doküman) verin; `meta` ile başlık/slug/meta alanları (yalnız meta verilirse draftData'ya dokunulmaz). Operation'lar yerel tema kataloğuyla uygulanıp doğrulanır, sonuç doküman sunucuya gider. Ortak bileşenler (Header/Footer) ve onların ALT düğümleri değiştirilemez. dryRun:true kaydetmez.",
            inputSchema: UpdatePageInputSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "update_page", async (args, mcpCtx: McpCallCtx) => {
            const { meta, dryRun } = args;
            const prep = await prepareUpdatePage(ctx, args);
            if (!prep.ok) return prep.result;
            const { site, detail, doc, applied, sendDraft, warnings, localizedSlugs, localizedTitles, metaFields } = prep.prepared;
            const localWarnings = formatIssueLines(warnings);

            const metaOut: Record<string, unknown> = {
                ...(meta?.title !== undefined ? { title: meta.title } : {}),
                ...(meta?.slug !== undefined ? { slug: meta.slug } : {}),
                ...(localizedSlugs ? { slugs: localizedSlugs } : {}),
                ...(localizedTitles ? { titles: localizedTitles } : {}),
                ...metaFields,
            };

            const r = await runRegistry(
                ctx,
                "update_page",
                {
                    page: detail._id,
                    themeId: site.themeId,
                    ...(sendDraft && doc ? { document: doc } : {}),
                    ...(Object.keys(metaOut).length ? { meta: metaOut } : {}),
                    ...(dryRun ? { dryRun: true } : {}),
                    /* İyimser kilit: hedefi az önce okuduk — sunucu modifiedDate'i karşılaştırır (409 page-modified) */
                    ...(detail.modifiedDate ? { expectedModifiedDate: detail.modifiedDate } : {}),
                },
                mcpCtx
            );
            if (r instanceof RegistryError) return remoteErrorResult(r);
            /* Sunucu `document` modunda `applied` boş döner; işlemleri biz uyguladık, listeyi biz veririz. */
            const data = mergeWarnings(asObject(r.data), localWarnings);
            data.applied = applied;
            return remoteOkResult({ ...r, data });
        })
    );
}
