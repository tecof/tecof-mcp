/**
 * Paket genelinde paylaşılan tipler.
 *
 * Doküman modeli tecof-theme-editor ile birebir aynı şekil (root/content/zones);
 * burada tekrar tanımlanıyor çünkü MCP sunucusu theme-editor'ü (React, zustand…)
 * bağımlılık olarak içeri almamalı — saf Node süreci olarak ayağa kalkmalı.
 */

// ── Doküman modeli ───────────────────────────────────────────────────────────

/** Editör dokümanındaki tek düğüm. `props.id` zorunlu ve doküman genelinde tekil. */
export type TecofNode = {
    type: string;
    props: Record<string, any> & { id: string };
};

/**
 * Sayfa dokümanı. Render YALNIZ `zones` okur; slot prop'ları (`props[slot]`)
 * boş dizi olarak bırakılır. Zone anahtarı `"<parentId>:<slot>"`.
 */
export type TecofDocument = {
    root: { props: Record<string, any> };
    content: TecofNode[];
    zones: Record<string, TecofNode[]>;
};

/**
 * Motorun kendine ayırdığı prop anahtarları. Ajan bunları yazamaz — yazarsa
 * editörün içsel durumu (kilit, gizleme, stil token'ları) bozulur. `_variant`
 * tek istisna değildir: ajan `variant` alanını kullanır, `_variant`'ı biz basarız.
 */
export const RESERVED_PROP_KEYS = [
    "_tecofStyles",
    "_tecofTheme",
    "_interactions",
    "_startHidden",
    "_locked",
    "_hidden",
    "_symbolOverrides",
    "_variant",
    "_schemaVersion",
    "_layerName",
] as const;

/** Ortak bileşen (symbol) işaretçisi — bu prop'u taşıyan düğümler MCP için salt-okunur. */
export const SHARED_COMPONENT_PROP = "sharedComponentId";

// ── Yazarlık biçimi (ajanın gördüğü) ─────────────────────────────────────────

/**
 * Ajanın create_page / update_page'e verdiği bölüm tanımı. Doküman modelinden
 * bilerek farklı: slot çocukları `slots` altında iç içe yazılır, id üretilmez,
 * çok dilli alanlar kısayol kabul eder. `build.ts` bunu TecofDocument'e çevirir.
 */
export type Section = {
    type: string;
    props?: Record<string, unknown>;
    variant?: string;
    slots?: Record<string, Section[]>;
};

// ── Katalog ──────────────────────────────────────────────────────────────────

export type ParsedField = {
    key: string;
    fieldType: string;
    label: string;
    options?: Array<{ label: string; value: string }>;
    arrayFields?: ParsedField[];
    objectFields?: ParsedField[];
    /** Slot alanları için izin verilen çocuk element tipleri */
    allow?: string[];
};

export type ParsedVariant = {
    label: string;
    props: Record<string, unknown>;
};

export type ParsedComponentSchema = {
    componentName: string | null;
    label: string | null;
    fields: ParsedField[];
    defaultProps: Record<string, unknown> | null;
    variants: Record<string, ParsedVariant> | null;
    /**
     * Stil panelinin varsayılan token'ları — `defaultProps._tecofStyles`'ın
     * tekrarı. Şemayı okuyan taraf bileşenin hazır stili var mı diye
     * defaultProps'u eşelemesin diye ayrıca veriliyor.
     */
    _tecofStyles: Record<string, unknown> | null;
};

export type ComponentCategory = "section" | "element";

export type CatalogComponent = ParsedComponentSchema & {
    componentName: string;
    category: ComponentCategory;
    /** Tema köküne göre göreli dosya yolu (components/sections/FeaturesSection.tsx) */
    filePath: string;
};

// ── Doğrulama ────────────────────────────────────────────────────────────────

export type Issue = {
    code: string;
    /** İnsan okunur konum — örn. `content[2].props.columns` veya `zones["abc:itemsSlot"][0]` */
    path: string;
    message: string;
};

export type ValidationResult = {
    ok: boolean;
    errors: Issue[];
    warnings: Issue[];
};

// ── update_page operation'ları ───────────────────────────────────────────────

export type Operation =
    | { op: "append_section"; section: Section }
    | { op: "insert_section"; section: Section; before?: string; after?: string }
    | { op: "replace_section"; id: string; section: Section }
    | { op: "remove_section"; id: string }
    | { op: "move_section"; id: string; before?: string; after?: string }
    | { op: "set_props"; id: string; props: Record<string, unknown> }
    | { op: "set_slot"; id: string; slot: string; children: Section[] }
    | { op: "set_root_props"; props: Record<string, unknown> };

// ── Backend API tipleri (sözleşme §2) ────────────────────────────────────────

export type LangValue<T = string> = { code: string; value: T };

export type MeResponse = {
    merchant: {
        _id: string;
        name: string;
        slug: string;
        productType?: string;
        languages: string[];
        defaultLanguage: string;
        currentThemeId?: string | null;
    };
    user: { _id: string; name: string; surname: string; email: string };
    token: { _id: string; name: string; scopes: string[]; expiresAt: string };
    themes: Array<{
        themeId: string;
        merchantThemeId: string;
        name: string;
        domain: string | null;
        isCurrent: boolean;
    }>;
    panelUrl: string;
};

/* ─── Headless CMS ─────────────────────────────────────────────────────────
   Koleksiyon = içerik tipi (alan şeması), item = içerik kaydı. `data` anahtarları
   alanların shortcode'udur; biçim sözleşmesi backend'de zorunlu kılınır
   (app/src/cmsService.ts) ve get_cms_collection çıktısında özetlenir. */

export type CmsFieldType =
    | "text" | "plain-text" | "rich-text"
    | "image" | "multi-image" | "video-link"
    | "link" | "email" | "phone"
    | "number" | "date-time" | "switch"
    | "color" | "option" | "file"
    | "reference" | "multi-reference" | "repeater";

export type CmsFieldOption = { label?: LangValue[]; value: string };

export type CmsField = {
    shortcode: string;
    label?: LangValue[];
    type: CmsFieldType;
    required?: boolean;
    isMultilingual?: boolean;
    options?: CmsFieldOption[];
    referenceCollectionId?: string | null;
    min?: number | null;
    max?: number | null;
    order?: number;
    subFields?: CmsField[];
};

export type CmsCollection = {
    _id: string;
    slug: string;
    name?: LangValue[];
    description?: LangValue[];
    icon?: string;
    displayField?: string;
    fields?: CmsField[];
    fieldCount?: number;
    itemCount?: number;
    status?: string;
    modifiedDate?: string;
    createDate?: string;
};

export type CmsItemStatus = "draft" | "scheduled" | "published";

export type CmsItem = {
    _id: string;
    collectionId: string;
    slug: string;
    data: Record<string, unknown>;
    metaTitle?: LangValue[];
    metaDescription?: LangValue[];
    status: CmsItemStatus;
    publishedDate?: string | null;
    scheduledDate?: string | null;
    order?: number;
    modifiedDate?: string;
    createDate?: string;
};

export type PageStatus = "draft" | "published" | "changed";

export type PageSummary = {
    _id: string;
    /** Kanonik slug — varsayılan dilin adresi (backend bunu unique tutar). */
    slug: string;
    title: string;
    /** Dil başına adres; boş dizi "her dil kanonik slug'ı kullanıyor" demektir. */
    slugs?: LangValue[];
    /** Dil başına sayfa adı */
    titles?: LangValue[];
    /** Okuması kolay hali: { tr: "hakkimizda", en: "about" } */
    slugAlternates?: Record<string, string>;
    status: PageStatus;
    isTemplate: boolean;
    templateType?: string | null;
    publishedDate?: string | null;
    modifiedDate?: string | null;
    createDate?: string;
};

export type PageDetail = PageSummary & {
    themeId: string;
    metaTitle?: LangValue[];
    metaDescription?: LangValue[];
    draftData: TecofDocument | null;
    publishedData?: TecofDocument | null;
    hasPublished: boolean;
    urls?: { panel?: string };
};

/**
 * Backend'in doküman uyarısı — zarfın KÖKÜNDE `warnings: DocIssue[]` olarak gelir
 * (`data` içinde değil). Biçim MCP'nin Issue'suyla aynı {code, path, message}.
 */
export type DocIssue = Issue;

/** Yazma uçlarının sonucu: sayfa + sunucu uyarıları */
export type PageWriteResult = {
    page: PageDetail;
    warnings: DocIssue[];
};

/** Editör upload alanına konabilecek dosya objesi (backend /media çıktısı). */
export type UploadObject = {
    _id: string;
    name: string;
    size: number | null;
    type: string;
    mimeType: string | null;
    folder: string;
    provider: string | null;
    meta: Record<string, unknown>;
    url: string | null;
};

export type PreviewUrlResponse = {
    previewToken: string;
    expiresAt: string;
    locale: string;
    slugPath: string;
    storefrontUrl: string | null;
    localUrlTemplate: string;
};

/* ─── Ürünler (e-ticaret kataloğu) ─────────────────────────────────────────
   `/api/v1/products` çıktısının aynadaki karşılığı (backend
   app/src/productService.ts `serializeProduct`). Sayfa/CMS'ten farkı: ürün
   yazmaları TASLAK DEĞİLDİR — `status:"active"` doğrudan vitrine çıkar. */

export type ProductStatus = "active" | "inactive" | "draft";
export type ProductType = "simple" | "variable" | "grouped" | "digital";

/** Marka / kategori / etiket bağı — backend id ile birlikte ADI da döndürür. */
export type ProductRef = { _id: string; name: string | null; slug: string };

/** Ürün görseli. `folder` DÜŞÜRÜLMEZ: scope'lu klasördeki dosyanın URL'i onsuz 404 verir. */
export type ProductImage = {
    _id?: string;
    uploadId: string | null;
    name: string | null;
    folder: string | null;
    url: string | null;
    order: number;
    variantId: string | null;
};

export type ProductVariant = {
    _id: string;
    sku: string;
    barcode: string | null;
    price: number;
    compareAtPrice: number | null;
    currencyCode?: string | null;
    weight: number | null;
    isActive: boolean;
    /** `stocks[]` toplamı (vitrin sepeti stocks[]'ten okur, bu alandan değil) */
    stock: number;
    stocks: Array<{ stockLocationId: string; quantity: number }>;
    variantValues: Array<{ variantTypeId: string; variantValueId: string | null }>;
};

export type Product = {
    _id: string;
    slug: string;
    name: LangValue[];
    status: ProductStatus;
    type: ProductType;
    brand: ProductRef | null;
    categories: ProductRef[];
    tags: ProductRef[];
    images: ProductImage[];
    totalStock: number;
    avgRating: number;
    reviewCount: number;
    variantCount: number;
    modifiedDate: string;
    createDate: string;
    shortDescription?: LangValue[];
    metaTitle?: LangValue[];
    metaDescription?: LangValue[];
    /** Aşağıdakiler yalnız tek ürün ucunda ve `fields=full` listesinde döner */
    description?: LangValue[];
    weight?: number;
    maxQuantityPerCart?: number | null;
    attributes?: unknown[];
    personalizationFields?: unknown[];
    variants?: ProductVariant[];
};

/** Toplu upsert raporundaki tek satır (hata da uyarı da aynı listede). */
export type ProductUpsertIssue = {
    index?: number;
    level?: "error" | "warning";
    code?: string;
    path?: string;
    slug?: string | null;
    message: string;
    max?: number;
};

/** `POST /api/v1/products/bulk` raporu — içe aktarma raporuyla aynı şekil. */
export type ProductUpsertReport = {
    dryRun: boolean;
    created: number;
    updated: number;
    skipped: number;
    issueCount: number;
    issues: ProductUpsertIssue[];
    items: Array<{
        index: number;
        slug: string | null;
        productId: string | null;
        outcome: "created" | "updated" | "skipped";
    }>;
};

/** Tecof standart yanıt zarfı. `warnings` yazma uçlarında kökte gelir. */
export type ApiEnvelope<T> = {
    success: boolean;
    message?: string;
    messageCode?: string;
    data?: T;
    totalData?: number;
    meta?: Record<string, unknown>;
    warnings?: Array<DocIssue | string>;
};
