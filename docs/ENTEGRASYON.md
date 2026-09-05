# @tecof/mcp — Entegrasyon Rehberi

Tecof tema reposunda çalışan yapay zekâ ajanlarına (Claude Code, Codex CLI, Gemini CLI)
mağazanın **sayfalarını okuma ve taslak yazma** yeteneği kazandıran stdio MCP sunucusu.

> **Tek cümlelik sözleşme:** araçların yaptığı her yazma **taslaktır**; yayına almayı
> kullanıcı Tecof panelinden yapar. Ajan yayınlayamaz.

- Paket: `@tecof/mcp` (npm, `bin: tecof-mcp`, Node ≥ 20, ESM)
- Kimlik: kişisel erişim anahtarı — `Authorization: Bearer tcf_…`
- Backend yüzeyi: `https://api.tecof.com/api/v1/*`
- Sözleşme detayları: [`docs/API_CONTRACT.md`](./API_CONTRACT.md)
- Üç bağlanma yolu: **stdio local** (bu belgenin ana konusu), **stdio remote** (aynı paket,
  araçlar backend kataloğundan — §11) ve **uzak HTTP** (`https://api.tecof.com/mcp`, paket
  kurmadan — §1.5).

---

## 1. Beş dakikada kurulum

### 1.1 Panelden anahtar üret

**Ayarlar → Geliştirici / API Anahtarları → Yeni anahtar**

| Alan | Öneri |
|---|---|
| Ad | `mcp — macbook` (hangi makine olduğu anlaşılsın) |
| Kapsam | `pages:read` + `pages:write` |
| Süre | 90 gün (30/90/180/365) |

Anahtar **bir kez** gösterilir (`tcf_` ile başlar). Kaybedersen yenisini üret, eskisini iptal et.
Anahtar oluşturma `apiAccess` paket özelliği ister (Pro ve üzeri).

### 1.2 Tema reposunun `.env` dosyasına yaz

```bash
# Tecof MCP
TECOF_API_TOKEN=tcf_...        # zorunlu

# Aşağıdakiler genelde temada zaten var; yoksa ekle
NEXT_PUBLIC_BASE_URL=https://api.tecof.com
NEXT_PUBLIC_THEME_ID=6a85a4d3c30931a35614621b
```

`.env` git'e girmez (`.gitignore`'da `.env*` vardır). Sunucu değerleri şu sırayla çözer:
**`process.env` → `.env.local` → `.env`** (ortam değişkeni dosyayı **ezmez**, dosya boşluğu doldurur).

| Değişken | Zorunlu | Yedeği | Açıklama |
|---|---|---|---|
| `TECOF_API_TOKEN` | evet | — | `tcf_…` anahtarı |
| `TECOF_API_URL` | evet | `NEXT_PUBLIC_BASE_URL` | Backend kökü |
| `TECOF_THEME_ID` | hayır | `NEXT_PUBLIC_THEME_ID` | Boşsa mağazanın aktif teması |
| `TECOF_LOCAL_URL` | hayır | `http://localhost:3000` | `get_preview_url`'ün yerel linki |
| `TECOF_PROJECT_DIR` | hayır | `CLAUDE_PROJECT_DIR` → `cwd` | Tema reposu başka dizindeyse |
| `TECOF_MCP_MODE` | hayır | `local` | `remote` → araçlar backend kataloğundan (§11) |
| `TECOF_TOOLSETS` | hayır | hepsi | remote modda modül daraltma: `pages,cms,media,products,domains,general` |

### 1.3 İstemciyi bağla

**Claude Code** — repo kökünde `.mcp.json` (git'e commit edilir, sır içermez):

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

**Codex CLI** — `.codex/config.toml`:

```toml
[mcp_servers.tecof]
command = "npx"
args = ["-y", "@tecof/mcp@latest"]
startup_timeout_sec = 20
tool_timeout_sec = 300
default_tools_approval_mode = "writes"

[mcp_servers.tecof.tools.delete_page]
approval_mode = "prompt"
```

**Gemini CLI** — `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "tecof": {
      "command": "npx",
      "args": ["-y", "@tecof/mcp@latest"],
      "timeout": 300000,
      "trust": false
    }
  }
}
```

Yayın öncesi sürümü denemek için paketi yerel klasörden çalıştır:
`export TECOF_MCP_PACKAGE=/path/to/tecof-mcp` (npx klasördeki `bin`'i çalıştırır).

### 1.4 Doğrula

Claude Code'da `/mcp` → `tecof` bağlı görünmeli. İlk komut:

> "get_site_context çağır, hangi mağaza ve temaya bağlıyız?"

Beklenen: mağaza adı, diller, tema (global `themeId` + panel linki), anahtarın kapsamı ve bitiş tarihi.

### 1.5 Paket kurmadan: uzak HTTP sunucu (`https://api.tecof.com/mcp`)

Backend aynı araçları Streamable HTTP MCP sunucusu olarak da sunar. Tema reposu gerekmez;
Claude Desktop / claude.ai / Cursor gibi stdio çalıştıramayan istemciler için yol budur.
Kimlik yine PAT — **static header** olarak (OAuth faz 2'de; "sunucu isterse OAuth" seçenekleri
yer tutucu sayfaya düşer). Araç adları, şemalar, hata kodları ve sonuç biçimi paketle birebir.

| İstemci | Kurulum |
|---|---|
| Claude Code | `claude mcp add --transport http tecof https://api.tecof.com/mcp --header "Authorization: Bearer ${TECOF_API_TOKEN}"` — ya da `.mcp.json`: `{"mcpServers":{"tecof":{"type":"http","url":"https://api.tecof.com/mcp","headers":{"Authorization":"Bearer ${TECOF_API_TOKEN}"},"timeout":600000}}}`. `headers` OLMADAN 401 challenge'ı izlenir ve OAuth yer tutucusuna düşülür. |
| Codex | `~/.codex/config.toml` → `[mcp_servers.tecof] url = "https://api.tecof.com/mcp"`, `bearer_token_env_var = "TECOF_API_TOKEN"`, `startup_timeout_sec = 20`, `tool_timeout_sec = 300`; onay isteyen araçlar için `[mcp_servers.tecof.tools.delete_page] approval_mode = "prompt"` (delete_cms_item, delete_product, domain_dns_upsert/delete, domain_nameservers_set için tekrarlayın). |
| Gemini CLI | `{"mcpServers":{"tecof":{"httpUrl":"https://api.tecof.com/mcp","headers":{"Authorization":"Bearer $TECOF_API_TOKEN"},"timeout":600000}}}` |
| Cursor | `{"mcpServers":{"tecof":{"url":"https://api.tecof.com/mcp","headers":{"Authorization":"Bearer ${env:TECOF_API_TOKEN}"}}}}` |
| Claude Desktop / claude.ai | Settings → Connectors → *Add custom connector* → URL + Authentication **"None"** + Request header `Authorization: Bearer tcf_…` (beta; "Required when the server asks" SEÇMEYİN) — ya da `npx -y mcp-remote https://api.tecof.com/mcp --header "Authorization: Bearer ${TECOF_API_TOKEN}"` köprüsü. |

Toolset daraltma: `X-Tecof-Toolsets: pages,cms` başlığı ya da `?toolsets=`. Duman testi:
`curl -s https://api.tecof.com/mcp/health` → `{ ok, toolCount, protocolVersions }`.

---

## 2. Ajan bunu nasıl kullanmalı (akış)

```
get_site_context          → bağlam (mağaza, diller, tema)
list_components full      → bölümlerin alanları, slot allow listeleri, varsayılanları
validate_document         → kaydetmeden dene
create_page / update_page → TASLAK yaz
get_preview_url           → taslağı tarayıcıda gör
                            → kullanıcı panelden yayınlar
```

Bu akışı ekibe dayatmak için tema reposundaki `CLAUDE.md` / `.agents/AGENTS.md` dosyalarına
"sayfa işlemleri yalnız `mcp__tecof__*` ile yapılır" kuralını koy (tema repolarında hazır gelir).

---

## 3. Araç referansı

| Araç | Tür | Girdi (özet) | Döndürür |
|---|---|---|---|
| `get_site_context` | okuma | — | mağaza, diller, tema(lar), token kapsamı, sayfa sayısı |
| `list_components` | okuma (yerel) | `category?`, `component?`, `detail?: summary\|full` | bölüm/element kataloğu: alanlar, `allow`, `defaultProps`, `variants` |
| `list_pages` | okuma | `includeTemplates?` | slug, başlık, durum, değişiklik tarihi |
| `get_page` | okuma | `page` (id\|slug), `mode?: outline\|full` | outline: bölüm ağacı; full: doküman JSON |
| `validate_document` | okuma (yerel) | `sections` **veya** `document` | `{ok, errors, warnings}` |
| `create_page` | yazma | `slug`, `title`, `slugs?`, `titles?`, `sections`, `meta?`, `layoutFrom?`, `dryRun?` | pageId, outline, panel + önizleme linkleri |
| `list_cms_collections` | okuma | — | CMS içerik tipleri |
| `get_cms_collection` | okuma | `collection` | Alan şeması + beklenen veri biçimleri |
| `create_cms_collection` / `update_cms_collection` | yazma | `slug`/`fields`… | İçerik tipi aç/güncelle (`allowFieldLoss` veri kaybı onayı) |
| `list_cms_items` / `get_cms_item` | okuma | `collection`, `item` | İçerik listesi / tam kayıt |
| `create_cms_item` / `update_cms_item` | yazma | `collection`, `slug`, `data` | TASLAK içerik yaz (`allowPublishedEdit` canlı içerik onayı) |
| `delete_cms_item` | yazma | `collection`, `item`, `confirm` | İçeriği sil (soft) |
| `update_page` | yazma | `page` + `operations` **veya** `document`, `meta?`, `dryRun?` | uygulanan işlemler, outline |
| `delete_page` | **yıkıcı** | `page`, `confirm: true` | soft delete sonucu |
| `get_preview_url` | okuma | `page`, `locale?` | 1 saatlik önizleme linki (vitrin + localhost) |

Notlar:

- `list_components` ve `validate_document` **backend'siz** çalışır (katalog diskten okunur) — token yokken bile kullanılabilir.
- `delete_page`, Claude Code'da her çağrıda kullanıcı onayı ister (`requiresUserInteraction`), ayrıca `confirm: true` zorunludur.
- `dryRun: true` → doğrulama + outline döner, **hiçbir şey kaydedilmez**.

---

## 4. Yazarlık biçimi (ajanın yazdığı şey)

Ajan `draftData` JSON'u **elle kurmaz**. Bölüm listesi yazar; id üretimi, `zones` yerleşimi
ve varsayılan birleştirme araca aittir.

```jsonc
{
  "slug": "kurumsal",
  "title": "Kurumsal",
  "meta": { "metaTitle": { "tr": "Kurumsal", "en": "About" } },
  "sections": [
    {
      "type": "PageHero",
      "props": { "layout": "single", "height": "normal", "align": "left" },
      "slots": {
        "contentSlot": [
          { "type": "Eyebrow", "props": { "text": { "tr": "Hakkımızda", "en": "About us" } } },
          { "type": "Title",   "props": { "text": { "tr": "Gökyüzünden anlatılan hikâyeler",
                                                     "en": "Stories told from the sky" } } }
        ]
      }
    },
    {
      "type": "FAQSection",
      "props": { "layout": "split" },
      "slots": {
        "itemsSlot": [
          { "type": "FAQItem", "props": {
              "question": { "tr": "Uçuş izinlerini kim alıyor?", "en": "Who handles flight permits?" },
              "answer":   { "tr": "İzin süreçlerini biz yürütüyoruz.", "en": "We handle the permits." } } }
        ]
      }
    }
  ]
}
```

### 4.1 Alan kısayolları

| Alan tipi | Kabul edilen kısayollar | Kaydedilen biçim |
|---|---|---|
| `language`, `editor` | `"metin"`, `{ "tr": "…", "en": "…" }`, `[{code,value}]` | `[{code,value}]` (tüm diller) |
| `link` | `"/iletisim"`, `{ url, target }` | `[{code, value:{url,target}}]` |
| `upload` | mutlak URL string | `[{ type:"external", provider:"external", url }]` |
| `select`, `radio` | yalnız `options` içindeki değer | ham değer |
| `slot` | `slots` altında bölüm listesi | `zones["<id>:<slot>"]` |

Eksik dil bırakırsan uyarı alırsın (kaydedilir ama uyarı görünür). Katalogda olmayan bir alan
yazarsan `unknown-prop` uyarısı düşer.

### 4.2 Birleştirme sırası

`defaultProps` (id ve inline slot'lar çıkarılır) → `variants[variant].props` (+ `_variant`) → senin `props`.
Slot içeriği: verdiğin `slots` → yoksa bileşenin varsayılan çocukları → yoksa boş.

---

## 5. `update_page` işlemleri

| İşlem | Parametreler | Not |
|---|---|---|
| `append_section` | `section` | Footer varsa onun **önüne** ekler |
| `insert_section` | `section`, `before?` \| `after?` | Çapa verilmezse append gibi davranır |
| `replace_section` | `id`, `section` | Düğümü baştan kurar |
| `remove_section` | `id` | Alt ağacı da temizler |
| `move_section` | `id`, `before?` \| `after?` | Yalnız kök seviyesi |
| `set_props` | `id`, `props` | Sığ birleştirme; `_` önekli ve slot alanları reddedilir |
| `set_slot` | `id`, `slot`, `children` | Slotu komple değiştirir |
| `set_root_props` | `props` | Sayfa kökü ayarları |

Akış: `get_page` → işlemler → doğrulama → `PUT` (iyimser kilit). Sayfa arada değiştiyse
**409** döner; ajan sayfayı yeniden okuyup birleştirmelidir.

`operations` **hepsi-ya-hiç** çalışır: bir işlem hata verirse hiçbiri kaydedilmez.

---

## 6. Doğrulama: ne zaman hata, ne zaman uyarı

Ajanın **dokunduğu** düğümlerde şunlar **hata**dır (kayıt durur):

- `unknown-type` — katalogda olmayan bileşen
- `element-at-root` — element (Title, Button…) sayfa köküne konamaz
- `slot-not-allowed` — slotun `allow` listesine uymayan çocuk
- `duplicate-id`, `orphan-zone`, `reserved-prop` (`_` önekli alanlar), `shared-component`

Ajanın **dokunmadığı**, sayfada zaten var olan düğümlerdeki aynı sorunlar `update_page`'in
işlem modunda yalnız **uyarı**dır — eski bir sayfa yüzünden yeni düzeltme bloke olmasın diye.

Sınırlar: doküman ≤ **2 MB**, düğüm ≤ **3000**, iç içe derinlik ≤ **24**.

---

## 7. Örnek oturum (mova teması)

```
> get_site_context
  The Kochan · diller tr, en · tema: Mova (6a85a4…) · kapsam pages:read, pages:write

> "kurumsal" adında bir sayfa oluştur: PageHero + ServiceShowcase + FAQSection, tr ve en dolu
  create_page(dryRun: true)  → 3 bölüm, 14 düğüm, 0 hata, 1 uyarı (en dili eksik: FAQItem#2)
  create_page()              → pageId 6a85c9… · durum: taslak
                               panel: https://app.tecof.com/app/themes/…/design/6a85c9…

> "FAQ'ya iki soru daha ekle"
  update_page(operations: [{ op: "set_slot", id: "FAQ…", slot: "itemsSlot", children: [ … ] }])

> get_preview_url
  https://thekochan.com/tr/kurumsal?showDraftData=true&previewToken=…  (1 saat)
  http://localhost:3000/tr/kurumsal?showDraftData=true&previewToken=…
```

Yayına alma bilinçli olarak yok: kullanıcı panelde sayfayı açıp **Yayınla** der.

---

## 8. Sorun giderme

| Belirti | Sebep | Çözüm |
|---|---|---|
| `TECOF_API_TOKEN tanımlı değil` | `.env` okunamadı | Anahtarı tema reposunun `.env`'ine yaz; `TECOF_PROJECT_DIR` ile dizini göster |
| 401 `token-invalid` / `token-expired` / `token-revoked` | Anahtar yanlış, süresi dolmuş ya da iptal | Panelden yeni anahtar üret |
| 401 `no-team-access` | Anahtarın sahibi mağaza ekibinden çıkarılmış | Kullanıcıyı ekibe geri ekle ya da başka anahtar üret |
| 403 `insufficient-scope` | Anahtarda `pages:write` yok | Yazma kapsamlı yeni anahtar üret |
| 403 `plan-feature-unavailable` | Paket `apiAccess` içermiyor | Pro ve üzeri pakete geç |
| 400 `theme-not-installed` | `NEXT_PUBLIC_THEME_ID` bu mağazaya kurulu değil | `get_site_context`'teki `themes[]` listesinden doğru id'yi al |
| 409 `page-modified` | Sayfa arada değişti (editör açık olabilir) | `get_page` ile yeniden oku, değişikliği tekrar uygula |
| 429 `rate-limited` | Okuma 120/dk, yazma 30/dk aşıldı | Bir dakika bekle; toplu işleri parçala |
| `ortak bileşen — panel editöründen düzenleyin` | Header/Footer ortak bileşen | Panel editöründen düzenle (aşağıya bak) |
| Önizleme linki 404 | Sayfanın taslak içeriği yok ya da şablon sayfa | Önce içerik yaz; şablon sayfalar desteklenmiyor |
| Bileşen katalogda yok | Yeni bölüm henüz diskte değil / dosya adı farklı | `list_components` ile mevcut adları doğrula |

---

## 9. Bilinçli sınırlar

- **Yayınlama yok.** Ajan taslak yazar; yayın panelden.
- **Şablon sayfalar** (ürün/CMS şablonları) API'den değiştirilemez.
- **Ortak bileşenler** (Header/Footer sembolleri) ve tüm alt düğümleri salt-okunurdur:
  bir sayfadaki kopyayı değiştirmek diğer sayfaları da etkileyeceği için yazma reddedilir.
  Ortak bileşen olmayan (sayfaya gömülü) Header/Footer düzenlenebilir — ama o zaman
  değişiklik **yalnız o sayfaya** işler; diğer sayfalarda eski hâli kalır.
- **Medya araçları henüz yok**: görsel alanlarına mevcut kütüphane dosyası ya da mutlak URL konur.
- Kapsamlar (PAT scope'ları): `pages:*`, `cms:*`, `media:*`, `ai:generate`, `products:*`, `domains:*`,
  `analytics:read`, `memory:write` (+ Cloud IDE için `code:*`, `sandbox:run`, `deploy:write`). local
  mod ilk beşini kullanır; `domains`/`general` araçları yalnız remote modda ve uzak HTTP sunucuda.

---

## 10. Güvenlik notları

- Anahtar bir **kullanıcıya + bir mağazaya** bağlıdır; kullanıcı ekipten çıkarsa anahtar o an ölür.
- Sunucu anahtarı yalnız `TECOF_API_URL` adresine gönderir, yönlendirmeleri takip etmez,
  `http://` (loopback dışı) adreste uyarır.
- Anahtar veritabanında **hash'li** tutulur; istek günlüklerinde `tcf_…` değerleri maskelenir.
- Tüm yazmalar denetim günlüğüne (`Ayarlar → Etkinlik`) düşer: kim, hangi anahtarla, hangi sayfa.
- Anahtarı paylaşılan makinede bırakma; şüphede panelden **iptal et**.

---

## 11. remote mod (stdio proxy)

`TECOF_MCP_MODE=remote` ile aynı paket, araç tanımlarını kendi içinden değil backend'in
**Tools API** kataloğundan (`GET /api/v1/tools?surface=mcp`) alır ve her çağrıyı
`POST /api/v1/tools/:name?stream=1` üzerinden sunucuya iletir (`X-Tecof-Surface: mcp` +
`Authorization: Bearer <TECOF_API_TOKEN>`). Ne zaman tercih edilir: backend'e yeni eklenen bir
araç (ör. `domain_*`, `store_health_check`) için paketi güncellemek istemiyorsanız, ya da
/mcp ile birebir aynı davranışı (onay, kredi, hata kodları) stdio üzerinden istiyorsanız.

**Başlangıç.** Katalog isteği 3 sn bütçeyle arka planda koşar; yetişmezse ya da backend
erişilemezse paketle gelen **snapshot** (38 araç) kullanılır — stderr'de `Katalog: snapshot`
görürsünüz. `tools/list` çevrimdışı da deterministiktir; canlı katalog sonradan gelirse eksik
araçlar eklenir ve istemciye `tools/list_changed` gider. `TECOF_TOOLSETS=pages,cms` hem sorguya
eklenir hem snapshot'ı daraltır.

**Yerel tema kataloğu.** Tema reposunda `components/` varsa `list_components` ve
`validate_document` bugünkü gibi diskten çalışır; `create_page`/`update_page` **hibrit**tir:
bölümler/operation'lar yerel katalogla inşa edilip doğrulanır (aynı yazarlık biçimi, aynı hata
mesajları), hazır `document` sunucunun `create_page`/`update_page` aracına gider ve sunucu kendi
(yayındaki tema) kataloğuyla bir kez daha doğrular. Sonuç: yerelde olup yayında henüz bulunmayan
bir bileşen sunucuda `unknown-type` ile reddedilir — böyle bir bileşenle taslak yazmak için
local mod kullanın. `components/` yoksa (tema reposu dışından çalıştırma) dört araç da sunucudan.

**Sonuç ve hata.** `content[0].text` JSON + `structuredContent` (+ `credit`, `warnings`).
Hata `isError:true`; metin `"<messageCode>: <mesaj>" + ipucu`, `structuredContent =
{ error: messageCode, message, status, …data }`. Onay isteyen araçlar `confirm:true` olmadan
`409 confirmation-required` + `confirmId` döner; kullanıcı onayladıysa AYNI girdiyle
`confirm:true` ve `confirmId` gönderilir (PAT yüzeyinde onay tek geçişlidir — sunucuda kullanıcı
yoktur, istemcinin onay adımı onaydır). İlerleme bildirimi yalnız istemci `progressToken`
verdiyse gelir. Sunucu düz `application/json` dönerse (idempotency replay, kimlik zinciri) zarf
olduğu gibi okunur.

| Belirti (remote) | Sebep | Çözüm |
|---|---|---|
| stderr `Katalog: snapshot` | Backend 3 sn içinde yanıt vermedi / 401 / 403 | Çağrı hatasındaki koda bakın; ağ düzelince arka plan yenilemesi canlıya geçer |
| `tool-not-found` | Snapshot'taki araç sunucuda yok/kapalı | `TECOF_TOOLSETS`'i kontrol edin; snapshot'ı backend `npm run tools:list -- --json` ile yenileyin |
| `confirmation-required` | Onay isteyen araç `confirm:true` olmadan çağrıldı | Kullanıcı onayı → aynı girdi + `confirm:true` + `confirmId` |
| `insufficient-credits` | `generate_image` gibi kredi düşen araç | Panel → Ayarlar → Paket / Krediler |
| `unknown-type` (sunucu) hibrit create/update_page'de | Bileşen yayındaki temada yok | Temayı yayınlayın ya da local mod |

