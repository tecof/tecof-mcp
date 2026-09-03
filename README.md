# @tecof/mcp

Tecof Developer API v1 için **stdio MCP sunucusu**. Bir Tecof tema reposunun içinden
çalışır; tema bileşenlerini diskten (AST) okur, ajanın yazdığı basit "bölüm" tanımlarını
editör dokümanına çevirir ve Developer API ile **taslak** sayfa oluşturur/günceller.
Sayfa yayınlama her zaman panelden yapılır (API'de publish yok). Aynı sunucu headless CMS
içeriklerini ve e-ticaret kataloğunu (ürün) da yönetir — ürün yazması taslak DEĞİLDİR.

- SDK: `@modelcontextprotocol/server@^2` (+ `zod@^4`) — `McpServer` + `serveStdio`
- Node ≥ 20, ESM
- Tool annotations (`readOnlyHint`, `destructiveHint`) ve `_meta["anthropic/requiresUserInteraction"]` (silme) destekli

## Kurulum

Tema reposunun kökünde:

```bash
# 1) Panelden API anahtarı üretin: Ayarlar → Geliştirici / API Anahtarları
#    (scope: pages:read, pages:write; CMS için cms:*, ürün araçları için products:read/products:write)
# 2) .env (gitignore'da) içine yazın
echo 'TECOF_API_TOKEN=tcf_...' >> .env
```

Sunucu `npx` ile çalışır; global kurulum gerekmez:

```bash
npx -y @tecof/mcp@latest
```

### Ortam değişkenleri

`TECOF_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → `process.cwd()` sırasıyla proje dizini bulunur;
`.env` ve `.env.local` buradan okunur. **process.env ezilmez** — dosya değerleri yalnız
boş olan anahtarları doldurur (`.env.local` > `.env`).

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `TECOF_API_TOKEN` | evet | `tcf_…` kişisel erişim anahtarı |
| `TECOF_API_URL` | evet* | Backend adresi; yoksa `NEXT_PUBLIC_BASE_URL` kullanılır |
| `TECOF_THEME_ID` | hayır | Global tema id; yoksa `NEXT_PUBLIC_THEME_ID`, o da yoksa mağazanın aktif teması |
| `TECOF_LOCAL_URL` | hayır | Yerel önizleme kökü (varsayılan `http://localhost:3000`) |
| `TECOF_PROJECT_DIR` | hayır | Tema reposu başka dizindeyse |

Eksik token/URL durumunda sunucu yine başlar; `list_components` ve `validate_document`
çalışır, sayfa araçları yol gösteren bir hata döner. Loglar yalnız `stderr`'e yazılır;
yakalanmamış hatalar da stderr'e düşer, süreç çökmez.

Güvenlik: `TECOF_API_URL` **https** olmalı. `http://` (loopback dışı) bir adres verilirse
başlangıçta stderr uyarısı basılır ve her tool hatasına aynı ipucu eklenir; http→https
yönlendirmeleri **takip edilmez** (Node fetch yönlendirmede `Authorization`'ı düşürür,
yanıltıcı 401 çıkardı) — 3xx yanıtı "TECOF_API_URL şeması/host'u yanlış" hatasına çevrilir.
İstek zaman aşımı (30 sn) header + gövde okumasının tamamını kapsar.

### Claude Code — `.mcp.json`

```json
{
  "mcpServers": {
    "tecof": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "${TECOF_MCP_PACKAGE:-@tecof/mcp@latest}"]
    }
  }
}
```

`TECOF_MCP_PACKAGE` env'i paket spec'ini ezer — npm'e yayınlanmadan önce ya da yerel
geliştirme için bu repo klasörünü verin (`npx -y /path/to/tecof-mcp` klasördeki `bin`'i çalıştırır):

```bash
export TECOF_MCP_PACKAGE=/Users/<siz>/Desktop/Tecof/tecof-mcp   # claude'u bu shell'den başlatın
```

### Yayınlama (npm)

```bash
npm run build && npm test && node scripts/smoke.mjs
npm version patch            # ya da minor
npm publish --access public  # @tecof kapsamı — tecof-theme-editor/analytics ile aynı hesap
```

### Codex — `.codex/config.toml`

```toml
[mcp_servers.tecof]
command = "npx"
args = ["-y", "@tecof/mcp@latest"]
```

### Gemini CLI — `.gemini/settings.json`

```json
{
  "mcpServers": {
    "tecof": {
      "command": "npx",
      "args": ["-y", "@tecof/mcp@latest"]
    }
  }
}
```

Token hiçbir yapılandırma dosyasına yazılmaz; `.env` içinde kalır. İstemci süreci tema
reposunun kökünde başlatır, sunucu `.env`'i oradan okur.

## Araçlar

| Tool | Girdi | Ne yapar |
|---|---|---|
| `get_site_context` | — | Mağaza, diller, tema (themeId/merchantThemeId/domain), token scope/bitiş, sayfa sayısı |
| `list_components` | `category?`, `component?`, `detail?: summary\|full` | Tema kataloğu (diskten AST, mtime cache). `full`: alanlar, seçenekler, slot `allow`, defaultProps, variants |
| `list_pages` | `includeTemplates?` | Sayfa listesi (slug artan) |
| `get_page` | `page` (id\|slug), `mode?: outline\|full` | outline: bölüm/slot ağacı (id, type, kısa metin); full: draftData |
| `validate_document` | `{ sections }` **veya** `{ document }` | Kaydetmeden doğrular; `ok`, `errors`, `warnings`, `normalizedDocument` |
| `create_page` | `slug`, `title`, `slugs?`, `titles?`, `sections`, `meta?`, `layoutFrom?`, `dryRun?` | Taslak oluşturur; Header/Footer `layoutFrom` sayfasındaki (varsayılan `home`) ortak bileşenlerden kopyalanır. `slugs`/`titles` dile göre adres/ad verir (`{tr:"hakkimizda", en:"about"}`); verilmezse `slug`/`title` tüm açık dillerde kullanılır |
| `update_page` | `page`, `operations` **veya** `document`, `meta?`, `dryRun?` | GET → işlemleri uygula → doğrula → PUT (`expectedModifiedDate` ile iyimser kilit; 409'da net mesaj) |
| `delete_page` | `page`, `confirm: true` | Soft delete — kullanıcı onayı şart |
| `get_preview_url` | `page`, `locale?` | 1 saatlik taslak önizleme linkleri (storefront + yerel) |
| `list_cms_collections` | — | Headless CMS içerik tipleri (slug, ad, alan/içerik sayısı) |
| `get_cms_collection` | `collection` (id\|slug) | Alan şeması **+ her alan için beklenen veri biçimi** (çok dilli mi, dosya objesi mi, referans id'si mi) — içerik yazmadan önce çağrılır |
| `create_cms_collection` | `slug`, `name?`, `fields?`, `displayField?`, `icon?` | İçerik tipi açar; alan şeması katı doğrulanır (shortcode, tip, option, repeater, reference) |
| `update_cms_collection` | `collection`, `fields?`, `slug?`, `displayField?`, `allowFieldLoss?` | Şemayı günceller; `fields` verilirse tamamen değişir. Veri taşıyan alanı silmek/tipini değiştirmek `allowFieldLoss:true` ister |
| `list_cms_items` | `collection`, `status?`, `search?`, `page?`, `limit?` | İçerik listesi (özet; `data` dönmez) |
| `get_cms_item` | `collection`, `item` (id\|slug) | İçeriğin tamamı + `modifiedDate` (iyimser kilit için) |
| `create_cms_item` | `collection`, `slug`, `data?`, `metaTitle?`, `metaDescription?` | **TASLAK** içerik oluşturur; `data` alan şemasına göre katı doğrulanır |
| `update_cms_item` | `collection`, `item`, `data?`, `dataMode?`, `slug?`, `allowPublishedEdit?` | `data` varsayılan olarak **birleştirilir** (verilmeyen alan korunur); silmek için `dataMode:"replace"`. İyimser kilit otomatik. Yayındaki içerik `allowPublishedEdit:true` ister |
| `delete_cms_item` | `collection`, `item`, `confirm: true`, `allowPublishedEdit?` | Soft delete — kullanıcı onayı şart; yayındaki içerik ayrıca onay ister |
| `list_products` | `search?`, `status?`, `category?`, `brand?`, `tag?`, `updatedSince?`, `page?`, `limit?`, `detail?: summary\|full` | Katalog listesi (ad, durum, marka/kategori/etiket adları, stok, kapak görseli). `full`: varyant sku/fiyat/stok + fiyat aralığı |
| `get_product` | `product` (id\|slug\|SKU) | Ürünün tamamı: çok dilli alanlar, görseller (CDN URL), varyantlar. Güncellemeden **önce** çağrılır |
| `upsert_products` | `items` (≤200), `dryRun?` | Oluşturur/günceller; anahtar `slug` → varyant `sku`. Marka/kategori/etiket **adıyla** çözülür, yoksa açılır; görsel URL'i sunucuda indirilir |
| `delete_product` | `product`, `confirm: true` | Soft delete — kullanıcı onayı şart |
| `get_product_import_template` | — | Panelin CSV içe aktarma şablonu (sütunlar + örnek satırlar + ham metin) |

Sonuçlar `content[0].text` (JSON) + `structuredContent` olarak döner; hatalar `isError: true`
ile alan/yol bilgisi taşır (ajan düzeltebilsin diye).

### Headless CMS akışı

`list_cms_collections` → `get_cms_collection` (alan biçimleri) → `create_cms_item` / `update_cms_item`.

Sözleşme, sayfa araçlarıyla aynı: **yazmalar taslaktır**, yayınlamayı kullanıcı panelden yapar
(`status` göndermek hata verir). Sayfalardan farklı olarak CMS'te taslak katmanı yoktur — yayındaki
bir içeriği değiştirmek/silmek anında canlıya yansır, bu yüzden `allowPublishedEdit: true` istenir;
bu bayrağı yalnız kullanıcı açıkça onayladıysa gönderin. Alan şeması değişikliğinde veri kaybı
riski varsa (`allowFieldLoss`) aynı kural geçerlidir.

Veri biçimleri (`data` içinde): çok dilli alanlar `[{code,value}]`; görsel/dosya alanları
`list_media` / `import_image` / `generate_image` çıktısındaki **tam dosya objesi dizisi**;
`reference` alanları hedef içeriğin 24 haneli id'si; `repeater` satır nesnesi dizisi.
Kesin liste her zaman `get_cms_collection` çıktısındadır.

### Ürün (e-ticaret) akışı

`list_products` → `get_product` → `upsert_products` (önce `dryRun: true`).
Scope: `products:read` / `products:write` (anahtarı panelden bu yetkilerle üretin).
`delete_product` silmenin kendisi için yalnız `products:write` ister; ancak ürünü **adres (slug) ya da
SKU** ile verirseniz araç önce ürünü okuyup id'ye çevirmek zorundadır, o okuma `products:read` gerektirir.
Yalnız yazma yetkili bir anahtarla çalışıyorsanız ürünün 24 haneli id'sini verin.

Sayfa/CMS araçlarından **iki farkı** vardır ve ikisi de kritiktir:

- **Yazma taslak değildir.** `status: "active"` ürünü anında vitrine çıkarır; `status`
  hiç gönderilmezse mevcut durum korunur (yeni üründe varsayılan `draft`).
- **Ürün temaya bağlı değildir** — `themeId` gönderilmez; teması bozuk/eksik bir
  mağazada da katalog yönetilebilir.

`upsert_products` "yalnız dolu alan yazılır" kuralıyla çalışır ve bu kural **varyant
içinde de** geçerlidir: göndermediğiniz `price`, `compareAtPrice`, `isActive` alanına
dokunulmaz; `stock` kısayolu yalnız ilk depo satırını günceller, diğer depoların stoğunu
silmez. `variants` listesinin KENDİSİ de opsiyoneldir: hiç göndermezseniz mevcut
varyantlara dokunulmaz (`{slug, status}` ile yalnız durumu değiştirebilirsiniz), gönderirseniz
boş olamaz. `price` de opsiyoneldir — yeni üründe boşsa `0`, mevcut varyantta boşsa fiyat
korunur. Eşleşmeyen SKU yeni varyant EKLER, listede olmayan varyant SİLİNMEZ (varyant
silme panel işidir); bu yüzden bir ürünü baştan kurgularken `get_product` → değerleri
kopyala → değiştireceğini değiştir → `upsert_products` akışı hâlâ en güvenlisidir.

Diğer notlar: marka/kategori/etiket **adıyla** verilir (yoksa açılır); `images[]` hem
kütüphane dosyası (`{uploadId}` / `{name}`) hem uzak URL (`{url}`; SSRF korumalı indirilir,
aynı URL bir kez) kabul eder; varyant ekseni `options: {"Beden":"S"}` biçimindedir.
Fiyat ve stok kuralları sunucudadır. Alan tablosu, dosyayla (CSV/XLSX/JSON) içe aktarma ve
sınırlar: backend `docs/PRODUCT_IMPORT_EXPORT.md`.

### `update_page` operation'ları

`append_section{section}` (Footer'ın önüne), `insert_section{section, before?|after?}` (anchor yoksa append gibi Footer'ın önüne),
`replace_section{id, section}`, `remove_section{id}`, `move_section{id, before?|after?}`,
`set_props{id, props}` (sığ birleşim), `set_slot{id, slot, children}` (slotu komple değiştirir; önce yeni çocuklar inşa edilir, başarısızsa eski içerik korunur),
`set_root_props{props}`.

Davranış notları:

- **Ortak bileşenler salt-okunur — alt düğümleri dahil.** `sharedComponentId` taşıyan düğüm (Header/Footer) ve onun zones altındaki tüm torunları (Logo, NavLink, FooterColumn…) `set_props/set_slot/replace_section/remove_section` ile değiştirilemez; "ortak bileşen — panel editöründen düzenleyin" hatası döner. Ortak kökün kendisi `remove_section` ile sayfadan kaldırılabilir (uyarıyla; master etkilenmez). `get_page` outline'ında bu düğümler `shared: true` ile işaretlidir.
- **Hata / uyarı ayrımı (operations modu):** GET'ten gelen doküman önce normalize edilir (props'ta kalmış inline slot dizileri → zones; master'ı silinmiş `SharedComponentRef` düğümleri uyarıyla düşer — backend PUT'ta aynısını yapar). Ajanın **bu turda eklediği/değiştirdiği** düğümler katı denetlenir (bilinmeyen type, allow ihlali, element-at-root → hata); **önceden var olan, dokunulmayan** düğümlerdeki ihlaller yalnız uyarıdır — tema değişmiş diye ilgisiz bir güncelleme kilitlenmez. `document` modunda ve `create_page`/`validate_document`'ta tüm düğümler katı denetlenir.
- **Boş `operations: []`** (meta da yoksa) → "uygulanacak işlem yok" hatası; PUT atılmaz. Yalnız `meta` verilirse `draftData` gönderilmez (status published→changed olmaz, gereksiz revizyon açılmaz); yanıtta `savedDraft` alanı bunu gösterir.
- Backend'in kaydetme uyarıları (zarf kökündeki `warnings: [{code,path,message}]`, örn. master'ı silinmiş Header bağının düşürülmesi) `create_page`/`update_page` yanıtında `sunucu: [code] path: message` satırları olarak döner.

## Yazarlık biçimi

Ajan doküman JSON'u değil, bölüm ağacı yazar; id üretimi, defaultProps birleşimi, slot → zone
dönüşümü ve çok dilli kısayollar sunucuda yapılır.

```jsonc
{
  "type": "FeaturesSection",
  "props": { "columns": "3", "background": "dark" },
  "variant": "dark",                       // bileşenin variants anahtarı (varsa)
  "slots": {
    "contentSlot": [
      { "type": "Title", "props": { "text": { "tr": "Neden biz?", "en": "Why us?" }, "size": "lg" } }
    ],
    "itemsSlot": [
      { "type": "Card", "props": { "href": "/hakkimizda" },
        "slots": { "contentSlot": [ { "type": "Paragraph", "props": { "text": "<p>Hızlı teslimat</p>" } } ] } }
    ]
  }
}
```

Dönüşüm kuralları:

1. `type` katalogda yoksa hata; kökte `element` kategorisi hata; slot çocuğu `allow` dışında hata.
2. `props` = `defaultProps` (−id, −inline slot çocukları) ← `variants[variant].props` (+`_variant`) ← kullanıcı `props`.
3. `slots[slot]` verildiyse o; verilmediyse defaultProps'taki örnek çocuklar; `[]` verilirse boş. Hepsi `zones["<id>:<slot>"]`'a yazılır, `props[slot] = []`.
4. Çok dilli kısayollar: `"metin"` → `[{code: varsayılanDil, value}]`; `{tr, en}` → `[{code,value}]`; eksik dil **uyarı**. `link`: `"/yol"` → `[{code, value:{url, target:"_self"}}]`. `upload`: URL string → dış dosya kaydı.
5. `select/radio` değeri `options` dışındaysa hata. `_` önekli anahtarlar hata (`className` serbest).
6. id: 8 karakter `[A-Za-z0-9_-]`, doküman genelinde tekil (geçerli+tekil bir `props.id` verilirse kabul edilir).

## Geliştirme

```bash
npm install
npm run build        # tsc → dist/ (+ dist/bin.js +x)
npm test             # vitest (parser, build, validate, operations, api mock, config, uçtan uca MCP)
node scripts/smoke.mjs   # dist/bin.js'i stdio ile ayağa kaldırıp initialize + tools/list doğrular
```

Testler gerçek backend'e istek atmaz (`fetch` mock'u); tema kataloğu `test/fixtures/theme`
altındaki kopya bileşenlerden okunur.

Programatik kullanım (HTTP transport vb.):

```ts
import { buildServer, ServerContext, loadConfig } from "@tecof/mcp";
const ctx = new ServerContext({ config: loadConfig() });
const server = buildServer({ ctx }); // McpServer — istediğiniz transport'a bağlayın
```
