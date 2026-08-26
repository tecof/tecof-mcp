# Tecof Developer API v1 + `@tecof/mcp` — Sözleşme (2026-08-19)

Bu belge üç iş kolunun ortak referansıdır: backend (`tecof-app-backend`), MCP paketi
(`tecof-mcp` → npm `@tecof/mcp`), panel (`tecof-app-frontend`). Yanıt zarfı her yerde
Tecof standardı: `{ success, message, messageCode, data, totalData? }`.

## 1. Kimlik: Personal Access Token (PAT)

- Biçim: `tcf_` + 43 karakter base64url (32 rastgele byte). Örn. `tcf_Qm9yw…`.
- Taşıma: **yalnız** `Authorization: Bearer tcf_…` header'ı. Query string kabul edilmez.
- Saklama: `merchant_api_tokens` koleksiyonunda `tokenHash = sha256(token)` (hex) +
  `tokenPrefix = token.slice(0, 12)` (gösterim). Düz token yalnız oluşturma yanıtında döner.
- Bağlam: token **bir merchant + bir kullanıcıya** bağlıdır. Her istekte: token aktif
  (revokedAt null, expiresAt > now), kullanıcı `status:"active"`, kullanıcı hâlâ o
  merchant'ın ekibinde (merchant_team) **veya** administrator. Değilse 401.
- Scope'lar (v1): `pages:read`, `pages:write`. (`publish` scope'u YOK — yayın panelden.)
  Yetersiz scope → **403** `insufficient-scope`, `data: { required: [...] }`.
- Süre: oluştururken `expiresInDays ∈ {30, 90, 180, 365}` (varsayılan 90). Süresiz yok.
- Plan kapısı: `/api/v1/me` HARİÇ tüm `/api/v1/*` uçları `requirePlan({ feature: "apiAccess" })`
  (paywall açıkken pro+; fail-open). 403 `plan-feature-unavailable`. `/me` bilinçli olarak kapısızdır:
  istemci kilitli pakette bile kimliğini doğrulayıp kullanıcıya "paket yükselt" diyebilsin.
- Rate limit (token başına, bellek-içi): okuma 120/dk, yazma 30/dk → **429** `rate-limited`.
- Hata kodları (401): `missing-auth-token`, `token-invalid`, `token-expired`, `token-revoked`,
  `no-team-access`.

### 1.1 Panel yönetim uçları (JWT + `X-Merchant-ID`, `assertMerchantAccess`)

| Metot | Yol | Gövde / Not |
|---|---|---|
| GET | `/api/merchant/api-tokens` | liste: `{_id, name, tokenPrefix, scopes, expiresAt, lastUsedAt, lastUsedIp, revokedAt, createDate, createUser{name,surname,email}}` |
| POST | `/api/merchant/api-tokens` | `{ name: string(≤60), scopes: string[], expiresInDays: 30\|90\|180\|365 }` → `data: { token: "tcf_…", item: {...} }` — `requirePlan({feature:"apiAccess"})` |
| DELETE | `/api/merchant/api-tokens/:id` | iptal (revokedAt set; kayıt silinmez) |

Activity: kategori `apiToken` → `create`, `revoke` (meta: `keyPrefix`, `scopes`, `expiresAt` — anahtar adları
activityLogger'ın `token|secret` maskeleme regex'ine takılmasın diye "key*").
İstek günlüğü (`logs`): POST create yanıtı HİÇ kaydedilmez (`groupName:"api-tokens"` → ignoreApi) ve tüm
gövdelerde `tcf_…` / `"token":"…"` / `"previewToken":"…"` desenleri maskelenir.

## 2. Developer API v1 — `/api/v1/*` (PAT)

Tüm uçlar PAT ister. `themeId` = **global** `themes._id` (tema reposundaki
`NEXT_PUBLIC_THEME_ID`). Her sayfa ucu, verilen themeId'nin bu merchant'a kurulu olduğunu
(`merchant_themes`) doğrular; değilse 400 `theme-not-installed`.

### 2.1 `GET /api/v1/me` (herhangi geçerli token)
```jsonc
{
  "merchant": { "_id", "name", "slug", "productType", "languages": ["tr","en"], "defaultLanguage": "tr", "currentThemeId" },
  "user":     { "_id", "name", "surname", "email" },
  "token":    { "_id", "name", "scopes": ["pages:read","pages:write"], "expiresAt" },
  "themes":   [ { "themeId", "merchantThemeId", "name", "domain": "shop.example.com|proj.vercel.app|null", "isCurrent": true } ],
  "panelUrl": "https://app.tecof.com"   // FRONTEND_URL
}
```

### 2.2 `GET /api/v1/pages?themeId=&includeTemplates=false` — scope `pages:read`
`data: [{ _id, slug, title, status: "draft|published|changed", isTemplate, templateType, publishedDate, modifiedDate, createDate }]`, `totalData`.
Sıralama: slug artan. `themeId` yoksa merchant.currentThemeId (yanıtta `meta.themeId` ile bildirilir).

### 2.3 `GET /api/v1/pages/:idOrSlug?themeId=` — `pages:read`
`:idOrSlug` 24-hex ise id, değilse slug (slug aramasında themeId zorunlu; yoksa currentThemeId).
```jsonc
{
  "_id", "themeId", "slug", "title", "status", "isTemplate", "templateType",
  "metaTitle": [{code,value}], "metaDescription": [{code,value}],
  "draftData": { "root": {...}, "content": [...], "zones": {...} },   // ortak bileşenler ÇÖZÜLMÜŞ (resolve)
  "hasPublished": true, "publishedDate", "modifiedDate", "createDate",
  "urls": { "panel": "https://app.tecof.com/app/themes/<merchantThemeId>/design/<pageId>" }
}
```
`?include=published` verilirse `publishedData` de döner (çözülmüş).

### 2.4 `POST /api/v1/pages` — `pages:write`
```jsonc
{
  "themeId": "…",                 // zorunlu
  "slug": "hakkimizda",           // zorunlu; sunucu normalize eder (lowercase, tr→ascii, [a-z0-9-/])
  "title": "Hakkımızda",          // zorunlu
  "metaTitle": [{code,value}]?, "metaDescription": [{code,value}]?,
  "draftData": { root, content, zones }?   // opsiyonel; verilirse yapısal doğrulamadan geçer
}
```
Kurallar: `isTemplate` sayfa oluşturma v1'de **kapalı** (400 `template-pages-not-supported`).
Slug çakışması → 400 `already-exists` (`data: { slug, existingPageId }`). Sayfa `status:"draft"` doğar.
Yanıt 201: 2.3 ile aynı sayfa nesnesi (draftData dahil) + `urls` + `warnings`. Activity: `page/create`
(`meta: { via: "api", patId }`). Revizyon: `draft-save` (draftData varsa), `createUser=userId`.
`modifiedDate` ms hassasiyetli `Date` (iyimser kilit için).

### 2.5 `PUT /api/v1/pages/:id` — `pages:write`
```jsonc
{
  "draftData": {...}?,            // tam doküman (patch değil); yapısal doğrulama
  "title"?, "slug"?, "metaTitle"?, "metaDescription"?,
  "expectedModifiedDate": "2026-08-19T10:00:00.000Z"?   // iyimser kilit
}
```
- `expectedModifiedDate` verilmiş ve sayfanın `modifiedDate`'i farklıysa → **409** `page-modified`
  (`data: { modifiedDate }`); istemci sayfayı yeniden okuyup birleştirir.
- `draftData` yazımında: `status === "published"` ise `"changed"` olur. Şablon sayfalar (isTemplate) → 400 `template-pages-not-supported`.
- Ortak bileşen (sharedComponentId) düğümleri `SharedComponentRef`'e indirgenir, **master güncellenmez**
  (MCP master'ı asla değiştirmez). Var olmayan master id'si → `sharedComponentId` düşürülür + `warnings`.
- Yanıt: 2.3 ile aynı + `warnings: string[]`. Activity `page/update`; revizyon `draft-save` (60 sn birleştirme geçerli).

### 2.6 `DELETE /api/v1/pages/:id` — `pages:write`
Soft delete (`deleteCode:1`). Şablon sayfalar silinemez (400). Yanıt: `{ _id, slug, status }`. Activity `page/delete` (warning).

### 2.7 `POST /api/v1/pages/:id/preview-url` — `pages:read`
Gövde: `{ "locale"?: "tr" }` (varsayılan merchant.defaultLanguage).
```jsonc
{
  "previewToken": "<jwt, 1 saat>", "expiresAt": "…",
  "locale": "tr", "slugPath": "hakkimizda",            // home için ""
  "storefrontUrl": "https://<domain>/tr/hakkimizda?showDraftData=true&previewToken=…",  // domain yoksa null
  "localUrlTemplate": "http://localhost:3000/tr/hakkimizda?showDraftData=true&previewToken=…"
}
```
Not: draftData `null` ise tema 404 verir (istemci uyarmalı); şablon sayfada çalışmaz.

### 2.8 Yapısal doğrulama (backend — tema şemasından bağımsız)
Hatalar (400 `invalid-document`, `data: { errors: [{code, path, message}] , warnings: [...] }`):
- `shape`: `root.props` obje, `content` dizi, `zones` obje; her düğüm `{type: string, props: object}`.
- `id`: her düğümde `props.id` boş olmayan string, `:` içermez, doküman genelinde (content + tüm zones) tekil.
- `zone-key`: anahtar `"<parentId>:<slot>"`; parentId dokümanda var olmalı (yetim zone → hata).
- `inline-slot`: props içinde düğüm dizisi (`[{type,props}]`) **kalmamalı** — sunucu bunları zones'a çıkarır (uyarı), kalan düğümlere id üretir.
- `size`: JSON ≤ 2 MB, düğüm ≤ 3000, derinlik ≤ 24.
- `reserved`: `props.sharedComponentId` bu merchant'ta mevcut bir master'a işaret etmeli; değilse bağ düşürülür (uyarı `shared-component-missing`). `SharedComponentRef` tipli düğüm (GET yanıtında master'ı silinmiş ref olarak gelebilir) master varsa aynen kalır, yoksa uyarıyla dokümandan çıkarılır; `sharedComponentId`'siz `SharedComponentRef` hatadır (`reserved-type`).
- `limits`: düğüm sayısı ve derinlik gezinti SIRASINDA denetlenir (erken durur); `title ≤ 200`, çok dilli değer ≤ 2000 karakter, ≤ 20 dil.
- Biçimsiz `?themeId` (ObjectId değil) 400 `theme-not-installed` (sessizce aktif temaya düşülmez).

## 3. `@tecof/mcp` — stdio MCP server

### 3.1 Çalışma bağlamı
- Proje dizini: `TECOF_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → `process.cwd()`.
- `.env`/`.env.local` buradan okunur (dotenv; process.env **ezilmez**, yalnız boşsa doldurulur):
  `TECOF_API_URL` (yoksa `NEXT_PUBLIC_BASE_URL`), `TECOF_THEME_ID` (yoksa `NEXT_PUBLIC_THEME_ID`),
  `TECOF_API_TOKEN` (zorunlu), `TECOF_LOCAL_URL` (varsayılan `http://localhost:3000`).
- Başlangıçta `GET /api/v1/me` ile token/tema doğrulanır; tema merchant'a kurulu değilse server
  başlar ama her tool net hata döner.
- Log yalnız `stderr`. stdout JSON-RPC.
- SDK: `@modelcontextprotocol/server@^2` (+ `zod@^4.2`), `serveStdio`. Tool annotations + `_meta`.

### 3.2 Katalog (diskten AST)
- `components/sections/**`, `components/elements/**` (alt klasörler dahil; `_`/`.` ile başlayan ve
  `Context`/`Provider` içeren dosyalar atlanır) → `parseComponentSchema` (theme-core kopyasının taşınmış
  ve genişletilmiş hali): `variants`, `createIconField→icon`, `createRepeaterField→repeater`,
  `createCmsCollectionField→cmsCollection`, `createApiListField→api-list`, `createExternalField→external`,
  e-ticaret factory'leri (`createCategoryField→category`, `createProductField→product`, …).
- Çıktı: `{ componentName, label, category: "section"|"element", filePath, fields[{key, fieldType, label, options?, allow?, arrayFields?, objectFields?}], defaultProps, variants? }`.
- mtime-bazlı cache; her tool çağrısında değişen dosyalar yeniden parse edilir.

### 3.3 Tool'lar
| Tool | Girdi | Çıktı / Notlar | Annotations |
|---|---|---|---|
| `get_site_context` | — | merchant, diller, tema (themeId/merchantThemeId/domain), token scope/expiry, sayfa sayısı | readOnly |
| `list_components` | `{ category?: "section"\|"element", component?: string, detail?: "summary"\|"full" }` | summary: ad/label/kategori/slot adları; full: fields+defaultProps+variants | readOnly |
| `list_pages` | `{ includeTemplates?: boolean }` | liste | readOnly |
| `get_page` | `{ page: string (id\|slug), mode?: "outline"\|"full" }` | outline: root props + section listesi `[{id,type,label,slots:{slot:[{id,type,text?}]}}]`; full: draftData JSON | readOnly |
| `validate_document` | `{ document }` **veya** `{ sections }` | `{ ok, errors, warnings, normalizedDocument? }` | readOnly |
| `create_page` | `{ slug, title, slugs?, titles?, meta?: {metaTitle?, metaDescription?}, sections: Section[], layoutFrom?: "home"\|"<slug>"\|"none", dryRun?: boolean }` | taslak oluşturur; Header/Footer `layoutFrom` sayfasındaki ortak bileşen ref'lerinden kopyalanır (ilk düğüm type /Header/ → başa, son düğüm /Footer/ → sona; yalnız `sharedComponentId` taşıyanlar); yanıt `{ pageId, slug, status, outline, urls:{panel, storefrontPreview, localPreview}, warnings }` | write, idempotent:false |
| `update_page` | `{ page, operations: Operation[], meta?: {title?, slug?, metaTitle?, metaDescription?}, dryRun? }` **veya** `{ page, document }` | GET → ops uygula → validate → PUT (`expectedModifiedDate`) | write |
| `delete_page` | `{ page, confirm: true }` | soft delete | destructive + `anthropic/requiresUserInteraction` |
| `get_preview_url` | `{ page, locale? }` | storefront + local URL | readOnly |

**Section yazarlık biçimi** (ajanın gördüğü):
```jsonc
{ "type": "FeaturesSection", "props": { "columns": "3" }, "variant"?: "dark",
  "slots": { "itemsSlot": [ { "type": "Card", "props": {...}, "slots": {...} } ] } }
```
Dönüşüm kuralları (MCP içinde, kaydetmeden önce):
1. `type` katalogda yoksa **hata**; kök düzeyde `category:"element"` → hata; slot çocuğu `allow` dışında → hata.
2. `props` birleşimi: `defaultProps` deep-clone (−`id`, −inline slot dizileri) ← `variants[variant].props` (+ `_variant`) ← kullanıcı `props`.
3. Slot: `slots[slot]` verildiyse o; verilmediyse defaultProps'taki inline çocuklar; ikisi de yoksa boş. Hepsi `zones["<id>:<slot>"]`'a yazılır, `props[slot] = []`.
4. Çok dilli kısayol: `language/editor` alanında düz string → `[{code: defaultLanguage, value}]`; `{tr:"…", en:"…"}` → `[{code,value}]`; eksik dil → uyarı. `link` alanında string URL → `[{code, value:{url, target:"_self"}}]`.
5. `select/radio` değeri `options` dışında → hata. `_` önekli anahtarlar (`_tecofStyles` hariç? → hayır, hepsi) → hata; `className` serbest.
6. id: `nanoid(8)` benzeri 8 karakter `[A-Za-z0-9_-]`; doküman genelinde tekil.
7. `sharedComponentId` taşıyan mevcut düğümler değiştirilemez (`update_page` `set_props/set_slot/replace_section` bu düğümlerde **hata**: "ortak bileşen — panel editöründen düzenle").

**Operation tipleri** (`update_page`):
`append_section{section}`, `insert_section{section, before?|after?: nodeId}`, `replace_section{id, section}`,
`remove_section{id}`, `move_section{id, before?|after?}`, `set_props{id, props}` (shallow merge; dil alanları kısayol destekli),
`set_slot{id, slot, children: Section[]}` (slotu komple değiştirir), `set_root_props{props}`.

### 3.4 Sunucu `instructions` (ilk 512 karakter kritik — Codex)
"Tecof sayfa araçları. Yazmalar TASLAK'tır; yayınlamayı kullanıcı panelden yapar. Akış: get_site_context →
list_components (full) → validate_document → create_page/update_page → get_preview_url. Ortak bileşenlere
(Header/Footer) dokunma. Çok dilli alanları tüm diller için doldur."

## 4. Panel (tecof-app-frontend)
- Ayarlar kartı: "Geliştirici / API Anahtarları" (`activity-connections` grubu), rota `/app/settings/api-tokens`.
- Liste (ad, prefix, scope rozetleri, son kullanım, bitiş, iptal), "Yeni anahtar" (ad, scope checkbox'ları, süre seçimi)
  → token bir kez gösterilir (kopyala) + hazır `.mcp.json` / Codex / Gemini snippet'i.
- `hasFeature(frontendData,"apiAccess")` yoksa upsell kutusu.
- PageSelector: status rozeti (Taslak / Değişiklik var).

## 5. Tema repoları
- `.mcp.json` (commit): `{"mcpServers":{"tecof":{"type":"stdio","command":"npx","args":["-y","@tecof/mcp@latest"]}}}`
- `.codex/config.toml`, `.gemini/settings.json` eşdeğerleri; `.env`'e `TECOF_API_TOKEN=` satırı (gitignore'da).
- CLAUDE.md/AGENTS.md kuralı: sayfa oluşturma/güncelleme/silme için `mcp__tecof__*`; draftData JSON'u elle yazılmaz; delete için onay.
