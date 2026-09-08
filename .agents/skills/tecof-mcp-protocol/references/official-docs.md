# Göreve ve sürüme göre MCP kaynağı

Başlangıç: [resmî llms.txt indeksi](https://modelcontextprotocol.io/llms.txt). İndeks bir keşif aracıdır; bağlantı verdiği sayfayı okumadan içerik doğrulanmış sayılmaz.

- Önce yerel paketin SDK export'larını ve sunucu/istemcinin desteklediği protokol sürümünü belirle. Kurulu SDK kaynakları ve lockfile, eski örnekten daha doğrudan API kanıtıdır.
- Aynı başlığın farklı tarihli sürümleri ve draft karşılığı olabilir. Hedef için uygun tarihli sayfayı seç; draft ancak deneysel değişiklik açıkça istenmişse dayanak olur. En yeni belgeyi otomatik migration talebi sayma.
- Hedef sürüm bilinmiyorsa mevcut handler ve test client'ı incele. Web aracı .md sayfasını açamıyorsa aynı sürümlü HTML karşılığını kullan; yönlendirme sonrası sürümü kontrol et. Ağ yoksa yerel kaynakla ilerle ve resmî belge doğrulamasının yapılmadığını belirt.

| Görev | İndeksten açılacak başlık |
|---|---|
| SDK/export veya sürüm geçişi | SDKs; Versioning and Compatibility; Key Changes/Deprecated Features |
| İlk bağlantı ve capability | Hedef sürümün Lifecycle veya Discovery; Architecture |
| HTTP/stdio | Hedef sürümün Transports ve Authorization |
| Tool sonucu/şema/hata | Tools; Schema Reference |
| Progress/iptal/timeout | Hedef sürümün Progress ve Cancellation |
| Kaynak, prompt veya etkileşim | Yalnız ilgili Resources, Prompts, Elicitation/Sampling bölümü |
| Yerel test/istemci sorunu | Inspector; Debugging; kullanılan Inspector sürümünün Configuration and flags |

## Sürüm ayrımının somut örneği

[2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) protokol oturumu ve bağımsız GET stream davranışını değiştirdi. [Aynı sürümün stdio belgesi](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) modern keşif ile legacy initialize uyumluluğunu ayrı ele alıyor. Bu örnekler sürüm seçme gerekçesidir; checkout'un bütün bu davranışları uyguladığı anlamına gelmez.

[Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) incelemesinde HTTP kaynak sunucusu ve OAuth yetkilendirme sunucusunun rollerini ayır. Stdio sürecine verilen ortam kimliğiyle HTTP OAuth akışını tek kurulum yolu sayma.

## Destekleyici kaynaklar

- [Build with Agent Skills](https://modelcontextprotocol.io/docs/develop/build-with-agent-skills): tasarım ve ihtiyaç halinde ayrıntı okuma referansı; mevcut Tecof sunucusunu yeniden scaffold etme veya plugin kurma talebi değildir.
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector): kullanılan sürümün yardım/flag ve Node gereksinimini doğrula. Tekrarlanabilir kontrolün sürümünü kaydet; latest komutunu CI sürüm sabitlemesi yerine kullanma.

Ürün sözleşmesi yerel docs'ta; protokolün dayanağı okunan resmî sürümdedir. Kaynak URL'si ve doğrulama tarihini tut, kılavuzun tamamını kopyalama.
