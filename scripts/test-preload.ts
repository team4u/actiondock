import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = join(__dirname, "..");
const sdkDist = join(rootDir, "packages", "sdk", "dist", "index.js");

if (!existsSync(sdkDist)) {
  console.log("[TEST PRELOAD] Monorepo dist not found, auto-building packages before tests...");
  const proc = spawnSync("bun", ["run", "./scripts/build.ts"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("Failed to auto-build packages in test preload");
  }
}
