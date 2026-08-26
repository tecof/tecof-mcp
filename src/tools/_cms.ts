/**
 * CMS araçlarının ortak parçaları.
 *
 * Ajanın en sık yaptığı hata, içerik verisini YANLIŞ BİÇİMDE yazmaktır
 * (`"baslik": "Merhaba"` yerine `[{code:"tr",value:"Merhaba"}]`, görsel alanına
 * URL string'i, referans alanına slug). Backend bunları 400 ile reddeder; bu
 * dosya iki tarafı birden kolaylaştırır:
 *  - `fieldGuide()` koleksiyon şemasını "hangi alana ne yazılır" tablosuna çevirir
 *    (get_cms_collection çıktısının kalbi),
 *  - `cmsErrorResult()` sunucunun `errors[]` ayrıntısını satır satır gösterir,
 *    böylece ajan tek turda düzeltebilir.
 */

import * as z from "zod/v4";
import { ApiError } from "../api.js";
import type { CmsCollection, CmsField } from "../types.js";
import { errorResult, type ToolResult } from "./_shared.js";

export const CollectionRefSchema = z
    .string()
    .min(1)
    .describe("Koleksiyon id'si (24 hex) ya da slug'ı (örn. 'blog', 'projeler')");

export const ItemRefSchema = z
    .string()
    .min(1)
    .describe("İçerik id'si (24 hex) ya da slug'ı");

/** Çok dilli alanlar için kısayol biçimleri — meta alanlarıyla aynı sözleşme. */
export const LangShortcut = z
    .union([z.string(), z.record(z.string(), z.string()), z.array(z.object({ code: z.string(), value: z.string() }))])
    .describe('Çok dilli metin: "metin" | {tr:"…",en:"…"} | [{code,value}]');

/** Alan tipi → `data` içinde beklenen JS biçimi (backend doğrulamasıyla birebir). */
const SHAPE_BY_TYPE: Record<string, string> = {
    "text": 'metin — "Başlık"',
    "plain-text": 'metin (HTML yok)',
    "rich-text": 'HTML metin — "<p>…</p>"',
    "video-link": 'metin (video URL\'si)',
    "link": 'metin (URL)',
    "email": "metin (e-posta)",
    "phone": "metin (telefon)",
    "color": 'metin ("#9ae600")',
    "number": "sayı (metin değil) — 42",
    "switch": "true / false",
    "date-time": 'ISO 8601 metin — "2026-08-26T10:00:00.000Z"',
    "option": "tanımlı seçeneklerden birinin value'su",
    "image": "TAM dosya objesi dizisi (1 öğe): [{_id,name,size,type,folder,meta}] — list_media/import_image çıktısındaki uploadValue",
    "multi-image": "TAM dosya objesi dizisi: [{_id,name,…}, …]",
    "file": "TAM dosya objesi dizisi",
    "reference": 'hedef içeriğin 24 haneli id\'si (slug DEĞİL)',
    "multi-reference": "id dizisi: [\"66f…\", \"66f…\"]",
    "repeater": "satır nesnesi dizisi: [{altAlanShortcode: değer, …}]",
};

export type FieldGuideRow = {
    shortcode: string;
    type: string;
    required: boolean;
    multilingual: boolean;
    expects: string;
    options?: string[];
    referenceCollectionId?: string | null;
    subFields?: FieldGuideRow[];
};

const guideRow = (field: CmsField): FieldGuideRow => {
    const base = SHAPE_BY_TYPE[field.type] ?? "değer";
    return {
        shortcode: field.shortcode,
        type: field.type,
        required: field.required === true,
        multilingual: field.isMultilingual === true,
        /* Çok dilli alanda tip ne olursa olsun sarmalayıcı biçim kazanır. */
        expects: field.isMultilingual
            ? `[{code,value}] dizisi — value: ${base}`
            : base,
        ...(field.type === "option" ? { options: (field.options || []).map((o) => o.value) } : {}),
        ...(field.referenceCollectionId ? { referenceCollectionId: String(field.referenceCollectionId) } : {}),
        ...(field.type === "repeater" && field.subFields?.length
            ? { subFields: field.subFields.map(guideRow) }
            : {}),
    };
};

/** Koleksiyonun alan şemasını ajanın doğrudan kullanabileceği tabloya çevirir. */
export const fieldGuide = (collection: CmsCollection): FieldGuideRow[] =>
    (collection.fields || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(guideRow);

/** `data` nesnesi serbest şemalıdır; doğrulama sunucuda yapılır (tek kaynak). */
export const ItemDataSchema = z
    .record(z.string(), z.unknown())
    .describe("Alan shortcode'u → değer. Beklenen biçimler için önce get_cms_collection çağırın.");

/**
 * Sunucunun ayrıntılı doğrulama hatasını (`errors[]`) okunur satırlara çevirir.
 * ApiError değilse null döner — çağıran hatayı wrapTool'a bırakır.
 */
export const cmsErrorResult = (err: unknown): ToolResult | null => {
    if (!(err instanceof ApiError)) return null;
    const data: any = err.data;
    const errors = Array.isArray(data?.errors) ? data.errors : null;

    if (errors) {
        const lines = errors.slice(0, 25).map((e: any) => `- ${e.path ?? "?"}: ${e.message ?? e.code}`);
        const more = errors.length > 25 ? `\n… ve ${errors.length - 25} hata daha` : "";
        return errorResult(`${err.message}\n${lines.join("\n")}${more}`, { messageCode: err.messageCode, errors });
    }

    /* Onay isteyen hatalar: ajan kullanıcıya sormadan bayrağı KENDİ BAŞINA
       açmasın diye mesaj olduğu gibi taşınır (backend hint'i açıklayıcıdır). */
    if (err.messageCode === "field-loss-requires-confirm" || err.messageCode === "published-item-requires-confirm") {
        return errorResult(err.toDisplayString(), { messageCode: err.messageCode, ...(data ? { detail: data } : {}) });
    }

    return null;
};
