import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.cwd(), "jdeploy-bundle", "jdeploy.js");
const target = resolve(process.cwd(), "jdeploy-bundle", "jdeploy.cjs");

if (!existsSync(source)) {
  throw new Error(`jDeploy launcher not found: ${source}`);
}

copyFileSync(source, target);
chmodSync(target, 0o755);
console.log(`[OK] copied CommonJS jDeploy launcher to ${target}`);
