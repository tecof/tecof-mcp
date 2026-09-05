#!/usr/bin/env node
/**
 * Duman testi: dist/bin.js'i stdio üzerinden ayağa kaldırır, JSON-RPC ile
 * initialize → notifications/initialized → tools/list gönderir ve beklenen tool
 * adlarının geldiğini doğrular. Backend'e gitmez: sahte token + erişilemeyen
 * URL verilir; sunucu yine de kalkmalı (tembel /me).
 *
 * Fazlar:
 *   1) local mod, erişilemeyen API — tools/list 17 ad, diskten araçlar çalışır
 *   2) local mod, geçersiz /me zarfı — süreç çökmez, hata tool yanıtında
 *   3) remote mod, sahte katalog sunucusu (node:http, 127.0.0.1) — katalog araçları
 *      + yerel list_components/validate_document + hibrit create/update_page; SSE çağrı
 *   4) remote mod, erişilemeyen API — snapshot (tüm araçlar) ile 10 sn bütçede ayağa kalkar
 *
 * Kullanım: node scripts/smoke.mjs   (önce npm run build)
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bin = path.join(root, "dist", "bin.js");

const EXPECTED_TOOLS = [
    "get_site_context",
    "list_components",
    "list_pages",
    "get_page",
    "validate_document",
    "create_page",
    "update_page",
    "delete_page",
    "get_preview_url",
    "list_media",
    "import_image",
    "generate_image",
    "list_products",
    "get_product",
    "upsert_products",
    "delete_product",
    "get_product_import_template",
];

const child = spawn(process.execPath, [bin], {
    cwd: root,
    env: {
        ...process.env,
        TECOF_PROJECT_DIR: path.join(root, "test", "fixtures", "theme"),
        TECOF_API_URL: "http://127.0.0.1:9", // kapalı port — bağlantı hatası beklenir, sunucu çökmemeli
        TECOF_API_TOKEN: "tcf_smoke_test_token_not_real",
        TECOF_THEME_ID: "000000000000000000000000",
    },
    stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => {
    stderr += d.toString();
});

const pending = new Map();
let nextId = 1;
let buffer = "";
child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            console.error("stdout'ta JSON olmayan satır:", line);
            continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        }
    }
});

function send(message) {
    child.stdin.write(JSON.stringify(message) + "\n");
}

function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: "2.0", id, method, params });
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error(`${method} zaman aşımı`));
            }
        }, 15_000);
    });
}

function notify(method, params) {
    send({ jsonrpc: "2.0", method, params });
}

const fail = (msg) => {
    console.error("SMOKE FAIL:", msg);
    console.error("--- stderr ---\n" + stderr);
    child.kill();
    process.exit(1);
};

child.on("exit", (code) => {
    if (code !== null && code !== 0 && pending.size) fail(`sunucu çıktı (code ${code})`);
});

try {
    const init = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "tecof-mcp-smoke", version: "0.0.0" },
    });
    if (!init?.serverInfo?.name) fail("initialize yanıtı serverInfo içermiyor: " + JSON.stringify(init));
    console.log(`initialize ✓  server=${init.serverInfo.name}@${init.serverInfo.version} protocol=${init.protocolVersion}`);
    if (!init.instructions || !init.instructions.startsWith("Tecof sayfa")) fail("instructions beklenen metinle başlamıyor");
    console.log(`instructions ✓ (${init.instructions.length} karakter)`);

    notify("notifications/initialized", {});

    const tools = await request("tools/list", {});
    const names = (tools?.tools ?? []).map((t) => t.name);
    const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
    if (missing.length) fail("eksik tool'lar: " + missing.join(", ") + " — gelenler: " + names.join(", "));
    console.log(`tools/list ✓  ${names.length} tool: ${names.join(", ")}`);

    const del = tools.tools.find((t) => t.name === "delete_page");
    if (!del.annotations?.destructiveHint) fail("delete_page destructiveHint yok");
    if (!del._meta?.["anthropic/requiresUserInteraction"]) fail("delete_page _meta.anthropic/requiresUserInteraction yok");
    console.log("delete_page annotations ✓");

    const readOnly = ["get_site_context", "list_components", "list_pages", "get_page", "validate_document", "get_preview_url"];
    for (const n of readOnly) {
        const t = tools.tools.find((x) => x.name === n);
        if (!t.annotations?.readOnlyHint) fail(`${n} readOnlyHint yok`);
    }
    console.log("readOnlyHint ✓");

    // Diske dayalı tool: backend'siz çalışmalı
    const lc = await request("tools/call", { name: "list_components", arguments: { detail: "summary" } });
    const lcData = lc?.structuredContent ?? JSON.parse(lc.content[0].text);
    if (lc.isError || !lcData.count || lcData.count < 5) fail("list_components beklenen sonucu vermedi: " + JSON.stringify(lc).slice(0, 400));
    console.log(`list_components ✓  ${lcData.count} bileşen (${lcData.components.map((c) => c.componentName).join(", ")})`);

    // validate_document: backend yoksa "tr" ile devam etmeli, hata listesi dönmeli
    const vd = await request("tools/call", {
        name: "validate_document",
        arguments: { sections: [{ type: "FeaturesSection", props: { columns: "9" } }, { type: "Title" }] },
    });
    const vdData = vd?.structuredContent ?? JSON.parse(vd.content[0].text);
    if (vd.isError || vdData.ok !== false || !vdData.errors?.some((e) => e.code === "invalid-option") || !vdData.errors?.some((e) => e.code === "element-at-root")) {
        fail("validate_document beklenen hataları vermedi: " + JSON.stringify(vd).slice(0, 600));
    }
    console.log(`validate_document ✓  ${vdData.errors.length} hata, ${vdData.warnings.length} uyarı (backend'siz)`);

    // Backend gerektiren tool: bağlantı hatası isError olarak dönmeli, sunucu çökmemeli
    const lp = await request("tools/call", { name: "list_pages", arguments: {} });
    if (!lp.isError) fail("list_pages erişilemeyen backend'de isError dönmeli");
    console.log(`list_pages ✓  isError (beklenen): ${lp.content[0].text.split("\n")[0].slice(0, 120)}`);

    child.kill();

    // ── Faz 2: /me geçersiz zarf döndüren yerel HTTP sunucusu — süreç çökmemeli (#3)
    await phaseInvalidMe();

    // ── Faz 3: remote mod + sahte katalog sunucusu (SSE çağrı dahil)
    await phaseRemoteLive();

    // ── Faz 4: remote mod + erişilemeyen API → snapshot, başlangıç bütçesi
    await phaseRemoteSnapshot();

    console.log("\nSMOKE OK");
    process.exit(0);
} catch (err) {
    fail(err?.message ?? String(err));
}

async function phaseInvalidMe() {
    const { createServer } = await import("node:http");
    const http = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        // 2xx + success:true ama merchant/themes yok → fetchSite reddetmeli, bin çökmemeli
        res.end(JSON.stringify({ success: true, data: {} }));
    });
    await new Promise((r) => http.listen(0, "127.0.0.1", r));
    const port = http.address().port;

    const proc = spawn(process.execPath, [bin], {
        cwd: root,
        env: {
            ...process.env,
            TECOF_PROJECT_DIR: path.join(root, "test", "fixtures", "theme"),
            TECOF_API_URL: `http://127.0.0.1:${port}`,
            TECOF_API_TOKEN: "tcf_smoke_test_token_not_real",
        },
        stdio: ["pipe", "pipe", "pipe"],
    });
    let err2 = "";
    proc.stderr.on("data", (d) => (err2 += d.toString()));
    const pend = new Map();
    let id2 = 1;
    let buf2 = "";
    proc.stdout.on("data", (chunk) => {
        buf2 += chunk.toString();
        let i;
        while ((i = buf2.indexOf("\n")) >= 0) {
            const line = buf2.slice(0, i).trim();
            buf2 = buf2.slice(i + 1);
            if (!line) continue;
            try {
                const m = JSON.parse(line);
                if (m.id !== undefined && pend.has(m.id)) {
                    pend.get(m.id)(m);
                    pend.delete(m.id);
                }
            } catch { /* yoksay */ }
        }
    });
    const req2 = (method, params) =>
        new Promise((resolve, reject) => {
            const id = id2++;
            pend.set(id, resolve);
            proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
            setTimeout(() => reject(new Error(`${method} zaman aşımı (faz 2)`)), 15_000);
        });

    let exited = false;
    proc.on("exit", () => (exited = true));

    await req2("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke2", version: "0" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    // /me ısıtmasının bitmesi için kısa bekleme
    await new Promise((r) => setTimeout(r, 500));
    if (exited) {
        http.close();
        fail("faz 2: sunucu geçersiz /me yanıtında çöktü\n" + err2);
    }
    const lp = await req2("tools/call", { name: "list_pages", arguments: {} });
    if (!lp.result?.isError || !/Geçersiz \/me yanıtı/.test(lp.result.content[0].text)) {
        http.close();
        fail("faz 2: list_pages 'Geçersiz /me yanıtı' hatası vermedi: " + JSON.stringify(lp).slice(0, 300));
    }
    if (!/\/me başarısız/.test(err2)) {
        http.close();
        fail("faz 2: stderr'de '/me başarısız' uyarısı yok:\n" + err2);
    }
    console.log("faz 2 ✓  geçersiz /me zarfında sunucu ayakta kaldı, hata tool yanıtında ve stderr'de");
    proc.kill();
    http.close();
}


/* ── Ortak yardımcı: bin.js'i verilen env ile başlatır; JSON-RPC istek/bildirim
   ve stderr toplayıcı döner. Faz 1/2 kendi kopyalarını taşır (dokunulmadı). */
async function spawnServer(env, label) {
    const proc = spawn(process.execPath, [bin], { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    const pend = new Map();
    const notes = [];
    let nextId = 1;
    let buf = "";
    proc.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            try {
                const m = JSON.parse(line);
                if (m.id !== undefined && pend.has(m.id)) {
                    pend.get(m.id)(m);
                    pend.delete(m.id);
                } else if (m.method) {
                    notes.push(m);
                }
            } catch { /* yoksay */ }
        }
    });
    let exited = false;
    proc.on("exit", () => (exited = true));
    const req = (method, params, timeoutMs = 15_000) =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            pend.set(id, resolve);
            proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
            setTimeout(() => reject(new Error(`${method} zaman aşımı (${label})`)), timeoutMs);
        });
    const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    return { proc, req, notify, notes, stderr: () => err, exited: () => exited, kill: () => proc.kill() };
}

/** Sahte Tools API: GET /api/v1/tools kataloğu + POST /api/v1/tools/:name?stream=1 SSE. */
async function startFakeCatalog() {
    const { createServer } = await import("node:http");
    const { readFileSync } = await import("node:fs");
    const snapshot = JSON.parse(readFileSync(path.join(root, "src", "remote", "catalog.snapshot.json"), "utf8"));
    const pick = (name) => snapshot.tools.find((t) => t.name === name);
    const tools = [pick("get_site_context"), pick("delete_page"), pick("domain_list"), pick("create_page"), pick("update_page"), pick("list_components"), pick("validate_document")];
    const TOKEN = "tcf_smoke_remote_token";
    const calls = [];
    const http = createServer(async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : {};
        calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
        const json = (status, payload) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
        };
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { success: false, messageCode: "token-invalid", message: "geçersiz", data: null });
        if (url.pathname === "/api/v1/tools" && req.method === "GET") {
            return json(200, { success: true, message: "success", messageCode: "success", data: { instructions: snapshot.instructions, version: "smoke", surface: "mcp", tools } });
        }
        if (url.pathname === "/api/v1/tools/get_site_context" && req.method === "POST") {
            res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" });
            res.write(": keepalive\n\n");
            res.write(`data: ${JSON.stringify({ type: "progress", data: { message: "bağlanıyor", percent: 50 } })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "result", status: 200, success: true, message: "success", messageCode: "success", data: { merchant: { name: "Smoke" }, pageCount: 3 }, warnings: ["smoke-uyarı"] })}\n\n`);
            return res.end();
        }
        if (url.pathname === "/api/v1/tools/delete_page" && req.method === "POST") {
            res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            res.write(`data: ${JSON.stringify({ type: "error", status: 409, success: false, messageCode: "confirmation-required", message: "Onay gerekli.", data: { needsConfirmation: true, confirmId: "smoke-cf", summary: "silinecek", expiresAt: "2026-09-05T00:00:00.000Z" } })}\n\n`);
            return res.end();
        }
        return json(404, { success: false, messageCode: "tool-not-found", message: "yok", data: null });
    });
    await new Promise((r) => http.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${http.address().port}`, token: TOKEN, calls, tools, close: () => http.close() };
}

async function phaseRemoteLive() {
    const fake = await startFakeCatalog();
    const srv = await spawnServer(
        {
            TECOF_PROJECT_DIR: path.join(root, "test", "fixtures", "theme"),
            TECOF_API_URL: fake.url,
            TECOF_API_TOKEN: fake.token,
            TECOF_THEME_ID: "000000000000000000000000",
            TECOF_MCP_MODE: "remote",
        },
        "faz 3"
    );
    const done = (msg) => {
        srv.kill();
        fake.close();
        if (msg) fail("faz 3: " + msg + "\n--- stderr ---\n" + srv.stderr());
    };
    try {
        const init = await srv.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke3", version: "0" } });
        if (!init.result?.serverInfo?.name) return done("initialize başarısız: " + JSON.stringify(init).slice(0, 300));
        if (!init.result.instructions?.startsWith("Tecof sayfa")) return done("instructions katalogtan gelmedi");
        srv.notify("notifications/initialized", {});

        const list = await srv.req("tools/list", {});
        const names = (list.result?.tools ?? []).map((t) => t.name);
        const expected = ["get_site_context", "delete_page", "domain_list", "create_page", "update_page", "list_components", "validate_document"];
        const missing = expected.filter((n) => !names.includes(n));
        if (missing.length) return done("eksik araçlar: " + missing.join(", ") + " — gelenler: " + names.join(", "));
        if (names.length !== expected.length) return done(`beklenmeyen araç sayısı ${names.length}: ${names.join(", ")}`);
        const del = list.result.tools.find((t) => t.name === "delete_page");
        if (!del._meta?.["anthropic/requiresUserInteraction"] || !del.annotations?.destructiveHint) return done("delete_page _meta/annotations katalogtan geçmedi");
        const cp = list.result.tools.find((t) => t.name === "create_page");
        if (JSON.stringify(cp.inputSchema.required) !== JSON.stringify(["slug", "title", "sections"])) return done("create_page hibrit (yerel) şema değil: " + JSON.stringify(cp.inputSchema.required));
        const lc = list.result.tools.find((t) => t.name === "list_components");
        if (!/diskten/.test(lc.description)) return done("list_components yerel tanım değil");
        console.log(`faz 3 ✓  tools/list ${names.length} araç (katalog + yerel + hibrit)`);

        if (!/canlı/.test(srv.stderr())) return done("stderr'de 'canlı' katalog logu yok");
        const catalogCall = fake.calls.find((c) => c.path === "/api/v1/tools");
        if (!catalogCall || catalogCall.query.surface !== "mcp" || catalogCall.headers["x-tecof-surface"] !== "mcp") return done("katalog isteği surface=mcp + X-Tecof-Surface ile gelmedi");

        const call = await srv.req("tools/call", { name: "get_site_context", arguments: {}, _meta: { progressToken: "smoke-pt" } });
        const data = call.result?.structuredContent;
        if (call.result?.isError || data?.merchant?.name !== "Smoke" || data?.pageCount !== 3 || !Array.isArray(data?.warnings)) return done("get_site_context SSE sonucu beklenen değil: " + JSON.stringify(call).slice(0, 400));
        const prog = srv.notes.find((n) => n.method === "notifications/progress");
        if (!prog || prog.params.progressToken !== "smoke-pt" || prog.params.progress !== 50) return done("progress bildirimi gelmedi/yanlış: " + JSON.stringify(srv.notes).slice(0, 300));
        const post = fake.calls.find((c) => c.method === "POST");
        if (post.query.stream !== "1" || post.headers["x-tecof-surface"] !== "mcp") return done("POST ?stream=1 + X-Tecof-Surface yok");
        console.log("faz 3 ✓  SSE çağrı: progress (token'lı) + result → structuredContent");

        const conf = await srv.req("tools/call", { name: "delete_page", arguments: { page: "home" } });
        if (!conf.result?.isError || conf.result.structuredContent?.error !== "confirmation-required" || conf.result.structuredContent?.confirmId !== "smoke-cf") return done("confirmation-required zarfı errorResult'a çevrilmedi: " + JSON.stringify(conf).slice(0, 400));
        console.log("faz 3 ✓  hata zarfı: confirmation-required → isError + structuredContent.error/confirmId");

        // Yerel araç remote modda da diskten çalışmalı
        const local = await srv.req("tools/call", { name: "list_components", arguments: { detail: "summary" } });
        if (local.result?.isError || !(local.result?.structuredContent?.count >= 5)) return done("list_components remote modda yerel çalışmadı");
        console.log("faz 3 ✓  list_components remote modda diskten");
        done(null);
    } catch (err) {
        done(err?.message ?? String(err));
    }
}

async function phaseRemoteSnapshot() {
    const t0 = Date.now();
    const srv = await spawnServer(
        {
            TECOF_PROJECT_DIR: path.join(root, "test", "fixtures", "theme"),
            TECOF_API_URL: "http://127.0.0.1:9", // kapalı port
            TECOF_API_TOKEN: "tcf_smoke_test_token_not_real",
            TECOF_MCP_MODE: "remote",
            TECOF_TOOLSETS: "", // boş → hepsi
        },
        "faz 4"
    );
    const done = (msg) => {
        srv.kill();
        if (msg) fail("faz 4: " + msg + "\n--- stderr ---\n" + srv.stderr());
    };
    try {
        const init = await srv.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke4", version: "0" } });
        if (!init.result?.serverInfo?.name) return done("initialize başarısız");
        srv.notify("notifications/initialized", {});
        const list = await srv.req("tools/list", {});
        const elapsed = Date.now() - t0;
        const names = (list.result?.tools ?? []).map((t) => t.name);
        const { readFileSync: readSnap } = await import("node:fs");
        const SNAPSHOT_TOOL_COUNT = JSON.parse(readSnap(path.join(root, "src", "remote", "catalog.snapshot.json"), "utf8")).tools.length;
        if (names.length !== SNAPSHOT_TOOL_COUNT) return done(`snapshot ${SNAPSHOT_TOOL_COUNT} araç bekleniyordu, ${names.length} geldi`);
        if (elapsed > 10_000) return done(`başlangıç ${elapsed} ms — Codex 10 sn bütçesi aşıldı`);
        if (!/snapshot/.test(srv.stderr())) return done("stderr'de snapshot uyarısı yok");
        if (srv.exited()) return done("süreç çıktı");
        const lp = await srv.req("tools/call", { name: "list_pages", arguments: {} });
        if (!lp.result?.isError || !/ulaşılamadı/.test(lp.result.content[0].text)) return done("list_pages erişilemeyen backend'de 'ulaşılamadı' hatası vermedi: " + JSON.stringify(lp).slice(0, 300));
        console.log(`faz 4 ✓  remote + erişilemeyen API: snapshot ${names.length} araç, tools/list ${elapsed} ms, hata tool yanıtında`);
        done(null);
    } catch (err) {
        done(err?.message ?? String(err));
    }
}
