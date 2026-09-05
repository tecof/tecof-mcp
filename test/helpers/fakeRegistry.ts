/**
 * Sahte Tools API sunucusu (node:http, yalnız 127.0.0.1) — remote mod testleri
 * için `GET /api/v1/tools`, `POST /api/v1/tools/:name?stream=1` (SSE ya da düz
 * JSON), hibrit sayfa araçları için `GET /api/v1/me` ve `GET /api/v1/pages/:ref`.
 * Gerçek ağa çıkılmaz; her istek `calls` listesine kaydedilir.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import type { CatalogTool } from "../../src/remote/registryClient.js";
import type { TecofDocument } from "../../src/types.js";

export type FakeSseReply = { mode?: "sse"; progress?: Array<{ message?: string; percent?: number }>; status?: number; data: unknown; credit?: unknown; warnings?: unknown[] };
export type FakeSseErrorReply = { mode: "sse-error"; status: number; messageCode: string; message?: string; data?: unknown };
export type FakeJsonReply = { mode: "json"; status: number; body: unknown; headers?: Record<string, string> };
export type FakeReply = FakeSseReply | FakeSseErrorReply | FakeJsonReply;
export type FakeHandler = (input: any, req: { headers: http.IncomingHttpHeaders; query: URLSearchParams }) => FakeReply | Promise<FakeReply>;

export type FakePageSeed = { _id?: string; slug: string; title?: string; draftData: TecofDocument | null; modifiedDate?: string; isTemplate?: boolean };

export type FakeRegistryOptions = {
    token?: string;
    themeId?: string;
    tools?: CatalogTool[];
    instructions?: string;
    version?: string;
    handlers?: Record<string, FakeHandler>;
    /** Katalog isteğini bu kadar geciktir (zaman aşımı testi) */
    catalogDelayMs?: number;
    /** İlk n katalog isteğine 503 dön (arka plan yenileme testi) */
    catalogFailFirst?: number;
    pages?: FakePageSeed[];
    languages?: string[];
    defaultLanguage?: string;
    scopes?: string[];
};

export type RecordedCall = { method: string; path: string; query: Record<string, string>; headers: http.IncomingHttpHeaders; body: any };

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Kısa katalog tanımı üretir (varsayılanlar READ + boş şema). */
export function toolDef(partial: Partial<CatalogTool> & { name: string }): CatalogTool {
    return {
        module: "general",
        title: partial.name,
        description: `${partial.name} açıklaması`,
        inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: {} },
        annotations: READ,
        requires: { scopes: [] },
        timeoutMs: 300_000,
        ...partial,
    };
}

const envelope = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, message: "success", messageCode: "success", data, ...extra });
const fail = (messageCode: string, data: unknown = null, message = messageCode) => ({ success: false, message, messageCode, data });

export async function startFakeRegistry(opts: FakeRegistryOptions = {}) {
    const token = opts.token ?? "tcf_registry_test";
    const themeId = opts.themeId ?? "64b000000000000000000001";
    const tools = opts.tools ?? [];
    const handlers = opts.handlers ?? {};
    const calls: RecordedCall[] = [];
    const languages = opts.languages ?? ["tr", "en"];
    const defaultLanguage = opts.defaultLanguage ?? "tr";
    let counter = 1;
    const pages = (opts.pages ?? []).map((p) => ({
        _id: p._id ?? (counter++).toString(16).padStart(24, "0"),
        slug: p.slug,
        title: p.title ?? p.slug,
        draftData: p.draftData,
        modifiedDate: p.modifiedDate ?? "2026-09-01T09:00:00.000Z",
        isTemplate: p.isTemplate ?? false,
    }));
    let catalogRequests = 0;
    let catalogFailuresLeft = opts.catalogFailFirst ?? 0;

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: any = null;
        try {
            body = raw ? JSON.parse(raw) : null;
        } catch {
            body = raw;
        }
        calls.push({ method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), headers: req.headers, body });

        const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
            res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
            res.end(JSON.stringify(payload));
        };

        if (req.headers.authorization !== `Bearer ${token}`) return json(401, fail("token-invalid", null, "API anahtarı geçersiz."));

        const path = url.pathname.replace(/^\/api\/v1/, "");

        if (path === "/tools" && req.method === "GET") {
            catalogRequests += 1;
            if (opts.catalogDelayMs) await new Promise((r) => setTimeout(r, opts.catalogDelayMs));
            if (catalogFailuresLeft > 0) {
                catalogFailuresLeft -= 1;
                return json(503, fail("error-db", null, "geçici hata"));
            }
            return json(200, envelope({ instructions: opts.instructions ?? "Tecof sayfa/CMS/ürün araçları (SAHTE KATALOG).", version: opts.version ?? "9.9.9", surface: url.searchParams.get("surface") ?? "mcp", generatedAt: new Date().toISOString(), tools }));
        }

        const run = path.match(/^\/tools\/([a-z][a-z0-9_]*)$/);
        if (run && req.method === "POST") {
            const name = run[1];
            const handler = handlers[name];
            if (!handler) return json(404, fail("tool-not-found", { name }, "Araç bulunamadı."));
            const reply = await handler(body ?? {}, { headers: req.headers, query: url.searchParams });
            if (reply.mode === "json") return json(reply.status, reply.body, reply.headers);
            if (url.searchParams.get("stream") !== "1") {
                /* stream istenmediyse düz zarf */
                if (reply.mode === "sse-error") return json(reply.status, fail(reply.messageCode, reply.data ?? null, reply.message ?? reply.messageCode));
                return json(reply.status ?? 200, envelope(reply.data, { ...(reply.credit ? { credit: reply.credit } : {}), ...(reply.warnings ? { warnings: reply.warnings } : {}) }));
            }
            res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
            const frame = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
            res.write(": keepalive\n\n");
            if (reply.mode === "sse-error") {
                frame({ type: "error", status: reply.status, success: false, message: reply.message ?? reply.messageCode, messageCode: reply.messageCode, data: reply.data ?? null });
                return res.end();
            }
            for (const p of reply.progress ?? []) frame({ type: "progress", data: p });
            res.write(": keepalive\n\n");
            frame({ type: "result", status: reply.status ?? 200, success: true, message: "success", messageCode: "success", data: reply.data, ...(reply.credit ? { credit: reply.credit } : {}), ...(reply.warnings ? { warnings: reply.warnings } : {}) });
            return res.end();
        }

        if (path === "/me" && req.method === "GET") {
            return json(200, envelope({
                merchant: { _id: "m1", name: "Test Mağaza", slug: "test", productType: "website", languages, defaultLanguage, currentThemeId: themeId },
                user: { _id: "u1", name: "Test", surname: "User", email: "test@example.com" },
                token: { _id: "t1", name: "test", scopes: opts.scopes ?? ["pages:read", "pages:write"], expiresAt: "2027-01-01T00:00:00.000Z" },
                themes: [{ themeId, merchantThemeId: "mt-1", name: "Test Theme", domain: "shop.example.com", isCurrent: true }],
                panelUrl: "https://app.example.com",
            }));
        }

        const pageMatch = path.match(/^\/pages\/([^/]+)$/);
        if (pageMatch && req.method === "GET") {
            const ref = decodeURIComponent(pageMatch[1]);
            const page = pages.find((p) => p._id === ref || p.slug === ref);
            if (!page) return json(404, fail("not-found", { page: ref }, "Sayfa bulunamadı."));
            return json(200, envelope({
                _id: page._id, themeId, slug: page.slug, title: page.title, status: "draft", isTemplate: page.isTemplate, templateType: null,
                metaTitle: [], metaDescription: [], draftData: page.draftData, hasPublished: false,
                publishedDate: null, modifiedDate: page.modifiedDate, createDate: "2026-09-01T08:00:00.000Z",
                urls: { panel: `https://app.example.com/app/themes/mt-1/design/${page._id}` },
            }));
        }

        return json(404, fail("not-found"));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;

    return {
        url: `http://127.0.0.1:${port}`,
        token,
        themeId,
        tools,
        pages,
        calls,
        get catalogRequests() {
            return catalogRequests;
        },
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            }),
    };
}
