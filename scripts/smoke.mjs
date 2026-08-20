#!/usr/bin/env node
/**
 * Duman testi: dist/bin.js'i stdio üzerinden ayağa kaldırır, JSON-RPC ile
 * initialize → notifications/initialized → tools/list gönderir ve beklenen tool
 * adlarının geldiğini doğrular. Backend'e gitmez: sahte token + erişilemeyen
 * URL verilir; sunucu yine de kalkmalı (tembel /me).
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
    if (!init.instructions || !init.instructions.startsWith("Tecof sayfa araçları")) fail("instructions beklenen metinle başlamıyor");
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
