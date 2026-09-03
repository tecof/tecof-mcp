/**
 * get_product_import_template — panelin ürün içe aktarma şablonu (ham CSV).
 *
 * Uç JSON zarfı DEĞİL, `text/csv` döndürür (indirme ucu); istemci metni olduğu
 * gibi alır. Sütun başlıkları eşleme sözlüğüyle geri eşleşir: kullanıcı dosyayı
 * doldurup panelden yüklediğinde sütunlar tanınır.
 *
 * Ajanın kendi ürün yazması için bu araç GEREKMEZ — upsert_products daha
 * doğrudan ve hatasızdır. Bu araç, "bana içe aktarma şablonunu ver / hangi
 * sütunlar var?" sorusu içindir.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ServerContext } from "../context.js";
import { okResult, wrapTool } from "./_shared.js";

/**
 * Küçük RFC 4180 çözümleyici — şablonun sütun/örnek satırlarını göstermek için.
 * Tam bir CSV kütüphanesi değil; tırnak, kaçırılmış tırnak ("") ve alan içi
 * satır sonu yeterli (şablonda açıklama alanları tırnaklı gelebilir).
 */
export function parseCsvText(text: string): string[][] {
    const src = text.replace(/^﻿/, "");
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else field += ch;
            continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === ",") { row.push(field); field = ""; continue; }
        if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && src[i + 1] === "\n") i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
            continue;
        }
        field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c !== ""));
}

export function registerGetProductImportTemplate(server: McpServer, ctx: ServerContext) {
    server.registerTool(
        "get_product_import_template",
        {
            title: "Ürün içe aktarma şablonu",
            description:
                "Panelin ürün içe aktarma şablonunu (CSV) döner: sütun başlıkları + iki örnek satır (biri iki eksenli varyantlı, biri basit ürün). Kullanıcı dosyayı Excel'de doldurup panelden yükleyecekse ya da hangi sütunların desteklendiğini soruyorsa bunu kullanın; ajanın kendi ürün yazması için upsert_products daha doğrudandır.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        wrapTool(ctx, "get_product_import_template", async () => {
            const api = ctx.requireApi();
            const csv = await api.productImportTemplate();
            const rows = parseCsvText(csv);
            const columns = rows[0] ?? [];
            const sampleRows = rows.slice(1).map((r) => {
                const obj: Record<string, string> = {};
                columns.forEach((c, i) => { obj[c] = r[i] ?? ""; });
                return obj;
            });

            return okResult({
                format: "csv",
                filename: "tecof-urun-sablonu.csv",
                columnCount: columns.length,
                columns,
                sampleRows,
                csv,
                /* Uç dosyayı UTF-8 BOM ile gönderir ama fetch'in metin çözümü
                   baştaki BOM'u DÜŞÜRÜR — buradaki `csv` BOM'suzdur. Dosyaya
                   yazacak ajan Excel için başa "\uFEFF" eklemeli, yoksa Türkçe
                   karakterler bozuk açılır. */
                hint: "Doldurulmuş dosya panelden yüklenir: Ürünler → İçe aktar. Bu metin BOM'suzdur: Excel'de açılacak bir dosyaya yazacaksanız başına \"\\uFEFF\" ekleyin. Çok değerli alanlar (ek görseller, etiketler) `|` ile, kategori yolu `>` ile ayrılır.",
            });
        })
    );
}
