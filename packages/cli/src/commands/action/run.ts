import { executeAction, getEffectiveOptions } from "@actiondock/runtime-cli";
import type { Command } from "commander";

export { executeAction };

export function registerActionRunCommand(actionCmd: Command, program: Command): void {
  actionCmd
    .command("run <id>")
    .description("Execute an action (from current project, linked packages, or remote profile)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override (repeatable or comma-separated)")
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .option("--async", "Execute asynchronously in background (requires remote server or profile)")
    .option("--data-dir <path>", "Custom database directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id, rawOptions, cmd) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      await executeAction(id, options);
    });

  // Root level alias: ad run <id>
  program
    .command("run <id>")
    .description("Alias for 'ad action run <id>'")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override")
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .option("--async", "Execute asynchronously in background (requires remote server or profile)")
    .option("--data-dir <path>", "Custom database directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id, rawOptions, cmd) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      await executeAction(id, options);
    });
}
