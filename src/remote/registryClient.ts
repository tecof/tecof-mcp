/**
 * Tools API istemcisi (sözleşme §6.1) — backend'in araç kayıt defterine giden
 * HTTP köprüsü. İki iş yapar:
 *
 *   fetchToolCatalog()  GET  /api/v1/tools?surface=mcp[&toolsets=…]   (3 sn zaman aşımı)
 *   callTool()          POST /api/v1/tools/:name?stream=1              (SSE; JSON'a düşer)
 *
 * Her istekte `Authorization: Bearer <PAT>` ve `X-Tecof-Surface: mcp` gider:
 * surface başlığı sayesinde backend, stdio proxy'yi /mcp ile aynı onay
 * kuralına (tek geçişli PAT onayı) tabi tutar; başlıksız istek `api`
 * yüzeyi sayılırdı.
 *
 * Hata ayrımı bilinçli: zarf hataları (`{success:false, messageCode, …}`)
 * `RegistryError` olarak, ağ/zaman aşımı/yönlendirme hataları `ApiError`
 * olarak fırlatılır. İlki ajanın DÜZELTEBİLECEĞİ bir durumdur (scope, onay,
 * doğrulama) ve `_shared.errorResult` biçimine çevrilir; ikincisi kurulum
 * sorunudur ve `wrapTool` zaten ApiError'ı ipucuyla basar.
 */

import { ApiError, type FetchLike } from "../api.js";

export const REMOTE_SURFACE = "mcp";
/** Katalog isteği bütçesi — Codex sunucuyu 10 sn içinde ayakta görmek ister; 3 sn + parse rahat sığar. */
export const CATALOG_TIMEOUT_MS = 3_000;
/** Backend `timeoutMs` varsayılanıyla aynı (catalogItem → 300000) */
export const DEFAULT_TOOL_TIMEOUT_MS = 300_000;
/** Aracın kendi bütçesine eklenen pay: sunucu zaman aşımını kendisi bildirsin, biz erken kesmeyelim */
export const TOOL_GRACE_MS = 30_000;
/** Sunucu 15 sn'de bir `: keepalive` yazar; 60 sn hiç byte gelmezse bağlantı ölmüştür */
export const IDLE_TIMEOUT_MS = 60_000;

export type CatalogAnnotations = {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
};

/** `GET /api/v1/tools` liste öğesi (backend `catalogItem` / scripts/list-tools.ts ile aynı şekil) */
export type CatalogTool = {
    name: string;
    module: string;
    title: string;
    description: string;
    /** JSON Schema 2020-12 (io:"input") — `fromJsonSchema` ile SDK'ya verilir */
    inputSchema: Record<string, unknown>;
    annotations?: CatalogAnnotations;
    requires?: { scopes: string[]; feature?: string | null; productType?: string };
    confirm?: string | null;
    credit?: { operation: string; cost: number; managedByHandler: boolean } | null;
    timeoutMs?: number;
    meta?: Record<string, unknown>;
};

export type ToolCatalog = {
    instructions: string;
    version: string;
    surface: string;
    generatedAt?: string;
    tools: CatalogTool[];
};

export type NeedsConfirmation = { confirmId: string; summary: string; expiresAt: string };

/** Backend zarf hatası: `{ success:false, messageCode, message, data }` (+ SSE `error` çerçevesi). */
export class RegistryError extends Error {
    readonly status: number;
    readonly messageCode: string;
    readonly data: unknown;
    readonly needsConfirmation: NeedsConfirmation | null;

    constructor(args: { status: number; messageCode: string; message: string; data?: unknown }) {
        super(args.message);
        this.name = "RegistryError";
        this.status = args.status;
        this.messageCode = args.messageCode;
        this.data = args.data;
        const d = args.data as Record<string, unknown> | null | undefined;
        this.needsConfirmation =
            args.messageCode === "confirmation-required" && d && typeof d === "object" && typeof d.confirmId === "string"
                ? { confirmId: String(d.confirmId), summary: String(d.summary ?? ""), expiresAt: String(d.expiresAt ?? "") }
                : null;
    }
}

export type ToolProgress = { message?: string; percent?: number; [key: string]: unknown };

export type ToolCallResult = {
    status: number;
    data: unknown;
    credit?: unknown;
    warnings?: unknown[];
    /** `Idempotency-Replayed: true` ile gelen saklanmış yanıt */
    replayed: boolean;
};

export type CallToolOptions = {
    onProgress?: (progress: ToolProgress) => void;
    /** İstemci (MCP) iptali — POST kesilir; backend koşuyu iptal eder, kredi iadesi YOK (sözleşme) */
    signal?: AbortSignal;
    /** Katalogdaki `timeoutMs`; verilmezse 300 sn */
    timeoutMs?: number;
    /** Verilirse `Idempotency-Key` başlığı basılır (≤128 karakter) */
    idempotencyKey?: string;
};

export type RegistryClientOptions = {
    baseUrl: string;
    token: string;
    fetch?: FetchLike;
    /** `?toolsets=` — modül adları; null/boş = hepsi */
    toolsets?: string[] | null;
    catalogTimeoutMs?: number;
    idleTimeoutMs?: number;
    userAgent?: string;
};

/** api.ts `normalizeBaseUrl` ile aynı: sondaki `/` ve `/api/v1` kırpılır */
function normalizeBaseUrl(raw: string): string {
    return raw.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

/**
 * Artımlı SSE çözücü. Olaylar boş satırla ayrılır; `:` ile başlayan satırlar
 * yorumdur (keepalive), yalnız `data:` alanları toplanır ve JSON olarak
 * çözülür. Chunk sınırı olayın ortasına düşebilir — tampon bu yüzden var.
 */
export class SseParser {
    private buffer = "";

    /** Yeni metin ekler; tamamlanan olayların JSON yüklerini döner (çözülemeyen yük atlanır). */
    push(text: string): unknown[] {
        // CRLF → LF; chunk sınırındaki yalnız `\r` bir sonraki `\n` ile birleşsin
        if (this.buffer.endsWith("\r") && text.startsWith("\n")) this.buffer = this.buffer.slice(0, -1);
        this.buffer += text.replace(/\r\n/g, "\n");
        const out: unknown[] = [];
        let idx: number;
        while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
            const block = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 2);
            const payload = parseEventBlock(block);
            if (payload !== undefined) out.push(payload);
        }
        return out;
    }

    /** Akış kapandığında tamponda kalan (boş satırsız biten) son olay */
    flush(): unknown[] {
        const rest = this.buffer;
        this.buffer = "";
        if (!rest.trim()) return [];
        const payload = parseEventBlock(rest);
        return payload === undefined ? [] : [payload];
    }
}

function parseEventBlock(block: string): unknown | undefined {
    const data: string[] = [];
    for (const rawLine of block.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") data.push(value);
    }
    if (!data.length) return undefined;
    try {
        return JSON.parse(data.join("\n"));
    } catch {
        return undefined;
    }
}

type Envelope = {
    success?: boolean;
    message?: string;
    messageCode?: string;
    data?: unknown;
    credit?: unknown;
    warnings?: unknown[];
};

export class RegistryClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly fetchImpl: FetchLike;
    readonly toolsets: string[] | null;
    private readonly catalogTimeoutMs: number;
    private readonly idleTimeoutMs: number;
    private readonly userAgent: string;

    constructor(options: RegistryClientOptions) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.token = options.token;
        this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
        this.toolsets = options.toolsets && options.toolsets.length ? [...options.toolsets] : null;
        this.catalogTimeoutMs = options.catalogTimeoutMs ?? CATALOG_TIMEOUT_MS;
        this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
        this.userAgent = options.userAgent ?? "@tecof/mcp";
    }

    get apiBase(): string {
        return `${this.baseUrl}/api/v1`;
    }

    /** Katalog adresi (loglar için) */
    get catalogUrl(): string {
        const url = new URL(`${this.apiBase}/tools`);
        url.searchParams.set("surface", REMOTE_SURFACE);
        if (this.toolsets) url.searchParams.set("toolsets", this.toolsets.join(","));
        return url.toString();
    }

    private headers(extra: Record<string, string> = {}): Record<string, string> {
        return {
            Authorization: `Bearer ${this.token}`,
            "X-Tecof-Surface": REMOTE_SURFACE,
            "User-Agent": this.userAgent,
            ...extra,
        };
    }

    /**
     * `GET /api/v1/tools?surface=mcp`. Zarf hatası → RegistryError (401/403…),
     * ağ/zaman aşımı → ApiError. Çağıran (RemoteCatalog) ikisini de snapshot'a düşürür.
     */
    async fetchToolCatalog(): Promise<ToolCatalog> {
        const url = this.catalogUrl;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.catalogTimeoutMs);
        const timeoutError = () =>
            new ApiError({
                status: 0,
                message: `Araç kataloğu ${this.catalogTimeoutMs / 1000} sn içinde alınamadı (${new URL(url).origin}).`,
                hint: "TECOF_API_URL doğru mu ve sunucu ayakta mı kontrol edin; paket bu sırada yerleşik katalog anlık görüntüsüyle çalışır.",
            });
        try {
            let res: Response;
            try {
                res = await this.fetchImpl(url, { method: "GET", headers: this.headers({ Accept: "application/json" }), signal: controller.signal, redirect: "manual" });
            } catch (err: any) {
                if (err?.name === "AbortError" || controller.signal.aborted) throw timeoutError();
                throw new ApiError({ status: 0, message: `Araç kataloğu alınamadı (${new URL(url).origin}): ${err?.message ?? err}`, hint: "TECOF_API_URL doğru mu ve sunucu ayakta mı kontrol edin." });
            }
            this.rejectRedirect(res, url);
            const text = await readBody(res, controller.signal, timeoutError);
            const env = parseEnvelope(text);
            if (!res.ok || !env || env.success === false) {
                throw envelopeError(res.status, env, "Araç kataloğu isteği reddedildi");
            }
            const data = env.data as Partial<ToolCatalog> | null | undefined;
            /* 2xx + success:true gelse de `data.tools` dizi değilse TECOF_API_URL başka
               bir servise bakıyordur; bunu snapshot'a düşürmek yerine açık hata verelim. */
            if (!data || typeof data !== "object" || !Array.isArray(data.tools)) {
                throw new ApiError({ status: res.status, message: `Geçersiz katalog yanıtı: data.tools dizisi yok. TECOF_API_URL (${this.baseUrl}) Tecof backend'ini mi gösteriyor?` });
            }
            return {
                instructions: typeof data.instructions === "string" ? data.instructions : "",
                version: typeof data.version === "string" ? data.version : "",
                surface: typeof data.surface === "string" ? data.surface : REMOTE_SURFACE,
                generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : undefined,
                tools: data.tools.filter((t): t is CatalogTool => !!t && typeof t === "object" && typeof (t as CatalogTool).name === "string"),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * `POST /api/v1/tools/:name?stream=1`. Sunucu `text/event-stream` verirse
     * çerçeveler işlenir (`progress` → onProgress, `result` → döner, `error` →
     * RegistryError); `application/json` verirse (idempotency replay, auth
     * zinciri, rota dışı 404) düz zarf okunur.
     */
    async callTool(name: string, input: unknown, opts: CallToolOptions = {}): Promise<ToolCallResult> {
        const url = new URL(`${this.apiBase}/tools/${encodeURIComponent(name)}`);
        url.searchParams.set("stream", "1");
        const origin = url.origin;

        const controller = new AbortController();
        let abortReason: "timeout" | "idle" | "cancel" | null = null;
        const abort = (reason: "timeout" | "idle" | "cancel") => {
            if (controller.signal.aborted) return;
            abortReason = reason;
            controller.abort();
        };
        const budgetMs = (opts.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS) + TOOL_GRACE_MS;
        const deadline = setTimeout(() => abort("timeout"), budgetMs);
        const onExternalAbort = () => abort("cancel");
        if (opts.signal) {
            if (opts.signal.aborted) abort("cancel");
            else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
        }
        let idle: ReturnType<typeof setTimeout> | null = null;
        const touch = () => {
            if (idle) clearTimeout(idle);
            idle = setTimeout(() => abort("idle"), this.idleTimeoutMs);
        };
        const abortError = () => {
            if (abortReason === "cancel") return new ApiError({ status: 499, message: `${name} çağrısı istemci tarafından iptal edildi; sunucu koşuyu durdurur, düşen kredi iade edilmez.`, messageCode: "tool-aborted" });
            if (abortReason === "idle") return new ApiError({ status: 0, message: `${name}: sunucu ${this.idleTimeoutMs / 1000} sn boyunca hiç veri göndermedi; bağlantı kesildi.`, hint: "Ters proxy'de SSE tamponlaması (proxy_buffering) kapalı mı kontrol edin." });
            return new ApiError({ status: 0, message: `${name}: backend ${budgetMs / 1000} sn içinde sonuç vermedi (${origin}).`, hint: "TECOF_API_URL doğru mu ve sunucu ayakta mı kontrol edin." });
        };

        try {
            let res: Response;
            try {
                res = await this.fetchImpl(url.toString(), {
                    method: "POST",
                    headers: this.headers({
                        Accept: "text/event-stream, application/json",
                        "Content-Type": "application/json",
                        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
                    }),
                    body: JSON.stringify(input && typeof input === "object" ? input : {}),
                    signal: controller.signal,
                    // 3xx takip edilmez: yönlendirmede Authorization düşer → yanıltıcı 401 (api.ts ile aynı kural)
                    redirect: "manual",
                });
            } catch (err: any) {
                if (err?.name === "AbortError" || controller.signal.aborted) throw abortError();
                throw new ApiError({ status: 0, message: `Backend'e ulaşılamadı (${origin}): ${err?.message ?? err}`, hint: "TECOF_API_URL doğru mu ve sunucu ayakta mı kontrol edin." });
            }
            this.rejectRedirect(res, url.toString());

            const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
            const replayed = (res.headers.get("idempotency-replayed") ?? "").toLowerCase() === "true";

            if (!contentType.includes("text/event-stream")) {
                const text = await readBody(res, controller.signal, abortError);
                const env = parseEnvelope(text);
                if (!res.ok || !env || env.success === false) {
                    throw envelopeError(res.status, env, `${name} çağrısı reddedildi`);
                }
                return { status: res.status, data: env.data, credit: env.credit, warnings: Array.isArray(env.warnings) ? env.warnings : undefined, replayed };
            }

            touch();
            const body = res.body;
            if (!body) throw new ApiError({ status: res.status, message: `${name}: SSE yanıtının gövdesi yok.` });
            const reader = body.getReader();
            const decoder = new TextDecoder();
            const parser = new SseParser();
            const handle = (frame: unknown): ToolCallResult | null => {
                const f = frame as Record<string, unknown> | null;
                if (!f || typeof f !== "object") return null;
                if (f.type === "progress") {
                    const p = f.data && typeof f.data === "object" ? (f.data as ToolProgress) : {};
                    try {
                        opts.onProgress?.(p);
                    } catch {
                        /* ilerleme bilgi taşımaz; dinleyici hatası çağrıyı düşürmesin */
                    }
                    return null;
                }
                if (f.type === "result") {
                    return { status: typeof f.status === "number" ? f.status : 200, data: f.data, credit: f.credit, warnings: Array.isArray(f.warnings) ? f.warnings : undefined, replayed };
                }
                if (f.type === "error") {
                    throw new RegistryError({
                        status: typeof f.status === "number" ? f.status : 500,
                        messageCode: typeof f.messageCode === "string" ? f.messageCode : "error",
                        message: typeof f.message === "string" ? f.message : "Araç çalıştırılamadı.",
                        data: f.data,
                    });
                }
                return null;
            };

            let done = false;
            while (!done) {
                /* Tip okuyucudan türetilir: lib DOM yok, ReadableStreamReadResult global değil */
                let chunk: Awaited<ReturnType<typeof reader.read>>;
                try {
                    chunk = await reader.read();
                } catch (err: any) {
                    if (controller.signal.aborted) throw abortError();
                    throw new ApiError({ status: 0, message: `${name}: akış okunamadı (${origin}): ${err?.message ?? err}` });
                }
                done = chunk.done;
                touch();
                const text = decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
                for (const frame of parser.push(text)) {
                    const result = handle(frame);
                    if (result) {
                        void reader.cancel().catch(() => { /* sonuç alındı; kalan akış önemsiz */ });
                        return result;
                    }
                }
            }
            for (const frame of parser.flush()) {
                const result = handle(frame);
                if (result) return result;
            }
            throw new ApiError({ status: 0, message: `${name}: akış sonuç çerçevesi olmadan kapandı (${origin}).`, hint: "Sunucu süreci koşu ortasında yeniden başlamış olabilir; get_* ile durumu doğrulayıp tekrar deneyin." });
        } finally {
            clearTimeout(deadline);
            if (idle) clearTimeout(idle);
            opts.signal?.removeEventListener("abort", onExternalAbort);
        }
    }

    private rejectRedirect(res: Response, url: string): void {
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            throw new ApiError({
                status: res.status,
                message: `Backend yönlendirme döndü (${res.status}${location ? ` → ${location}` : ""}); TECOF_API_URL şeması/host'u yanlış görünüyor (${new URL(url).origin}).`,
                hint: "TECOF_API_URL'yi yönlendirilen adresle (örn. https://…) değiştirin; yönlendirme takip edilmez çünkü Authorization başlığı düşer.",
            });
        }
    }
}

/** Gövde okuması da iptal sinyaline tabi — header'ı gönderip gövdeyi askıda bırakan proxy çağrıyı kilitlemesin. */
async function readBody(res: Response, signal: AbortSignal, onAbort: () => Error): Promise<string> {
    const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(onAbort());
        signal.addEventListener("abort", () => reject(onAbort()), { once: true });
    });
    try {
        return await Promise.race([res.text(), aborted]);
    } catch (err: any) {
        if (err instanceof ApiError) throw err;
        if (err?.name === "AbortError" || signal.aborted) throw onAbort();
        throw new ApiError({ status: res.status, message: `Yanıt gövdesi okunamadı: ${err?.message ?? err}` });
    }
}

function parseEnvelope(text: string): Envelope | null {
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" ? (parsed as Envelope) : null;
    } catch {
        return null;
    }
}

/** Zarf varsa RegistryError (ajan okuyabilir), yoksa ApiError (HTML 502 gibi ham hatalar). */
function envelopeError(status: number, env: Envelope | null, fallback: string): Error {
    if (env && (typeof env.messageCode === "string" || typeof env.message === "string")) {
        return new RegistryError({
            status,
            messageCode: typeof env.messageCode === "string" && env.messageCode ? env.messageCode : `http-${status}`,
            message: typeof env.message === "string" && env.message ? env.message : fallback,
            data: env.data,
        });
    }
    return new ApiError({ status, message: `${fallback} (HTTP ${status}, JSON zarfı yok).`, hint: "TECOF_API_URL Tecof backend'ini mi gösteriyor?" });
}
