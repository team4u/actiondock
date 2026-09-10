import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ActionContext,
  ActionDefinition,
  ActionRef,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  ProgressReporter,
  RuntimeError,
  RunRecord,
} from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { resolveActionProject, resolvePackageRoot } from "../registry/registry";
import { validateSchema } from "../schema/validator";
import type { RuntimeStorage, TerminalRunStatus } from "../storage/types";
import type { Clock } from "./clock";
import type { RuntimePlatform } from "../platform/types";
import { createActionContext, StderrLogger } from "./context";

/**
 * ActionRunner 初始化配置选项。
 */
export interface RunnerOptions {
  /** 运行所属的 Package ID */
  packageId: string;
  /** 持久化运行时存储实例（SQLite） */
  storage?: RuntimeStorage;
  /** 全局共享持久化存储实例（SQLite，用于单例池化避免泄漏） */
  globalStorage?: RuntimeStorage;
  /** 项目根目录绝对路径 */
  projectRoot?: string;
  /** 项目元数据配置 */
  projectConfig?: ProjectConfig;
  /** CLI 或上层注入的临时配置覆盖项 */
  configOverrides?: Record<string, unknown>;
  /** 预加载的 Action 映射表 */
  actions?: Map<string, ActionDefinition>;
  /** 外部注入的进程执行器 */
  process?: ProcessAPI;
  /** 可选的时间与时钟源（默认使用存储内嵌时钟或系统时间） */
  clock?: Clock;
  /** 可选的底层运行时平台契约 */
  platform?: RuntimePlatform;
  /** 动态解析跨包或未注册 Action 的委托函数 */
  actionResolver?: (
    ref: ActionRef | string,
    currentPackageId?: string
  ) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
  /** 最大调用嵌套深度限制（防死循环/过深调用链，默认 16） */
  maxCallDepth?: number;
  /** 最大并发子任务数限制（默认 64） */
  maxSubRuns?: number;
  /** 跨包存储工厂 */
  getStorageForPackage?: (packageId: string, projectRoot?: string) => RuntimeStorage;
  /** 跨包运行上下文解析委托函数 */
  packageContextResolver?: (packageId: string) => Promise<{
    projectRoot?: string;
    projectConfig?: ProjectConfig;
    storage: RuntimeStorage;
    actions?: Map<string, ActionDefinition>;
  } | undefined> | {
    projectRoot?: string;
    projectConfig?: ProjectConfig;
    storage: RuntimeStorage;
    actions?: Map<string, ActionDefinition>;
  } | undefined;
  /** 自定义 ActionDock 用户家目录（用于测试隔离与多租户环境） */
  customHome?: string;
}

/** ActionRunnerOptions 别名兼容 */
export type ActionRunnerOptions = RunnerOptions;

/**
 * 启动 Action 执行时的可选控制参数。
 */
export interface ExecutionStartOptions {
  /** 显式指定的运行 ID */
  runId?: string;
  /** 根运行 ID */
  rootRunId?: string;
  /** 父级运行 ID（嵌套调用场景下建立调用链树） */
  parentRunId?: string;
  /** 包物理实例标识 */
  packageInstanceId?: string;
  /** 快照代次标识 */
  generationId?: string;
  /** 执行所有者标识 */
  ownerId?: string;
  /** 调用栈数组（用于检测 A -> B -> A 环路死锁） */
  callStack?: string[];
  /** 外部传入的 AbortSignal 取消信号 */
  signal?: AbortSignal;
  /** 最大超时时间（毫秒），超时将自动中止执行并标记为 ACTION_TIMEOUT */
  timeoutMs?: number;
  /** 最大调用深度覆盖 */
  maxCallDepth?: number;
  /** 外部注入的进程执行器 */
  process?: ProcessAPI;
  /** 可选的底层运行时平台契约 */
  platform?: RuntimePlatform;
  /** 外部注入的进度报告器 */
  progress?: ProgressReporter;
  /** 外部注入的日志记录器 */
  logger?: Logger;
  /** 执行级临时配置覆盖项 */
  configOverrides?: Record<string, unknown>;
}

/**
 * 异步执行句柄，支持获取执行结果 Promise 与主动取消操作。
 */
export interface ExecutionHandle {
  /** 本次执行生成的全局唯一运行 ID */
  runId: string;
  /** 最终执行结果信封 Promise */
  result: Promise<ExecutionResult>;
  /**
   * 取消当前正在执行的任务
   * @param reason 取消原因
   * @returns 是否成功触发取消
   */
  cancel(reason?: string): boolean;
}

/**
 * Action 解析结果判别联合类型。
 */
export type ActionResolution =
  | { status: "found"; action: ActionDefinition }
  | { status: "not_found"; reason?: string }
  | { status: "load_failed"; error: Error; packageId: string; projectRoot: string };

const anonymousRunnerActionIds = new WeakMap<object, string>();
let anonymousRunnerActionCounter = 0;

/**
 * ActionDock 核心执行引擎（ActionRunner）。
 * 
 * 职责：
 * 1. 负责 Action 执行的全生命周期管理（校验、隔离、跟踪、落库）。
 * 2. 入参 (inputSchema) 与出参 (outputSchema) 的 JSON Schema 严格校验。
 * 3. 嵌套 Action 相互调用的环路检测（Cycle Detection）。
 * 4. 超时 (Timeout) 与中断信号 (AbortSignal) 竞态控制。
 * 5. 自动记录并持久化 RunRecord 运行记录至 SQLite 存储。
 */
export class ActionRunner {
  private packageId: string;
  private storage: RuntimeStorage;
  private globalStorage?: RuntimeStorage;
  private projectRoot?: string;
  private projectConfig?: ProjectConfig;
  private configOverrides: Record<string, unknown>;
  private actions: Map<string, ActionDefinition>;
  private clock?: Clock;
  private process?: ProcessAPI;
  private platform?: RuntimePlatform;
  private maxCallDepth: number;
  private maxSubRuns: number;
  private activeSubRuns = 0;
  private packageRunners = new Map<string, ActionRunner>();
  private actionResolver?: (
    ref: ActionRef | string,
    currentPackageId?: string
  ) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
  private getStorageForPackage?: (packageId: string, projectRoot?: string) => RuntimeStorage;
  private packageContextResolver?: (packageId: string) => Promise<{
    projectRoot?: string;
    projectConfig?: ProjectConfig;
    storage: RuntimeStorage;
    actions?: Map<string, ActionDefinition>;
  } | undefined> | {
    projectRoot?: string;
    projectConfig?: ProjectConfig;
    storage: RuntimeStorage;
    actions?: Map<string, ActionDefinition>;
  } | undefined;
  private customHome?: string;

  constructor(options: RunnerOptions) {
    this.packageId = options.packageId;
    this.projectRoot = options.projectRoot;
    this.projectConfig = options.projectConfig;
    this.configOverrides = options.configOverrides || {};
    this.actions = options.actions || new Map();
    this.customHome = options.customHome;
    this.platform = options.platform;

    if (options.platform) {
      this.clock = options.platform.clock;
      this.process = options.platform.process;
      this.storage = options.storage ?? options.platform.storage.createStorage(this.packageId, {
        projectRoot: this.projectRoot,
        customHome: this.customHome,
      });
      this.globalStorage = options.globalStorage ?? options.platform.storage.createGlobalStorage({
        customHome: this.customHome,
      });
    } else {
      if (!options.storage) {
        throw new Error("ActionRunner requires either 'storage' or 'platform' option");
      }
      this.storage = options.storage;
      this.globalStorage = options.globalStorage;
      this.process = options.process;
      this.clock = options.clock;
    }

    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
    this.actionResolver = options.actionResolver;
    this.getStorageForPackage = options.getStorageForPackage;
    this.packageContextResolver = options.packageContextResolver;
  }

  public getStorage(): RuntimeStorage {
    return this.storage;
  }

  public getPackageRunners(): Map<string, ActionRunner> {
    return this.packageRunners;
  }

  /**
   * 注册单个 Action 到当前 Runner。
   */
  public registerAction(id: string, action: ActionDefinition): void;
  public registerAction(action: ({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition): void;
  public registerAction(
    idOrAction: string | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    actionDef?: ActionDefinition
  ): void {
    if (typeof idOrAction === "string") {
      if (actionDef) {
        this.actions.set(idOrAction, actionDef);
      }
    } else {
      const actObj = idOrAction as any;
      const id = actObj.id || "anonymous-action";
      const act = actObj.action || (actObj.run ? actObj : undefined);
      if (act) {
        this.actions.set(id, act);
      }
    }
  }

  /**
   * 根据 ID 检索注册的 Action。
   */
  public getAction(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  /**
   * 动态解析 Action（支持本地注册表、自定义解析器委托与已链接包目录索引检索）。
   * 
   * @param actionOrRef Action 定义对象、引用或标识符
   * @returns 解析判别联合结果（found | not_found | load_failed）
   */
  public async resolveAction(
    actionOrRef: ActionDefinition | ActionRef | string
  ): Promise<ActionResolution> {
    if (
      typeof actionOrRef === "object" &&
      "run" in actionOrRef &&
      typeof (actionOrRef as any).run === "function"
    ) {
      return { status: "found", action: actionOrRef as ActionDefinition };
    }

    const ref = actionOrRef as ActionRef | string;
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch (err: any) {
      return { status: "not_found", reason: err.message };
    }
    const targetActionId = parsed.actionId;
    const targetPackageId = parsed.packageId;

    // 1. 本地 actions 映射表优先检索
    if (targetPackageId && targetPackageId !== this.packageId) {
      if (this.actions.has(`${targetPackageId}/${targetActionId}`)) {
        return { status: "found", action: this.actions.get(`${targetPackageId}/${targetActionId}`)! };
      }
    } else {
      if (this.actions.has(targetActionId)) {
        return { status: "found", action: this.actions.get(targetActionId)! };
      }
      if (this.packageId && this.actions.has(`${this.packageId}/${targetActionId}`)) {
        return { status: "found", action: this.actions.get(`${this.packageId}/${targetActionId}`)! };
      }
    }

    // 2. 外部注入的自定义 actionResolver 调度
    if (this.actionResolver) {
      try {
        const customResolved = await this.actionResolver(ref, this.packageId);
        if (customResolved) {
          if (targetPackageId && targetPackageId !== this.packageId) {
            this.actions.set(`${targetPackageId}/${targetActionId}`, customResolved);
          } else {
            this.actions.set(targetActionId, customResolved);
            if (this.packageId) {
              this.actions.set(`${this.packageId}/${targetActionId}`, customResolved);
            }
          }
          return { status: "found", action: customResolved };
        }
      } catch (err: any) {
        return { status: "not_found", reason: err.message };
      }
    }

    // 3. 基于全局链接注册表与目录索引的动态寻址与按需加载
    const identifier = targetPackageId
      ? `${targetPackageId}/${targetActionId}`
      : targetActionId;

    let resolved;
    try {
      resolved = await resolveActionProject(identifier, this.projectRoot, this.customHome);
    } catch (err: any) {
      return { status: "not_found", reason: err.message };
    }

    if (!resolved || !existsSync(resolved.projectRoot)) {
      return {
        status: "not_found",
        reason: `Project root not found for action '${identifier}'`,
      };
    }

    let config;
    try {
      config = loadProjectConfig(resolved.projectRoot);
    } catch (err: any) {
      return {
        status: "load_failed",
        error: err instanceof Error ? err : new Error(String(err)),
        packageId: resolved.packageId,
        projectRoot: resolved.projectRoot,
      };
    }

    let actionsMap: Map<string, ActionDefinition>;
    try {
      actionsMap = await loadActions(resolved.projectRoot, config.actionsDir, {
        autoInstall: false,
        loader: this.platform?.modules,
      });
    } catch (err: any) {
      return {
        status: "load_failed",
        error: err instanceof Error ? err : new Error(String(err)),
        packageId: resolved.packageId,
        projectRoot: resolved.projectRoot,
      };
    }

    const matched = actionsMap.get(resolved.actionId);
    if (matched) {
      this.actions.set(`${resolved.packageId}/${resolved.actionId}`, matched);
      // 仅当目标包就是当前项目时才注册短标识符，避免跨包动态载入污染全局短标识符
      if (!targetPackageId || resolved.packageId === this.packageId) {
        this.actions.set(resolved.actionId, matched);
      }
      return { status: "found", action: matched };
    }

    return {
      status: "not_found",
      reason: `Action '${resolved.actionId}' not found in package '${resolved.packageId}' (${resolved.projectRoot})`,
    };
  }

  /**
   * 获取当前 Runner 已注册的所有 Action 列表。
   */
  public listActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /**
   * 注入或更新跨包运行上下文解析委托。
   */
  public setPackageContextResolver(
    resolver: (packageId: string) => Promise<{
      projectRoot?: string;
      projectConfig?: ProjectConfig;
      storage: RuntimeStorage;
      actions?: Map<string, ActionDefinition>;
    } | undefined> | {
      projectRoot?: string;
      projectConfig?: ProjectConfig;
      storage: RuntimeStorage;
      actions?: Map<string, ActionDefinition>;
    } | undefined
  ): void {
    this.packageContextResolver = resolver;
  }

  /**
   * 跨包运行时解析与获取（确保跨包执行具备独立的配置、存储、状态与 Action 注册表）。
   */
  public async resolveTargetPackageRunner(targetPackageId: string): Promise<ActionRunner | undefined> {
    if (this.packageRunners.has(targetPackageId)) {
      return this.packageRunners.get(targetPackageId);
    }

    if (this.packageContextResolver) {
      const resolved = await this.packageContextResolver(targetPackageId);
      if (resolved) {
        const runner = new ActionRunner({
          packageId: targetPackageId,
          storage: resolved.storage,
          globalStorage: this.globalStorage,
          projectRoot: resolved.projectRoot,
          projectConfig: resolved.projectConfig,
          actions: resolved.actions,
          process: this.process,
          clock: this.clock,
          platform: this.platform,
          maxCallDepth: this.maxCallDepth,
          maxSubRuns: this.maxSubRuns,
          actionResolver: this.actionResolver,
          getStorageForPackage: this.getStorageForPackage,
          packageContextResolver: this.packageContextResolver,
        });
        this.packageRunners.set(targetPackageId, runner);
        return runner;
      }
    }

    const root = resolvePackageRoot(targetPackageId, this.projectRoot, this.customHome);
    if (root && existsSync(root)) {
      const config = loadProjectConfig(root);
      let storage: RuntimeStorage;
      if (this.getStorageForPackage) {
        storage = this.getStorageForPackage(targetPackageId, root);
      } else if (this.platform) {
        storage = this.platform.storage.createStorage(targetPackageId, {
          projectRoot: root,
          customHome: this.customHome,
        });
      } else {
        const sqlitePath = (config as any).storage?.sqlitePath || ".actiondock/storage.db";
        const dbPath = join(root, sqlitePath);
        const { SqliteRuntimeStorage } = await import("../storage/sqlite");
        storage = new SqliteRuntimeStorage({ dbPath, packageId: targetPackageId, clock: this.clock });
      }
      const actionsMap = await loadActions(root, config.actionsDir, {
        autoInstall: false,
        loader: this.platform?.modules,
      });
      const runner = new ActionRunner({
        packageId: targetPackageId,
        storage,
        globalStorage: this.globalStorage,
        projectRoot: root,
        projectConfig: config,
        actions: actionsMap,
        process: this.process,
        clock: this.clock,
        platform: this.platform,
        maxCallDepth: this.maxCallDepth,
        maxSubRuns: this.maxSubRuns,
        actionResolver: this.actionResolver,
        getStorageForPackage: this.getStorageForPackage,
        packageContextResolver: this.packageContextResolver,
        customHome: this.customHome,
      });
      this.packageRunners.set(targetPackageId, runner);
      return runner;
    }

    return undefined;
  }

  /**
   * 异步启动 Action 的执行并立即返回 ExecutionHandle 句柄。
   * 
   * @param actionOrId Action 定义对象、引用或标识符
   * @param input 传递给 Action 的输入数据
   * @param options 执行控制选项（超时、取消信号、父运行 ID 等）
   * @returns 包含 runId、result Promise 和 cancel 方法的执行句柄
   */
  start(
    actionOrId: ActionDefinition | ActionRef | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): ExecutionHandle {
    const runId = options.runId || randomUUID();
    const effectiveClock = options.platform?.clock ?? this.clock;
    const effectiveProcess = options.process || options.platform?.process || this.process;
    const startedAt =
      effectiveClock?.now().toISOString() ||
      (typeof (this.storage as any).clock?.now === "function"
        ? (this.storage as any).clock.now().toISOString()
        : new Date().toISOString());
    const callStack = [...(options.callStack || [])];

    let action: ActionDefinition | undefined;
    let targetActionId: string;
    let targetPackageId: string = this.packageId;

    if (
      typeof actionOrId === "object" &&
      "run" in actionOrId &&
      typeof (actionOrId as any).run === "function"
    ) {
      action = actionOrId as ActionDefinition;
      const actObj = action as any;
      if (actObj.id) {
        targetActionId = actObj.id;
      } else {
        let foundId: string | undefined;
        for (const [id, a] of this.actions) {
          if (a === action) {
            foundId = id;
            break;
          }
        }
        if (foundId) {
          targetActionId = foundId;
        } else {
          let anonId = anonymousRunnerActionIds.get(action);
          if (!anonId) {
            anonymousRunnerActionCounter++;
            anonId = `anonymous-action-${anonymousRunnerActionCounter}`;
            anonymousRunnerActionIds.set(action, anonId);
          }
          targetActionId = anonId;
          try {
            actObj.id = targetActionId;
          } catch {}
        }
      }
      this.actions.set(targetActionId, action);
    } else {
      const parsed = ActionResolver.parseRef(actionOrId as ActionRef | string);
      targetActionId = parsed.actionId;
      if (parsed.packageId) {
        targetPackageId = parsed.packageId;
      }

      if (parsed.packageId && parsed.packageId !== this.packageId) {
        action = this.actions.get(`${parsed.packageId}/${targetActionId}`);
      } else {
        action =
          this.actions.get(targetActionId) ||
          (this.packageId ? this.actions.get(`${this.packageId}/${targetActionId}`) : undefined);
      }
    }

    // 1. 始终优先将执行尝试持久化到存储中（确保任意异常与终态都可追溯）
    const initialRun: RunRecord = {
      id: runId,
      rootRunId: options.rootRunId || options.parentRunId || runId,
      parentRunId: options.parentRunId,
      packageId: targetPackageId,
      packageInstanceId: options.packageInstanceId || targetPackageId,
      actionId: targetActionId,
      generationId: options.generationId || "1",
      ownerId: options.ownerId || "local",
      status: "running",
      input: input as JsonValue | undefined,
      startedAt,
    };
    this.storage.createRun(initialRun);

    let finalized = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const finalizeRun = (
      status: TerminalRunStatus,
      output?: unknown,
      error?: RuntimeError
    ) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (finalized) return;
      finalized = true;
      this.storage.updateRun(runId, status, output, error);
    };

    // 2. 调用嵌套深度限制检测 (Max Call Depth Check)
    const maxDepth = options.maxCallDepth ?? this.maxCallDepth;
    if (callStack.length >= maxDepth) {
      const error: RuntimeError = {
        code: "ACTION_MAX_DEPTH_EXCEEDED",
        message: `Maximum call depth of ${maxDepth} exceeded: ${callStack.join(" -> ")} -> ${targetActionId}`,
      };
      finalizeRun("failed", undefined, error);
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error }),
        cancel: () => false,
      };
    }

    // 3. 环路死锁检测 (Cycle Detection)
    const isExternal = Boolean(targetPackageId && targetPackageId !== this.packageId);
    const callKey = isExternal
      ? `${targetPackageId}/${targetActionId}`
      : targetActionId;

    const hasCycle = isExternal
      ? callStack.includes(callKey)
      : (callStack.includes(callKey) || (this.packageId ? callStack.includes(`${this.packageId}/${targetActionId}`) : false));

    if (hasCycle) {
      const error: RuntimeError = {
        code: "ACTION_CYCLE_DETECTED",
        message: `Cycle detected in action invocation: ${callStack.join(" -> ")} -> ${callKey}`,
      };
      finalizeRun("failed", undefined, error);
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error }),
        cancel: () => false,
      };
    }
    callStack.push(callKey);

    // 4. 输入参数 JSON Schema 校验（若 action 已就绪）
    const targetInputSchema =
      (action as any)?.inputSchema ?? this.projectConfig?.actions?.[targetActionId]?.inputSchema;
    if (targetInputSchema) {
      const val = validateSchema(targetInputSchema, input);
      if (!val.valid) {
        const error: RuntimeError = {
          code: "INPUT_VALIDATION_FAILED",
          message: `Input schema validation failed for action '${targetActionId}'`,
          details: val.errors,
        };
        finalizeRun("failed", undefined, error);
        return {
          runId,
          result: Promise.resolve({ ok: false, runId, error }),
          cancel: () => false,
        };
      }
    }

    // 5. 初始化 AbortController 与超时定时器
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => controller.abort(options.signal?.reason),
          { once: true }
        );
      }
    }

    let isTimeout = false;
    if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        isTimeout = true;
        controller.abort(new Error(`Action exceeded timeout of ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    // 6. 构建 ActionContext 运行时上下文
    const ctx = createActionContext({
      storage: this.storage,
      globalStorage: this.globalStorage,
      overrides: { ...this.configOverrides, ...(options.configOverrides || {}) },
      projectConfig: this.projectConfig,
      runId,
      rootRunId: initialRun.rootRunId,
      parentRunId: options.parentRunId,
      signal: controller.signal,
      process: effectiveProcess,
      progress: options.progress,
      logger: options.logger || new StderrLogger(targetActionId),
      onActionInvoke: async (childAction, childInput, parentRunId) => {
        if (this.activeSubRuns >= this.maxSubRuns) {
          const err = new Error(`Maximum concurrent sub-runs (${this.maxSubRuns}) reached`);
          (err as any).code = "MAX_SUBRUNS_REACHED";
          throw err;
        }

        let childPackageId = this.packageId;
        const parsed = ActionResolver.parseRef(childAction as ActionRef | string);
        if (parsed.packageId) {
          childPackageId = parsed.packageId;
        }

        const actionConfig = this.projectConfig?.actions?.[targetActionId] as any;
        const declaredUses = actionConfig?.uses ?? (action as any)?.uses;
        if (childPackageId && childPackageId !== this.packageId && Array.isArray(declaredUses)) {
          const childActionId =
            typeof childAction === "string"
              ? ActionResolver.parseRef(childAction).actionId
              : (childAction as ActionRef).actionId;
          const targetRef = `${childPackageId}/${childActionId}`;
          const isAllowed = declaredUses.some(
            (u: string) => u === targetRef || u === `${childPackageId}/*` || u === childPackageId
          );
          if (!isAllowed) {
            const err = new Error(
              `Undeclared cross-package dependency: Action '${this.packageId}/${targetActionId}' does not declare '${targetRef}' in 'uses'`
            );
            (err as any).code = "UNDECLARED_ACTION_DEPENDENCY";
            (err as any).details = {
              caller: `${this.packageId}/${targetActionId}`,
              target: targetRef,
              declaredUses,
            };
            throw err;
          }
        }

        this.activeSubRuns++;
        try {
          let runnerToUse: ActionRunner = this;
          if (childPackageId && childPackageId !== this.packageId) {
            const targetRunner = await this.resolveTargetPackageRunner(childPackageId);
            if (targetRunner) {
              runnerToUse = targetRunner;
            } else if (!this.actionResolver) {
              const err = new Error(`Package '${childPackageId}' could not be resolved`);
              (err as any).code = "PACKAGE_NOT_FOUND";
              throw err;
            }
          }

          const childResult = await runnerToUse.execute(childAction, childInput, {
            rootRunId: initialRun.rootRunId,
            parentRunId,
            callStack,
            signal: controller.signal,
            process: effectiveProcess,
            platform: options.platform || this.platform,
            progress: options.progress,
            logger: options.logger,
            configOverrides: options.configOverrides,
            maxCallDepth: options.maxCallDepth ?? this.maxCallDepth,
          });
          if (!childResult.ok) {
            const err = new Error(childResult.error.message);
            (err as any).code = childResult.error.code;
            (err as any).details = childResult.error.details;
            throw err;
          }
          return childResult.data;
        } finally {
          this.activeSubRuns--;
        }
      },
    });

    // 7. 执行 Action 业务逻辑并与取消/超时信号进行竞态
    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(controller.signal.reason || new Error("Action execution was cancelled"));
      } else {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason || new Error("Action execution was cancelled")),
          { once: true }
        );
      }
    });

    const executionPromise = (async (): Promise<ExecutionResult> => {
      try {
        let currentAction = action;
        if (!currentAction) {
          const resolution = await this.resolveAction(actionOrId);
          if (resolution.status === "found") {
            currentAction = resolution.action;
          } else if (resolution.status === "load_failed") {
            const cause = resolution.error;
            const causeMsg = cause?.message || String(cause);
            const isMissingModule =
              causeMsg.includes("Cannot find package") ||
              causeMsg.includes("Cannot find module") ||
              causeMsg.includes("ERR_MODULE_NOT_FOUND") ||
              causeMsg.includes("Could not resolve");
            const hint = isMissingModule
              ? `依赖未安装，在 '${resolution.projectRoot}' 执行 npm install 或先执行 'ad run ${resolution.packageId}/${targetActionId}'`
              : undefined;

            const error: RuntimeError = {
              code: "ACTION_LOAD_FAILED",
              message: `Failed to load action '${targetActionId}' from package '${resolution.packageId}' (${resolution.projectRoot}): ${causeMsg}`,
              details: {
                packageId: resolution.packageId,
                projectRoot: resolution.projectRoot,
                rootCause: causeMsg,
                hint,
              },
            };
            finalizeRun("failed", undefined, error);
            return { ok: false, runId, error };
          } else {
            const error: RuntimeError = {
              code: "ACTION_NOT_FOUND",
              message: `Action '${targetActionId}' not found in registry or linked packages`,
              details: resolution.reason ? { reason: resolution.reason } : undefined,
            };
            finalizeRun("failed", undefined, error);
            return { ok: false, runId, error };
          }

          if ((currentAction as any).inputSchema) {
            const val = validateSchema((currentAction as any).inputSchema, input);
            if (!val.valid) {
              const error: RuntimeError = {
                code: "INPUT_VALIDATION_FAILED",
                message: `Input schema validation failed for action '${targetActionId}'`,
                details: val.errors,
              };
              finalizeRun("failed", undefined, error);
              return { ok: false, runId, error };
            }
          }
        }

        const rawOutput = await Promise.race([
          Promise.resolve().then(() => currentAction!.run(input, ctx)),
          abortPromise,
        ]);

        // 输出结果 Schema 校验
        const targetOutputSchema =
          (currentAction as any)?.outputSchema ?? this.projectConfig?.actions?.[targetActionId]?.outputSchema;
        if (targetOutputSchema) {
          const outVal = validateSchema(targetOutputSchema, rawOutput);
          if (!outVal.valid) {
            const error: RuntimeError = {
              code: "OUTPUT_VALIDATION_FAILED",
              message: `Output schema validation failed for action '${targetActionId}'`,
              details: outVal.errors,
            };
            finalizeRun("failed", undefined, error);
            return { ok: false, runId, error };
          }
        }

        finalizeRun("success", rawOutput);
        return {
          ok: true,
          runId,
          data: rawOutput as JsonValue,
        };
      } catch (err: any) {
        if (isTimeout) {
          const error: RuntimeError = {
            code: "ACTION_TIMEOUT",
            message: `Action exceeded timeout of ${options.timeoutMs}ms`,
          };
          finalizeRun("timed_out", undefined, error);
          return { ok: false, runId, error };
        }

        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          const reasonMsg =
            reason instanceof Error
              ? reason.message
              : typeof reason === "string"
              ? reason
              : undefined;
          const error: RuntimeError = {
            code: "ACTION_CANCELLED",
            message: "Action execution was cancelled",
            details: reasonMsg ? { reason: reasonMsg } : undefined,
          };
          finalizeRun("cancelled", undefined, error);
          return { ok: false, runId, error };
        }

        const error: RuntimeError = {
          code: err?.code || "ACTION_FAILED",
          message: err?.message || String(err),
          details: err?.details,
        };
        finalizeRun("failed", undefined, error);
        return {
          ok: false,
          runId,
          error,
        };
      }
    })();

    return {
      runId,
      result: executionPromise,
      cancel: (reason?: string): boolean => {
        if (finalized || controller.signal.aborted) {
          return false;
        }
        controller.abort(new Error(reason || "Action execution was cancelled"));
        return true;
      },
    };
  }

  /**
   * 同步等待方式执行指定 Action，直接返回 ExecutionResult 信封结果。
   * 
   * @param actionOrId Action 定义对象、引用或标识符
   * @param input 输入参数
   * @param options 执行控制选项
   */
  async execute(
    actionOrId: ActionDefinition | ActionRef | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): Promise<ExecutionResult> {
    return this.start(actionOrId, input, options).result;
  }
}
