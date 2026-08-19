/**
 * McpServer fabrikası — stdio (bin.ts) ve ileride HTTP transport aynı fonksiyonu
 * kullanır. Her bağlantı için yeni McpServer üretilir (SDK v2 factory modeli),
 * ServerContext (katalog cache + /me cache) paylaşılır.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { createRequire } from "node:module";
import { ServerContext } from "./context.js";
import { registerCreatePage } from "./tools/create_page.js";
import { registerDeletePage } from "./tools/delete_page.js";
import { registerGetPage } from "./tools/get_page.js";
import { registerGetPreviewUrl } from "./tools/get_preview_url.js";
import { registerGetSiteContext } from "./tools/get_site_context.js";
import { registerListComponents } from "./tools/list_components.js";
import { registerListPages } from "./tools/list_pages.js";
import { registerUpdatePage } from "./tools/update_page.js";
import { registerValidateDocument } from "./tools/validate_document.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

export const SERVER_NAME = "tecof";
export const SERVER_VERSION: string = pkg.version;

/**
 * Sözleşme §3.4 — ilk 512 karakter kritik (Codex yalnız o kadarını gösterir);
 * akış ve yasaklar başta, ayrıntı sonda.
 */
export const SERVER_INSTRUCTIONS =
    "Tecof sayfa araçları. Yazmalar TASLAK'tır; yayınlamayı kullanıcı panelden yapar. " +
    "Akış: get_site_context → list_components (full) → validate_document → create_page/update_page → get_preview_url. " +
    "Ortak bileşenlere (Header/Footer) dokunma. Çok dilli alanları tüm diller için doldur. " +
    "Bölümleri yazarlık biçimiyle ver: {type, props, variant?, slots:{slot:[...]}} — draftData JSON'u elle yazma; id üretme (MCP üretir). " +
    "Alan adlarını ve select seçeneklerini list_components çıktısından al; slot'a yalnız allow listesindeki element tiplerini koy. " +
    "update_page için id'leri get_page (outline) çıktısından al; 409 alırsan sayfayı yeniden oku. " +
    "delete_page yalnız kullanıcı açıkça onayladıysa (confirm:true).";

export type BuildServerOptions = {
    ctx: ServerContext;
};

export function buildServer({ ctx }: BuildServerOptions): McpServer {
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION, title: "Tecof" },
        { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
    );

    registerGetSiteContext(server, ctx);
    registerListComponents(server, ctx);
    registerListPages(server, ctx);
    registerGetPage(server, ctx);
    registerValidateDocument(server, ctx);
    registerCreatePage(server, ctx);
    registerUpdatePage(server, ctx);
    registerDeletePage(server, ctx);
    registerGetPreviewUrl(server, ctx);

    return server;
}

export { ServerContext };
