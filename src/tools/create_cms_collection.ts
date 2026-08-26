/**
 * create_cms_collection — yeni içerik tipi (alan şeması) açar.
 *
 * Alan şeması sunucuda KATI doğrulanır: shortcode biçimi/tekilliği, tip enum'u,
 * option seçenekleri, repeater alt alanları, reference hedefi. Hata 400 +
 * errors[] olarak döner ve cmsErrorResult satır satır gösterir.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { cmsErrorResult, LangShortcut } from "./_cms.js";
import { okResult, wrapTool } from "./_shared.js";
import { normalizeLanguageValue, type IssueSink } from "../document/fields.js";
import type { LangValue } from "../types.js";

const SubFieldSchema = z.object({
    shortcode: z.string().describe("küçük harf + [a-z0-9_] (ör. baslik)"),
    type: z.string().describe("alan tipi — repeater HARİÇ (iç içe repeater yok)"),
    label: LangShortcut.optional(),
    required: z.boolean().optional(),
    isMultilingual: z.boolean().optional(),
    options: z.array(z.object({ value: z.string(), label: LangShortcut.optional() })).optional(),
    referenceCollectionId: z.string().optional(),
});

export const FieldSchema = SubFieldSchema.extend({
    subFields: z.array(SubFieldSchema).optional().describe("yalnız type:'repeater' için"),
});

/** label kısayollarını [{code,value}]'ye çevirir (alan ve alt alanlar için). */
export function normalizeFieldLabels(fields: any[] | undefined, lang: { languages: string[]; defaultLanguage: string }, sink: IssueSink): any[] {
    return (fields || []).map((field, i) => ({
        ...field,
        ...(field.label !== undefined ? { label: normalizeLanguageValue(field.label, lang, `fields[${i}].label`, sink) } : {}),
        ...(Array.isArray(field.subFields)
            ? {
                subFields: field.subFields.map((sub: any, si: number) => ({
                    ...sub,
                    ...(sub.label !== undefined
                        ? { label: normalizeLanguageValue(sub.label, lang, `fields[${i}].subFields[${si}].label`, sink) }
                        : {}),
                })),
            }
            : {}),
    }));
}

export function registerCreateCmsCollection(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "create_cms_collection",
        {
            title: "İçerik tipi oluştur",
            description:
                "Yeni bir CMS koleksiyonu (içerik tipi) açar. fields[] alan şemasıdır; tipler: text, plain-text, rich-text, image, multi-image, video-link, link, email, phone, number, date-time, switch, color, option, file, reference, multi-reference, repeater. displayField, listede etiket olarak kullanılacak alanın shortcode'udur.",
            inputSchema: z.object({
                slug: z.string().min(1).describe("URL/anahtar slug'ı — sunucu normalize eder (ör. 'blog')"),
                name: LangShortcut.optional().describe("Panelde görünen ad"),
                description: LangShortcut.optional(),
                icon: z.string().optional().describe("lucide ikon adı (varsayılan: file-text)"),
                displayField: z.string().optional().describe("Liste etiketi olacak alanın shortcode'u"),
                fields: z.array(FieldSchema).optional().describe("Alan şeması"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "create_cms_collection", async ({ slug, name, description, icon, displayField, fields }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const sink: IssueSink = { errors: [], warnings: [] };

            const body = {
                themeId: site.themeId,
                slug,
                ...(name !== undefined ? { name: normalizeLanguageValue(name, site.lang, "name", sink) as LangValue[] } : {}),
                ...(description !== undefined ? { description: normalizeLanguageValue(description, site.lang, "description", sink) as LangValue[] } : {}),
                ...(icon !== undefined ? { icon } : {}),
                ...(displayField !== undefined ? { displayField } : {}),
                ...(fields !== undefined ? { fields: normalizeFieldLabels(fields as any[], site.lang, sink) } : {}),
            };

            try {
                const created = await api.createCmsCollection(body);
                return okResult({
                    collectionId: created._id,
                    slug: created.slug,
                    displayField: created.displayField ?? null,
                    fieldCount: (created.fields || []).length,
                    next: "İçerik eklemek için: create_cms_item(collection: \"" + created.slug + "\", …)",
                });
            } catch (err) {
                const mapped = cmsErrorResult(err);
                if (mapped) return mapped;
                throw err;
            }
        })
    );
}
