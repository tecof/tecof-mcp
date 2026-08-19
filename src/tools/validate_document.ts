/**
 * validate_document — kaydetmeden doğrulama. İki giriş biçimi:
 *   { sections } → yazarlık biçimi build edilir + doğrulanır (normalizedDocument = üretilen doküman)
 *   { document } → tam doküman normalize edilir (inline slot → zones) + doğrulanır
 *
 * Backend'e gitmez; yalnız /me (diller) için bağlantı denenir, olmazsa "tr" ile devam.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { buildDocument } from "../document/build.js";
import { buildOutline } from "../document/outline.js";
import { normalizeDocument, validateDocument } from "../document/validate.js";
import type { Issue, TecofDocument } from "../types.js";
import { DocumentSchema, errorResult, okResult, SectionSchema, wrapTool } from "./_shared.js";

export function registerValidateDocument(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "validate_document",
        {
            title: "Dokümanı doğrula",
            description:
                "Kaydetmeden doğrular. Ya `sections` (yazarlık biçimi: type/props/variant/slots) ya da `document` (tam {root,content,zones}) verin. Hatalar yol + açıklama ile döner; ok=true ise normalizedDocument kaydedilebilir haldedir.",
            inputSchema: z.object({
                sections: z.array(SectionSchema).optional(),
                document: DocumentSchema.optional(),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        wrapTool(ctx, "validate_document", async ({ sections, document }) => {
            if (!sections && !document) return errorResult("sections ya da document verin.");
            if (sections && document) return errorResult("sections ve document aynı anda verilemez.");

            const snapshot = await ctx.catalog.load();
            const { lang, warning: langWarning } = await ctx.langOrFallback();
            const warnings: Issue[] = [];
            if (langWarning) warnings.push({ code: "context", path: "", message: langWarning });

            let doc: TecofDocument;
            let errors: Issue[] = [];

            if (sections) {
                const built = buildDocument(sections, { catalog: snapshot.byName, lang, usedIds: new Set() });
                doc = built.document;
                errors.push(...built.errors);
                warnings.push(...built.warnings);
                const v = validateDocument(doc, { catalog: snapshot.byName, lang, checkFields: false });
                errors.push(...v.errors);
                warnings.push(...v.warnings);
            } else {
                const normalized = normalizeDocument(document as unknown as TecofDocument);
                doc = normalized.document;
                warnings.push(...normalized.warnings);
                const v = validateDocument(doc, { catalog: snapshot.byName, lang, checkFields: true });
                errors.push(...v.errors);
                warnings.push(...v.warnings);
            }

            const ok = errors.length === 0;
            return okResult({
                ok,
                errors,
                warnings,
                outline: ok ? buildOutline(doc, snapshot.byName, lang) : undefined,
                normalizedDocument: ok ? doc : undefined,
            });
        })
    );
}
