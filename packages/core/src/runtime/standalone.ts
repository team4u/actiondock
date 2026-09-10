import { readFileSync } from "node:fs";
import type { ActionDefinition, JsonValue } from "@actiondock/sdk";
import type { ActionSpec } from "../app/types";
import { filterWithFallbackInfo } from "../filter";
import type { ConfigItemDefinition } from "../project/types";
import { createActionDockTarget } from "../target/target";
import type { ActionDockTarget } from "../target/types";
import { parseDuration } from "../utils";

/**
 * 退出状态码常量。
 */
export const ExitCode = {
  SUCCESS: 0,
  FAILURE: 1,
  INVALID_ARGUMENT: 2,
  SIGINT: 130,
} as const;

/**
 * 独立二进制运行分发器配置选项。
 */
export interface StandaloneDispatcherOptions {
  /** 所属 Package ID */
  packageId: string;
  /** 版本号 */
  version: string;
  /** 描述信息 */
  description?: string;
  /** 已构造的 ActionDockTarget 门面（若未传入则依据 actions/config 自动创建） */
  target?: ActionDockTarget;
  /** 声明的配置依赖定义（兼容选项） */
  configDefs?: Record<string, ConfigItemDefinition>;
  config?: Record<string, ConfigItemDefinition>;
  /** 打包内置的 Action 动作定义列表（兼容选项） */
  actions?:
    | Map<string, ActionDefinition>
    | Array<
        | ({ id: string; action: ActionDefinition } & Partial<ActionSpec>)
        | (ActionDefinition & { id: string })
      >
    | Record<string, ActionDefinition>;
  /** 标准输出自定义拦截器 */
  stdout?: (msg: string) => void;
  /** 标准错误自定义拦截器 */
  stderr?: (msg: string) => void;
  /** 持久化数据库目录 */
  dataDir?: string;
  /** 自定义主目录 */
  customHome?: string;
  /** 是否使用纯内存存储 */
  inMemory?: boolean;
}

/**
 * 统一独立入口轻量参数解析分发器（StandaloneDispatcher）。
 * 
 * 职责：
 * 1. 负责轻量参数解析、诊断输出渲染与统一退出码管理。
 * 2. 统一面向 ActionDockTarget 门面调用能力（支持本地 LocalTarget 与 IPC 监督隔离 Target）。
 * 3. 严格遵循 ActionDock 2.0 输出协议约定：结果数据专走 stdout，日志与错误专走 stderr。
 * 4. 独立入口拒绝异步启动语义，显式拦截并返回 STANDALONE_ASYNC_UNSUPPORTED。
 */
export class StandaloneDispatcher {
  private options: StandaloneDispatcherOptions;

  constructor(options: StandaloneDispatcherOptions) {
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

  private async createLocalTarget(
    dataDir?: string,
    configOverrides: Record<string, unknown> = {}
  ): Promise<{ target: ActionDockTarget; ownsTarget: boolean }> {
    if (this.options.target) {
      return { target: this.options.target, ownsTarget: false };
    }

    if (this.options.inMemory && (this.options as any)._sharedTarget) {
      return { target: (this.options as any)._sharedTarget, ownsTarget: false };
    }

    const actionSpecs: Record<string, any> = {};
    const actionsMap = new Map<string, ActionDefinition>();

    const rawActions = this.options.actions;
    if (rawActions instanceof Map) {
      for (const [k, v] of rawActions) {
        actionsMap.set(k, v);
        actionSpecs[k] = {
          id: k,
          description: (v as any).description,
          inputSchema: (v as any).inputSchema,
          outputSchema: (v as any).outputSchema,
        };
      }
    } else if (Array.isArray(rawActions)) {
      for (const item of rawActions as any[]) {
        const id = item.id;
        const act = item.action ?? item;
        if (id) {
          actionsMap.set(id, act);
          actionSpecs[id] = {
            id,
            description: item.description ?? act.description,
            inputSchema: item.inputSchema ?? act.inputSchema,
            outputSchema: item.outputSchema ?? act.outputSchema,
          };
        }
      }
    } else if (typeof rawActions === "object" && rawActions !== null) {
      for (const [k, v] of Object.entries(rawActions)) {
        actionsMap.set(k, v);
        actionSpecs[k] = {
          id: k,
          description: (v as any).description,
          inputSchema: (v as any).inputSchema,
          outputSchema: (v as any).outputSchema,
        };
      }
    }

    const appOptions = {
      projectConfig: {
        id: this.options.packageId,
        name: this.options.packageId,
        version: this.options.version,
        description: this.options.description,
        config: this.options.config || this.options.configDefs,
        actions: actionSpecs,
      },
      actions: actionsMap,
      dataDir: dataDir || this.options.dataDir,
      configOverrides,
      customHome: this.options.customHome,
      inMemory: this.options.inMemory,
    };

    const target = await createActionDockTarget({
      type: "local",
      appOptions,
    });

    if (this.options.inMemory) {
      (this.options as any)._sharedTarget = target;
      return { target, ownsTarget: false };
    }

    return { target, ownsTarget: true };
  }

  /**
   * 解析命令行参数并分发执行对应子命令。
   * 
   * @param argv 命令行参数数组（如 process.argv.slice(2)）
   * @returns 退出状态码（0: 成功, 1: 失败, 2: 参数错误, 130: 中断）
   */
  async dispatch(argv: string[]): Promise<number> {
    const args = [...argv];
    let dataDir: string | undefined;
    const configOverrides: Record<string, unknown> = {};

    // 1. 提取全局参数（--data-dir, --config）
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

    // 2. 独立入口拒绝异步启动语义
    if (args.includes("--async")) {
      const isJson = args.includes("--json") || args.includes("--envelope");
      if (isJson) {
        this.writeOut(
          JSON.stringify(
            {
              ok: false,
              error: {
                code: "STANDALONE_ASYNC_UNSUPPORTED",
                message:
                  "Async execution is not supported in standalone single-execution binaries. Use 'ad serve' or remote target.",
              },
            },
            null,
            2
          )
        );
      } else {
        this.writeErr(
          "Error [STANDALONE_ASYNC_UNSUPPORTED]: Async execution is not supported in standalone single-execution binaries."
        );
      }
      return ExitCode.FAILURE;
    }

    // 3. 版本与帮助快速处理（无需初始化 Host / Storage）
    if (command === "-v" || command === "-V" || command === "--version" || command === "version") {
      this.writeOut(`${this.options.packageId} v${this.options.version}`);
      return ExitCode.SUCCESS;
    }

    if (command === "-h" || command === "--help" || command === "help") {
      this.printHelp();
      return ExitCode.SUCCESS;
    }

    let target: ActionDockTarget;
    let ownsTarget = false;
    try {
      const targetRes = await this.createLocalTarget(dataDir, configOverrides);
      target = targetRes.target;
      ownsTarget = targetRes.ownsTarget;
    } catch (err: any) {
      this.writeErr(`Error initializing standalone target: ${err?.message || err}`);
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
          return await this.handleList(target, subArgs);

        case "describe":
        case "show":
          return await this.handleDescribe(target, subArgs);

        case "run":
          return await this.handleRun(target, subArgs, controller.signal);

        case "config":
          return await this.handleConfig(target, subArgs);

        case "state":
          return await this.handleState(target, subArgs);

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
      if (ownsTarget) {
        await target.close();
      }
    }
  }

  private async handleList(target: ActionDockTarget, subArgs: string[]): Promise<number> {
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

    const actions = await target.listActions();
    const list = actions.map((a) => ({
      id: a.id,
      description: a.description || "",
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
      let text = `Actions in ${this.options.packageId} (v${this.options.version}):\n\n`;
      for (const a of filterRes.items) {
        text += `  ${a.id.padEnd(28)} ${a.description}\n`;
      }
      this.writeOut(text.trimEnd());
    }
    return ExitCode.SUCCESS;
  }

  private async handleDescribe(target: ActionDockTarget, subArgs: string[]): Promise<number> {
    const id = subArgs.find((a) => !a.startsWith("-"));
    const isJson = subArgs.includes("--json") || subArgs.includes("--envelope");
    const useEnvelope = subArgs.includes("--envelope");

    if (!id) {
      this.writeErr("Error: Action ID is required for describe");
      return ExitCode.INVALID_ARGUMENT;
    }

    let action: ActionSpec | undefined;
    try {
      action = await target.describeAction(id);
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
      let text = `Action: ${action.id}\n`;
      if (action.description) text += `Description: ${action.description}\n`;
      if (action.inputSchema) {
        text += `\nInput Schema:\n${JSON.stringify(action.inputSchema, null, 2)}\n`;
      }
      if (action.outputSchema) {
        text += `\nOutput Schema:\n${JSON.stringify(action.outputSchema, null, 2)}\n`;
      }
      this.writeOut(text.trimEnd());
    }
    return ExitCode.SUCCESS;
  }

  private async handleRun(
    target: ActionDockTarget,
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
      if (arg === "--timeout" && i + 1 < subArgs.length) {
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

    const result = await target.runAction(id, input as JsonValue, {
      signal,
      timeoutMs,
    });

    this.writeOut(JSON.stringify(result, null, 2));
    return result.ok ? ExitCode.SUCCESS : ExitCode.FAILURE;
  }

  private async handleConfig(target: ActionDockTarget, subArgs: string[]): Promise<number> {
    const sub = subArgs[0] || "list";

    if (sub === "list") {
      const views = await target.listConfig(this.options.packageId);
      const dict: Record<string, unknown> = {};
      for (const v of views) {
        if (v.configured && v.value !== undefined) {
          dict[v.key] = v.value;
        }
      }
      this.writeOut(JSON.stringify(dict, null, 2));
      return ExitCode.SUCCESS;
    }

    if (sub === "get") {
      const key = subArgs[1];
      if (!key) {
        this.writeErr("Error: config key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      try {
        const item = await target.getConfig(this.options.packageId, key);
        this.writeOut(item.configured ? JSON.stringify(item.value) : "undefined");
        return ExitCode.SUCCESS;
      } catch {
        this.writeOut("undefined");
        return ExitCode.SUCCESS;
      }
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
      await target.setConfig(this.options.packageId, key, parsed as any);
      this.writeOut(`Config '${key}' updated`);
      return ExitCode.SUCCESS;
    }

    if (sub === "delete") {
      const key = subArgs[1];
      if (!key) {
        this.writeErr("Error: config key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      await target.deleteConfig(this.options.packageId, key);
      this.writeOut(`Config '${key}' deleted`);
      return ExitCode.SUCCESS;
    }

    this.writeErr(`Unknown config subcommand: '${sub}'`);
    return ExitCode.INVALID_ARGUMENT;
  }

  private async handleState(target: ActionDockTarget, subArgs: string[]): Promise<number> {
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
      const keys = await target.listStateKeys(this.options.packageId, "", {
        namespace,
        prefix: prefix || undefined,
        all: isAll,
      });
      this.writeOut(JSON.stringify(keys, null, 2));
      return ExitCode.SUCCESS;
    }

    if (sub === "get") {
      const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
      if (!key) {
        this.writeErr("Error: state key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      let ns = namespace;
      let actualKey = key;
      if (ns === undefined && key.includes(":")) {
        const colonIdx = key.indexOf(":");
        ns = key.slice(0, colonIdx);
        actualKey = key.slice(colonIdx + 1);
      }
      const val = await target.getState(this.options.packageId, "", actualKey, { namespace: ns });
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

      await target.setState(this.options.packageId, "", actualKey, parsed as any, { namespace: ns, ttl });
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
      const deleted = await target.deleteState(this.options.packageId, "", key, { namespace });
      if (deleted) {
        this.writeOut(`State '${key}' deleted`);
        return ExitCode.SUCCESS;
      }
      this.writeErr(`Error: State key '${key}' not found`);
      return ExitCode.FAILURE;
    }

    if (sub === "clear" || sub === "clean") {
      const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
      const count = await target.clearState(this.options.packageId, "", {
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
 * 独立二进制可执行文件运行时（兼容门面包装）。
 */
export interface StandaloneRuntimeOptions extends StandaloneDispatcherOptions {}

export class StandaloneRuntime {
  private dispatcher: StandaloneDispatcher;

  constructor(options: StandaloneRuntimeOptions) {
    this.dispatcher = new StandaloneDispatcher(options);
  }

  async run(argv: string[]): Promise<void> {
    const code = await this.dispatcher.dispatch(argv);
    if (code !== ExitCode.SUCCESS && code !== ExitCode.FAILURE) {
      process.exit(code);
    }
  }
}

/**
 * 工厂函数：创建独立运行时实例。
 */
export function createStandaloneRuntime(options: StandaloneRuntimeOptions): StandaloneRuntime {
  return new StandaloneRuntime(options);
}
