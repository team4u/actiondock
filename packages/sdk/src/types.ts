/**
 * 标准 JSON 数据域。
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * 标准 JSON Schema 结构定义。
 * 支持对象模式或布尔模式。
 */
export type JsonSchema = Record<string, unknown> | boolean;

/**
 * ActionDock 标准运行时错误对象。
 */
export interface RuntimeError {
  /** 机器可读的唯一错误码 */
  code: string;
  /** 人类可读的错误描述信息 */
  message: string;
  /** 结构化的附加错误详情 */
  details?: unknown;
  /** 导致此错误的底层原始异常或原因 */
  cause?: unknown;
}

/**
 * 标准执行结果信封。
 */
export type ExecutionResult<T = JsonValue> =
  | {
      /** 执行是否成功 */
      ok: true;
      /** 本次执行的全局唯一运行标识 */
      runId: string;
      /** Action 执行返回的业务数据 */
      data: T;
    }
  | {
      /** 执行是否失败 */
      ok: false;
      /** 本次执行的全局唯一运行标识 */
      runId: string;
      /** 运行时错误详情 */
      error: RuntimeError;
    };

/**
 * Action 逻辑引用。
 */
export interface ActionRef {
  /** 所属包标识 */
  packageId?: string;
  /** Action 动作标识 */
  actionId: string;
}

/**
 * 运行时完整解析后的 Action 引用。
 */
export interface ResolvedActionRef {
  /** 包逻辑标识 */
  packageId: string;
  /** 包物理实例标识 */
  packageInstanceId: string;
  /** Action 动作标识 */
  actionId: string;
  /** 运行时代码快照代次标识 */
  generationId: string;
}

/**
 * Action 声明契约。
 */
export interface ActionContract {
  /** Action 唯一标识 */
  id: string;
  /** Action 功能描述 */
  description?: string;
  /** 输入参数模式规范 */
  inputSchema?: JsonSchema;
  /** 输出结果模式规范 */
  outputSchema?: JsonSchema;
  /** 静态 Action 依赖列表 */
  uses?: string[];
  /** 检索与分类标签 */
  tags?: string[];
  /** 协议注解元数据 */
  annotations?: Record<string, JsonValue>;
}

/**
 * 配置提供器接口。
 */
export interface Config {
  /**
   * 获取指定键的配置值，未设置时返回 undefined
   * @param key 配置键名
   */
  get<T = unknown>(key: string): T | undefined;
  /**
   * 获取指定键的配置值，未设置时返回提供的默认值
   * @param key 配置键名
   * @param defaultValue 默认回退值
   */
  get<T = unknown>(key: string, defaultValue: T): T;
  /**
   * 检查指定键是否存在配置值
   * @param key 配置键名
   */
  has(key: string): boolean;
}

/**
 * 共享状态持久化存储接口。
 */
export interface StateStore {
  /**
   * 读取指定键的状态值。若键已过期则返回 undefined
   * @param key 状态键名
   */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /**
   * 设置状态键值对，可选指定过期存活时间
   * @param key 状态键名
   * @param value 要存储的数据值
   * @param ttl 存活时间（单位：秒）。不传或小于等于 0 表示永久有效
   */
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
  /**
   * 删除指定键的状态数据
   * @param key 状态键名
   */
  delete(key: string): Promise<boolean>;
  /**
   * 清空当前命名空间下的所有状态数据
   * @param prefix 可选的键名前缀过滤条件
   */
  clear(prefix?: string): Promise<number>;
  /**
   * 列出当前命名空间下所有匹配前缀的状态键名
   * @param prefix 键名前缀过滤条件
   */
  keys(prefix?: string): Promise<string[]>;
  /**
   * 创建具有独立命名空间隔离的子 StateStore 实例
   * @param namespace 命名空间标识
   */
  scope(namespace: string): StateStore;
}

/**
 * 结构化日志记录器接口。
 */
export interface Logger {
  /** 记录调试级别日志 */
  debug(message: string, data?: unknown): void;
  /** 记录信息级别日志 */
  info(message: string, data?: unknown): void;
  /** 记录警告级别日志 */
  warn(message: string, data?: unknown): void;
  /** 记录错误级别日志 */
  error(message: string, data?: unknown): void;
}

/**
 * 执行进度报告器接口。
 */
export interface ProgressReporter {
  /**
   * 报告当前任务执行进度
   * @param current 当前完成量
   * @param total 任务总量
   * @param message 当前进度说明
   */
  report(current: number, total?: number, message?: string): void;
}

/**
 * 进程执行参数。
 */
export interface ProcessExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string | Uint8Array;
  timeoutMs?: number;
  signal?: AbortSignal;
  encoding?: string;
  throwOnError?: boolean;
  maxOutputBytes?: number;
}

/**
 * 进程执行结果。
 */
export interface ProcessResult {
  ok: boolean;
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  raw: Uint8Array;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  error?: RuntimeError;
}

/**
 * 后台守护进程启动选项。
 */
export interface DetachedProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  probe?: (result: ProcessResult) => boolean | Promise<boolean>;
}

/**
 * 后台守护进程启动结果。
 */
export interface DetachedProcessResult {
  ok: boolean;
  pid?: number;
  ready: boolean;
  durationMs: number;
  error?: RuntimeError;
}

/**
 * 统一进程操作接口。
 */
export interface ProcessAPI {
  /** 执行外部命令 */
  exec(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>;
  /** 启动脱离父进程的后台进程并探测就绪状态 */
  spawnDetached(options: DetachedProcessOptions): Promise<DetachedProcessResult>;
}

/**
 * Action 间相互调用的执行器接口。
 */
export interface ActionInvoker {
  /**
   * 调用指定的 Action 并传入参数，返回其执行结果
   * @param action 目标 Action 定义对象、引用或标识符
   * @param input 传递给目标 Action 的输入参数
   */
  invoke<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | ActionRef | string,
    input?: I
  ): Promise<O>;
}

/**
 * 传递给 Action 业务函数的运行时上下文对象。
 */
export interface ActionContext {
  /** 配置读取接口 */
  config: Config;
  /** 状态持久化存储接口 */
  state: StateStore;
  /** Action 相互调用接口 */
  actions: ActionInvoker;
  /** 进程执行接口 */
  process: ProcessAPI;
  /** 结构化日志接口 */
  log: Logger;
  /** 进度报告接口 */
  progress: ProgressReporter;
  /** 取消信号 */
  signal: AbortSignal;
  /** 当前执行信息 */
  run: {
    id: string;
    rootId: string;
    parentId?: string;
  };
}

/**
 * Action 动作定义契约。
 */
export interface ActionDefinition<I = unknown, O = unknown> extends ActionContract {
  /**
   * Action 的核心业务执行函数
   * @param input 符合 inputSchema 契约的输入数据
   * @param ctx 运行时上下文对象
   */
  run(input: I, ctx: ActionContext): Promise<O> | O;
}

/**
 * 运行记录状态。
 */
export type RunStatus =
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

/**
 * Action 执行运行历史记录。
 */
export interface RunRecord {
  /** 全局唯一运行标识 */
  id: string;
  /** 根调用运行标识 */
  rootRunId: string;
  /** 父级调用的运行标识 */
  parentRunId?: string;
  /** 所属 Action Package 的逻辑标识 */
  packageId: string;
  /** 包物理实例标识 */
  packageInstanceId: string;
  /** 所执行的 Action 标识 */
  actionId: string;
  /** 运行时代码快照代次标识 */
  generationId: string;
  /** 执行宿主所有者标识 */
  ownerId: string;
  /** 运行生命周期状态 */
  status: RunStatus;
  /** 输入参数快照 */
  input?: JsonValue;
  /** 执行成功时的输出结果快照 */
  output?: JsonValue;
  /** 执行失败时的错误信息 */
  error?: RuntimeError;
  /** 开始执行时间（UTC ISO 8601 格式） */
  startedAt: string;
  /** 结束执行时间（UTC ISO 8601 格式） */
  finishedAt?: string;
  /** 运行耗时（单位：毫秒） */
  durationMs?: number;
}

/**
 * 执行生命周期事件。
 */
export type ExecutionEvent = {
  runId: string;
  rootRunId: string;
  sequence: number;
  timestamp: string;
} & (
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string; data?: JsonValue }
  | { type: "progress"; current?: number; total?: number; message?: string }
  | { type: "status"; status: RunStatus }
  | { type: "finish"; result: ExecutionResult }
);
