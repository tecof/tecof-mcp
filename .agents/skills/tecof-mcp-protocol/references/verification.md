# MCP bağlantısını kanıtla

Matrisi yalnız değişen yola uygula. [Yerel haritadaki](../../../../docs/MCP_PROTOCOL.md) test/handler'ları incele; yeni runner veya genel audit değişikliğin ön koşulu değildir.

| Değişiklik | Anlamlı kontrol |
|---|---|
| SDK/lifecycle | Gerçek test istemcisiyle sürüme uygun ilk bağlantı/keşif; desteklenmeyen sürümün sonucu; capability'nin gerçek handler'ı |
| HTTP | JSON ve gerekiyorsa SSE, Content-Type/Accept, ilgili metadata, auth challenge ve Origin reddi; yalnız health kontrolü yeterli değildir |
| Stdio | stdout yalnız MCP mesajları; log stderr; başlangıç/kapanış ve cleanup; gerçek kullanıcı env'ini devralmayan fixture |
| Auth/tenant | Geçerli, eksik/iptal kimlik, yetersiz scope ve başka merchant; kaynak metadata URL'si ve token hedefi |
| Tool adapter | Input/output şeması, content/structuredContent, protokol hatası ile isError tool hatası ayrımı |
| Remote proxy | Katalog/snapshot, JSON/SSE sonuçları, hata dönüşümü, ilgili istek için progress ve varsa yerel hibrit davranış |
| Progress/iptal/retry | Hedef sürümün iptal yoluyla terminal sonuç ve cleanup; retry'nin mutasyonu tekrarlamaması |

Smoke'un hangi transport/protokol sürümünü sınadığını kodundan oku. InMemoryTransport testi HTTP header/Origin/OAuth davranışını kanıtlamaz; legacy initialize testi modern server/discover yolunu kanıtlamaz.

Inspector gerektiğinde önce araç sürümünü/yardımını, sonra hedefin yerel/test sunucusu olduğunu doğrula. Kayıtlarda yalnız temsili token kullan. Canlı sunucuya geçiş veya görünür mutasyon görevin yetkisi içinde olmalıdır. Ortam/servis eksiği varsa sonucu açık bırak; fixture başarısını canlı başarı diye raporlama.

Doğrulama kaydı: transport/mod, sunucu/istemci ve protokol sürümü, komut/senaryo, passed/failed/not run ve kapsam. Yalnız skill/belge düzenlemesinde uygulama testlerinin tamamını çalıştırmak gerekmez.
