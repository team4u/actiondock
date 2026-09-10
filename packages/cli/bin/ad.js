#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distEntry = resolve(import.meta.dirname, "../dist/index.js");

if (existsSync(distEntry)) {
  const { main } = await import(pathToFileURL(distEntry).href);
  await main(process.argv);
} else {
  // 开发调试态（源码仓库且未预先构建 dist 时）
  const isBun = typeof process.versions.bun !== "undefined";
  const hasTsx =
    process.execArgv.some((arg, i) => arg === "--import" && process.execArgv[i + 1]?.includes("tsx")) ||
    process.execArgv.some((arg) => arg.includes("tsx"));

  if (!isBun && !hasTsx) {
    const require = createRequire(import.meta.url);
    let tsxSpecifier = null;
    try {
      tsxSpecifier = pathToFileURL(require.resolve("tsx")).href;
    } catch {
      try {
        const runtimeNodePkg = require.resolve("@actiondock/runtime-node/package.json");
        const runtimeReq = createRequire(runtimeNodePkg);
        tsxSpecifier = pathToFileURL(runtimeReq.resolve("tsx")).href;
      } catch {
        // 无可用 tsx 模块
      }
    }

    if (tsxSpecifier) {
      const res = spawnSync(
        process.execPath,
        ["--import", tsxSpecifier, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
        {
          stdio: "inherit",
        }
      );
      process.exit(res.status ?? (res.signal ? 1 : 0));
    }
  }

  const { main } = await import("../src/index.ts");
  await main(process.argv);
}
