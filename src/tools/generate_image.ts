/**
 * generate_image — AI ile görsel üretir ve editöre hazır upload objesi döner.
 * Maliyet MAĞAZANIN kredisinden düşer (üretim başarısızsa iade edilir).
 * Kredi yetersizse net bir hata döner; ajan körlemesine tekrar denememeli.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

export function registerGenerateImage(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "generate_image",
        {
            title: "AI görsel üret",
            description:
                "Verilen açıklamadan AI görsel üretir; sonuç bir bölümün görsel alanına konabilir. Maliyet mağaza kredisinden düşer (başarısızsa iade). Kredi yetersizse hata döner — tekrar denemeyin.",
            inputSchema: z.object({
                prompt: z.string().min(1).max(1500).describe("Görsel açıklaması (İngilizce daha iyi sonuç verir)"),
                orientation: z.enum(["landscape", "portrait", "square", "panoramic"]).optional(),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        wrapTool(ctx, "generate_image", async ({ prompt, orientation }) => {
            const api = ctx.requireApi();
            const res = await api.generateImage(prompt, orientation);
            return okResult({
                _id: res.upload._id,
                name: res.upload.name,
                url: res.upload.url,
                uploadValue: [res.upload],
                credit: res.credit,
                hint: "uploadValue'yu bir bölümün görsel (upload) alanına koyun.",
            });
        })
    );
}
