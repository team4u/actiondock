import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "@actiondock/core";
import { Command } from "commander";

export function registerTestCommand(program: Command): void {
  program
    .command("test [pattern]")
    .description("Run project tests using configured test runner (node:test or bun test)")
    .action((pattern) => {
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
          // ignore
        }
      }

      if (pattern) {
        if (testCmd === "npm") {
          testArgs.push("--", pattern);
        } else {
          testArgs.push(pattern);
        }
      }

      const proc = spawnSync(testCmd, testArgs, {
        cwd,
        stdio: "inherit",
      });

      if (proc.status !== 0) {
        process.exit(proc.status ?? 1);
      }
    });
}
