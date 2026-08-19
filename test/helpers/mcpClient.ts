/**
 * Minimal in-process MCP istemcisi — InMemoryTransport çifti üzerinden ham
 * JSON-RPC konuşur. Tool'ları GERÇEK sunucu katmanından (zod doğrulama,
 * annotations, isError) geçirerek test etmek için; @modelcontextprotocol/client
 * bağımlılığı eklemeden.
 */

import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";

export async function connectTestClient(server: McpServer) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    let nextId = 1;

    clientSide.onmessage = (message: any) => {
        if (message.id !== undefined && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id)!;
            pending.delete(message.id);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
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
        listTools: async () => (await request("tools/list")).tools as any[],
        callTool: async (name: string, args: Record<string, unknown> = {}) => {
            const res = await request("tools/call", { name, arguments: args });
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
