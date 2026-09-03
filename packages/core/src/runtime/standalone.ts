import { readFileSync } from "node:fs";
import type { ActionDefinition } from "@actiondock/sdk";
import { filterWithFallbackInfo } from "../filter";
import type { ConfigItemDefinition } from "../project/types";
import { createStorage } from "../storage";
import { parseDuration } from "../utils";
import { ActionRunner } from "./runner";

/**
 * 独立编译可执行文件运行时的初始化选项。
 */
export interface StandaloneRuntimeOptions {
  /** 所属 Package ID */
  packageId: string;
  /** 版本号 */
  version: string;
  /** 描述信息 */
  description?: string;
  /** 声明的配置依赖定义 */
  config?: Record<string, ConfigItemDefinition>;
  /** 打包内置的 Action 动作定义列表 */
  actions: ActionDefinition[];
}

/**
 * 独立二进制可执行文件运行时（Standalone Runtime）。
 * 
 * 职责：
 * 1. 作为由 `ad build` 编译生成的单文件独立可执行文件（Standalone Binary）的运行时入口。
 * 2. 保证与开发态（`ad run` / `ad action`）在输出信封、配置优先级、状态存储等方面的 100% 行为一致性。
 * 3. 自带轻量 CLI 分发器，支持 `list`, `describe`, `run`, `config`, `state`, `version`, `help` 子命令。
 */
export class StandaloneRuntime {
  private packageId: string;
  private version: string;
  private description?: string;
  private configDefs?: Record<string, ConfigItemDefinition>;
  private actionsMap: Map<string, ActionDefinition>;

  constructor(options: StandaloneRuntimeOptions) {
    this.packageId = options.packageId;
    this.version = options.version;
    this.description = options.description;
    this.configDefs = options.config;
    this.actionsMap = new Map(options.actions.map((a) => [a.id, a]));
  }

  /**
   * 解析命令行参数并执行对应的独立二进制子命令。
   * 
   * @param argv 命令行参数数组（通常为 process.argv.slice(2)）
   */
  async run(argv: string[]): Promise<void> {
    const args = [...argv];
    let dataDir: string | undefined;
    const configOverrides: Record<string, unknown> = {};

    // 提取全局参数（--data-dir 与 --config）
    const filteredArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--data-dir" && i + 1 < args.length) {
        dataDir = args[++i];
      } else if (arg.startsWith("--data-dir=")) {
        dataDir = arg.split("=")[1];
      } else if (arg === "--config" && i + 1 < args.length) {
        const pair = args[++i];
        const [k, ...v] = pair.split("=");
        if (k) configOverrides[k] = v.join("=");
      } else if (arg.startsWith("--config=")) {
        const pair = arg.slice(9);
        const [k, ...v] = pair.split("=");
        if (k) configOverrides[k] = v.join("=");
      } else {
        filteredArgs.push(arg);
      }
    }

    const command = filteredArgs[0] || "help";
    const subArgs = filteredArgs.slice(1);

    const storage = createStorage(this.packageId, { dataDir });
    const runner = new ActionRunner({
      packageId: this.packageId,
      storage,
      configOverrides,
      projectConfig: {
        id: this.packageId,
        name: this.packageId,
        version: this.version,
        description: this.description,
        config: this.configDefs,
      },
      actions: this.actionsMap,
    });

    try {
      switch (command) {
        case "list": {
          const json = subArgs.includes("--json");
          const noFallback = subArgs.includes("--no-fallback");
          let intent: string | undefined;
          const positionalPatterns: string[] = [];

          for (let i = 0; i < subArgs.length; i++) {
            const arg = subArgs[i];
            if (arg === "--intent" || arg === "-i") {
              if (i + 1 < subArgs.length) intent = subArgs[++i];
            } else if (arg.startsWith("--intent=")) {
              intent = arg.slice(9);
            } else if (arg.startsWith("-i=")) {
              intent = arg.slice(3);
            } else if (!arg.startsWith("-")) {
              positionalPatterns.push(arg);
            }
          }

          const effectiveIntent =
            intent ||
            (positionalPatterns.length > 0
              ? positionalPatterns.join("|")
              : undefined);

          const list = runner.listActions().map((a) => ({
            id: a.id,
            description: a.description || "",
          }));

          const filterRes = filterWithFallbackInfo(
            list,
            effectiveIntent,
            [(a) => a.id, (a) => a.description],
            !noFallback
          );

          if (json) {
            console.log(JSON.stringify(filterRes.items, null, 2));
          } else {
            console.log(`Actions in ${this.packageId} (v${this.version}):\n`);
            for (const a of filterRes.items) {
              console.log(`  ${a.id.padEnd(28)} ${a.description}`);
            }
          }
          break;
        }


        case "describe":
        case "show": {
          const id = subArgs.find((a) => !a.startsWith("-"));
          const json = subArgs.includes("--json");
          if (!id) {
            console.error("Error: Action ID is required for describe");
            process.exit(1);
          }
          const action = runner.getAction(id);
          if (!action) {
            console.error(`Error: Action '${id}' not found`);
            process.exit(1);
          }
          if (json) {
            console.log(
              JSON.stringify(
                {
                  id: action.id,
                  description: action.description,
                  inputSchema: action.inputSchema,
                  outputSchema: action.outputSchema,
                },
                null,
                2
              )
            );
          } else {
            console.log(`Action: ${action.id}`);
            if (action.description) console.log(`Description: ${action.description}`);
            if (action.inputSchema) {
              console.log("\nInput Schema:");
              console.log(JSON.stringify(action.inputSchema, null, 2));
            }
            if (action.outputSchema) {
              console.log("\nOutput Schema:");
              console.log(JSON.stringify(action.outputSchema, null, 2));
            }
          }
          break;
        }

        case "run": {
          const id = subArgs.find((a) => !a.startsWith("-"));
          if (!id) {
            console.error("Error: Action ID is required for run");
            process.exit(1);
          }

          let input: unknown = {};
          let timeoutMs: number | undefined;

          for (let i = 0; i < subArgs.length; i++) {
            if (subArgs[i] === "--async") {
              console.error(
                "Error: Async execution is not supported in standalone single-execution binaries."
              );
              process.exit(1);
            } else if (subArgs[i] === "--timeout" && i + 1 < subArgs.length) {
              const raw = subArgs[++i];
              timeoutMs = parseDuration(raw);
            } else if (subArgs[i].startsWith("--timeout=")) {
              timeoutMs = parseDuration(subArgs[i].slice(10));
            } else if (subArgs[i] === "--input" && i + 1 < subArgs.length) {
              try {
                input = JSON.parse(subArgs[++i]);
              } catch (e: any) {
                console.error(`Error parsing --input JSON: ${e.message}`);
                process.exit(1);
              }
            } else if (subArgs[i].startsWith("--input=")) {
              try {
                input = JSON.parse(subArgs[i].slice(8));
              } catch (e: any) {
                console.error(`Error parsing --input JSON: ${e.message}`);
                process.exit(1);
              }
            } else if (subArgs[i] === "--input-file" && i + 1 < subArgs.length) {
              try {
                input = JSON.parse(readFileSync(subArgs[++i], "utf-8"));
              } catch (e: any) {
                console.error(`Error reading --input-file: ${e.message}`);
                process.exit(1);
              }
            }
          }

          const controller = new AbortController();
          const sigintHandler = () => {
            controller.abort(new Error("Interrupted by SIGINT"));
          };
          process.once("SIGINT", sigintHandler);

          try {
            const result = await runner.execute(id, input, {
              signal: controller.signal,
              timeoutMs,
            });
            // Standard stdout JSON envelope
            console.log(JSON.stringify(result, null, 2));
            if (!result.ok) {
              process.exit(1);
            }
          } finally {
            process.removeListener("SIGINT", sigintHandler);
          }
          break;
        }

        case "config": {
          const sub = subArgs[0] || "list";
          if (sub === "list") {
            const all = storage.listConfig();
            console.log(JSON.stringify(all, null, 2));
          } else if (sub === "get") {
            const key = subArgs[1];
            if (!key) {
              console.error("Error: config key required");
              process.exit(1);
            }
            const val = storage.getConfig(key);
            console.log(val !== undefined ? JSON.stringify(val) : "undefined");
          } else if (sub === "set") {
            const key = subArgs[1];
            const rawVal = subArgs[2];
            if (!key || rawVal === undefined) {
              console.error("Error: key and value required");
              process.exit(1);
            }
            let parsed: unknown = rawVal;
            try {
              parsed = JSON.parse(rawVal);
            } catch {
              parsed = rawVal;
            }
            storage.setConfig(key, parsed);
            console.log(`Config '${key}' updated`);
          } else if (sub === "delete") {
            const key = subArgs[1];
            if (!key) {
              console.error("Error: config key required");
              process.exit(1);
            }
            storage.deleteConfig(key);
            console.log(`Config '${key}' deleted`);
          }
          break;
        }

        case "state": {
          const sub = subArgs[0] || "list";
          let namespace: string | undefined;
          let isAll = false;
          let isJson = false;

          for (let i = 1; i < subArgs.length; i++) {
            if ((subArgs[i] === "-n" || subArgs[i] === "--namespace") && i + 1 < subArgs.length) {
              namespace = subArgs[++i];
            } else if (subArgs[i].startsWith("--namespace=")) {
              namespace = subArgs[i].slice(12);
            } else if (subArgs[i] === "-a" || subArgs[i] === "--all") {
              isAll = true;
            } else if (subArgs[i] === "--json") {
              isJson = true;
            }
          }

          if (sub === "list") {
            const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
            const keys = await storage.listStateKeys(namespace !== undefined ? namespace : null, prefix);
            console.log(JSON.stringify(keys, null, 2));
          } else if (sub === "get") {
            const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
            if (!key) {
              console.error("Error: state key required");
              process.exit(1);
            }
            let val: unknown;
            if (namespace !== undefined) {
              val = await storage.getState(namespace, key);
            } else {
              const entry = await storage.findState(key);
              val = entry?.value;
            }
            if (isJson) {
              console.log(JSON.stringify({ key, value: val }, null, 2));
            } else {
              console.log(val !== undefined ? JSON.stringify(val) : "undefined");
            }
          } else if (sub === "set") {
            const key = subArgs[1];
            const rawVal = subArgs[2];
            if (!key || rawVal === undefined) {
              console.error("Error: key and value required");
              process.exit(1);
            }

            let ns = namespace || "";
            let actualKey = key;
            if (namespace === undefined && key.includes(":")) {
              const colonIdx = key.indexOf(":");
              ns = key.slice(0, colonIdx);
              actualKey = key.slice(colonIdx + 1);
            }

            let parsed: unknown = rawVal;
            try {
              parsed = JSON.parse(rawVal);
            } catch {
              parsed = rawVal;
            }

            let ttl: number | undefined;
            for (let i = 3; i < subArgs.length; i++) {
              if (subArgs[i] === "--ttl" && i + 1 < subArgs.length) {
                ttl = parseInt(subArgs[++i], 10);
              } else if (subArgs[i].startsWith("--ttl=")) {
                ttl = parseInt(subArgs[i].slice(6), 10);
              }
            }

            await storage.setState(ns, actualKey, parsed, ttl);
            const displayKey = ns ? `${ns}:${actualKey}` : actualKey;
            console.log(`State '${displayKey}' updated`);
          } else if (sub === "delete" || sub === "rm") {
            const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
            if (!key) {
              console.error("Error: state key required");
              process.exit(1);
            }
            const deleted = await storage.deleteStateSmart(key, namespace);
            if (deleted) {
              console.log(`State '${key}' deleted`);
            } else {
              console.error(`Error: State key '${key}' not found`);
              process.exit(1);
            }
          } else if (sub === "clear" || sub === "clean") {
            const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
            const count = await storage.clearState({
              namespace,
              all: isAll,
              prefix: prefix || undefined,
            });
            console.log(`Cleared ${count} state entry(s)`);
          }
          break;
        }

        case "version":
        case "-v":
        case "--version": {
          console.log(`${this.packageId} v${this.version}`);
          break;
        }

        case "help":
        default: {
          console.log(`${this.packageId} (v${this.version})`);
          if (this.description) console.log(`${this.description}\n`);
          console.log("Usage:");
          console.log("  <cmd> list [--json]                         List available actions");
          console.log("  <cmd> describe <id> [--json]                Show action details and schemas");
          console.log("  <cmd> run <id> [--input '<json>']           Execute action with JSON input");
          console.log("  <cmd> config list/get/set/delete            Manage package configuration");
          console.log("  <cmd> state list/get/set/delete             Manage shared state store");
          console.log("\nGlobal options:");
          console.log("  --data-dir <path>                           Custom runtime database directory");
          console.log("  --config <KEY=val>                          Temporary config override");
          break;
        }
      }
    } finally {
      storage.close();
    }
  }
}

export function createStandaloneRuntime(
  options: StandaloneRuntimeOptions
): StandaloneRuntime {
  return new StandaloneRuntime(options);
}
