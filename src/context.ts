/**
 * Sunucu bağlamı — konfigürasyon, API istemcisi, katalog ve /me önbelleği.
 *
 * /me çağrısı TEMBEL: sunucu başlarken backend'e gidilmez, ilk tool çağrısında
 * gidilir ve kısa süre önbellekte tutulur. Neden: MCP istemcileri sunucuyu
 * oturum başında başlatır; o anda token eksik/yanlış olsa bile `tools/list`
 * çalışmalı ki kullanıcı "sunucu kalkmıyor" yerine anlamlı bir hata görsün.
 */

import { ApiError, describeInsecureApiUrl, TecofApiClient } from "./api.js";
import { ComponentCatalog } from "./catalog/index.js";
import { describeMissingConfig, type TecofConfig } from "./config.js";
import type { LanguageContext } from "./document/fields.js";
import type { MeResponse } from "./types.js";

/** Tool'a "isError" olarak yansıtılacak, ajanın okuyup düzeltebileceği hata. */
export class ToolError extends Error {
    readonly details?: unknown;
    constructor(message: string, details?: unknown) {
        super(message);
        this.name = "ToolError";
        this.details = details;
    }
}

export type SiteContext = {
    me: MeResponse;
    /** Çözümlenen tema (TECOF_THEME_ID ya da merchant.currentThemeId) */
    theme: MeResponse["themes"][number] | null;
    themeId: string | null;
    /** Tema çözülemediyse neden (her sayfa tool'u bunu hata olarak döner) */
    themeError: string | null;
    lang: LanguageContext;
};

export type ServerContextOptions = {
    config: TecofConfig;
    fetch?: typeof fetch;
    /** ms; /me önbellek süresi (varsayılan 5 dk) */
    siteTtlMs?: number;
    log?: (message: string) => void;
};

const FALLBACK_LANG: LanguageContext = { languages: ["tr"], defaultLanguage: "tr" };

export class ServerContext {
    readonly config: TecofConfig;
    readonly api: TecofApiClient | null;
    readonly catalog: ComponentCatalog;
    readonly log: (message: string) => void;
    /** TECOF_API_URL şifresiz (http, loopback değil) ise uyarı metni; her tool hatasına ipucu olarak eklenir */
    readonly insecureApiUrlWarning: string | null;

    private readonly siteTtlMs: number;
    private siteCache: { value: SiteContext; at: number } | null = null;
    private siteFailure: { error: ToolError; at: number } | null = null;
    private siteInflight: Promise<SiteContext> | null = null;

    constructor(options: ServerContextOptions) {
        this.config = options.config;
        this.log = options.log ?? ((m) => process.stderr.write(`[tecof-mcp] ${m}\n`));
        this.siteTtlMs = options.siteTtlMs ?? 5 * 60_000;
        this.catalog = new ComponentCatalog(options.config.projectDir);
        this.insecureApiUrlWarning = describeInsecureApiUrl(options.config.apiUrl);
        this.api =
            options.config.token && options.config.apiUrl
                ? new TecofApiClient({
                    baseUrl: options.config.apiUrl,
                    token: options.config.token,
                    fetch: options.fetch as any,
                })
                : null;
    }

    /** API istemcisi yoksa (token/url eksik) net mesajla patlat. */
    requireApi(): TecofApiClient {
        if (!this.api) {
            throw new ToolError(describeMissingConfig(this.config).join(" "));
        }
        return this.api;
    }

    /** /me + tema çözümü (önbellekli). Başarısızsa ToolError. */
    site(force = false): Promise<SiteContext> {
        const now = Date.now();
        if (!force && this.siteCache && now - this.siteCache.at < this.siteTtlMs) return Promise.resolve(this.siteCache.value);
        // Art arda gelen çağrılar başarısız /me'yi 15 sn boyunca tekrar denemesin
        if (!force && this.siteFailure && now - this.siteFailure.at < 15_000) return Promise.reject(this.siteFailure.error);
        if (!this.siteInflight) {
            this.siteInflight = this.fetchSite()
                .then((value) => {
                    this.siteCache = { value, at: Date.now() };
                    this.siteFailure = null;
                    return value;
                })
                .catch((err) => {
                    const toolError = err instanceof ToolError ? err : new ToolError(err instanceof ApiError ? err.toDisplayString() : String(err?.message ?? err));
                    this.siteFailure = { error: toolError, at: Date.now() };
                    throw toolError;
                })
                .finally(() => {
                    this.siteInflight = null;
                });
        }
        return this.siteInflight;
    }

    /** Tema zorunlu tool'lar için: site + themeId; tema yoksa hata. */
    async requireTheme(): Promise<SiteContext & { themeId: string }> {
        const site = await this.site();
        if (!site.themeId || site.themeError) {
            throw new ToolError(site.themeError ?? "Tema çözülemedi.");
        }
        return { ...site, themeId: site.themeId };
    }

    /**
     * Dil bağlamı — /me alınamazsa "tr" varsayılanıyla devam (validate/list gibi
     * backend'siz çalışabilen tool'lar tamamen kilitlenmesin).
     */
    async langOrFallback(): Promise<{ lang: LanguageContext; warning: string | null }> {
        try {
            const site = await this.site();
            return { lang: site.lang, warning: null };
        } catch (err: any) {
            return {
                lang: FALLBACK_LANG,
                warning: `Mağaza dilleri alınamadı (${err?.message ?? err}); varsayılan "tr" kullanıldı.`,
            };
        }
    }

    private async fetchSite(): Promise<SiteContext> {
        const api = this.requireApi();
        const me = await api.me();

        /* /me zarfı 2xx + success:true gelse de `data` beklenen şekilde olmayabilir
           (TECOF_API_URL başka bir servise bakıyor, sürüm farkı). Burada reddetmezsek
           merchant.name gibi erişimler ileride TypeError üretir. */
        if (!me || typeof me !== "object" || !me.merchant || typeof me.merchant !== "object" || !Array.isArray(me.themes)) {
            throw new ToolError(
                `Geçersiz /me yanıtı: merchant/themes alanları yok. TECOF_API_URL (${this.config.apiUrl}) Tecof backend'ini mi gösteriyor?`
            );
        }

        const languages = Array.isArray(me.merchant?.languages) && me.merchant.languages.length ? me.merchant.languages : [me.merchant?.defaultLanguage || "tr"];
        const defaultLanguage = me.merchant?.defaultLanguage || languages[0];
        const lang: LanguageContext = { languages, defaultLanguage };

        const configured = this.config.themeId;
        const themeId = configured ?? me.merchant?.currentThemeId ?? null;
        const themes = Array.isArray(me.themes) ? me.themes : [];
        const theme = themeId ? themes.find((t) => t.themeId === themeId) ?? null : null;

        let themeError: string | null = null;
        if (!themeId) {
            themeError = "Tema belirlenemedi: TECOF_THEME_ID / NEXT_PUBLIC_THEME_ID tanımlı değil ve mağazanın aktif teması yok.";
        } else if (!theme) {
            const installed = themes.map((t) => `${t.name} (${t.themeId})`).join(", ") || "(yok)";
            themeError = `${configured ? "TECOF_THEME_ID" : "currentThemeId"}=${themeId} bu mağazaya kurulu değil. Kurulu temalar: ${installed}.`;
        }

        if (themeError) this.log(themeError);
        return { me, theme, themeId, themeError, lang };
    }
}
