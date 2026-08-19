// dist/bin.js'e çalıştırma izni ver ve shebang'ı doğrula (tsc shebang'ı korur
// ama chmod yapmaz; npm bin linki +x ister).
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "dist", "bin.js");
const head = readFileSync(bin, "utf8").slice(0, 40);
if (!head.startsWith("#!/usr/bin/env node")) {
    console.error("dist/bin.js shebang ile başlamıyor!");
    process.exit(1);
}
chmodSync(bin, 0o755);
console.log("postbuild: dist/bin.js +x");
