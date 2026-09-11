import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "@actiondock/core";
import { Command } from "commander";
import { spawnAsync } from "../utils";

export function registerTestCommand(program: Command): void {
  program
    .command("test [pattern]")
    .description("Run project tests using configured test runner (node:test or bun test)")
    .action(async (pattern) => {
      const root = findProjectRoot();
      const cwd = root || process.cwd();

      const pkgJsonPath = join(cwd, "package.json");
      let testCmd = "npm";
      let testArgs = ["test"];

      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          if (pkg.scripts?.test?.includes("bun test") && typeof (globalThis as any).Bun !== "undefined") {
            testCmd = "bun";
            testArgs = ["test"];
          }
        } catch {
          // package.json 解析失败时回退 npm test
        }
      }

      if (pattern) {
        if (testCmd === "npm") {
          testArgs.push("--", pattern);
        } else {
          testArgs.push(pattern);
        }
      }

      // stdio inherit 保持实时输出；进程异常（如命令不存在）时回退退出码 1
      const proc = await spawnAsync(testCmd, testArgs, {
        cwd,
        stdio: "inherit",
      }).catch(() => ({ status: 1, signal: null, stdout: "", stderr: "" }));

      if (proc.status !== 0) {
        process.exitCode = proc.status ?? 1;
      }
    });
}
