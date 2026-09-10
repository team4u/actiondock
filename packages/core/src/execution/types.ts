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
import type { Clock } from "../runtime/clock";
import type { EventSink } from "../runtime/events";
import type { RuntimeStorage } from "../storage/types";
import type { RuntimePlatform } from "../platform/types";

/**
 * 执行参数选项。
 */
export interface ExecuteOptions {
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 配置临时覆盖字典 */
  config?: Record<string, JsonValue>;
  /** 幂等请求去重标识 */
  requestId?: string;
  /** 父运行 ID */
  parentRunId?: string;
  /** 根运行 ID */
  rootRunId?: string;
  /** 最大调用嵌套深度限制 */
  maxCallDepth?: number;
  /** 外部日志注入 */
  logger?: Logger;
  /** 外部进度报告器注入 */
  progress?: ProgressReporter;
  /** 外部进程执行器注入 */
  process?: ProcessAPI;
  /** 可选的底层运行平台契约 */
  platform?: RuntimePlatform;
  /** 执行宿主会话标识 */
  hostSessionId?: string;
}

/**
 * 统一执行协调服务配置选项。
 */
export interface ExecutionServiceOptions {
  packageId: string;
  hostSessionId?: string;
  storage?: RuntimeStorage;
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
  maxCallDepth?: number;
  maxSubRuns?: number;
  ownerId?: string;
  actionResolver?: (ref: ActionRef | string) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
  getStorageForPackage?: (packageId: string, projectRoot?: string) => RuntimeStorage;
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
  customHome?: string;
  platform?: RuntimePlatform;
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
  /** 同步执行 Action 并等待终态结果 */
  execute(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>;

  /** 异步启动 Action 并立即返回任务票据 */
  start(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
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

  /** 优雅关闭服务并等待活跃任务收尾 */
  close(options?: { graceMs?: number }): Promise<void>;
}
