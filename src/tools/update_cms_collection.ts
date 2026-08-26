/**
 * update_cms_collection — içerik tipinin şemasını/etiketlerini günceller.
 *
 * `fields` GÖNDERİLİRSE tamamen değiştirilir (merge yok) — önce
 * get_cms_collection ile okuyup üzerine ekleyin. Veri taşıyan bir alan
 * silinir ya da tipi değişirse sunucu 400 field-loss-requires-confirm döner;
 * ajan bunu KULLANICIYA sormadan allowFieldLoss ile geçmemelidir.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { normalizeLanguageValue, type IssueSink } from "../document/fields.js";
import type { LangValue } from "../types.js";
import { cmsErrorResult, CollectionRefSchema, LangShortcut } from "./_cms.js";
import { FieldSchema, normalizeFieldLabels } from "./create_cms_collection.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerUpdateCmsCollection(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "update_cms_collection",
        {
            title: "İçerik tipini güncelle",
            description:
                "Koleksiyonun adını/slug'ını/ikonunu/displayField'ini ve ALAN ŞEMASINI günceller. fields verilirse şema tamamen değişir (merge yok) — önce get_cms_collection ile okuyun. Veri taşıyan alanı silmek/tipini değiştirmek allowFieldLoss:true ister; bunu yalnız kullanıcı onayladıysa gönderin.",
            inputSchema: z.object({
                collection: CollectionRefSchema.describe("Güncellenecek koleksiyonun id'si (slug da kabul edilir)"),
                slug: z.string().optional(),
                name: LangShortcut.optional(),
                description: LangShortcut.optional(),
                icon: z.string().optional(),
                displayField: z.string().optional(),
                fields: z.array(FieldSchema).optional(),
                allowFieldLoss: z.boolean().optional().describe("Kullanıcı, veri kaybını açıkça onayladı"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "update_cms_collection", async ({ collection, slug, name, description, icon, displayField, fields, allowFieldLoss }) => {
            const api = ctx.requireApi();
            const site = await ctx.requireTheme();
            const sink: IssueSink = { errors: [], warnings: [] };

            /* Slug ile çağrılabilsin diye önce id'ye çözülür (PUT id ister). */
            const target = await api.getCmsCollection(collection, site.themeId);

            const body = {
                themeId: site.themeId,
                ...(slug !== undefined ? { slug } : {}),
                ...(name !== undefined ? { name: normalizeLanguageValue(name, site.lang, "name", sink) as LangValue[] } : {}),
                ...(description !== undefined ? { description: normalizeLanguageValue(description, site.lang, "description", sink) as LangValue[] } : {}),
                ...(icon !== undefined ? { icon } : {}),
                ...(displayField !== undefined ? { displayField } : {}),
                ...(fields !== undefined ? { fields: normalizeFieldLabels(fields as any[], site.lang, sink) } : {}),
                ...(allowFieldLoss === true ? { allowFieldLoss: true } : {}),
            };

            try {
                const { collection: updated, warnings } = await api.updateCmsCollection(target._id, body);
                return okResult({
                    collectionId: updated._id,
                    slug: updated.slug,
                    displayField: updated.displayField ?? null,
                    fieldCount: (updated.fields || []).length,
                    warnings,
                });
            } catch (err) {
                const mapped = cmsErrorResult(err);
                if (mapped) return mapped;
                throw err;
            }
        })
    );
}
