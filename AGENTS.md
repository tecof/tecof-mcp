# Tecof MCP çalışma kuralları

Önce git status --short ile başlangıç değişikliklerini ayır, README.md ve [docs indeksinden](docs/README.md) yalnız ilgili belgeyi oku. Diğer kullanıcı çalışmalarını koru; görev kapsamını ve mevcut yetkisini esas al.

MCP sürümü/SDK, stdio/HTTP bağlantısı veya yetkilendirme işinde [tecof-mcp-protocol](.agents/skills/tecof-mcp-protocol/SKILL.md) kullan. Kaynak .agents/skills altında; .claude/skills aynı repo içindeki dosyalara bağlanır.

Mevcut kod, kurulu paket ve ilgili sürümün resmî belgelerini karşılaştır. Yalnız skill değişikliği için sunucu başlatma veya paket yayınlama gerekmez. Yeni/değişen davranışın belgesini güncelle; yoksa docs altında oluştur ve indekse ekle. Çalıştırılmayan test veya erişilemeyen backend'i doğrulanmış sayma.
