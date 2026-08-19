/**
 * Çalışma bağlamı çözümü (sözleşme §3.1).
 *
 * Neden kendi .env parser'ımız var: `dotenv` process.env'i mutasyona uğratır ve
 * MCP istemcileri (Claude Code, Codex) süreci kendi env'leriyle başlatır —
 * kullanıcının kabuktan verdiği TECOF_API_TOKEN'ı dosyadaki eski değerin ezmesi
 * istenmez. Burada dosya değerleri yalnız process.env'de BOŞ olan anahtarları
 * doldurur; process.env hiçbir zaman ezilmez.
 */

import fs from "node:fs";
import path from "node:path";

export type TecofConfig = {
    /** Tema reposunun kökü — katalog buradan taranır, .env buradan okunur */
    projectDir: string;
    apiUrl: string | null;
    themeId: string | null;
    token: string | null;
    localUrl: string;
    /** Hangi değerin nereden geldiği — hata mesajlarında kullanıcıya yol göstermek için */
    sources: Record<string, "env" | ".env" | ".env.local" | "default" | "missing">;
};

/**
 * Minimal dotenv parser. Desteklenenler: `KEY=value`, `export KEY=value`,
 * tek/çift/backtick tırnak, `#` yorum satırı, tırnaksız değerde satır-içi
 * ` #` yorumu, çift tırnakta `\n` kaçışı. Çok satırlı tırnaklı değer desteklenir.
 */
export function parseDotenv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    // CRLF → LF; çok satırlı tırnaklı değerler için tek regex ile tarıyoruz
    const src = text.replace(/\r\n?/g, "\n");
    const re =
        /^\s*(?:export\s+)?([\w.-]+)\s*=[ \t]*(?:(["'`])([\s\S]*?)\2|([^#\n]*?))[ \t]*(?:#.*)?$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        const key = m[1];
        const quote = m[2];
        let value: string;
        if (quote) {
            value = m[3] ?? "";
            if (quote === '"') {
                value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
            }
        } else {
            value = (m[4] ?? "").trim();
        }
        out[key] = value;
    }
    return out;
}

function readDotenvFile(file: string): Record<string, string> | null {
    try {
        return parseDotenv(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

/** Proje dizini önceliği: TECOF_PROJECT_DIR → CLAUDE_PROJECT_DIR → cwd */
export function resolveProjectDir(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
    const candidate = env.TECOF_PROJECT_DIR || env.CLAUDE_PROJECT_DIR;
    return path.resolve(candidate && candidate.trim() ? candidate : cwd);
}

export type LoadConfigOptions = {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    projectDir?: string;
};

/**
 * Birleşik konfigürasyon. Öncelik: process.env → .env.local → .env → varsayılan.
 * (.env.local, Next.js alışkanlığına uygun olarak .env'i ezer; ikisi de process.env'i ezmez.)
 */
export function loadConfig(options: LoadConfigOptions = {}): TecofConfig {
    const env = options.env ?? process.env;
    const projectDir = options.projectDir ?? resolveProjectDir(env, options.cwd);

    const dotenv = readDotenvFile(path.join(projectDir, ".env")) ?? {};
    const dotenvLocal = readDotenvFile(path.join(projectDir, ".env.local")) ?? {};

    const sources: TecofConfig["sources"] = {};

    const pick = (keys: string[], fallback: string | null): string | null => {
        for (const key of keys) {
            const v = env[key];
            if (v && v.trim()) {
                sources[keys[0]] = "env";
                return v.trim();
            }
        }
        for (const key of keys) {
            const v = dotenvLocal[key];
            if (v && v.trim()) {
                sources[keys[0]] = ".env.local";
                return v.trim();
            }
        }
        for (const key of keys) {
            const v = dotenv[key];
            if (v && v.trim()) {
                sources[keys[0]] = ".env";
                return v.trim();
            }
        }
        sources[keys[0]] = fallback == null ? "missing" : "default";
        return fallback;
    };

    // Tema reposu NEXT_PUBLIC_* adlarını kullanır; TECOF_* öncelikli, onlar yedek.
    const apiUrl = pick(["TECOF_API_URL", "NEXT_PUBLIC_BASE_URL"], null);
    const themeId = pick(["TECOF_THEME_ID", "NEXT_PUBLIC_THEME_ID"], null);
    const token = pick(["TECOF_API_TOKEN"], null);
    const localUrl = pick(["TECOF_LOCAL_URL"], "http://localhost:3000")!;

    return {
        projectDir,
        apiUrl: apiUrl ? apiUrl.replace(/\/+$/, "") : null,
        themeId,
        token,
        localUrl: localUrl.replace(/\/+$/, ""),
        sources,
    };
}

/** Eksik zorunlu ayarlar için tek tip, yol gösteren mesaj. */
export function describeMissingConfig(config: TecofConfig): string[] {
    const problems: string[] = [];
    if (!config.token) {
        problems.push(
            "TECOF_API_TOKEN tanımlı değil. Panelden (Ayarlar → Geliştirici / API Anahtarları) bir anahtar oluşturup " +
            `${path.join(config.projectDir, ".env")} dosyasına TECOF_API_TOKEN=tcf_… satırı ekleyin.`
        );
    }
    if (!config.apiUrl) {
        problems.push(
            "TECOF_API_URL (veya NEXT_PUBLIC_BASE_URL) tanımlı değil — backend adresi bilinmiyor (örn. https://api.tecof.com)."
        );
    }
    return problems;
}
