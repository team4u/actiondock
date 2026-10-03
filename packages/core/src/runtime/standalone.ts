import { type ActionDefinition } from "@actiondock/sdk";
import type { ActionSpec } from "../package/types";
import type { ConfigItemDefinition } from "../project/types";
import { createActionDock } from "../service/factory";
import type { ActionDockService } from "../service/types";
import { STANDALONE_ASYNC_UNSUPPORTED } from "../errors";
import { normalizeActionCollection } from "./action-collection";
import { parseStandaloneArgs, printHelp, emitError } from "./standalone-help";
import {
  handleList,
  handleDescribe,
  handleRun,
  handleConfig,
  handleState,
  type CommandContext,
} from "./standalone-commands";

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

  private emitError(
    isJson: boolean,
    code: string,
    message: string,
    exitCode: number,
    options?: { textMessage?: string; details?: unknown; hint?: string }
  ): number {
    return emitError(
      this.writeOut.bind(this),
      this.writeErr.bind(this),
      isJson,
      code,
      message,
      exitCode,
      options
    );
  }

  private async createLocalService(
    dataDir?: string,
    configOverrides: Record<string, unknown> = {},
    accessMode: "owner" | "observer" = "owner"
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
      // 发现入口使用旁观初始化：不创建数据库、不取目录锁、不收割遗留运行记录；
      // 执行与写入入口继续持有者初始化（默认 recoverOrphans 语义）
      ...(accessMode === "observer" ? { recoverOrphans: false } : {}),
    });

    if (this.options.inMemory) {
      (this.options as any)._sharedService = service;
      return { service, ownsService: false };
    }

    return { service, ownsService: true };
  }

  private printHelp(): void {
    printHelp(this.writeOut.bind(this), {
      packageId: this.options.packageId,
      version: this.options.version,
      description: this.options.description,
    });
  }

  /**
   * 解析命令行参数并分发执行对应子命令。
   * 
   * @param argv 命令行参数数组（如 process.argv.slice(2)）
   * @param control 可选的中断与取消控制契约
   * @returns 退出状态码（0: 成功, 1: 失败, 2: 参数错误, 130: 中断）
   */
  async dispatch(argv: string[], control?: InvocationControl): Promise<number> {
    const {
      controlArgs,
      actionArgs,
      dataDir,
      configOverrides,
      command,
      subArgs,
    } = parseStandaloneArgs(argv);

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
      // 复用既有命令分发结果确定访问性质：发现命令（list/describe）为旁观；
      // 执行与写入命令（run/config/state）为持有者
      const accessMode = command === "list" || command === "describe" || command === "show" ? "observer" : "owner";
      const serviceRes = await this.createLocalService(dataDir, configOverrides, accessMode);
      service = serviceRes.service;
      ownsService = serviceRes.ownsService;
    } catch (err: any) {
      this.writeErr(`Error initializing standalone service: ${err?.message || err}`);
      return ExitCode.FAILURE;
    }

    const ctx: CommandContext = {
      service,
      options: this.options,
      writeOut: this.writeOut.bind(this),
      writeErr: this.writeErr.bind(this),
      emitError: this.emitError.bind(this),
    };

    try {
      let code: number;
      switch (command) {
        case "list":
          code = await handleList(ctx, subArgs);
          break;

        case "describe":
        case "show":
          code = await handleDescribe(ctx, subArgs);
          break;

        case "run":
          code = await handleRun(ctx, subArgs, actionArgs, control?.signal);
          break;

        case "config":
          code = await handleConfig(ctx, subArgs);
          break;

        case "state":
          code = await handleState(ctx, subArgs);
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
