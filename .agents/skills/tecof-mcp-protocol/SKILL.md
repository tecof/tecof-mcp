---
name: tecof-mcp-protocol
description: "Tecof MCP sunucusunda SDK/protokol sürümü, HTTP veya stdio bağlantısı, keşif, yetkilendirme, iptal/ilerleme ya da istemci uyumu değiştiğinde resmî MCP belgeleriyle geliştirir ve doğrular. Yalnız ürün aracının iş mantığı değişiyorsa tecof-tool-development akışına yönlendirir."
---

Önce yerel [MCP kaynak haritasını](../../../docs/MCP_PROTOCOL.md) ve görevin dosyalarını oku. Backend HTTP, stdio local ve stdio remote proxy yollarından hangisinin etkilendiğini belirle; üçünü aynı uygulama varsayma.

1. package.json talebi, lockfile çözümü ve kurulu `@modelcontextprotocol/*` paket sürümlerini karşılaştır. SDK sürümü, sunucu paket sürümü ve tarihli MCP protokol sürümü ayrı bilgilerdir. Eksik kurulumda bunu belirt; sırf güncel doküman başka API gösteriyor diye bağımlılık yükseltme.
2. [Resmî kaynak seçimini](references/official-docs.md) kullan: `llms.txt` indeksinden görev ve desteklenen protokol sürümüyle ilgili sayfaları aç. Bütün siteyi context'e alma. Gözlenen mevcut davranış ile önerilen geçişi ayır.
3. Değişen katmanda [bağlantı doğrulamasını](references/verification.md) uygula. Lifecycle/keşif, metadata, capability ve hata kurallarını seçilen protokol sürümüne bağla; legacy initialize akışını modern bağlantıya veya modern kuralı legacy istemciye zorla uygulama.
4. HTTP'de auth bağlamı, protected-resource metadata, Origin ve yanıt türünü; stdio'da stdout saflığını, süreç kapanışını ve yapılandırmayı izle. Retry/iptal canlı mutasyonu çoğaltmamalı. Tool annotations yetki kontrolünün yerine geçmez.
5. Protokol değişmiyorsa backend'deki tecof-tool-development akışını kullan; o skill bulunmayan checkout'ta mevcut tool/helper ve API sözleşmesini izle. Kaynak/prompt/elicitation gibi capability'leri yalnız gereken davranış ve gerçek handler varsa ekle; ilan edilen desteği çalışır özellik sayma.
6. Göreve uygun fixture veya Inspector kontrolünü seç. İlan edilen sürüm listesi ve health yanıtı başarılı protokol oturumunun kanıtı değildir. Mevcut kullanıcı yetkisini ve kapsamını koru; değişiklik olmadan publish/deploy veya canlı tool çağrısı başlatma.
7. Değişen bağlantı sözleşmesini mevcut docs belgesine yaz. Yerel tecof-docs-sync varsa kullan; yoksa docs indeksini ve varsa registry'yi güncelle, kaynak bağlantılarını ve `git diff --check` sonucunu doğrula. Başka checkout'a erişilemiyorsa karşı tarafı doğruladığını söyleme.

Teslimatta etkilenen yol, gerçek SDK/protokol sürümü, okunan resmî sürüm, değişen dosyalar ve çalıştırılan/atlanmış kontroller açık olsun. MCP kılavuzu Tecof'un ürün davranışını veya kullanıcı yetkisini kendiliğinden değiştirmez.
