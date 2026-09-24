import { readFileSync } from "node:fs";
import { decodeStateKey, type ActionDefinition, type JsonValue } from "@actiondock/sdk";
import type { ActionSpec } from "../package/types";
import { filterWithFallbackInfo } from "../filter";
import type { ConfigItemDefinition } from "../project/types";
import { createActionDock } from "../service/factory";
import type { ActionDockService } from "../service/types";
import { STANDALONE_ASYNC_UNSUPPORTED } from "../errors";
import {
  resolveActionInput,
  FlatInputError,
  INPUT_CONFLICT,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  formatActionDetail,
  buildActionDescribePayload,
  buildCliDescribeInputMetadataV1,
  mapInputValidationFailure,
} from "../input";
import { validateActionInputValue } from "../json/value-validator";
import { normalizeActionCollection } from "./action-collection";
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
 * 调用控制选项契约。
 */
export interface InvocationControl {
  signal?: AbortSignal;
  cancellationSource?: "external" | "sigint";
}

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
  /** 已构造的 ActionDockService 服务（若未传入则依据 actions/config 自动创建） */
  service?: ActionDockService;
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
 * 2. 统一面向 ActionDockService 服务调用能力。
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

  /**
   * 统一错误输出辅助方法。
   *
   * JSON 模式向 stdout 输出两空格缩进的标准错误结构；
   * 纯文本模式向 stderr 输出单行错误消息（默认携带 Error: 前缀）。
   * 消息文本与退出码由调用方逐字给定，输出字节严格保持不变。
   *
   * @param isJson 是否处于 JSON 输出模式
   * @param code 错误码
   * @param message JSON 模式错误消息（兼作纯文本默认消息主体）
   * @param exitCode 调用方应返回的退出状态码
   * @param options 可选项：textMessage 覆盖纯文本消息全文；details 为 JSON 模式可选结构化详情
   * @returns 透传 exitCode 供调用方直接返回
   */
  private emitError(
    isJson: boolean,
    code: string,
    message: string,
    exitCode: number,
    options?: { textMessage?: string; details?: unknown }
  ): number {
    if (isJson) {
      const details = options?.details;
      this.writeOut(
        JSON.stringify(
          {
            ok: false,
            error: {
              code,
              message,
              ...(details !== undefined ? { details } : {}),
            },
          },
          null,
          2
        )
      );
    } else {
      this.writeErr(options?.textMessage ?? `Error: ${message}`);
    }
    return exitCode;
  }

  private async createLocalService(
    dataDir?: string,
    configOverrides: Record<string, unknown> = {}
  ): Promise<{ service: ActionDockService; ownsService: boolean }> {
    if (this.options.service) {
      return { service: this.options.service, ownsService: false };
    }

    if (this.options.inMemory && (this.options as any)._sharedService) {
      return { service: (this.options as any)._sharedService, ownsService: false };
    }

    // 归一化 Action 集合：单一入口统一三形态输入
    const { actionsMap, actionSpecs } = normalizeActionCollection(this.options.actions);
    // projectConfig.actions 要求 manifest 形态，字段语义兼容，此处显式收敛类型
    const manifestActions = actionSpecs as Record<string, any>;

    const runtimeOptions = {
      projectConfig: {
        id: this.options.packageId,
        name: this.options.packageId,
        version: this.options.version,
        description: this.options.description,
        config: this.options.config || this.options.configDefs,
        actions: manifestActions,
      },
      actions: actionsMap,
      dataDir: dataDir || this.options.dataDir,
      configOverrides,
      customHome: this.options.customHome,
      inMemory: this.options.inMemory,
    };

    const service = await createActionDock({
      runtimeOptions,
    });

    if (this.options.inMemory) {
      (this.options as any)._sharedService = service;
      return { service, ownsService: false };
    }

    return { service, ownsService: true };
  }

  /**
   * 解析命令行参数并分发执行对应子命令。
   * 
   * @param argv 命令行参数数组（如 process.argv.slice(2)）
   * @param control 可选的中断与取消控制契约
   * @returns 退出状态码（0: 成功, 1: 失败, 2: 参数错误, 130: 中断）
   */
  async dispatch(argv: string[], control?: InvocationControl): Promise<number> {
    const separator = argv.indexOf("--");
    const controlArgs = separator >= 0 ? argv.slice(0, separator) : argv;
    const actionArgs = separator >= 0 ? argv.slice(separator + 1) : [];

    let dataDir: string | undefined;
    const configOverrides: Record<string, unknown> = {};

    // 1. 提取全局参数（--data-dir, --config）仅从 controlArgs 中解析
    const filteredArgs: string[] = [];
    for (let i = 0; i < controlArgs.length; i++) {
      const arg = controlArgs[i];
      if (arg === "--data-dir" && i + 1 < controlArgs.length) {
        dataDir = controlArgs[++i];
      } else if (arg.startsWith("--data-dir=")) {
        dataDir = arg.slice(11);
      } else if (arg === "--config" && i + 1 < controlArgs.length) {
        const pair = controlArgs[++i];
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
    if (controlArgs.includes("--async")) {
      return this.emitError(
        controlArgs.includes("--json"),
        STANDALONE_ASYNC_UNSUPPORTED,
        "Async execution is not supported in standalone single-execution binaries. Use 'ad serve' or remote target.",
        ExitCode.FAILURE,
        {
          textMessage: `Error [${STANDALONE_ASYNC_UNSUPPORTED}]: Async execution is not supported in standalone single-execution binaries.`,
        }
      );
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

    let service: ActionDockService;
    let ownsService = false;
    try {
      const serviceRes = await this.createLocalService(dataDir, configOverrides);
      service = serviceRes.service;
      ownsService = serviceRes.ownsService;
    } catch (err: any) {
      this.writeErr(`Error initializing standalone service: ${err?.message || err}`);
      return ExitCode.FAILURE;
    }

    try {
      let code: number;
      switch (command) {
        case "list":
          code = await this.handleList(service, subArgs);
          break;

        case "describe":
        case "show":
          code = await this.handleDescribe(service, subArgs);
          break;

        case "run":
          code = await this.handleRun(service, subArgs, actionArgs, control?.signal);
          break;

        case "config":
          code = await this.handleConfig(service, subArgs);
          break;

        case "state":
          code = await this.handleState(service, subArgs);
          break;

        default:
          this.writeErr(`Unknown command: '${command}'`);
          this.printHelp();
          return ExitCode.INVALID_ARGUMENT;
      }

      if (control?.cancellationSource === "sigint" && control?.signal?.aborted) {
        return ExitCode.SIGINT;
      }
      return code;
    } catch (err: any) {
      if (
        control?.cancellationSource === "sigint" &&
        (control?.signal?.aborted || err?.name === "AbortError" || err?.code === "SIGINT_INTERRUPTED")
      ) {
        return ExitCode.SIGINT;
      }
      this.writeErr(`Error: ${err?.message || err}`);
      return ExitCode.FAILURE;
    } finally {
      if (ownsService) {
        await service.close();
      }
    }
  }

  private async handleList(service: ActionDockService, subArgs: string[]): Promise<number> {
    const isJson = subArgs.includes("--json");
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

    const actions = await service.discovery.listActions();
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
      this.writeOut(JSON.stringify(filterRes.items, null, 2));
    } else {
      let text = `Actions in ${this.options.packageId} (v${this.options.version}):\n\n`;
      for (const a of filterRes.items) {
        text += `  ${a.id.padEnd(28)} ${a.description}\n`;
      }
      this.writeOut(text.trimEnd());
    }
    return ExitCode.SUCCESS;
  }

  private async handleDescribe(service: ActionDockService, subArgs: string[]): Promise<number> {
    const id = subArgs.find((a) => !a.startsWith("-"));
    const isJson = subArgs.includes("--json");

    if (!id) {
      return this.emitError(isJson, "INVALID_ARGUMENT", "Action ID is required for describe", ExitCode.INVALID_ARGUMENT);
    }

    let action: ActionSpec | undefined;
    try {
      action = await service.discovery.describeAction(id);
    } catch {
      return this.emitError(isJson, "INVALID_ARGUMENT", `Action '${id}' not found`, ExitCode.INVALID_ARGUMENT);
    }

    const payload = buildActionDescribePayload(action, {
      packageId: this.options.packageId,
    });

    if (isJson) {
      this.writeOut(JSON.stringify(payload, null, 2));
    } else {
      this.writeOut(formatActionDetail(payload));
    }
    return ExitCode.SUCCESS;
  }

  private async handleRun(
    service: ActionDockService,
    subArgs: string[],
    actionArgs: string[],
    signal?: AbortSignal
  ): Promise<number> {
    const isJson = subArgs.includes("--json");
    const id = subArgs.find((a) => !a.startsWith("-"));
    if (!id) {
      return this.emitError(
        isJson,
        "INVALID_ARGUMENT",
        "Error: Action ID is required for run",
        ExitCode.INVALID_ARGUMENT,
        { textMessage: "Error: Action ID is required for run" }
      );
    }

    let inputStr: string | undefined;
    let inputFile: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < subArgs.length; i++) {
      const arg = subArgs[i];
      if (arg === "--timeout" && i + 1 < subArgs.length) {
        try {
          timeoutMs = parseDuration(subArgs[++i]);
        } catch (err: any) {
          return this.emitError(
            isJson,
            "INVALID_ARGUMENT",
            `Invalid timeout format: ${err?.message || err}`,
            ExitCode.INVALID_ARGUMENT
          );
        }
      } else if (arg.startsWith("--timeout=")) {
        try {
          timeoutMs = parseDuration(arg.slice(10));
        } catch (err: any) {
          return this.emitError(
            isJson,
            "INVALID_ARGUMENT",
            `Invalid timeout format: ${err?.message || err}`,
            ExitCode.INVALID_ARGUMENT
          );
        }
      } else if (arg === "--input" && i + 1 < subArgs.length) {
        inputStr = subArgs[++i];
      } else if (arg.startsWith("--input=")) {
        inputStr = arg.slice(8);
      } else if (arg === "--input-file" && i + 1 < subArgs.length) {
        inputFile = subArgs[++i];
      } else if (arg.startsWith("--input-file=")) {
        inputFile = arg.slice(13);
      }
    }

    let input: JsonValue;
    try {
      input = await resolveActionInput({
        input: inputStr,
        inputFile,
        flatArgs: actionArgs.length > 0 ? actionArgs : undefined,
        stdin: process.stdin,
      });
      const check = validateActionInputValue(input);
      if (!check.valid) {
        throw mapInputValidationFailure("cli-pre-target", check);
      }
    } catch (err: any) {
      return this.emitError(isJson, err?.code || "INVALID_ARGUMENT", err?.message || String(err), ExitCode.INVALID_ARGUMENT, {
        details: err?.details,
      });
    }

    const result = await service.execution.run(id, input, {
      signal,
      timeoutMs,
    });

    if (isJson) {
      this.writeOut(JSON.stringify(result, null, 2));
    } else {
      if (result.ok) {
        const data: any = result.data;
        let rawText: string;
        let metaInfo: Record<string, unknown> | undefined;

        if (typeof data === "string") {
          rawText = data;
        } else if (data !== null && typeof data === "object") {
          if ("content" in data && data.content !== undefined) {
            rawText =
              typeof data.content === "object" && data.content !== null
                ? JSON.stringify(data.content, null, 2)
                : String(data.content);
            const { content, ...rest } = data;
            if (Object.keys(rest).length > 0) {
              metaInfo = rest;
            }
          } else if ("text" in data && typeof data.text === "string") {
            rawText = data.text;
            const { text, ...rest } = data;
            if (Object.keys(rest).length > 0) {
              metaInfo = rest;
            }
          } else if ("message" in data && typeof data.message === "string") {
            rawText = data.message;
            const { message, ...rest } = data;
            if (Object.keys(rest).length > 0) {
              metaInfo = rest;
            }
          } else {
            rawText = JSON.stringify(data, null, 2);
          }
        } else if (data !== undefined) {
          rawText = String(data);
        } else {
          rawText = "";
        }

        if (metaInfo) {
          const parts: string[] = [];
          const title = metaInfo.path ? String(metaInfo.path) : id;
          parts.push(title);

          if (metaInfo.startLine !== undefined && metaInfo.endLine !== undefined) {
            parts.push(`lines ${metaInfo.startLine}-${metaInfo.endLine}`);
          } else if (metaInfo.line !== undefined) {
            parts.push(`line ${metaInfo.line}`);
          }

          if (metaInfo.hasMore !== undefined) {
            parts.push(`hasMore: ${metaInfo.hasMore}`);
          }
          if (metaInfo.truncated) {
            parts.push("truncated: true");
          }

          const handled = new Set(["path", "startLine", "endLine", "line", "hasMore", "truncated"]);
          for (const [k, v] of Object.entries(metaInfo)) {
            if (!handled.has(k) && v !== undefined) {
              parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
            }
          }

          if (parts.length > 0) {
            this.writeErr(`[${parts.join(" | ")}]`);
          }
        }

        this.writeOut(rawText);
      } else {
        this.writeErr(`Error [${result.error.code}]: ${result.error.message}`);
        if (result.error.details) {
          this.writeErr(
            typeof result.error.details === "string"
              ? result.error.details
              : JSON.stringify(result.error.details, null, 2)
          );
        }
      }
    }
    return result.ok ? ExitCode.SUCCESS : ExitCode.FAILURE;
  }

  private async handleConfig(service: ActionDockService, subArgs: string[]): Promise<number> {
    const sub = subArgs[0] || "list";

    if (!service.management) {
      this.writeErr("Error: management port is not enabled on this service");
      return ExitCode.FAILURE;
    }

    if (sub === "list") {
      const views = await service.management.config.list(this.options.packageId);
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
        const item = await service.management.config.get(this.options.packageId, key);
        this.writeOut(item.configured ? JSON.stringify(item.value) : "undefined");
        return ExitCode.SUCCESS;
      } catch (err: any) {
        // 服务能力缺失（如远端未开启管理接口）视为键未配置，输出 undefined
        if (this.isServiceCapabilityError(err)) {
          this.writeOut("undefined");
          return ExitCode.SUCCESS;
        }
        // 内部异常严禁吞没：透传 stderr 并以 FAILURE 退出码暴露
        this.writeErr(`Error reading config '${key}': ${err?.message || String(err)}`);
        return ExitCode.FAILURE;
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
      await service.management.config.set(this.options.packageId, key, parsed as any);
      this.writeOut(`Config '${key}' updated`);
      return ExitCode.SUCCESS;
    }

    if (sub === "delete") {
      const key = subArgs[1];
      if (!key) {
        this.writeErr("Error: config key required");
        return ExitCode.INVALID_ARGUMENT;
      }
      await service.management.config.delete(this.options.packageId, key);
      this.writeOut(`Config '${key}' deleted`);
      return ExitCode.SUCCESS;
    }

    this.writeErr(`Unknown config subcommand: '${sub}'`);
    return ExitCode.INVALID_ARGUMENT;
  }

  private async handleState(service: ActionDockService, subArgs: string[]): Promise<number> {
    const sub = subArgs[0] || "list";
    let namespace: string | undefined;
    let isAll = false;
    let isJson = false;

    if (!service.management) {
      this.writeErr("Error: management port is not enabled on this service");
      return ExitCode.FAILURE;
    }

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
      const keys = await service.management.state.list(this.options.packageId, "", {
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
      if (ns === undefined) {
        const decoded = this.decodeStateKeyArg(key);
        ns = decoded.namespace || undefined;
        actualKey = decoded.key;
      }
      const val = await service.management.state.get(this.options.packageId, "", actualKey, { namespace: ns });
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
      if (namespace === undefined) {
        const decoded = this.decodeStateKeyArg(key);
        ns = decoded.namespace;
        actualKey = decoded.key;
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

      await service.management.state.set(this.options.packageId, "", actualKey, parsed as any, { namespace: ns, ttl });
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
      const deleted = await service.management.state.delete(this.options.packageId, "", key, { namespace });
      if (deleted) {
        this.writeOut(`State '${key}' deleted`);
        return ExitCode.SUCCESS;
      }
      this.writeErr(`Error: State key '${key}' not found`);
      return ExitCode.FAILURE;
    }

    if (sub === "clear" || sub === "clean") {
      const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
      const count = await service.management.state.clear(this.options.packageId, "", {
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

  /**
   * 判定配置读取异常是否为服务能力缺失（键未配置语义）而非内部故障。
   */
  private isServiceCapabilityError(err: any): boolean {
    const code = String(err?.code || "");
    return (
      code === "CAPABILITY_UNAVAILABLE" ||
      code === "TARGET_CAPABILITY_UNAVAILABLE"
    );
  }

  /**
   * 解析携带命名空间前缀的状态键参数：委托 sdk 单一事实源 decodeStateKey。
   *
   * 解析失败（如存在多个未转义冒号的歧义键）时按纯键处理，交由存储层兜底。
   */
  private decodeStateKeyArg(key: string): { namespace: string; key: string } {
    try {
      return decodeStateKey(key);
    } catch {
      return { namespace: "", key };
    }
  }

  private printHelp(): void {
    this.writeOut(`${this.options.packageId} (v${this.options.version})`);
    if (this.options.description) this.writeOut(`${this.options.description}\n`);
    this.writeOut("Usage:");
    this.writeOut("  <cmd> list [--json]                         List available actions");
    this.writeOut("  <cmd> describe <id> [--json]                Show action details and schemas");
    this.writeOut("  <cmd> run <id> [--input '<json>']           Execute action (raw text output by default)");
    this.writeOut("  <cmd> run <id> [--json]                     Output standard execution result in JSON format");
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

/**
 * 独立二进制进程入口适配器。
 * 仅在命令行可执行入口调用，负责全局 SIGINT 监听与退出状态码写入。
 */
export async function runStandaloneProcess(
  argv: string[],
  options: StandaloneDispatcherOptions
): Promise<void> {
  const controller = new AbortController();
  const control: InvocationControl = {
    signal: controller.signal,
  };
  let sigintCount = 0;
  const sigintHandler = () => {
    sigintCount++;
    if (sigintCount === 1) {
      control.cancellationSource = "sigint";
      controller.abort(new Error("Interrupted by SIGINT"));
    } else {
      process.exitCode = 130;
      process.exit(130);
    }
  };
  process.on("SIGINT", sigintHandler);
  try {
    const dispatcher = new StandaloneDispatcher(options);
    const exitCode = await dispatcher.dispatch(argv, control);
    process.exitCode = exitCode;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

