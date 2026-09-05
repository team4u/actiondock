#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isBun = typeof process.versions.bun !== "undefined";

if (!isBun && !process.env.ACTIONDOCK_TSX_BOOTSTRAPPED) {
  const hasTsx =
    process.execArgv.some((arg, i) => arg === "--import" && process.execArgv[i + 1] === "tsx") ||
    process.execArgv.some((arg) => arg.includes("tsx"));
  if (!hasTsx) {
    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
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

