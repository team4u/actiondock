import { readFileSync } from "node:fs";
import {
  createActionDockTarget,
  findProjectRoot,
  parseDuration,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import type { JsonValue } from "@actiondock/sdk";
import { Command } from "commander";
import { ArgumentError, ExecutionError, SigintError } from "../errors";
import { writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions } from "../utils";

/**
 * 统一执行 Action 核心逻辑（使用 ActionDockTarget 门面）。
 */
export async function executeAction(
  id: string,
  options: any,
  context?: CliContext
): Promise<void> {
  if (!id) {
    throw new ArgumentError("Action ID is required for run");
  }

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
      throw new ArgumentError(`Invalid timeout format: ${err.message}`);
    }
  }

  const configOverrides: Record<string, JsonValue> = {};
  if (options.config) {
    const list = Array.isArray(options.config) ? options.config : [options.config];
    for (const item of list) {
      const [k, ...v] = item.split("=");
      if (k) configOverrides[k] = v.join("=");
    }
  }

  const controller = new AbortController();
  let receivedSigint = false;
  const sigintHandler = () => {
    receivedSigint = true;
    controller.abort(new Error("Interrupted by SIGINT"));
  };
  process.once("SIGINT", sigintHandler);

  try {
    // 1. 目标拓扑解析
    const resolved = resolveTarget(
      {
        profile: options.profile,
        server: options.server,
        token: options.token,
      },
      context?.customHome
    );

    if (resolved.type === "local" && options.async) {
      throw new ExecutionError(
        "Async execution requires a long-running ActionDock server.\nUse --profile, --server, or start 'ad serve'."
      );
    }

    let targetPackageRoot: string | undefined;
    let targetRef = id;

    if (resolved.type === "local") {
      if (options.package) {
        const root = resolvePackageRoot(options.package);
        if (!root) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
        targetPackageRoot = root;
        if (!id.includes("/") && !id.includes(":")) {
          targetRef = `${options.package}/${id}`;
        }
      } else {
        targetPackageRoot = findProjectRoot() || undefined;
      }
    } else if (options.package && !id.includes("/") && !id.includes(":")) {
      targetRef = `${options.package}/${id}`;
    }

    // 2. 通过 Target 统一执行
    const target = await createActionDockTarget(
      resolved.type === "remote"
        ? {
            type: "remote",
            serverUrl: resolved.serverUrl!,
            token: resolved.token,
          }
        : {
            type: "local",
            projectRoot: targetPackageRoot,
            customHome: context?.customHome,
            dataDir: options.dataDir || context?.dataDir,
            scanLinkedPackages: true,
          }
    );

    try {
      if (options.async) {
        const ticket = await target.startAction(targetRef, input as JsonValue, {
          signal: controller.signal,
          timeoutMs,
          config: configOverrides,
        });

        const asyncOutput = {
          ok: ticket.status !== "failed",
          runId: ticket.runId,
          status: ticket.status,
        };
        writeStdout(JSON.stringify(asyncOutput, null, 2), context);

        if (ticket.status === "failed") {
          throw new ExecutionError(`Action '${id}' failed to start`);
        }
      } else {
        const result = await target.runAction(targetRef, input as JsonValue, {
          signal: controller.signal,
          timeoutMs,
          config: configOverrides,
        });

        writeStdout(JSON.stringify(result, null, 2), context);

        if (!result.ok) {
          throw new ExecutionError(
            result.error?.message || `Action '${id}' execution failed`,
            result.error
          );
        }
      }
    } finally {
      await target.close();
    }
  } catch (err: any) {
    if (receivedSigint || err?.name === "AbortError" || err?.message?.includes("SIGINT")) {
      throw new SigintError();
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

/**
 * 注册顶层统一 run 命令：执行指定 Action。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerRunCommand(program: Command, context?: CliContext): void {
  program
    .command("run <id>")
    .description("Execute an action (from current project, linked packages, or remote profile)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override (repeatable)")
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .option("--async", "Execute asynchronously in background (requires remote server or profile)")
    .option("--data-dir <path>", "Custom database directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      await executeAction(id, options, context);
    });
}
