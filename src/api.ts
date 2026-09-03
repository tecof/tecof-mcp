/**
 * Tecof Developer API v1 istemcisi (sözleşme §2).
 *
 * Tek sorumluluk: Bearer header'ı basmak, yanıt zarfını çözmek ve HTTP/zarf
 * hatalarını ajanın DÜZELTEBİLECEĞİ mesajlara çevirmek. 401/403/409/429 ayrımı
 * önemli: 401 "token yanlış" (kullanıcı .env'i düzeltsin), 403 "scope/plan"
 * (panelden yeni anahtar), 409 "sayfa değişti" (ajan yeniden okusun), 429
 * "yavaşla" (ajan beklesin). Hepsini tek "request failed" altında toplarsak
 * ajan körlemesine tekrar dener.
 */

import type {
    ApiEnvelope,
    CmsCollection,
    CmsItem,
    DocIssue,
    LangValue,
    MeResponse,
    PageDetail,
    PageSummary,
    PageWriteResult,
    PreviewUrlResponse,
    Product,
    ProductUpsertReport,
    TecofDocument,
    UploadObject,
} from "./types.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
    readonly status: number;
    readonly messageCode: string | null;
    readonly data: unknown;
    /** Ajanın yapması gereken bir sonraki adım — mesajın sonuna eklenir */
    readonly hint: string | null;

    constructor(args: { status: number; message: string; messageCode?: string | null; data?: unknown; hint?: string | null }) {
        super(args.message);
        this.name = "ApiError";
        this.status = args.status;
        this.messageCode = args.messageCode ?? null;
        this.data = args.data;
        this.hint = args.hint ?? null;
    }

    /** Tool sonucuna basılacak tam metin (mesaj + ipucu + kod). */
    toDisplayString(): string {
        const parts = [this.message];
        if (this.hint) parts.push(this.hint);
        const tail: string[] = [];
        if (this.status) tail.push(`HTTP ${this.status}`);
        if (this.messageCode) tail.push(`code=${this.messageCode}`);
        if (tail.length) parts.push(`[${tail.join(", ")}]`);
        return parts.join(" ");
    }
}

export type TecofApiClientOptions = {
    baseUrl: string;
    token: string;
    fetch?: FetchLike;
    /** ms; varsayılan 30 sn — backend'in doküman doğrulaması büyük sayfalarda uzayabilir */
    timeoutMs?: number;
    userAgent?: string;
};

function normalizeBaseUrl(raw: string): string {
    // Kullanıcı .env'e "https://api.tecof.com/" ya da ".../api/v1" yazmış olabilir;
    // ikisini de kabul edip tek biçime indiriyoruz.
    let base = raw.trim().replace(/\/+$/, "");
    base = base.replace(/\/api\/v1$/, "");
    return base;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * PAT şifresiz (http://) bir adrese gönderilmemeli: anahtar 1 yıla kadar geçerli
 * ve pages:write yetkili. Yerel geliştirme (loopback) istisna. Dönen metin
 * başlangıçta stderr'e, her tool hatasına ipucu olarak eklenir; istek yine de
 * atılır (kullanıcı bilinçli http kullanıyor olabilir) ama 3xx yönlendirme
 * takip edilmez — Node fetch cross-origin yönlendirmede Authorization'ı düşürür,
 * kullanıcı yanıltıcı 401 görürdü.
 */
export function describeInsecureApiUrl(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        const u = new URL(raw);
        if (u.protocol === "https:") return null;
        if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return null;
        return `TECOF_API_URL şifresiz (${u.protocol}//${u.host}) — API anahtarı düz metin gider. https:// kullanın; http→https yönlendirmesi takip EDİLMEZ (Authorization yönlendirmede düşer).`;
    } catch {
        return `TECOF_API_URL geçerli bir URL değil: ${raw}`;
    }
}

/** Hangi kaynağın ucu — ipuçları buna göre değişir. */
export type ApiDomain = "page" | "cms" | "product";

/** messageCode → insan okunur açıklama + ipucu. Bilinmeyen kodlarda generic metin. */
function explain(
    status: number,
    messageCode: string | null,
    serverMessage: string | undefined,
    data: unknown,
    /* İpuçları kaynağa göre değişir: CMS hatasında "list_pages ile doğrulayın"
       demek ajanı yanlış araca yollar. Ürün uçlarında da aynısı geçerli. */
    domain: ApiDomain = "page"
): { message: string; hint: string | null } {
    const code = messageCode ?? "";
    const isCms = domain === "cms";
    const isProduct = domain === "product";
    switch (status) {
        case 401: {
            const map: Record<string, string> = {
                "missing-auth-token": "İstekte Bearer token yok.",
                "token-invalid": "API anahtarı geçersiz.",
                "token-expired": "API anahtarının süresi dolmuş.",
                "token-revoked": "API anahtarı iptal edilmiş.",
                "no-team-access": "Anahtarın sahibi kullanıcı artık bu mağazanın ekibinde değil.",
            };
            return {
                message: map[code] ?? serverMessage ?? "Kimlik doğrulama başarısız.",
                hint: "TECOF_API_TOKEN değerini kontrol edin; gerekirse panelden (Ayarlar → API Anahtarları) yeni bir anahtar oluşturun.",
            };
        }
        case 403: {
            if (code === "insufficient-scope") {
                const required = (data as any)?.required;
                return {
                    message: `API anahtarının yetkisi yetersiz${Array.isArray(required) ? ` (gereken scope: ${required.join(", ")})` : ""}.`,
                    hint: "Panelden gereken scope'ları içeren yeni bir anahtar oluşturun.",
                };
            }
            if (code === "plan-feature-unavailable") {
                return {
                    /* Ürün uçlarında kapı İKİ katmanlı: apiAccess (tüm /api/v1)
                       ve ecommerceEnabled (yalnız ürün yazma). Hangisinin kapalı
                       olduğunu backend söylemiyor; ikisini de yazıyoruz ki
                       kullanıcı doğru yerde arasın. */
                    message: isProduct
                        ? "Mağazanın paketi API erişimini (apiAccess) ya da e-ticareti (ecommerceEnabled) kapsamıyor."
                        : "Mağazanın planı API erişimini (apiAccess) kapsamıyor.",
                    hint: "Panelden planı yükseltin ya da mağaza sahibine iletin.",
                };
            }
            if (code === "plan-quota-exceeded") {
                const max = (data as any)?.max;
                return {
                    message: `Paketin ürün limiti dolu${typeof max === "number" ? ` (${max})` : ""}.`,
                    hint: "Paketi yükseltin ya da kullanılmayan ürünleri silin; mevcut ürünlerin GÜNCELLENMESİ limitten etkilenmez.",
                };
            }
            return { message: serverMessage ?? "Bu işlem için yetki yok.", hint: null };
        }
        case 404:
            return {
                message: serverMessage ?? "Kayıt bulunamadı.",
                hint: isCms
                    ? "Koleksiyon/içerik id ya da slug'ını list_cms_collections / list_cms_items ile doğrulayın."
                    : isProduct
                        ? "Ürün id/slug/SKU'sunu list_products ile doğrulayın (slug adresten, SKU varyanttan gelir)."
                        : "Sayfa id/slug'ını list_pages ile doğrulayın.",
            };
        case 409:
            return isCms
                ? {
                    message: "İçerik siz okuduktan sonra başka biri tarafından değiştirildi (iyimser kilit).",
                    hint: "get_cms_item ile güncel hâlini alıp değişikliğinizi yeniden uygulayın.",
                }
                : {
                    message: "Sayfa siz okuduktan sonra başka biri tarafından değiştirildi (iyimser kilit).",
                    hint: "get_page ile güncel hâlini alıp değişikliğinizi yeniden uygulayın.",
                };
        case 429:
            return {
                message: "İstek sınırı aşıldı (okuma 120/dk, yazma 30/dk).",
                /* Toplu içerik üretiminde (ör. 40 blog yazısı) yazma limiti
                   yarı yolda vurur ve koleksiyon yarım kalır — ajan bunu
                   bilerek aralıklı ilerlemeli. */
                hint: isCms
                    ? "Yazma sınırı dakikada 30: toplu içerik aktarımını parçalara bölün, aralarda bekleyin; yarım kalan kayıtları list_cms_items ile doğrulayıp kaldığınız yerden sürdürün."
                    : isProduct
                        /* Ürün aktarımı en çok bu duvara toplu yüklemede
                           çarpıyor: 200'lük tek istek 1 yazma sayılır, 200 ayrı
                           istek 200. Ajanı doğru yöne itiyoruz. */
                        ? "Yazma sınırı dakikada 30: ürünleri tek tek değil, upsert_products'a tek çağrıda (≤200 kalem) verin; yarım kalan aktarımı list_products ile doğrulayıp sürdürün."
                        : "Kısa bir süre bekleyip tekrar deneyin; toplu değişiklikleri tek update_page çağrısında birleştirin.",
            };
        case 400: {
            if (code === "validation-error") {
                /* Ürün servisinin hata şekli: data.issues = [{path,message}].
                   Ajan hangi kalemin hangi alanını düzelteceğini görmeli. */
                const issues = (data as any)?.issues;
                const detail = Array.isArray(issues)
                    ? issues.slice(0, 10).map((i: any) => `${i.path ?? "?"}: ${i.message ?? i.code}`).join("; ")
                    : "";
                return { message: `Sunucu isteği reddetti${detail ? `: ${detail}` : "."}`, hint: null };
            }
            if (code === "invalid-document") {
                const errors = (data as any)?.errors;
                const detail = Array.isArray(errors)
                    ? errors.slice(0, 10).map((e: any) => `${e.path ?? "?"}: ${e.message ?? e.code}`).join("; ")
                    : "";
                return { message: `Sunucu dokümanı reddetti${detail ? `: ${detail}` : "."}`, hint: null };
            }
            if (code === "already-exists") {
                return { message: `Bu slug zaten kullanımda (${(data as any)?.slug ?? "?"}).`, hint: "Farklı bir slug verin ya da mevcut sayfayı update_page ile güncelleyin. Çakışma başka bir DİLİN adresiyle de olabilir (ör. EN slug'ı başka sayfanın TR slug'ıyla aynı)." };
            }
            if (code === "theme-not-installed") {
                return { message: "Verilen themeId bu mağazaya kurulu değil.", hint: "TECOF_THEME_ID / NEXT_PUBLIC_THEME_ID değerini get_site_context çıktısındaki themes listesiyle karşılaştırın." };
            }
            if (code === "template-pages-not-supported") {
                return { message: "Şablon sayfalar (isTemplate) API üzerinden oluşturulamaz/değiştirilemez.", hint: "Şablon sayfaları panelden düzenleyin." };
            }
            return { message: serverMessage ?? "Geçersiz istek.", hint: null };
        }
        default:
            return { message: serverMessage ?? `Sunucu hatası (${status}).`, hint: null };
    }
}

/** Yol → kaynak alanı. `explain` ipuçlarını buna göre seçer. */
function domainOf(pathname: string): ApiDomain {
    if (pathname.startsWith("/cms")) return "cms";
    if (pathname.startsWith("/products")) return "product";
    return "page";
}

/**
 * Sunucu uyarıları zarfın KÖKÜNDE gelir (`{success, data, warnings}`); eski/olası
 * `data.warnings` biçimi de yedek olarak okunur. String gelirse Issue'ya sarılır.
 */
function extractWarnings(envelope: ApiEnvelope<unknown>, data: unknown): DocIssue[] {
    const raw = (envelope.warnings ?? (data as any)?.warnings ?? []) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((w): DocIssue | null => {
            if (typeof w === "string") return { code: "server", path: "", message: w };
            if (w && typeof w === "object") {
                const o = w as Record<string, unknown>;
                return { code: String(o.code ?? "server"), path: String(o.path ?? ""), message: String(o.message ?? JSON.stringify(o)) };
            }
            return null;
        })
        .filter((w): w is DocIssue => !!w);
}

export class TecofApiClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly fetchImpl: FetchLike;
    private readonly timeoutMs: number;
    private readonly userAgent: string;

    constructor(options: TecofApiClientOptions) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.token = options.token;
        this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.userAgent = options.userAgent ?? "@tecof/mcp";
    }

    get apiBase(): string {
        return `${this.baseUrl}/api/v1`;
    }

    /**
     * Ham HTTP — zaman aşımı, yönlendirme reddi ve gövde okuması burada.
     * `request` (JSON zarfı) ve `requestText` (CSV şablonu gibi ham yanıtlar)
     * bunu paylaşır: iki ayrı kopya olsaydı zaman aşımı düzeltmeleri birinde
     * unutulurdu.
     */
    private async send(method: string, pathname: string, opts: { query?: Record<string, string | boolean | undefined>; body?: unknown; accept?: string } = {}): Promise<{ res: Response; text: string }> {
        const url = new URL(`${this.apiBase}${pathname}`);
        for (const [k, v] of Object.entries(opts.query ?? {})) {
            if (v === undefined || v === null || v === "") continue;
            url.searchParams.set(k, String(v));
        }

        /* Zaman aşımı HEM header HEM gövde okumasını kapsar: clearTimeout ancak
           res.text() bittikten sonra (finally) çağrılır; yoksa header'ı gönderip
           gövdeyi askıda bırakan bir proxy tool çağrısını süresiz kilitlerdi. */
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const timeoutError = () =>
            new ApiError({
                status: 0,
                message: `Backend ${this.timeoutMs / 1000} sn içinde yanıt vermedi (${url.origin}).`,
                hint: "TECOF_API_URL doğru mu ve sunucu ayakta mı kontrol edin.",
            });

        let res: Response;
        let text = "";
        try {
            try {
                res = await this.fetchImpl(url.toString(), {
                    method,
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        Accept: opts.accept ?? "application/json",
                        "User-Agent": this.userAgent,
                        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
                    },
                    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                    signal: controller.signal,
                    // 3xx takip edilmez: yönlendirmede Authorization düşer → yanıltıcı 401. Aşağıda açık hataya çevrilir.
                    redirect: "manual",
                });
            } catch (err: any) {
                if (err?.name === "AbortError") throw timeoutError();
                throw new ApiError({
                    status: 0,
                    message: `Backend'e ulaşılamadı (${url.origin}): ${err?.message ?? err}`,
                    hint: "TECOF_API_URL doğru mu ve sunucu ayakta mı kontrol edin.",
                });
            }

            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get("location");
                throw new ApiError({
                    status: res.status,
                    message: `Backend yönlendirme döndü (${res.status}${location ? ` → ${location}` : ""}); TECOF_API_URL şeması/host'u yanlış görünüyor.`,
                    hint: "TECOF_API_URL'yi yönlendirilen adresle (örn. https://…) değiştirin; yönlendirme takip edilmez çünkü Authorization başlığı düşer.",
                });
            }

            try {
                /* Gövde okuması da zaman aşımına tabi. Race: fetch uygulaması sinyali
                   gövdeye taşımasa bile (özel fetch/mock) abort anında döneriz. */
                const abortedPromise = new Promise<never>((_, reject) => {
                    if (controller.signal.aborted) reject(timeoutError());
                    controller.signal.addEventListener("abort", () => reject(timeoutError()), { once: true });
                });
                text = await Promise.race([res.text(), abortedPromise]);
            } catch (err: any) {
                if (err instanceof ApiError) throw err;
                if (err?.name === "AbortError" || controller.signal.aborted) throw timeoutError();
                throw new ApiError({ status: res.status, message: `Yanıt gövdesi okunamadı (${url.origin}): ${err?.message ?? err}` });
            }
        } finally {
            clearTimeout(timer);
        }

        return { res, text };
    }

    private async request<T>(method: string, pathname: string, opts: { query?: Record<string, string | boolean | undefined>; body?: unknown } = {}): Promise<{ data: T; envelope: ApiEnvelope<T> }> {
        const { res, text } = await this.send(method, pathname, opts);

        let envelope: ApiEnvelope<T> | null = null;
        if (text) {
            try {
                envelope = JSON.parse(text) as ApiEnvelope<T>;
            } catch {
                envelope = null;
            }
        }

        if (!res.ok || !envelope || envelope.success === false) {
            const status = res.status;
            const code = envelope?.messageCode ?? null;
            const { message, hint } = explain(status, code, envelope?.message, envelope?.data, domainOf(pathname));
            throw new ApiError({ status, message, messageCode: code, data: envelope?.data, hint });
        }

        return { data: envelope.data as T, envelope };
    }

    /**
     * JSON zarfı OLMAYAN uçlar (ürün içe aktarma şablonu `text/csv` döner).
     * Hata durumunda gövde yine JSON zarfı olabilir — varsa aynı `explain`
     * yolundan geçirilir ki ajan 403/429 ayrımını kaybetmesin.
     */
    private async requestText(method: string, pathname: string, opts: { query?: Record<string, string | boolean | undefined>; accept?: string } = {}): Promise<string> {
        const { res, text } = await this.send(method, pathname, { ...opts, accept: opts.accept ?? "text/csv, text/plain, application/json" });
        if (!res.ok) {
            let envelope: ApiEnvelope<unknown> | null = null;
            try { envelope = JSON.parse(text) as ApiEnvelope<unknown>; } catch { envelope = null; }
            const code = envelope?.messageCode ?? null;
            const { message, hint } = explain(res.status, code, envelope?.message, envelope?.data, domainOf(pathname));
            throw new ApiError({ status: res.status, message, messageCode: code, data: envelope?.data, hint });
        }
        return text;
    }

    // ── Uçlar ────────────────────────────────────────────────────────────────

    async me(): Promise<MeResponse> {
        return (await this.request<MeResponse>("GET", "/me")).data;
    }

    async listPages(params: { themeId?: string | null; includeTemplates?: boolean } = {}): Promise<{ items: PageSummary[]; total: number; themeId: string | null }> {
        const { data, envelope } = await this.request<PageSummary[]>("GET", "/pages", {
            query: { themeId: params.themeId ?? undefined, includeTemplates: params.includeTemplates ? "true" : undefined },
        });
        const items = Array.isArray(data) ? data : [];
        const metaThemeId = (envelope.meta as any)?.themeId ?? params.themeId ?? null;
        return { items, total: envelope.totalData ?? items.length, themeId: metaThemeId };
    }

    async getPage(idOrSlug: string, params: { themeId?: string | null; includePublished?: boolean } = {}): Promise<PageDetail> {
        return (
            await this.request<PageDetail>("GET", `/pages/${encodeURIComponent(idOrSlug)}`, {
                query: { themeId: params.themeId ?? undefined, include: params.includePublished ? "published" : undefined },
            })
        ).data;
    }

    async createPage(body: {
        themeId: string;
        slug: string;
        title: string;
        /** Dil başına adres — verilmezse backend `slug`'ı tüm açık dillere kopyalar. */
        slugs?: LangValue[];
        /** Dil başına sayfa adı — verilmezse backend `title`'ı tüm açık dillere kopyalar. */
        titles?: LangValue[];
        metaTitle?: LangValue[];
        metaDescription?: LangValue[];
        draftData?: TecofDocument;
    }): Promise<PageWriteResult> {
        const { data, envelope } = await this.request<PageDetail>("POST", "/pages", { body });
        return { page: data, warnings: extractWarnings(envelope, data) };
    }

    async updatePage(id: string, body: {
        draftData?: TecofDocument;
        title?: string;
        slug?: string;
        /** Kısmi gönderilebilir: verilmeyen dil eski adresini korur. */
        slugs?: LangValue[];
        titles?: LangValue[];
        metaTitle?: LangValue[];
        metaDescription?: LangValue[];
        expectedModifiedDate?: string | null;
    }): Promise<PageWriteResult> {
        const { data, envelope } = await this.request<PageDetail>("PUT", `/pages/${encodeURIComponent(id)}`, { body });
        return { page: data, warnings: extractWarnings(envelope, data) };
    }

    /* ─── Headless CMS ────────────────────────────────────────────────────
       Uçlar /api/v1/cms/*; scope cms:read / cms:write. `collectionRef` ve
       `itemRef` hem 24-hex id hem slug kabul eder. */

    async listCmsCollections(themeId?: string | null): Promise<{ items: CmsCollection[]; total: number }> {
        const { data, envelope } = await this.request<CmsCollection[]>("GET", "/cms/collections", { query: { themeId: themeId ?? undefined } });
        return { items: data ?? [], total: envelope.totalData ?? (data ?? []).length };
    }

    async getCmsCollection(collectionRef: string, themeId?: string | null): Promise<CmsCollection> {
        return (await this.request<CmsCollection>("GET", `/cms/collections/${encodeURIComponent(collectionRef)}`, {
            query: { themeId: themeId ?? undefined },
        })).data;
    }

    async createCmsCollection(body: {
        themeId?: string | null;
        slug: string;
        name?: LangValue[];
        description?: LangValue[];
        icon?: string;
        displayField?: string;
        fields?: unknown[];
    }): Promise<CmsCollection> {
        return (await this.request<CmsCollection>("POST", "/cms/collections", { body })).data;
    }

    async updateCmsCollection(id: string, body: {
        slug?: string;
        name?: LangValue[];
        description?: LangValue[];
        icon?: string;
        displayField?: string;
        fields?: unknown[];
        allowFieldLoss?: boolean;
    }): Promise<{ collection: CmsCollection; warnings: string[] }> {
        const { data, envelope } = await this.request<CmsCollection>("PUT", `/cms/collections/${encodeURIComponent(id)}`, { body });
        return { collection: data, warnings: ((envelope as any)?.warnings as string[]) ?? [] };
    }

    async listCmsItems(collectionRef: string, params: { themeId?: string | null; status?: string; search?: string; page?: number; limit?: number } = {}): Promise<{
        items: CmsItem[];
        total: number;
        meta: { collectionId?: string; collectionSlug?: string; displayField?: string };
    }> {
        const { data, envelope } = await this.request<CmsItem[]>("GET", `/cms/collections/${encodeURIComponent(collectionRef)}/items`, {
            query: {
                themeId: params.themeId ?? undefined,
                status: params.status,
                search: params.search,
                page: params.page ? String(params.page) : undefined,
                limit: params.limit ? String(params.limit) : undefined,
            },
        });
        return { items: data ?? [], total: envelope.totalData ?? (data ?? []).length, meta: ((envelope as any)?.meta ?? {}) };
    }

    async getCmsItem(collectionRef: string, itemRef: string, themeId?: string | null): Promise<CmsItem> {
        return (await this.request<CmsItem>("GET", `/cms/collections/${encodeURIComponent(collectionRef)}/items/${encodeURIComponent(itemRef)}`, {
            query: { themeId: themeId ?? undefined },
        })).data;
    }

    async createCmsItem(collectionRef: string, body: {
        themeId?: string | null;
        slug: string;
        data?: Record<string, unknown>;
        metaTitle?: LangValue[];
        metaDescription?: LangValue[];
    }): Promise<CmsItem> {
        return (await this.request<CmsItem>("POST", `/cms/collections/${encodeURIComponent(collectionRef)}/items`, { body })).data;
    }

    async updateCmsItem(collectionRef: string, id: string, body: {
        themeId?: string | null;
        slug?: string;
        data?: Record<string, unknown>;
        metaTitle?: LangValue[];
        metaDescription?: LangValue[];
        allowPublishedEdit?: boolean;
        expectedModifiedDate?: string | null;
    }): Promise<{ item: CmsItem; warnings: string[] }> {
        const { data, envelope } = await this.request<CmsItem>("PUT", `/cms/collections/${encodeURIComponent(collectionRef)}/items/${encodeURIComponent(id)}`, { body });
        return { item: data, warnings: ((envelope as any)?.warnings as string[]) ?? [] };
    }

    async deleteCmsItem(collectionRef: string, id: string, body: { themeId?: string | null; allowPublishedEdit?: boolean } = {}): Promise<{ _id: string; slug: string; status: string; deleted: boolean }> {
        return (await this.request<{ _id: string; slug: string; status: string; deleted: boolean }>(
            "DELETE",
            `/cms/collections/${encodeURIComponent(collectionRef)}/items/${encodeURIComponent(id)}`,
            { body }
        )).data;
    }

    async deletePage(id: string): Promise<{ _id: string; slug: string; status: string }> {
        return (await this.request<{ _id: string; slug: string; status: string }>("DELETE", `/pages/${encodeURIComponent(id)}`)).data;
    }

    async previewUrl(id: string, params: { locale?: string } = {}): Promise<PreviewUrlResponse> {
        return (
            await this.request<PreviewUrlResponse>("POST", `/pages/${encodeURIComponent(id)}/preview-url`, {
                body: params.locale ? { locale: params.locale } : {},
            })
        ).data;
    }

    // ─── Medya + AI görsel ───────────────────────────────────────────────
    async listMedia(params: { page?: number; limit?: number; search?: string } = {}): Promise<{ items: UploadObject[]; total: number }> {
        const res = await this.request<UploadObject[]>("GET", "/media", {
            query: {
                page: params.page ? String(params.page) : undefined,
                limit: params.limit ? String(params.limit) : undefined,
                search: params.search || undefined,
            },
        });
        return { items: res.data ?? [], total: res.envelope.totalData ?? (res.data?.length ?? 0) };
    }

    async importImage(url: string, name?: string): Promise<UploadObject> {
        return (await this.request<UploadObject>("POST", "/media/import-url", { body: { url, ...(name ? { name } : {}) } })).data;
    }

    async generateImage(prompt: string, orientation?: string): Promise<{ upload: UploadObject; credit: { charged: number; balance: number } | null }> {
        return (
            await this.request<{ upload: UploadObject; credit: { charged: number; balance: number } | null }>(
                "POST",
                "/ai/generate-image",
                { body: { prompt, ...(orientation ? { orientation } : {}) } }
            )
        ).data;
    }

    /* ─── Ürünler ─────────────────────────────────────────────────────────
       Uçlar /api/v1/products*; scope products:read / products:write.
       Sayfa/CMS'ten farkı: ürün TEMAYA bağlı değildir (themeId gönderilmez) ve
       yazma taslak değildir — `status:"active"` doğrudan vitrine çıkar. */

    async listProducts(params: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
        category?: string;
        brand?: string;
        tag?: string;
        updatedSince?: string;
        /** "full" → description + variants; liste varsayılanı hafiftir */
        fields?: string;
    } = {}): Promise<{ items: Product[]; total: number }> {
        const { data, envelope } = await this.request<Product[]>("GET", "/products", {
            query: {
                page: params.page ? String(params.page) : undefined,
                limit: params.limit ? String(params.limit) : undefined,
                search: params.search || undefined,
                status: params.status || undefined,
                category: params.category || undefined,
                brand: params.brand || undefined,
                tag: params.tag || undefined,
                updatedSince: params.updatedSince || undefined,
                fields: params.fields || undefined,
            },
        });
        const items = Array.isArray(data) ? data : [];
        return { items, total: envelope.totalData ?? items.length };
    }

    /** `ref` = 24-hex id, slug ya da varyant SKU'su (backend üçünü de dener). */
    async getProduct(ref: string): Promise<Product> {
        return (await this.request<Product>("GET", `/products/${encodeURIComponent(ref)}`)).data;
    }

    /**
     * Toplu upsert (≤200 kalem). Anahtar: `slug` → varyant `sku`.
     * Tek kalem için de bu uç kullanılır: `POST /products` 201/200 ayrımı
     * yapıyor ama rapor şekli tekilde farklılaşıyor; MCP tarafında TEK bir
     * rapor biçimi olması ajan için daha okunur.
     */
    async upsertProducts(items: unknown[], opts: { dryRun?: boolean } = {}): Promise<ProductUpsertReport> {
        return (
            await this.request<ProductUpsertReport>("POST", "/products/bulk", {
                body: { items, ...(opts.dryRun ? { dryRun: true } : {}) },
            })
        ).data;
    }

    /** Soft delete (deleteCode:1) + `product.deleted` webhook'u. */
    async deleteProduct(id: string): Promise<{ _id: string }> {
        return (await this.request<{ _id: string }>("DELETE", `/products/${encodeURIComponent(id)}`)).data;
    }

    /** İçe aktarma şablonu — HAM CSV (UTF-8 BOM'lu), JSON zarfı YOK. */
    async productImportTemplate(): Promise<string> {
        return this.requestText("GET", "/products/import-template");
    }
}
