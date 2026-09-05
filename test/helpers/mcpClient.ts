/**
 * Minimal in-process MCP istemcisi — InMemoryTransport çifti üzerinden ham
 * JSON-RPC konuşur. Tool'ları GERÇEK sunucu katmanından (zod doğrulama,
 * annotations, isError) geçirerek test etmek için; @modelcontextprotocol/client
 * bağımlılığı eklemeden.
 *
 * Sunucudan gelen bildirimler (`notifications/progress`, `tools/list_changed`)
 * `notifications` dizisinde birikir — remote mod testleri progressToken kuralını
 * buradan doğrular. `callTool` üçüncü parametreyle istek `_meta`'sı gönderebilir.
 */

import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";

export type CallToolOpts = {
    /** `tools/call` isteğinin `_meta`'sı (örn. { progressToken: "x" }) */
    meta?: Record<string, unknown>;
};

export async function connectTestClient(server: McpServer) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    const notifications: Array<{ method: string; params?: any }> = [];
    let nextId = 1;

    clientSide.onmessage = (message: any) => {
        if (message.id !== undefined && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id)!;
            pending.delete(message.id);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
        } else if (message.method && message.id === undefined) {
            notifications.push({ method: message.method, params: message.params });
        }
    };

    await server.connect(serverSide);
    await clientSide.start();

    const request = (method: string, params: any = {}) =>
        new Promise<any>((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            clientSide.send({ jsonrpc: "2.0", id, method, params } as any);
        });

    const init = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
    });
    await clientSide.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} } as any);

    return {
        init,
        request,
        notifications,
        listTools: async () => (await request("tools/list")).tools as any[],
        callTool: async (name: string, args: Record<string, unknown> = {}, opts: CallToolOpts = {}) => {
            const res = await request("tools/call", { name, arguments: args, ...(opts.meta ? { _meta: opts.meta } : {}) });
            const text = res.content?.[0]?.text ?? "";
            let data: any = res.structuredContent;
            if (data === undefined) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = undefined;
                }
            }
            return { raw: res, isError: !!res.isError, text, data };
        },
        close: async () => {
            await clientSide.close();
            await server.close();
        },
    };
}
