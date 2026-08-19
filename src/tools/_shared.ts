/**
 * Tool'ların ortak parçaları: zod şemaları, sonuç/hata sarmalayıcıları, sayfa çözümü.
 *
 * Sonuç biçimi: `content[0].text` = JSON (tüm istemciler okur) + `structuredContent`
 * (yapısal çıktı destekleyen istemciler için). Hatalar `isError: true` ile düz
 * metin — ajan mesajı okuyup girdisini düzeltebilsin diye yol/alan bilgisi taşır.
 */

import * as z from "zod/v4";
import { ApiError } from "../api.js";
import { ToolError, type ServerContext } from "../context.js";
import type { Issue, PageDetail, Section } from "../types.js";

// ── Zod şemaları ─────────────────────────────────────────────────────────────

/** Yazarlık biçimi — özyinelemeli (slots → Section[]). */
export const SectionSchema: z.ZodType<Section> = z.lazy(() =>
    z.object({
        type: z.string().min(1).describe("Katalogdaki bileşen adı (list_components). Örn. FeaturesSection, Title"),
        props: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Alan değerleri. Çok dilli alanlarda "metin" ya da {tr:"…",en:"…"} kısayolu; link için "/yol"; select/radio için options\'tan bir value.'),
        variant: z.string().optional().describe("Bileşenin variants anahtarlarından biri (varsa)."),
        slots: z
            .record(z.string(), z.array(SectionSchema))
            .optional()
            .describe("Slot adı → çocuk bölümler. Verilmeyen slot bileşenin varsayılan çocuklarıyla dolar; boş bırakmak için [] verin."),
    })
) as z.ZodType<Section>;

export const DocumentSchema = z
    .object({
        root: z.object({ props: z.record(z.string(), z.unknown()) }).optional(),
        content: z.array(z.unknown()),
        zones: z.record(z.string(), z.array(z.unknown())).optional(),
    })
    .describe("Tam editör dokümanı {root, content, zones}");

export const LangShortcutSchema = z
    .union([z.string(), z.record(z.string(), z.string()), z.array(z.object({ code: z.string(), value: z.string() }))])
    .describe('Çok dilli metin: "metin" | {tr:"…",en:"…"} | [{code,value}]');

export const OperationSchema = z.discriminatedUnion("op", [
    z.object({ op: z.literal("append_section"), section: SectionSchema }),
    z.object({
        op: z.literal("insert_section"),
        section: SectionSchema,
        before: z.string().optional().describe("Bu kök bölüm id'sinin önüne"),
        after: z.string().optional().describe("Bu kök bölüm id'sinin arkasına"),
    }),
    z.object({ op: z.literal("replace_section"), id: z.string(), section: SectionSchema }),
    z.object({ op: z.literal("remove_section"), id: z.string() }),
    z.object({ op: z.literal("move_section"), id: z.string(), before: z.string().optional(), after: z.string().optional() }),
    z.object({
        op: z.literal("set_props"),
        id: z.string(),
        props: z.record(z.string(), z.unknown()).describe("Sığ birleştirme; dil/link kısayolları geçerli. Slot içeriği için set_slot kullanın."),
    }),
    z.object({ op: z.literal("set_slot"), id: z.string(), slot: z.string(), children: z.array(SectionSchema).describe("Slotun YENİ içeriği (tamamen değiştirir)") }),
    z.object({ op: z.literal("set_root_props"), props: z.record(z.string(), z.unknown()) }),
]);

export const PageRefSchema = z.string().min(1).describe("Sayfa id'si (24 hex) ya da slug'ı (örn. 'home', 'hakkimizda')");

// ── Sonuçlar ─────────────────────────────────────────────────────────────────

export type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
};

export function okResult(data: Record<string, unknown>): ToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
    };
}

export function errorResult(message: string, details?: Record<string, unknown>): ToolResult {
    const payload = details ? `${message}\n${JSON.stringify(details, null, 2)}` : message;
    return {
        isError: true,
        content: [{ type: "text", text: payload }],
        ...(details ? { structuredContent: { error: message, ...details } } : {}),
    };
}

/** Sunucu (backend) uyarılarını "sunucu: [code] path: message" biçimine çevirir. */
export function formatServerWarnings(warnings: Issue[]): string[] {
    return warnings.map((w) => `sunucu: [${w.code}]${w.path ? ` ${w.path}:` : ""} ${w.message}`);
}

/** Hata listesini ajan için okunur metne çevirir. */
export function formatIssues(issues: Issue[], max = 25): string {
    return issues
        .slice(0, max)
        .map((i) => `- [${i.code}] ${i.path}: ${i.message}`)
        .join("\n") + (issues.length > max ? `\n… ve ${issues.length - max} hata daha` : "");
}

export function validationErrorResult(title: string, errors: Issue[], warnings: Issue[] = []): ToolResult {
    return errorResult(`${title}\n${formatIssues(errors)}`, { errors, warnings });
}

/**
 * Tool gövdesini sarar: ToolError/ApiError → isError sonucu; beklenmeyen
 * hatalar da yutulmaz ama stack yerine mesaj döner (stdout'a log basılmaz).
 */
export function wrapTool<A>(ctx: ServerContext, name: string, fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
    return async (args: A) => {
        try {
            return await fn(args);
        } catch (err: any) {
            // Şifresiz TECOF_API_URL uyarısı her hata mesajına ipucu olarak eklenir (#1)
            const hint = ctx.insecureApiUrlWarning ? `\nİpucu: ${ctx.insecureApiUrlWarning}` : "";
            if (err instanceof ToolError) {
                return errorResult(err.message + hint, err.details as Record<string, unknown> | undefined);
            }
            if (err instanceof ApiError) {
                return errorResult(err.toDisplayString() + hint, err.data && typeof err.data === "object" ? { data: err.data } : undefined);
            }
            ctx.log(`${name} beklenmeyen hata: ${err?.stack ?? err}`);
            return errorResult(`${name}: beklenmeyen hata — ${err?.message ?? String(err)}${hint}`);
        }
    };
}

// ── Sayfa çözümü ─────────────────────────────────────────────────────────────

/** id ya da slug ile sayfayı getirir; tema bağlamını otomatik ekler. */
export async function fetchPage(ctx: ServerContext, pageRef: string, opts: { includePublished?: boolean } = {}): Promise<PageDetail> {
    const api = ctx.requireApi();
    const site = await ctx.requireTheme();
    return api.getPage(pageRef.trim(), { themeId: site.themeId, includePublished: opts.includePublished });
}

export function panelUrlFor(ctx: ServerContext, page: PageDetail, site: { me: { panelUrl?: string }; theme: { merchantThemeId: string } | null }): string | null {
    if (page.urls?.panel) return page.urls.panel;
    if (site.me.panelUrl && site.theme?.merchantThemeId) {
        return `${site.me.panelUrl.replace(/\/+$/, "")}/app/themes/${site.theme.merchantThemeId}/design/${page._id}`;
    }
    return null;
}

/** Önizleme URL'lerini dener; başarısızsa null + uyarı (yazma tool'ları bu yüzden çökmemeli). */
export async function tryPreviewUrls(ctx: ServerContext, pageId: string, locale?: string): Promise<{ storefrontPreview: string | null; localPreview: string | null; warning: string | null }> {
    try {
        const api = ctx.requireApi();
        const res = await api.previewUrl(pageId, { locale });
        return {
            storefrontPreview: res.storefrontUrl ?? null,
            localPreview: rewriteLocalUrl(res.localUrlTemplate, ctx.config.localUrl),
            warning: null,
        };
    } catch (err: any) {
        const msg = err instanceof ApiError ? err.toDisplayString() : String(err?.message ?? err);
        return { storefrontPreview: null, localPreview: null, warning: `Önizleme URL'si alınamadı: ${msg}` };
    }
}

/** Backend localhost:3000 şablonu verir; kullanıcı TECOF_LOCAL_URL ile farklı port kullanıyorsa değiştir. */
export function rewriteLocalUrl(template: string | null | undefined, localUrl: string): string | null {
    if (!template) return null;
    try {
        const u = new URL(template);
        const target = new URL(localUrl);
        u.protocol = target.protocol;
        u.host = target.host;
        return u.toString();
    } catch {
        return template;
    }
}
