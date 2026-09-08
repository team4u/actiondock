import { readFileSync } from "node:fs";
import {
  ActionRunner,
  createStorage,
  executeRemoteAction,
  loadActions,
  loadProjectConfig,
  resolveActionProject,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { ArgumentError, ExecutionError, getEffectiveOptions } from "@actiondock/runtime-cli";
import type { Command } from "commander";
import { parseDuration } from "../../utils/duration";

export async function executeAction(id: string, options: any): Promise<void> {
  let input: unknown = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input);
    } catch (err: any) {
      throw new ArgumentError(`Error parsing --input JSON: ${err.message}`);
    }
  } else if (options.inputFile) {
    try {
      input = JSON.parse(readFileSync(options.inputFile, "utf-8"));
    } catch (err: any) {
      throw new ArgumentError(`Error reading --input-file: ${err.message}`);
    }
  }

  let timeoutMs: number | undefined;
  if (options.timeout) {
    try {
      timeoutMs = parseDuration(options.timeout);
    } catch (err: any) {
      throw new ArgumentError(err.message);
    }
  }

  const configOverrides: Record<string, unknown> = {};
  if (options.config) {
    const list = Array.isArray(options.config) ? options.config : [options.config];
    for (const item of list) {
      const [k, ...v] = item.split("=");
      if (k) configOverrides[k] = v.join("=");
    }
  }

  // Check target (remote profile vs local)
  let target;
  try {
    target = resolveTarget({
      profile: options.profile,
      server: options.server,
      token: options.token,
    });
  } catch (err: any) {
    throw new ExecutionError(err.message);
  }

  const controller = new AbortController();
  const sigintHandler = () => {
    controller.abort(new Error("Interrupted by SIGINT"));
  };
  process.once("SIGINT", sigintHandler);

  try {
    if (target.type === "remote") {
      try {
        const result = await executeRemoteAction(target.serverUrl!, id, input, {
          configOverrides,
          token: target.token,
          timeoutMs,
          signal: controller.signal,
          async: Boolean(options.async),
        });
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) {
          process.exitCode = 1;
        }
        return;
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    }

    // Local execution
    if (options.async) {
      throw new ExecutionError(
        "Async execution requires a long-running ActionDock server.\nUse --profile, --server, or start `ad serve`."
      );
    }

    let actionTarget = id;
    if (options.package && !id.includes("/") && !id.includes(":")) {
      const pkgRoot = resolvePackageRoot(options.package);
      if (!pkgRoot) {
        throw new ArgumentError(
          `Package '${options.package}' not found in linked packages or path`
        );
      }
      actionTarget = `${options.package}/${id}`;
    }

    let resolvedProjectRoot: string;
    let resolvedActionId: string;

    try {
      const resolved = await resolveActionProject(actionTarget);
      resolvedProjectRoot = resolved.projectRoot;
      resolvedActionId = resolved.actionId;
    } catch (err: any) {
      if (err.message?.includes("not found") || err.message?.includes("no longer exists")) {
        throw new ArgumentError(err.message);
      }
      throw new ExecutionError(err.message);
    }

    try {
      const config = loadProjectConfig(resolvedProjectRoot);
      const actions = await loadActions(resolvedProjectRoot, config.actionsDir);
      const storage = createStorage(config.id, {
        projectRoot: resolvedProjectRoot,
        dataDir: options.dataDir,
      });

      const runner = new ActionRunner({
        packageId: config.id,
        storage,
        projectConfig: config,
        configOverrides,
        actions,
      });

      const result = await runner.execute(resolvedActionId, input, {
        signal: controller.signal,
        timeoutMs,
      });

      console.log(JSON.stringify(result, null, 2));
      storage.close();

      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (err: any) {
      if (err instanceof ArgumentError) throw err;
      throw new ExecutionError(err.message);
    }
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

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
