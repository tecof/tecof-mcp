/**
 * get_site_context — ajanın ilk çağrısı: mağaza, diller, tema, token kapsamı,
 * sayfa sayısı. Her şey buradan türediği için (defaultLanguage, themeId) akış
 * bununla başlar (instructions'ta da ilk adım).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerGetSiteContext(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_site_context",
        {
            title: "Site bağlamını getir",
            description:
                "Mağaza (diller, varsayılan dil), aktif tema (themeId/merchantThemeId/domain), API anahtarının kapsamı ve bitişi, sayfa sayısı. Diğer araçlardan önce çağırın.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "get_site_context", async () => {
            const site = await ctx.site();
            const api = ctx.requireApi();

            let pageCount: number | null = null;
            let pageCountError: string | null = null;
            if (site.themeId && !site.themeError) {
                try {
                    const res = await api.listPages({ themeId: site.themeId });
                    pageCount = res.total;
                } catch (err: any) {
                    pageCountError = err?.toDisplayString?.() ?? String(err?.message ?? err);
                }
            }

            const warnings: string[] = [];
            if (site.themeError) warnings.push(site.themeError);
            if (pageCountError) warnings.push(`Sayfa sayısı alınamadı: ${pageCountError}`);
            if (!ctx.config.themeId) warnings.push("TECOF_THEME_ID tanımlı değil; mağazanın aktif teması kullanılıyor.");

            return okResult({
                merchant: {
                    id: site.me.merchant._id,
                    name: site.me.merchant.name,
                    slug: site.me.merchant.slug,
                    productType: site.me.merchant.productType ?? null,
                    languages: site.lang.languages,
                    defaultLanguage: site.lang.defaultLanguage,
                },
                theme: site.theme
                    ? {
                        themeId: site.theme.themeId,
                        merchantThemeId: site.theme.merchantThemeId,
                        name: site.theme.name,
                        domain: site.theme.domain,
                        isCurrent: site.theme.isCurrent,
                    }
                    : null,
                installedThemes: site.me.themes.map((t) => ({ themeId: t.themeId, name: t.name, domain: t.domain, isCurrent: t.isCurrent })),
                token: { name: site.me.token.name, scopes: site.me.token.scopes, expiresAt: site.me.token.expiresAt },
                user: { name: `${site.me.user.name} ${site.me.user.surname}`.trim(), email: site.me.user.email },
                pageCount,
                panelUrl: site.me.panelUrl,
                projectDir: ctx.config.projectDir,
                localUrl: ctx.config.localUrl,
                warnings,
            });
        })
    );
}
