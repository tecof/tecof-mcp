import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeMissingConfig, loadConfig, parseDotenv, resolveProjectDir } from "../src/config.js";

const tmpDirs: string[] = [];
const mkTmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tecof-mcp-"));
    tmpDirs.push(d);
    return d;
};
afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseDotenv", () => {
    it("temel biçimler: düz, export, tırnaklar, yorumlar, boş satır", () => {
        const out = parseDotenv(`
# yorum
TECOF_API_URL=https://api.tecof.com/   # satır içi yorum
export TECOF_API_TOKEN="tcf_abc#notcomment"
SINGLE='tek tırnak # değil'
BACK=\`x\`
EMPTY=
MULTI="satır1\\nsatır2"
SPACED =  değer  
`);
        expect(out.TECOF_API_URL).toBe("https://api.tecof.com/");
        expect(out.TECOF_API_TOKEN).toBe("tcf_abc#notcomment");
        expect(out.SINGLE).toBe("tek tırnak # değil");
        expect(out.BACK).toBe("x");
        expect(out.EMPTY).toBe("");
        expect(out.MULTI).toBe("satır1\nsatır2");
        expect(out.SPACED).toBe("değer");
    });

    it("CRLF ve çok satırlı tırnaklı değer", () => {
        const out = parseDotenv('A=1\r\nB="iki\nsatır"\r\nC=3');
        expect(out).toEqual({ A: "1", B: "iki\nsatır", C: "3" });
    });
});

describe("loadConfig", () => {
    it("process.env > .env.local > .env > varsayılan; NEXT_PUBLIC_* yedek; process.env ezilmez", () => {
        const dir = mkTmp();
        fs.writeFileSync(path.join(dir, ".env"), "TECOF_API_TOKEN=tcf_from_env_file\nNEXT_PUBLIC_BASE_URL=https://file.example.com/\nNEXT_PUBLIC_THEME_ID=theme-file\n");
        fs.writeFileSync(path.join(dir, ".env.local"), "TECOF_API_TOKEN=tcf_from_local\n");
        const env = { TECOF_PROJECT_DIR: dir, TECOF_API_URL: "https://env.example.com" } as NodeJS.ProcessEnv;
        const cfg = loadConfig({ env });
        expect(cfg.projectDir).toBe(path.resolve(dir));
        expect(cfg.token).toBe("tcf_from_local");
        expect(cfg.sources.TECOF_API_TOKEN).toBe(".env.local");
        expect(cfg.apiUrl).toBe("https://env.example.com"); // process.env kazandı, sondaki / yok
        expect(cfg.sources.TECOF_API_URL).toBe("env");
        expect(cfg.themeId).toBe("theme-file"); // NEXT_PUBLIC_THEME_ID yedeği
        expect(cfg.localUrl).toBe("http://localhost:3000");
        expect(cfg.sources.TECOF_LOCAL_URL).toBe("default");
        // process.env dokunulmadı
        expect(env.TECOF_API_TOKEN).toBeUndefined();
        expect(describeMissingConfig(cfg)).toEqual([]);
    });

    it("boş process.env değeri dosyadakini ezmez; eksikler raporlanır", () => {
        const dir = mkTmp();
        fs.writeFileSync(path.join(dir, ".env"), "TECOF_API_TOKEN=tcf_x\n");
        const cfg = loadConfig({ env: { TECOF_API_TOKEN: "   " } as any, projectDir: dir });
        expect(cfg.token).toBe("tcf_x");
        expect(cfg.apiUrl).toBeNull();
        expect(describeMissingConfig(cfg)).toHaveLength(1);
        expect(describeMissingConfig(cfg)[0]).toContain("TECOF_API_URL");

        const none = loadConfig({ env: {} as any, projectDir: mkTmp() });
        expect(describeMissingConfig(none)).toHaveLength(2);
    });

    it("resolveProjectDir: TECOF_PROJECT_DIR > CLAUDE_PROJECT_DIR > cwd", () => {
        expect(resolveProjectDir({ TECOF_PROJECT_DIR: "/a", CLAUDE_PROJECT_DIR: "/b" } as any, "/c")).toBe("/a");
        expect(resolveProjectDir({ CLAUDE_PROJECT_DIR: "/b" } as any, "/c")).toBe("/b");
        expect(resolveProjectDir({} as any, "/c")).toBe("/c");
    });
});
