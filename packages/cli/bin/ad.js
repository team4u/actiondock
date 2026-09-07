#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const isBun = typeof process.versions.bun !== "undefined";

if (!isBun && !process.env.ACTIONDOCK_TSX_BOOTSTRAPPED) {
  const hasTsx =
    process.execArgv.some((arg, i) => arg === "--import" && process.execArgv[i + 1]?.includes("tsx")) ||
    process.execArgv.some((arg) => arg.includes("tsx"));
  if (!hasTsx) {
    const require = createRequire(import.meta.url);
    let tsxSpecifier = "tsx";
    try {
      tsxSpecifier = pathToFileURL(require.resolve("tsx")).href;
    } catch {
      try {
        const runtimeNodePkg = require.resolve("@actiondock/runtime-node/package.json");
        const runtimeReq = createRequire(runtimeNodePkg);
        tsxSpecifier = pathToFileURL(runtimeReq.resolve("tsx")).href;
      } catch {
        // 回退为裸模块名
      }
    }

    const res = spawnSync(
      process.execPath,
      ["--import", tsxSpecifier, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          ACTIONDOCK_TSX_BOOTSTRAPPED: "1",
        },
      }
    );
    process.exit(res.status ?? (res.signal ? 1 : 0));
  }
}

const { main } = await import("../src/index.ts");
await main(process.argv);

