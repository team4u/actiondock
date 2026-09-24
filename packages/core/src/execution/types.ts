import type {
  ActionDefinition,
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  ProgressReporter,
  RunRecord,
  RunStatus,
} from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";
import type { ActionRunner, ExecutionHandle } from "../runtime/runner";
import type { Clock } from "../runtime/clock";
import type { EventSink } from "../runtime/events";
import type { RuntimeStorage } from "../storage/types";
import type { ModuleLoader } from "../runtime/module-loader";
import type { ProcessOwner } from "../process/process-manager";
import {
  type PackageIdentity,
  type RunOptions,
  type InvocationContext,
  createInvocationContext,
  createRootInvocationContext,
} from "../invocation/types";
import type { LocalActionResolver } from "../runtime/runner";

export { createInvocationContext, createRootInvocationContext };
export type { PackageIdentity, RunOptions, InvocationContext, LocalActionResolver };

/**
 * 跨包动作调用委托函数。
 */
export type ActionInvoker = (
  childAction: ActionRef | string,
  childInput: unknown,
  context: InvocationContext
) => Promise<unknown>;

/**
 * 统一执行协调服务配置选项。
 */
export interface ExecutionServiceOptions {
  /** 包物理与快照身份标识值对象（必填单一事实源） */
  identity: PackageIdentity;
  hostSessionId?: string;
  storage: RuntimeStorage;
  globalStorage?: RuntimeStorage;
  projectRoot?: string;
  projectConfig?: ProjectConfig;
  configOverrides?: Record<string, unknown>;
  actions?: Map<string, ActionDefinition>;
  process?: ProcessAPI;
  clock?: Clock;
  logger?: Logger;
  eventSink?: EventSink;
  maxActiveRuns?: number;
  ownerId?: string;
  actionResolver?: LocalActionResolver;
  customHome?: string;
  moduleLoader?: ModuleLoader;
  actionInvoker?: ActionInvoker;
}

/**
 * 异步任务执行票据。
 */
export interface ExecutionTicket {
  /** 运行标识 */
  runId: string;
  /** 当前状态 */
  status: RunStatus;
  /** 任务终态结果 Promise（用于需要异步等待执行结果的场景） */
  result?: Promise<ExecutionResult>;
}

/**
 * 取消操作结果枚举。
 */
export type CancelResult =
  | { outcome: "requested"; runId: string }
  | { outcome: "already_terminal"; runId: string; status: RunStatus }
  | { outcome: "not_found"; runId: string }
  | { outcome: "not_owner"; runId: string };

/**
 * 统一执行协调服务接口。
 */
export interface ExecutionService {
  /** 包物理与快照身份标识值对象 */
  readonly identity: PackageIdentity;

  /** 解析指定 Action 定义（支持本地注册、局部解析器及工程目录扫描） */
  resolveAction?(ref: ActionRef | string): Promise<ActionDefinition | undefined>;

  /** 同步执行 Action 并等待终态结果 */
  execute(
    ref: ActionRef | string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionResult>;

  /** 同步执行 Action 并等待终态结果（execute 统一别名） */
  run(
    ref: ActionRef | string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionResult>;

  /** 异步启动 Action 并立即返回任务票据 */
  start(
    ref: ActionRef | string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionTicket>;

  /** 根据 ID 获取运行记录 */
  get(runId: string): Promise<RunRecord | undefined>;

  /** 取消指定的在运行任务 */
  cancel(runId: string, reason?: string): Promise<CancelResult>;

  /** 订阅执行事件流 */
  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent>;

  /** 获取指定运行的活动执行句柄（无活跃执行时返回 undefined） */
  getActiveHandle(runId: string): ExecutionHandle | undefined;

  /** 注册单个 Action 至执行引擎 */
  registerAction(id: string, action: ActionDefinition): void;

  /** 按 ID 检索已注册的 Action 定义 */
  getAction(id: string): ActionDefinition | undefined;

  /** 设置子任务动作调用委托器 */
  setActionInvoker?(invoker?: ActionInvoker): void;

  /** 优雅关闭服务并等待活跃任务收尾 */
  close(options?: { graceMs?: number }): Promise<void>;
}
