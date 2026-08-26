/**
 * McpServer fabrikası — stdio (bin.ts) ve ileride HTTP transport aynı fonksiyonu
 * kullanır. Her bağlantı için yeni McpServer üretilir (SDK v2 factory modeli),
 * ServerContext (katalog cache + /me cache) paylaşılır.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { createRequire } from "node:module";
import { ServerContext } from "./context.js";
import { registerCreateCmsCollection } from "./tools/create_cms_collection.js";
import { registerCreateCmsItem } from "./tools/create_cms_item.js";
import { registerCreatePage } from "./tools/create_page.js";
import { registerDeleteCmsItem } from "./tools/delete_cms_item.js";
import { registerGetCmsCollection } from "./tools/get_cms_collection.js";
import { registerGetCmsItem } from "./tools/get_cms_item.js";
import { registerListCmsCollections } from "./tools/list_cms_collections.js";
import { registerListCmsItems } from "./tools/list_cms_items.js";
import { registerUpdateCmsCollection } from "./tools/update_cms_collection.js";
import { registerUpdateCmsItem } from "./tools/update_cms_item.js";
import { registerDeletePage } from "./tools/delete_page.js";
import { registerGetPage } from "./tools/get_page.js";
import { registerGetPreviewUrl } from "./tools/get_preview_url.js";
import { registerGetSiteContext } from "./tools/get_site_context.js";
import { registerListMedia } from "./tools/list_media.js";
import { registerImportImage } from "./tools/import_image.js";
import { registerGenerateImage } from "./tools/generate_image.js";
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
    /* Sözleşme §3.4 — ilk 512 karakter kritik (Codex yalnız o kadarını gösterir).
       Bütçe test'te ölçülür (test/server.test.ts): akış ve yasaklar ilk cümlelerde,
       ayrıntı araç açıklamalarında durur — burada tekrarlanmaz. */
    "Tecof sayfa + CMS araçları. Tüm yazmalar TASLAK'tır; yayınlamayı kullanıcı panelden yapar. " +
    "Sayfa: get_site_context → list_components → create_page/update_page → get_preview_url. " +
    "CMS: list_cms_collections → get_cms_collection (alan biçimleri) → create_cms_item. " +
    "Ortak bileşenlere (Header/Footer) dokunma; id üretme; çok dilli alanları tüm dillerde doldur. " +
    "Görsel: list_media / import_image / generate_image çıktısındaki uploadValue'yu kullan. " +
    "Silme ve canlı içerik değişikliği kullanıcı onayı ister.";

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

    /* Headless CMS — koleksiyon (içerik tipi) şeması + içerik kayıtları.
       Sayfa araçlarıyla aynı sözleşme: yazmalar TASLAK'tır, yayın panelden. */
    registerListCmsCollections(server, ctx);
    registerGetCmsCollection(server, ctx);
    registerCreateCmsCollection(server, ctx);
    registerUpdateCmsCollection(server, ctx);
    registerListCmsItems(server, ctx);
    registerGetCmsItem(server, ctx);
    registerCreateCmsItem(server, ctx);
    registerUpdateCmsItem(server, ctx);
    registerDeleteCmsItem(server, ctx);
    registerGetPreviewUrl(server, ctx);
    registerListMedia(server, ctx);
    registerImportImage(server, ctx);
    registerGenerateImage(server, ctx);

    return server;
}

export { ServerContext };
