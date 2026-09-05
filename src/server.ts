/**
 * McpServer fabrikası — stdio (bin.ts) ve ileride HTTP transport aynı fonksiyonu
 * kullanır. Her bağlantı için yeni McpServer üretilir (SDK v2 factory modeli),
 * ServerContext (katalog cache + /me cache) paylaşılır.
 *
 * İki mod (config.ts `McpMode`):
 *   local  → 26 araç bu paketten (0.1.x ile birebir).
 *   remote → araçlar backend kataloğundan (canlı ya da snapshot); yerel tema
 *            kataloğu varsa list_components/validate_document yerel, create/
 *            update_page hibrit (src/remote/registerRemoteTools.ts).
 */

import { McpServer } from "@modelcontextprotocol/server";
import { createRequire } from "node:module";
import { ServerContext } from "./context.js";
import { registerRemoteTools } from "./remote/registerRemoteTools.js";
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
import { registerListProducts } from "./tools/list_products.js";
import { registerGetProduct } from "./tools/get_product.js";
import { registerUpsertProducts } from "./tools/upsert_products.js";
import { registerDeleteProduct } from "./tools/delete_product.js";
import { registerGetProductImportTemplate } from "./tools/get_product_import_template.js";

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
    /* Ürün satırı bilinçli olarak "ANINDA CANLI" diyor: sayfa/CMS'te her yazma
       taslaktı, üründe DEĞİL. Bu ayrım ilk 512 karaktere sığmazsa ajan ürünü de
       taslak sanıp canlı kataloğu değiştirir. */
    "Tecof sayfa/CMS/ürün araçları. Sayfa+CMS yazması TASLAK'tır, yayını kullanıcı yapar. " +
    "Sayfa: get_site_context → list_components → create_page/update_page → get_preview_url. " +
    "CMS: list_cms_collections → get_cms_collection → create_cms_item. " +
    "Ürün: get_product → upsert_products (önce dryRun); \"active\" ANINDA CANLI. " +
    "Ortak bileşenlere dokunma; id üretme; çok dilli alanları tüm dillerde doldur. " +
    "Görsel: list_media/import_image/generate_image → uploadValue. " +
    "Silme ve canlı değişiklik kullanıcı onayı ister.";

export type BuildServerOptions = {
    ctx: ServerContext;
};

export function buildServer({ ctx }: BuildServerOptions): McpServer {
    if (ctx.mode === "remote") return buildRemoteServer(ctx);

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

    /* E-ticaret kataloğu — scope products:read / products:write.
       Sayfa/CMS'ten iki farkı var: temaya bağlı DEĞİL (themeId gönderilmez) ve
       yazma taslak değil (status:"active" doğrudan vitrine çıkar). */
    registerListProducts(server, ctx);
    registerGetProduct(server, ctx);
    registerUpsertProducts(server, ctx);
    registerDeleteProduct(server, ctx);
    registerGetProductImportTemplate(server, ctx);

    return server;
}

/**
 * Remote mod. Katalog `ctx.remoteCatalog.current()`'tan okunur — senkron: canlı
 * katalog daha gelmediyse snapshot'tır (bin.ts factory'de `ready()`'yi bekler,
 * testler de öyle). Canlı katalog sonradan gelirse eksik araçlar bu sunucuya
 * eklenir ve `tools/list_changed` gönderilir; tools/list böylece çevrimdışı da
 * deterministik kalır, başlangıç ağa bloklanmaz.
 */
function buildRemoteServer(ctx: ServerContext): McpServer {
    const state = ctx.remoteCatalog.current();
    /* Sunucu talimatı kataloğun kendi metnidir (backend SERVER_INSTRUCTIONS, ≤512);
       boşsa paketinki — iki yüzeyde aynı akış anlatılsın. */
    const instructions = state.catalog.instructions?.trim() || SERVER_INSTRUCTIONS;
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION, title: "Tecof" },
        { capabilities: { tools: { listChanged: true } }, instructions }
    );

    const registration = registerRemoteTools(server, ctx, state.catalog, { localCatalog: ctx.hasLocalCatalog() });

    /* Dinleyici sunucu ömrünce kalır: stdio'da tek bağlantı var; HTTP barındırmada
       istek başına fabrika kullanan bir sarmalayıcı `stop()`/`onUpdate` dönüşünü
       kendisi yönetmeli. */
    ctx.remoteCatalog.onUpdate((next) => {
        const added = registration.add(next.catalog.tools);
        if (!added.length) return;
        ctx.log(`Katalog yenilendi: ${added.length} yeni araç eklendi (${added.join(", ")}).`);
        try {
            if (server.isConnected()) server.sendToolListChanged();
        } catch (err: any) {
            ctx.log(`tools/list_changed gönderilemedi: ${err?.message ?? err}`);
        }
    });

    return server;
}

export { ServerContext };
