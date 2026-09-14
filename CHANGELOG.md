# Değişiklikler

## Unreleased

- Snapshot 2026-09-14 öğlen yeniden üretildi: 154 araç (`theme_component_schemas` eklendi; `theme_deploy_status`/`theme_deploy_logs` şemalarında `deploymentId` biçim kuralı).

### Değişti
- `src/remote/catalog.snapshot.json` backend `mcp` kataloğundan yeniden üretildi
  (`npm run -s tools:list -- --json`, 2026-09-14). Eski snapshot remote modda, canlı katalog
  yetişmediğinde backend'de var olan tema/kod araçlarını ve yeni şema alanlarını gizliyordu.
  Sunucu talimatları (`instructions`) da güncel metinle geldi.
- Snapshot'a giren yeni araçlar (modüle göre, kısaca):
  - **code:** `create_theme`, `theme_job_status`, `activate_theme`, `list_themes`,
    `fork_theme_to_custom`, `theme_deploy_logs`, `ide_delete_files`
  - **pages:** `publish_page`, `list_symbols` / `get_symbol` / `create_symbol` / `update_symbol`,
    `list_page_revisions`, `restore_page_revision`
  - **marketing:** `list_discounts`, `list_flash_sales`, kupon/otomatik indirim/flaş satış/hediye
    kartı/e-posta araçları
  - **orders, customers, catalog, settings:** sipariş/iade, müşteri, kategori/marka/varyant tipi/yorum,
    kargo/vergi/sözleşme araçları
  - **cms, media, products, general:** `publish_cms_item`, `list_form_submissions`, medya yükleme/
    kullanım/silme, stok ve rapor araçları, `store_overview`, `list_merchants` vb.
- Şema değişiklikleri:
  - `theme_deploy_status`: `waitFor` (`none`/`terminal`), `sinceDeploymentId`, `timeoutSeconds`
  - `theme_commit_files`: `deletions[]` eklendi; `files` artık zorunlu değil (yalnız silme commit'i)
  - `update_cms_collection`, `upsert_products`: `confirm` / `confirmId`
  - `create_cms_item`: `title`, `content`, `excerpt`, `extraFields`; `slug` zorunlu değil
  - `list_media`: `kind`, `scope`, `folder`, `sort`; `import_image`: `scope`
  - `get_page` / `update_page`: `page` şemada zorunlu değil (editör yüzeyindeki açık sayfa
    varsayılanı; açık sayfa yoksa sunucu yine ister). Yerel katalogla çalışan hibrit `update_page`
    kendi şemasını kullanır
  - `create_page`, `domain_*`, `ide_*`, `theme_deploy`: alan açıklamaları, onay alanı ve
    annotations güncellendi
- `README.md` ve `docs/ENTEGRASYON.md`: sabit araç sayısı kaldırıldı (snapshot = yayın anındaki
  backend `mcp` kataloğunun kopyası, canlı katalog önceliklidir); remote moda özgü öne çıkan
  araçlar tablosu eklendi.

### Testler
- `test/remote.test.ts` snapshot sözleşmesi: her araçta `name`/`module`/`inputSchema`, kritik
  tema/kod/pazarlama araçları ve `theme_deploy_status`/`theme_commit_files` şema alanları; bellek
  içi bozuk kopyayla negatif kontrol; `generatedAt` 14 günden eskiyse uyarı (düşürmez).
- Stdio proxy: `theme_commit_files` yalnız `deletions` ile istemcide reddedilmez; şemaya uymayan
  `files` öğesi sunucuya gitmeden reddedilir.
- TECOF_TOOLSETS testi beklenen listeyi snapshot'tan türetir (yenilemede sabit liste kırılmasın).

## 0.2.0 — 2026-09-05

### Eklendi
- **Remote (proxy) modu** — `TECOF_MCP_MODE=remote`. Araç kataloğu backend'in Tools API'sinden
  (`GET /api/v1/tools?surface=mcp`) gelir, çağrılar `POST /api/v1/tools/:name?stream=1` (SSE)
  üzerinden koşar; `X-Tecof-Surface: mcp` + `Authorization: Bearer <TECOF_API_TOKEN>`.
  Sonuç biçimi `_shared.ts` ile birebir (`content[0].text` JSON + `structuredContent`; hata
  `isError:true`, `structuredContent.error = messageCode`). SSE `progress` çerçeveleri yalnız istek
  `_meta.progressToken` taşıyorsa `notifications/progress` olur.
- `src/remote/catalog.snapshot.json` — 38 araçlık katalog anlık görüntüsü (backend
  `npm run tools:list -- --json`). Canlı katalog 3 sn içinde alınamazsa snapshot kullanılır;
  başlangıç ağa bloklanmaz, `tools/list` çevrimdışı deterministiktir. Canlı katalog sonradan
  gelirse (arka plan yenileme) eksik araçlar eklenir ve `tools/list_changed` gönderilir.
- Remote modda yerel tema kataloğu (`components/`) varsa `list_components` ve `validate_document`
  diskten çalışır; `create_page`/`update_page` **hibrit**: build/validate istemcide, hazır
  `document` kayıt defterine (`sections`/`operations` yerine). `components/` yoksa dört araç da proxy.
- `TECOF_TOOLSETS` (virgülle modül adları) — uzak katalog daraltma; snapshot da aynı filtreyle.
- `README.md` + `docs/ENTEGRASYON.md`: uzak HTTP sunucu (`https://api.tecof.com/mcp`) için
  Claude Code / Codex / Gemini / Cursor / Claude Desktop kurulum parçacıkları.
- Programatik dışa aktarımlar: `RegistryClient`, `RegistryError`, `SseParser`, `RemoteCatalog`,
  `loadCatalogSnapshot`, `registerRemoteTools`, `parseToolsets`.
- `test/remote.test.ts` (sahte Tools API — node:http, yalnız 127.0.0.1) ve `scripts/smoke.mjs`
  3./4. fazlar (remote + sahte katalog, remote + erişilemeyen API → snapshot).

### Değişti
- `wrapTool` ikinci parametre olarak SDK çağrı bağlamını (`ctx.mcpReq`) iletir; yerel araçlar
  için davranış aynı.
- `create_page` / `update_page` hazırlık adımları `prepareCreatePage` / `prepareUpdatePage`
  olarak dışa açıldı (hibrit yol aynı gövdeyi kullanır); yerel araçların adı, şeması ve sonuç
  biçimi değişmedi.

### Notlar
- Varsayılan mod `local` (0.1.x davranışı); remote opt-in'dir.
- Hibrit yolda sunucu, dokümanı KENDİ (yayındaki tema) kataloğuyla bir kez daha doğrular:
  yerelde olup yayında henüz bulunmayan bileşen `unknown-type` ile reddedilir.

## 0.1.4
- Ürün araçları (`list_products`, `get_product`, `upsert_products`, `delete_product`,
  `get_product_import_template`).
