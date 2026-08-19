import path from "node:path";
import { fileURLToPath } from "node:url";
import { ComponentCatalog } from "../../src/catalog/index.js";

export const FIXTURE_THEME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "theme");

let cached: Promise<Awaited<ReturnType<ComponentCatalog["load"]>>> | null = null;

/** Fixture kataloğu (testler arasında paylaşılır; disk yalnız bir kez parse edilir). */
export function loadFixtureCatalog() {
    if (!cached) cached = new ComponentCatalog(FIXTURE_THEME_DIR).load();
    return cached;
}

export const LANG = { languages: ["tr", "en"], defaultLanguage: "tr" };
