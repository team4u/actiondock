import { readFileSync } from "node:fs";
import type { ActionDefinition, JsonValue } from "@actiondock/sdk";
import {
  createActionDockApp,
  filterWithFallbackInfo,
  parseDuration,
  type ActionDockApp,
  type ActionSpec,
  type ConfigItemDefinition,
} from "@actiondock/core";
import { ExitCode, type StandaloneOptions, type Envelope } from "../types";
import {
  renderActionDetail,
  renderActionList,
  renderConfigList,
  renderStateList,
} from "../renderer";

/**
 * 独立二进制轻量参数解析分发器。
 * 不依赖 Commander，直接调用 ActionDockApp 执行生命周期。
 */
export class StandaloneDispatcher {
  private options: StandaloneOptions;

  constructor(options: StandaloneOptions) {
    this.options = options;
  }

  private writeOut(msg: string): void {
    if (this.options.stdout) {
      this.options.stdout(msg);
    } else {
      console.log(msg);
    }
  }

  private writeErr(msg: string): void {
    if (this.options.stderr) {
      this.options.stderr(msg);
    } else {
      console.error(msg);
    }
  }

  /**
   * 解析命令行参数并执行分发。
   * 
   * @param argv 命令行参数数组（如 process.argv.slice(2)）
   * @returns 退出状态码
   */
  async dispatch(argv: string[]): Promise<number> {
    const args = [...argv];
    let dataDir: string | undefined;
    const configOverrides: Record<string, unknown> = {};

    // 1. 提取顶层全局参数（--data-dir, --config）
    const filteredArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--data-dir" && i + 1 < args.length) {
        dataDir = args[++i];
      } else if (arg.startsWith("--data-dir=")) {
        dataDir = arg.slice(11);
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

    // 2. 版本与帮助快速处理
    if (command === "-v" || command === "-V" || command === "--version" || command === "version") {
      this.writeOut(`${this.options.packageId} v${this.options.version}`);
      return ExitCode.SUCCESS;
    }

    if (command === "-h" || command === "--help" || command === "help") {
      this.printHelp();
      return ExitCode.SUCCESS;
    }

    // 3. 构建 ActionDockApp 实例
    const actionsMap =
      this.options.actions instanceof Map
        ? this.options.actions
        : new Map(this.options.actions.map((a) => [a.id, a]));

    let app: ActionDockApp;
    try {
      app = await createActionDockApp({
        projectConfig: {
          id: this.options.packageId,
          name: this.options.packageId,
          version: this.options.version,
          description: this.options.description,
          config: this.options.configDefs,
        },
        actions: actionsMap,
        dataDir: dataDir || this.options.dataDir,
        configOverrides,
        customHome: this.options.customHome,
      });
    } catch (err: any) {
      this.writeErr(`Error initializing standalone runtime: ${err?.message || err}`);
      return ExitCode.FAILURE;
    }

    const controller = new AbortController();
    const sigintHandler = () => {
      controller.abort(new Error("Interrupted by SIGINT"));
    };
    process.once("SIGINT", sigintHandler);

    try {
      switch (command) {
        case "list":
          return await this.handleList(app, subArgs);

        case "describe":
        case "show":
          return await this.handleDescribe(app, subArgs);

        case "run":
          return await this.handleRun(app, subArgs, controller.signal);

        case "config":
          return await this.handleConfig(app, subArgs);

        case "state":
          return await this.handleState(app, subArgs);

        default:
          this.writeErr(`Unknown command: '${command}'`);
          this.printHelp();
          return ExitCode.INVALID_ARGUMENT;
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        return ExitCode.SIGINT;
      }
      this.writeErr(`Error: ${err?.message || err}`);
      return ExitCode.FAILURE;
    } finally {
      process.removeListener("SIGINT", sigintHandler);
      await app.close();
    }
  }

  private async handleList(app: ActionDockApp, subArgs: string[]): Promise<number> {
    const isJson = subArgs.includes("--json") || subArgs.includes("--envelope");
    const useEnvelope = subArgs.includes("--envelope");
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
      intent || (positionalPatterns.length > 0 ? positionalPatterns.join("|") : undefined);

    const actions = await app.listActions();
    const list = actions.map((a) => ({
      id: a.id,
      description: a.description || "",
      packageId: this.options.packageId,
    }));

    const filterRes = filterWithFallbackInfo(
      list,
      effectiveIntent,
      [(a) => a.id, (a) => a.description],
      !noFallback
    );

    if (isJson) {
      const payload = useEnvelope
        ? { ok: true, data: filterRes.items }
        : filterRes.items;
      this.writeOut(JSON.stringify(payload, null, 2));
    } else {
      this.writeOut(
        renderActionList(
          filterRes.items,
          `Actions in ${this.options.packageId} (v${this.options.version})`,
          filterRes.isFallback,
          effectiveIntent
        )
      );
    }
    return ExitCode.SUCCESS;
  }

  private async handleDescribe(app: ActionDockApp, subArgs: string[]): Promise<number> {
    const id = subArgs.find((a) => !a.startsWith("-"));
    const isJson = subArgs.includes("--json") || subArgs.includes("--envelope");
    const useEnvelope = subArgs.includes("--envelope");

    if (!id) {
      this.writeErr("Error: Action ID is required for describe");
      return ExitCode.INVALID_ARGUMENT;
    }

    let action: ActionSpec | undefined;
    try {
      action = await app.describeAction(id);
    } catch {
      this.writeErr(`Error: Action '${id}' not found`);
      return ExitCode.INVALID_ARGUMENT;
    }

    const detail = {
      id: action.id,
      packageId: this.options.packageId,
      description: action.description,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
    };

    if (isJson) {
      const payload = useEnvelope ? { ok: true, data: detail } : detail;
      this.writeOut(JSON.stringify(payload, null, 2));
    } else {
      this.writeOut(renderActionDetail(detail));
    }
    return ExitCode.SUCCESS;
  }

  private async handleRun(
    app: ActionDockApp,
    subArgs: string[],
    signal: AbortSignal
  ): Promise<number> {
    const id = subArgs.find((a) => !a.startsWith("-"));
    if (!id) {
      this.writeErr("Error: Action ID is required for run");
      return ExitCode.INVALID_ARGUMENT;
    }

    let input: unknown = {};
    let timeoutMs: number | undefined;

    for (let i = 0; i < subArgs.length; i++) {
      const arg = subArgs[i];
      if (arg === "--async") {
        this.writeErr("Error: Async execution is not supported in standalone single-execution binaries.");
        return ExitCode.FAILURE;
      } else if (arg === "--timeout" && i + 1 < subArgs.length) {
        timeoutMs = parseDuration(subArgs[++i]);
      } else if (arg.startsWith("--timeout=")) {
        timeoutMs = parseDuration(arg.slice(10));
      } else if (arg === "--input" && i + 1 < subArgs.length) {
        try {
          input = JSON.parse(subArgs[++i]);
        } catch (e: any) {
          this.writeErr(`Error parsing --input JSON: ${e.message}`);
          return ExitCode.INVALID_ARGUMENT;
        }
      } else if (arg.startsWith("--input=")) {
        try {
          input = JSON.parse(arg.slice(8));
        } catch (e: any) {
          this.writeErr(`Error parsing --input JSON: ${e.message}`);
          return ExitCode.INVALID_ARGUMENT;
        }
      } else if (arg === "--input-file" && i + 1 < subArgs.length) {
        try {
          input = JSON.parse(readFileSync(subArgs[++i], "utf-8"));
        } catch (e: any) {
          this.writeErr(`Error reading --input-file: ${e.message}`);
          return ExitCode.INVALID_ARGUMENT;
        }
      }
    }

    const result = await app.runAction(id, input as JsonValue, {
      signal,
      timeoutMs,
    });

    this.writeOut(JSON.stringify(result, null, 2));
    return result.ok ? ExitCode.SUCCESS : ExitCode.FAILURE;
  }

  private async handleConfig(app: ActionDockApp, subArgs: string[]): Promise<number> {
    const sub = subArgs[0] || "list";

    if (sub === "list") {
      const all = app.storage.listConfig();
      this.writeOut(JSON.stringify(all, null, 2));
      return ExitCode.SUCCESS;
    }

    if (sub === "get") {
      const key = subArgs[1];
      if (!key) {
        this.writeErr("Error: config key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      const val = (await app.getConfig(key)) ?? app.storage.getConfig(key);
      this.writeOut(val !== undefined ? JSON.stringify(val) : "undefined");
      return ExitCode.SUCCESS;
    }

    if (sub === "set") {
      const key = subArgs[1];
      const rawVal = subArgs[2];
      if (!key || rawVal === undefined) {
        this.writeErr("Error: key and value required");
        return ExitCode.INVALID_ARGUMENT;
      }
      let parsed: unknown = rawVal;
      try {
        parsed = JSON.parse(rawVal);
      } catch {
        parsed = rawVal;
      }
      await app.setConfig(key, parsed as any);
      this.writeOut(`Config '${key}' updated`);
      return ExitCode.SUCCESS;
    }

    if (sub === "delete") {
      const key = subArgs[1];
      if (!key) {
        this.writeErr("Error: config key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      app.storage.deleteConfig(key);
      this.writeOut(`Config '${key}' deleted`);
      return ExitCode.SUCCESS;
    }

    this.writeErr(`Unknown config subcommand: '${sub}'`);
    return ExitCode.INVALID_ARGUMENT;
  }

  private async handleState(app: ActionDockApp, subArgs: string[]): Promise<number> {
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
      const keys = await app.storage.listStateKeys(namespace !== undefined ? namespace : null, prefix);
      this.writeOut(JSON.stringify(keys, null, 2));
      return ExitCode.SUCCESS;
    }

    if (sub === "get") {
      const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
      if (!key) {
        this.writeErr("Error: state key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      let val: unknown;
      if (namespace !== undefined) {
        val = await app.getState(key, { namespace });
      } else {
        val = await app.getState(key);
      }
      if (isJson) {
        this.writeOut(JSON.stringify({ key, value: val }, null, 2));
      } else {
        this.writeOut(val !== undefined ? JSON.stringify(val) : "undefined");
      }
      return ExitCode.SUCCESS;
    }

    if (sub === "set") {
      const key = subArgs[1];
      const rawVal = subArgs[2];
      if (!key || rawVal === undefined) {
        this.writeErr("Error: key and value required");
        return ExitCode.INVALID_ARGUMENT;
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

      await app.setState(actualKey, parsed as any, { namespace: ns, ttl });
      const displayKey = ns ? `${ns}:${actualKey}` : actualKey;
      this.writeOut(`State '${displayKey}' updated`);
      return ExitCode.SUCCESS;
    }

    if (sub === "delete" || sub === "rm") {
      const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
      if (!key) {
        this.writeErr("Error: state key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      const deleted = await app.storage.deleteStateSmart(key, namespace);
      if (deleted) {
        this.writeOut(`State '${key}' deleted`);
        return ExitCode.SUCCESS;
      }
      this.writeErr(`Error: State key '${key}' not found`);
      return ExitCode.FAILURE;
    }

    if (sub === "clear" || sub === "clean") {
      const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
      const count = await app.storage.clearState({
        namespace,
        all: isAll,
        prefix: prefix || undefined,
      });
      this.writeOut(`Cleared ${count} state entry(s)`);
      return ExitCode.SUCCESS;
    }

    this.writeErr(`Unknown state subcommand: '${sub}'`);
    return ExitCode.INVALID_ARGUMENT;
  }

  private printHelp(): void {
    this.writeOut(`${this.options.packageId} (v${this.options.version})`);
    if (this.options.description) this.writeOut(`${this.options.description}\n`);
    this.writeOut("Usage:");
    this.writeOut("  <cmd> list [--json]                         List available actions");
    this.writeOut("  <cmd> describe <id> [--json]                Show action details and schemas");
    this.writeOut("  <cmd> run <id> [--input '<json>']           Execute action with JSON input");
    this.writeOut("  <cmd> config list/get/set/delete            Manage package configuration");
    this.writeOut("  <cmd> state list/get/set/delete             Manage shared state store");
    this.writeOut("\nGlobal options:");
    this.writeOut("  --data-dir <path>                           Custom runtime database directory");
    this.writeOut("  --config <KEY=val>                          Temporary config override");
  }
}

/**
 * 运行独立二进制参数解析分发器并返回退出状态码。
 */
export async function runStandaloneCli(
  argv: string[] = process.argv.slice(2),
  options: StandaloneOptions
): Promise<number> {
  const dispatcher = new StandaloneDispatcher(options);
  return dispatcher.dispatch(argv);
}

/**
 * 创建独立二进制运行时分发器实例。
 */
export function createStandaloneDispatcher(options: StandaloneOptions): StandaloneDispatcher {
  return new StandaloneDispatcher(options);
}
