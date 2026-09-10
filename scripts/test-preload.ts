import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const rootDir = resolve(import.meta.dirname, "..");
const sdkDist = join(rootDir, "packages", "sdk", "dist", "index.js");

if (!existsSync(sdkDist)) {
  console.log("[TEST PRELOAD] Monorepo dist not found, auto-building packages before tests...");
  const proc = spawnSync(process.execPath, [join(rootDir, "scripts", "build.ts")], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error("Failed to auto-build packages in test preload");
  }
}

// Register loader hooks in Node
import { register } from "node:module";
try {
  const loaderUrl = pathToFileURL(join(rootDir, "scripts", "test-loader.mjs")).href;
  register(loaderUrl);
} catch {
  // Ignore if already registered
}

// Load test-compat to initialize environment
const compatUrl = pathToFileURL(join(rootDir, "scripts", "test-compat.ts")).href;
await import(compatUrl);
