const kExperimentalWarningSuppressed = Symbol.for("actiondock.experimental_warning_suppressed");
if (!((globalThis as any)[kExperimentalWarningSuppressed])) {
  (globalThis as any)[kExperimentalWarningSuppressed] = true;
  const originalEmitWarning = process.emitWarning;
  if (typeof originalEmitWarning === "function") {
    process.emitWarning = function (warning: any, ...args: any[]) {
      if (typeof warning === "string") {
        const type = typeof args[0] === "string" ? args[0] : (args[0]?.type || args[1]);
        if (type === "ExperimentalWarning") return;
      } else if (warning && (warning.name === "ExperimentalWarning" || warning.type === "ExperimentalWarning")) {
        return;
      }
      return Reflect.apply(originalEmitWarning, process, [warning, ...args]);
    } as typeof process.emitWarning;
  }
  const originalListeners = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (warning: any) => {
    if (warning && (warning.name === "ExperimentalWarning" || warning.type === "ExperimentalWarning")) return;
    for (const listener of originalListeners) {
      listener.call(process, warning);
    }
  });
}

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



