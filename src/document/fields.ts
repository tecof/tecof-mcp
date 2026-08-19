/**
 * Alan değeri normalizasyonu — ajanın verdiği kısayolları editörün beklediği
 * biçime çevirir (sözleşme §3.3 dönüşüm kuralı 4).
 *
 *   language/editor : "Merhaba"            → [{code:"tr", value:"Merhaba"}]
 *                     {tr:"…", en:"…"}     → [{code:"tr",…},{code:"en",…}]
 *   link            : "/iletisim"          → [{code:"tr", value:{url:"/iletisim", target:"_self"}}]
 *                     {url, target?}       → [{code:"tr", value:{url, target}}]
 *   upload          : "https://…/a.png"    → [{_id, name, type:"external", url, provider:"external"}]
 *
 * Neden burada ve ajana bırakılmıyor: çok dilli dizi biçimini her çağrıda elle
 * yazmak hata kaynağı (code unutulur, dil eksik kalır). Eksik dil bir UYARI —
 * kullanıcı tek dilli içerik isteyebilir; ama ajan görsün diye raporlanır.
 */

import type { Issue, LangValue, ParsedField } from "../types.js";

export type LanguageContext = {
    languages: string[];
    defaultLanguage: string;
};

export type IssueSink = {
    errors: Issue[];
    warnings: Issue[];
};

const LANGUAGE_FIELD_TYPES = new Set(["language", "editor"]);

function isLangValueArray(value: unknown): value is LangValue<unknown>[] {
    return (
        Array.isArray(value) &&
        value.every((item) => item && typeof item === "object" && typeof (item as any).code === "string" && "value" in (item as any))
    );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Çok dilli değerde eksik dilleri uyarı olarak raporlar. */
function reportMissingLanguages(arr: LangValue<unknown>[], lang: LanguageContext, path: string, sink: IssueSink) {
    const present = new Set(arr.map((x) => x.code));
    const missing = lang.languages.filter((code) => !present.has(code));
    if (missing.length) {
        sink.warnings.push({
            code: "missing-language",
            path,
            message: `Eksik dil(ler): ${missing.join(", ")} — mağaza dilleri: ${lang.languages.join(", ")}. Tüm diller için değer verin.`,
        });
    }
}

/** language/editor alanı: string | {code:value} | LangValue[] → LangValue[] */
export function normalizeLanguageValue(value: unknown, lang: LanguageContext, path: string, sink: IssueSink): LangValue[] | unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
        const arr = [{ code: lang.defaultLanguage, value }];
        reportMissingLanguages(arr, lang, path, sink);
        return arr;
    }

    /* Sık yapılan hata: dizi yerine tek `{code, value}` nesnesi. Dil haritası
       sanılırsa [{code:"code",…},{code:"value",…}] gibi bozuk veri kaydedilirdi;
       tek elemanlı diziye sarıyoruz. */
    if (isPlainObject(value) && typeof value.code === "string" && "value" in value && Object.keys(value).length <= 2) {
        value = [value];
    }

    if (isLangValueArray(value)) {
        for (const [i, item] of value.entries()) {
            if (typeof item.value !== "string") {
                sink.errors.push({ code: "invalid-language-value", path: `${path}[${i}].value`, message: "Çok dilli değerin value alanı string olmalı." });
            }
            if (!lang.languages.includes(item.code)) {
                sink.warnings.push({ code: "unknown-language", path: `${path}[${i}].code`, message: `"${item.code}" mağaza dilleri arasında yok (${lang.languages.join(", ")}).` });
            }
        }
        reportMissingLanguages(value, lang, path, sink);
        return value;
    }

    if (isPlainObject(value)) {
        const arr: LangValue[] = [];
        for (const [code, v] of Object.entries(value)) {
            if (typeof v !== "string") {
                sink.errors.push({ code: "invalid-language-value", path: `${path}.${code}`, message: "Dil haritasındaki değer string olmalı." });
                continue;
            }
            if (!lang.languages.includes(code)) {
                sink.warnings.push({ code: "unknown-language", path: `${path}.${code}`, message: `"${code}" mağaza dilleri arasında yok (${lang.languages.join(", ")}).` });
            }
            arr.push({ code, value: v });
        }
        reportMissingLanguages(arr, lang, path, sink);
        return arr;
    }

    sink.errors.push({
        code: "invalid-language-value",
        path,
        message: 'Çok dilli alan için string, {tr:"…",en:"…"} ya da [{code,value}] verin.',
    });
    return value;
}

/** link alanı: string | {url,target?} | LangValue<{url,target}>[] → LangValue<{url,target}>[] */
export function normalizeLinkValue(value: unknown, lang: LanguageContext, path: string, sink: IssueSink): unknown {
    if (value === null || value === undefined) return value;

    const wrap = (link: { url: string; target?: string }) =>
        [{ code: lang.defaultLanguage, value: { url: link.url, target: link.target === "_blank" ? "_blank" : "_self" } }];

    if (typeof value === "string") return wrap({ url: value });

    if (isPlainObject(value) && typeof value.url === "string") {
        return wrap({ url: value.url, target: typeof value.target === "string" ? value.target : undefined });
    }

    if (isLangValueArray(value)) {
        for (const [i, item] of value.entries()) {
            const v = item.value as any;
            if (!isPlainObject(v) || typeof v.url !== "string") {
                sink.errors.push({ code: "invalid-link-value", path: `${path}[${i}].value`, message: "Link değeri {url, target} nesnesi olmalı." });
            }
        }
        return value;
    }

    sink.errors.push({ code: "invalid-link-value", path, message: 'Link alanı için "/yol", {url, target} ya da [{code, value:{url,target}}] verin.' });
    return value;
}

/** upload alanı: string URL → dış dosya kaydı; dizi → olduğu gibi */
export function normalizeUploadValue(value: unknown, path: string, sink: IssueSink): unknown {
    if (value === null || value === undefined) return value;
    const toExternal = (url: string) => {
        const name = url.split("?")[0].split("/").pop() || "file";
        return { _id: `external-${hashString(url)}`, name, type: "external", url, provider: "external" };
    };
    if (typeof value === "string") return [toExternal(value)];
    if (Array.isArray(value)) {
        return value.map((item, i) => {
            if (typeof item === "string") return toExternal(item);
            if (isPlainObject(item)) return item;
            sink.errors.push({ code: "invalid-upload-value", path: `${path}[${i}]`, message: "Upload öğesi URL string'i ya da dosya nesnesi olmalı." });
            return item;
        });
    }
    sink.errors.push({ code: "invalid-upload-value", path, message: "Upload alanı için URL string'i ya da dosya nesneleri dizisi verin." });
    return value;
}

/** Kısa, deterministik, yalnız `_id` türetmek için (kriptografik değil). */
function hashString(input: string): string {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

/**
 * Tek bir alanın değerini şemaya göre normalize eder + doğrular. Dizi ve nesne
 * alanlarında alt alanlara iner (örn. steps[].title language alanı).
 */
export function normalizeFieldValue(field: ParsedField, value: unknown, lang: LanguageContext, path: string, sink: IssueSink): unknown {
    if (value === null || value === undefined) return value;

    if (LANGUAGE_FIELD_TYPES.has(field.fieldType)) {
        return normalizeLanguageValue(value, lang, path, sink);
    }
    if (field.fieldType === "link") {
        return normalizeLinkValue(value, lang, path, sink);
    }
    if (field.fieldType === "upload") {
        return normalizeUploadValue(value, path, sink);
    }
    if (field.fieldType === "select" || field.fieldType === "radio") {
        if (field.options && field.options.length) {
            const allowed = field.options.map((o) => o.value);
            if (!allowed.includes(String(value))) {
                sink.errors.push({
                    code: "invalid-option",
                    path,
                    message: `"${String(value)}" geçerli bir seçenek değil. Seçenekler: ${allowed.join(", ")}.`,
                });
            }
        }
        return value;
    }
    if (field.fieldType === "number") {
        if (typeof value !== "number") {
            const n = Number(value);
            if (Number.isFinite(n)) return n;
            sink.errors.push({ code: "invalid-number", path, message: "Sayısal alan için sayı verin." });
        }
        return value;
    }
    if (field.fieldType === "array" || field.fieldType === "repeater") {
        if (!Array.isArray(value)) {
            sink.errors.push({ code: "invalid-array", path, message: "Bu alan bir dizi bekler." });
            return value;
        }
        if (!field.arrayFields?.length) return value;
        return value.map((item, i) => {
            if (!isPlainObject(item)) {
                sink.errors.push({ code: "invalid-array-item", path: `${path}[${i}]`, message: "Dizi öğesi nesne olmalı." });
                return item;
            }
            return normalizeObjectByFields(field.arrayFields!, item, lang, `${path}[${i}]`, sink);
        });
    }
    if (field.fieldType === "object") {
        if (!isPlainObject(value)) {
            sink.errors.push({ code: "invalid-object", path, message: "Bu alan bir nesne bekler." });
            return value;
        }
        if (!field.objectFields?.length) return value;
        return normalizeObjectByFields(field.objectFields, value, lang, path, sink);
    }
    return value;
}

/** Bir nesnenin anahtarlarını alan listesine göre normalize eder (bilinmeyen anahtar uyarısı yok — alt seviyede gevşek). */
export function normalizeObjectByFields(fields: ParsedField[], obj: Record<string, unknown>, lang: LanguageContext, path: string, sink: IssueSink): Record<string, unknown> {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        const field = byKey.get(key);
        out[key] = field ? normalizeFieldValue(field, value, lang, `${path}.${key}`, sink) : value;
    }
    return out;
}

/** Çok dilli bir değerden düz metin çıkarır (outline için). HTML etiketleri soyulur. */
export function pickText(value: unknown, lang: LanguageContext, max = 80): string | undefined {
    let raw: string | undefined;
    if (typeof value === "string") raw = value;
    else if (isLangValueArray(value)) {
        const hit = value.find((x) => x.code === lang.defaultLanguage) ?? value[0];
        if (hit && typeof hit.value === "string") raw = hit.value;
    }
    if (raw === undefined) return undefined;
    const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
