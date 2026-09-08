# Stdio MCP protokolü ve kaynak haritası

Durum: kaynak haritası. Son inceleme: 2026-09-08, çalışma ağacı. Canlı bağlantı veya bütün protokol sürümlerinin çalışma iddiası değildir.

| Katman | Kaynak |
|---|---|
| Stdio başlangıcı, log ve süreç | [bin.ts](../src/bin.ts) |
| Local/remote factory ve capability | [server.ts](../src/server.ts) |
| Ortam/bağlam | [config.ts](../src/config.ts), [context.ts](../src/context.ts) |
| Remote katalog/araç dönüşümü | [remote dizini](../src/remote/), [registerRemoteTools.ts](../src/remote/registerRemoteTools.ts) |
| Yerel sayfa hibrit davranışı | [pagesHybrid.ts](../src/remote/pagesHybrid.ts) |
| SDK ve komutlar | [package.json](../package.json), [package-lock.json](../package-lock.json) |

İnceleme anında @tecof/mcp 0.2.1, kurulu @modelcontextprotocol/server 2.0.0; Node manifest gereksinimi >=20. Protokol sürümünü gerçek test istemcisi ve SDK davranışından belirle. Inspector'ın Node gereksinimi farklı olabilir.

Paket serveStdio kullanır. TECOF_MCP_MODE local veya remote seçer; remote modu stdio konuşur ve backend Tools API'sini tüketir. Backend /mcp HTTP handler'ı ayrı giriş noktasıdır.

stdout protokol mesajlarına ayrılır, loglar stderr'e gider. bin.ts token/URL varsa site bilgisini arka planda ısıtabilir; “başlangıç hiç ağa çıkmaz” yorumunu koddan doğrula. Remote katalog bütçesini, snapshot ve yenilemeyi ilgili kaynaklardan kontrol et.

## Belge ve skill akışı

[MCP skill'i](../.agents/skills/tecof-mcp-protocol/SKILL.md) protokol/SDK/bağlantı değişikliğinde kullanılır. Kaynak .agents altında, .claude bağlantısı aynı repo içindedir. Ortak talimat değişiminde backend kopyasıyla karşılaştır; kardeş checkout zorunlu değildir.

[README](../README.md), [API sözleşmesi](API_CONTRACT.md) ve [entegrasyon rehberi](ENTEGRASYON.md) tarihli başlangıç kaynaklarıdır. HTTP OAuth'un uygulanma durumu, katalog/scope sayıları ve “tüm yazmalar taslak” gibi genellemelerde güncel backend ve tool kodu esas alınır. Bu harita eski belgelerin tamamının doğrulandığı anlamına gelmez.

Yerel tecof-docs-sync bulunmuyorsa değişen sözleşmeyi mevcut belgeye işle; yeni modül belgesini docs/README.md'ye ekle. Başka repodaki skill'in kendiliğinden yükleneceğini varsayma.

## Yerel doğrulama

| Kapsam | Başlangıç |
|---|---|
| Local server/araç sözleşmesi | npm test -- test/server.test.ts |
| Remote proxy/snapshot/SSE | npm test -- test/remote.test.ts |
| Yapılandırma | npm test -- test/config.test.ts |
| Gerçek stdio subprocess | npm run build ardından npm run smoke; [script'i](../scripts/smoke.mjs) ve env/fixture sınırını önce incele |
| Tip denetimi | npm run typecheck |

[Server testi](../test/server.test.ts) in-memory transport ve sahte backend; [remote testi](../test/remote.test.ts) in-memory MCP ile loopback Tools API kullanır. [Test client](../test/helpers/mcpClient.ts) içindeki sürümü incele. Bunlar backend HTTP/OAuth veya her modern protokol yolunu kanıtlamaz.

Yalnız skill/docs düzenlemesinde biçim, yerel bağlantılar ve git diff --check; davranış değişiminde [doğrulama referansındaki](../.agents/skills/tecof-mcp-protocol/references/verification.md) ilgili kontroller kullanılır.

Resmî kaynak [MCP llms.txt](https://modelcontextprotocol.io/llms.txt); konu/sürüm seçimi [kaynak rehberinde](../.agents/skills/tecof-mcp-protocol/references/official-docs.md).
