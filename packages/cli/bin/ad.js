#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const isBun = typeof process.versions.bun !== "undefined";
const hasTsx =
  process.execArgv.some((arg, i) => arg === "--import" && process.execArgv[i + 1]?.includes("tsx")) ||
  process.execArgv.some((arg) => arg.includes("tsx"));

if (!isBun && !hasTsx) {
  const require = createRequire(import.meta.url);
  let tsxSpecifier = null;
  try {
    tsxSpecifier = pathToFileURL(require.resolve("tsx", { paths: [import.meta.dirname, process.cwd()] })).href;
  } catch {
    try {
      tsxSpecifier = pathToFileURL(require.resolve("tsx")).href;
    } catch {
      // 未检测到 tsx 模块
    }
  }

  if (tsxSpecifier) {
    const child = spawn(
      process.execPath,
      ["--import", tsxSpecifier, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: "inherit",
      }
    );

    const forwardSignal = (sig) => {
      if (child.pid && !child.killed) {
        try {
          child.kill(sig);
        } catch {}
      }
    };

    process.on("SIGTERM", () => forwardSignal("SIGTERM"));
    process.on("SIGINT", () => forwardSignal("SIGINT"));
    process.on("SIGHUP", () => forwardSignal("SIGHUP"));

    await new Promise((resolvePromise) => {
      child.on("exit", (code, signal) => {
        if (signal) {
          process.removeListener("SIGTERM", forwardSignal);
          process.removeListener("SIGINT", forwardSignal);
          process.removeListener("SIGHUP", forwardSignal);
          process.kill(process.pid, signal);
        } else {
          process.exit(code ?? 0);
        }
        resolvePromise();
      });
    });
  }
}

const distEntry = resolve(import.meta.dirname, "../dist/index.js");

if (existsSync(distEntry)) {
  const { runCliProcess } = await import(pathToFileURL(distEntry).href);
  await runCliProcess(process.argv);
} else {
  const { runCliProcess } = await import("../src/index.ts");
  await runCliProcess(process.argv);
}
