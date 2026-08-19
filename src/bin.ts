#!/usr/bin/env node
/**
 * `tecof-mcp` — stdio girişi. stdout JSON-RPC'ye ayrılmıştır; tüm loglar stderr.
 *
 * Başlangıçta backend'e GİDİLMEZ (tembel /me): token eksik/yanlış olsa da
 * istemci tools/list alabilsin ve kullanıcı hatayı tool yanıtında görsün.
 * Yalnız konfigürasyon eksikleri stderr'e yazılır.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { describeMissingConfig, loadConfig } from "./config.js";
import { ServerContext } from "./context.js";
import { buildServer, SERVER_VERSION } from "./server.js";

const log = (message: string) => {
    process.stderr.write(`[tecof-mcp] ${message}\n`);
};

/* Sunucu hiçbir koşulda sessizce çökmemeli: yakalanmamış bir hata stdout'u
   (JSON-RPC) kirletmeden stderr'e yazılır ve süreç devam eder. Node ≥15'te
   varsayılan davranış unhandledRejection'da exit 1 olduğu için bu şart. */
process.on("unhandledRejection", (reason: any) => {
    log(`UYARI: yakalanmamış promise hatası — ${reason?.stack ?? reason?.message ?? reason}`);
});
process.on("uncaughtException", (err: any) => {
    log(`UYARI: yakalanmamış istisna — ${err?.stack ?? err?.message ?? err}`);
});

const config = loadConfig();
const ctx = new ServerContext({ config, log });

log(`v${SERVER_VERSION} başlatılıyor — proje: ${config.projectDir}`);
for (const problem of describeMissingConfig(config)) log(`UYARI: ${problem}`);
if (config.apiUrl) log(`API: ${config.apiUrl} (kaynak: ${config.sources.TECOF_API_URL})`);
if (ctx.insecureApiUrlWarning) log(`UYARI: ${ctx.insecureApiUrlWarning}`);
if (config.themeId) log(`Tema: ${config.themeId} (kaynak: ${config.sources.TECOF_THEME_ID})`);

/* Token varsa /me'yi arka planda ısıt — hata olursa yalnız logla; sunucu yine de
   ayakta kalır ve ilk tool çağrısı aynı hatayı ajanın okuyabileceği biçimde döner.
   `.then(ok).catch(err)`: onFulfilled içindeki bir hata da catch'e düşsün. */
if (ctx.api) {
    ctx.site()
        .then((site) => log(`Bağlandı: ${site.me.merchant?.name ?? "?"} — tema: ${site.theme?.name ?? "(çözülemedi)"}; diller: ${site.lang.languages.join(",")}`))
        .catch((err) => log(`UYARI: /me başarısız — ${err?.message ?? err}`));
}

serveStdio(() => buildServer({ ctx }), {
    onerror: (error) => log(`transport hatası: ${error?.message ?? error}`),
});
