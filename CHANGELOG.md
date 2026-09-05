# Değişiklikler

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
