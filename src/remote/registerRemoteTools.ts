/**
 * Uzak katalog → McpServer kaydı (sözleşme §6.1, backend adapters/mcp.ts'in
 * istemci tarafı ikizi).
 *
 * Her katalog aracı `fromJsonSchema(inputSchema)` ile kaydedilir; gövde
 * `RegistryClient.callTool` → `_shared.okResult` / `errorResult`. Kapsam, plan,
 * kredi ve onay kapıları BURADA tekrarlanmaz — hepsi backend koşucusundadır;
 * yetkisiz/bilinmeyen araç da listelenir, hata çağrı anında döner.
 *
 * İstisnalar (yerel tema kataloğu `components/` varsa):
 *   - list_components, validate_document → bugünkü yerel araçlar (disk AST).
 *   - create_page, update_page → hibrit: build/validate istemcide, kayıt
 *     defterine hazır `document` (pagesHybrid.ts).
 *
 * İlerleme: SSE `progress` çerçeveleri YALNIZ istek `_meta.progressToken`
 * taşıyorsa `notifications/progress` olur — token'sız progress spec dışıdır.
 */

import { fromJsonSchema, type JsonSchemaType, type McpServer } from "@modelcontextprotocol/server";
import type { ServerContext } from "../context.js";
import { errorResult, okResult, wrapTool, type ToolResult } from "../tools/_shared.js";
import { registerListComponents } from "../tools/list_components.js";
import { registerValidateDocument } from "../tools/validate_document.js";
import { registerHybridCreatePage, registerHybridUpdatePage } from "./pagesHybrid.js";
import { RegistryError, type CatalogTool, type ToolCallResult, type ToolCatalog, type ToolProgress } from "./registryClient.js";

/** SDK `ServerContext`'in kullandığımız alt kümesi (yapısal — SDK tipine bağımlılığı azaltmak için). */
export type McpCallCtx = {
    mcpReq?: {
        _meta?: Record<string, unknown> | undefined;
        signal?: AbortSignal;
        notify?: (notification: { method: string; params?: Record<string, unknown> }) => Promise<void>;
    };
};

/** Yerel katalog varken diskten çalışan araçlar */
export const LOCAL_ONLY_TOOLS = ["list_components", "validate_document"] as const;
/** Yerel katalog varken build/validate'i istemcide yapıp registry'ye `document` gönderen araçlar */
export const HYBRID_PAGE_TOOLS = ["create_page", "update_page"] as const;

/* structuredContent nesne olmak ZORUNDA; dizi/ilkel dönen bir araç `result` anahtarına sarılır. */
export function asObject(data: unknown): Record<string, unknown> {
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
    return { result: data };
}

/** Başarılı koşu → `_shared.okResult` (+ credit/warnings, backend adaptörüyle aynı yerleşim). */
export function remoteOkResult(r: Pick<ToolCallResult, "data" | "credit" | "warnings">): ToolResult {
    return okResult({
        ...asObject(r.data),
        ...(r.credit ? { credit: r.credit } : {}),
        ...(r.warnings && r.warnings.length ? { warnings: r.warnings } : {}),
    });
}

/** messageCode → ajanın atacağı sonraki adım. Backend adaptörüyle aynı ipuçları + api.ts'teki 401 açıklamaları. */
function hintFor(err: RegistryError): string {
    switch (err.messageCode) {
        case "confirmation-required":
            return err.needsConfirmation
                ? `\nOnay: kullanıcı onayladıysa AYNI girdiyle confirm:true ve confirmId:"${err.needsConfirmation.confirmId}" gönder. Özet: ${err.needsConfirmation.summary}`
                : "\nOnay: kullanıcı onayladıysa AYNI girdiyle confirm:true gönder.";
        case "confirmation-expired":
            return "\nİpucu: onay kaydı bulunamadı/eskidi — confirmId olmadan tekrar dene, yeni özet üretilecek.";
        case "insufficient-scope":
            return "\nİpucu: anahtarın scope'u yetersiz — Panel → Ayarlar → API Anahtarları'ndan gerekli scope ile yeni anahtar oluştur.";
        case "insufficient-credits":
            return "\nİpucu: kredi yetersiz — Panel → Ayarlar → Paket / Krediler.";
        case "plan-feature-unavailable":
        case "plan-module-locked":
            return "\nİpucu: mağazanın paketi bu özelliği kapsamıyor — panelden paketi yükseltin ya da mağaza sahibine iletin.";
        case "rate-limited":
            return "\nİpucu: istek sınırı aşıldı — bir dakika bekleyin; toplu işleri tek çağrıda birleştirin.";
        case "tool-not-found":
            return "\nİpucu: araç bu sunucuda yok ya da bu yüzeye kapalı — katalog eskimiş olabilir, tools/list'i yenileyin.";
        case "idempotency-in-progress":
            return "\nİpucu: aynı Idempotency-Key ile bir çalıştırma hâlâ sürüyor — birkaç saniye bekleyip tekrar deneyin.";
        case "missing-auth-token":
        case "token-invalid":
        case "token-expired":
        case "token-revoked":
        case "no-team-access":
            return "\nİpucu: TECOF_API_TOKEN değerini kontrol edin; gerekirse panelden (Ayarlar → API Anahtarları) yeni bir anahtar oluşturun.";
        default:
            return "";
    }
}

/**
 * Zarf hatası → `_shared.errorResult`. `structuredContent.error = messageCode`
 * (backend adaptörüyle aynı), metin `"<messageCode>: <mesaj>" + ipucu`.
 */
export function remoteErrorResult(err: RegistryError): ToolResult {
    const details = err.data && typeof err.data === "object" && !Array.isArray(err.data) ? (err.data as Record<string, unknown>) : {};
    return errorResult(`${err.messageCode}: ${err.message}${hintFor(err)}`, {
        error: err.messageCode,
        message: err.message,
        status: err.status,
        ...details,
        ...(err.needsConfirmation ? { needsConfirmation: true, ...err.needsConfirmation } : {}),
    });
}

/**
 * `progress` köprüsü: yalnız istemci `progressToken` verdiyse. Bildirim hataları
 * yutulur — ilerleme hiçbir zaman yük taşıyan bilgi değildir.
 */
export function progressForwarder(mcpCtx: McpCallCtx | undefined): ((p: ToolProgress) => void) | undefined {
    const token = mcpCtx?.mcpReq?._meta?.progressToken as string | number | undefined;
    const notify = mcpCtx?.mcpReq?.notify;
    if (token === undefined || token === null || typeof notify !== "function") return undefined;
    return (p) => {
        const percent = typeof p.percent === "number" ? p.percent : undefined;
        void notify({
            method: "notifications/progress",
            params: {
                progressToken: token,
                progress: percent ?? 0,
                ...(percent !== undefined ? { total: 100 } : {}),
                ...(p.message !== undefined ? { message: String(p.message) } : {}),
            },
        }).catch(() => { /* ilerleme yük taşımaz */ });
    };
}

/** Tek katalog aracını proxy olarak kaydeder; şema çevrilemezse atlar (false). */
export function registerProxyTool(server: McpServer, ctx: ServerContext, tool: CatalogTool): boolean {
    let inputSchema;
    try {
        /* SDK v2 `fromJsonSchema` JSON Schema tipini (JSONSchema.Interface) ister;
           katalogtan gelen düz nesne için açık cast şart (TS2345). */
        inputSchema = fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType);
    } catch (err: any) {
        ctx.log(`UYARI: ${tool.name} inputSchema çevrilemedi (${err?.message ?? err}); araç listelenmedi.`);
        return false;
    }
    const meta: Record<string, unknown> = {
        ...(tool.confirm ? { "anthropic/requiresUserInteraction": true } : {}),
        ...(tool.meta ?? {}),
    };
    server.registerTool(
        tool.name,
        {
            title: tool.title,
            description: tool.description,
            inputSchema,
            annotations: tool.annotations,
            ...(Object.keys(meta).length ? { _meta: meta } : {}),
        },
        wrapTool(ctx, tool.name, async (args: Record<string, unknown>, mcpCtx: McpCallCtx) => {
            const registry = ctx.requireRegistry();
            try {
                const r = await registry.callTool(tool.name, args ?? {}, {
                    onProgress: progressForwarder(mcpCtx),
                    signal: mcpCtx?.mcpReq?.signal,
                    timeoutMs: tool.timeoutMs,
                });
                return remoteOkResult(r);
            } catch (err) {
                if (err instanceof RegistryError) return remoteErrorResult(err);
                throw err;
            }
        })
    );
    return true;
}

export type RemoteRegistration = {
    /** Sunucuya kayıtlı araç adları (yerel + proxy) */
    registered: Set<string>;
    /** Kayıtlı olmayanları ekler; eklenen adları döner (arka plan katalog yenilemesi için) */
    add(tools: CatalogTool[]): string[];
};

/**
 * Kataloğu sunucuya yazar. `localCatalog` true ise (tema reposunda `components/`
 * var) dört sayfa aracı yerel/hibrit olarak kaydedilir ve katalogtaki aynı
 * adlı tanımlar atlanır — yerel tanım her zaman öncelikli: ajan, diskteki
 * (çalışma ağacındaki) bileşen şemasıyla yazar.
 */
export function registerRemoteTools(server: McpServer, ctx: ServerContext, catalog: ToolCatalog, opts: { localCatalog: boolean }): RemoteRegistration {
    const registered = new Set<string>();

    if (opts.localCatalog) {
        registerListComponents(server, ctx);
        registerValidateDocument(server, ctx);
        registerHybridCreatePage(server, ctx);
        registerHybridUpdatePage(server, ctx);
        for (const name of [...LOCAL_ONLY_TOOLS, ...HYBRID_PAGE_TOOLS]) registered.add(name);
    }

    const add = (tools: CatalogTool[]): string[] => {
        const added: string[] = [];
        for (const tool of tools) {
            if (registered.has(tool.name)) continue;
            if (!registerProxyTool(server, ctx, tool)) continue;
            registered.add(tool.name);
            added.push(tool.name);
        }
        return added;
    };

    add(catalog.tools);
    return { registered, add };
}
