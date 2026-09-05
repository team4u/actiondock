import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
  RunStatus,
} from "@actiondock/sdk";

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
}

/**
 * 异步任务执行票据。
 */
export interface ExecutionTicket {
  /** 运行标识 */
  runId: string;
  /** 当前状态 */
  status: RunStatus;
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
    ref: ActionRef,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>;

  /** 异步启动 Action 并立即返回任务票据 */
  start(
    ref: ActionRef,
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
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent>;

  /** 优雅关闭服务并等待活跃任务收尾 */
  close(options?: { graceMs?: number }): Promise<void>;
}
