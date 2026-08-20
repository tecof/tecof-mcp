/**
 * import_image — herhangi bir yerde (agy, Magnific, ChatGPT, elle) üretilmiş bir
 * görseli URL'den mağaza kütüphanesine indirir ve editöre hazır upload objesi
 * döner. İç ağ/metadata adresleri backend'de reddedilir (SSRF).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerImportImage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "import_image",
        {
            title: "Görseli URL'den içe aktar",
            description:
                "Bir görsel URL'sini mağaza medya kütüphanesine indirir ve bir bölümün görsel alanına konabilecek upload objesi döner. Kredi düşmez.",
            inputSchema: z.object({
                url: z.string().url().describe("Herkese açık https görsel URL'si"),
                name: z.string().optional().describe("Dosya adı (opsiyonel)"),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "import_image", async ({ url, name }) => {
            const api = ctx.requireApi();
            const m = await api.importImage(url, name);
            return okResult({
                _id: m._id,
                name: m.name,
                url: m.url,
                uploadValue: [m],
                hint: "uploadValue'yu bir bölümün görsel (upload) alanına koyun.",
            });
        })
    );
}
