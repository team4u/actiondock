import { findProjectRoot } from "@actiondock/core";
import { Command } from "commander";

export function registerTestCommand(program: Command): void {
  program
    .command("test [pattern]")
    .description("Run project tests using Bun test runner")
    .action((pattern) => {
      const root = findProjectRoot();
      const cwd = root || process.cwd();

      const args = ["bun", "test"];
      if (pattern) {
        args.push(pattern);
      }

      const proc = Bun.spawnSync(args, {
        cwd,
        stdio: ["inherit", "inherit", "inherit"],
      });

      if (proc.exitCode !== 0) {
        process.exit(proc.exitCode ?? 1);
      }
    });
}
