/**
 * Uzak katalog durumu — canlı (`GET /api/v1/tools`) ya da paketle gelen anlık
 * görüntü (`catalog.snapshot.json`, backend `npm run tools:list -- --json`
 * çıktısı).
 *
 * Neden snapshot: MCP istemcileri sunucuyu oturum başında başlatır ve
 * `tools/list`'i hemen ister. Backend o anda erişilemezse (ağ yok, token
 * yanlış, sunucu bakımda) araç listesi yine deterministik olmalı; çağrı
 * anında zaten anlamlı bir hata döner. Başlangıç ağa BLOKLANMAZ: ilk fetch 3 sn
 * bütçeyle koşar, düşerse snapshot; canlı katalog arka planda gelince eksik
 * araçlar sunucuya eklenir (server.ts `onUpdate`).
 */

import snapshotJson from "./catalog.snapshot.json" with { type: "json" };
import { ApiError } from "../api.js";
import { RegistryClient, RegistryError, type ToolCatalog } from "./registryClient.js";

export type CatalogSource = "live" | "snapshot";

export type CatalogState = {
    catalog: ToolCatalog;
    source: CatalogSource;
    /** Canlı katalogun alındığı an (ms); snapshot'ta null */
    fetchedAt: number | null;
    /** Son fetch hatası (snapshot'a düşme nedeni); canlıda null */
    error: string | null;
};

/** Paketle gelen katalog anlık görüntüsü (isteğe bağlı toolsets filtresiyle). */
export function loadCatalogSnapshot(toolsets?: string[] | null): ToolCatalog {
    const snapshot = snapshotJson as unknown as ToolCatalog;
    return filterCatalog({ ...snapshot, tools: [...snapshot.tools] }, toolsets);
}

/** `toolsets` modül adlarına göre daraltır (backend `?toolsets=` ile aynı anlam; bilinmeyen ad yok sayılır). */
export function filterCatalog(catalog: ToolCatalog, toolsets?: string[] | null): ToolCatalog {
    if (!toolsets || !toolsets.length) return catalog;
    const allowed = new Set(toolsets);
    return { ...catalog, tools: catalog.tools.filter((t) => allowed.has(t.module)) };
}

export type RemoteCatalogOptions = {
    registry: RegistryClient | null;
    toolsets?: string[] | null;
    log?: (message: string) => void;
};

export class RemoteCatalog {
    private state: CatalogState;
    private readonly registry: RegistryClient | null;
    private readonly toolsets: string[] | null;
    private readonly log: (message: string) => void;
    private readyPromise: Promise<CatalogState> | null = null;
    private inflight: Promise<CatalogState> | null = null;
    private readonly listeners = new Set<(state: CatalogState) => void>();
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: RemoteCatalogOptions) {
        this.registry = options.registry;
        this.toolsets = options.toolsets ?? null;
        this.log = options.log ?? (() => undefined);
        this.state = {
            catalog: loadCatalogSnapshot(this.toolsets),
            source: "snapshot",
            fetchedAt: null,
            error: this.registry ? null : "TECOF_API_URL / TECOF_API_TOKEN eksik — canlı katalog denenmedi.",
        };
    }

    /** Anlık durum (senkron) — buildServer bunu okur; henüz fetch bitmediyse snapshot'tır. */
    current(): CatalogState {
        return this.state;
    }

    /**
     * İlk canlı deneme (bir kez). ASLA reddetmez: başarısızlıkta snapshot ile
     * döner ve nedeni loglar. bin.ts factory içinde bekler (≤ 3 sn).
     */
    ready(): Promise<CatalogState> {
        if (!this.readyPromise) this.readyPromise = this.refresh();
        return this.readyPromise;
    }

    /** Canlı kataloğu (yeniden) çeker; başarılıysa durum güncellenir ve dinleyiciler çağrılır. */
    refresh(): Promise<CatalogState> {
        if (this.inflight) return this.inflight;
        this.inflight = this.doRefresh().finally(() => {
            this.inflight = null;
        });
        return this.inflight;
    }

    private async doRefresh(): Promise<CatalogState> {
        if (!this.registry) return this.state;
        try {
            const catalog = await this.registry.fetchToolCatalog();
            const previousNames = new Set(this.state.catalog.tools.map((t) => t.name));
            this.state = { catalog, source: "live", fetchedAt: Date.now(), error: null };
            const added = catalog.tools.filter((t) => !previousNames.has(t.name)).length;
            for (const listener of [...this.listeners]) {
                try {
                    listener(this.state);
                } catch (err: any) {
                    this.log(`katalog dinleyicisi hata verdi: ${err?.message ?? err}`);
                }
            }
            if (added) this.log(`Canlı katalog güncellendi: ${catalog.tools.length} araç (${added} yeni).`);
            return this.state;
        } catch (err: any) {
            const reason = err instanceof ApiError ? err.toDisplayString() : err instanceof RegistryError ? `${err.messageCode}: ${err.message} [HTTP ${err.status}]` : String(err?.message ?? err);
            if (this.state.source === "snapshot") {
                this.state = { ...this.state, error: reason };
                this.log(`UYARI: canlı araç kataloğu alınamadı (${reason}); paketteki snapshot kullanılıyor (${this.state.catalog.tools.length} araç, v${this.state.catalog.version || "?"}).`);
            } else {
                this.log(`UYARI: katalog yenilenemedi (${reason}); son canlı katalog kullanılmaya devam ediyor.`);
            }
            return this.state;
        }
    }

    /** Canlı katalog geldiğinde/yenilendiğinde çağrılır. Dönen fonksiyon aboneliği kaldırır. */
    onUpdate(listener: (state: CatalogState) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Arka plan yenileme. Zamanlayıcı `unref` — süreç istemci kapanınca yaşamaya
     * devam etmesin. Snapshot'la başlandıysa ilk deneme daha erken (30 sn) yapılır:
     * geçici bir ağ kesintisi tüm oturumu snapshot'ta bırakmasın.
     */
    startBackgroundRefresh(intervalMs = 10 * 60_000, retryMs = 30_000): void {
        if (!this.registry || this.timer) return;
        const tick = () => {
            void this.refresh();
        };
        this.timer = setInterval(tick, intervalMs);
        if (typeof (this.timer as any).unref === "function") (this.timer as any).unref();
        void this.ready().then((state) => {
            if (state.source !== "snapshot") return;
            const retry = setTimeout(tick, retryMs);
            if (typeof (retry as any).unref === "function") (retry as any).unref();
        });
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.listeners.clear();
    }
}
