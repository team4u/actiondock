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
 * 调用选项。
 */
export interface CallOptions {
  /** 调用取消信号 */
  signal?: AbortSignal;
}

/**
 * 结构化字节流封装。
 */
export type Bytes = {
  /** 字节编码格式，统一采用 base64 */
  encoding: "base64";
  /** 经过编码后的字符串数据 */
  data: string;
};

/**
 * 受管进程生命周期状态。
 */
export type ProcessState =
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed"
  | "lost";

/**
 * 受管进程控制状态。
 */
export type ControlState = "free" | "held" | "quarantined" | "closed";

/**
 * 输入输出通道配置。
 */
export type IOConfig =
  | { mode: "pipe" }
  | { mode: "pty"; cols: number; rows: number; term: string };

/**
 * 进程启动规范。
 */
export interface LaunchSpec {
  /** 可执行文件路径或名称 */
  executable: string;
  /** 启动参数列表 */
  args: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量配置 */
  env?: {
    /** 宿主环境变量继承策略 */
    inherit: "none" | "allowlisted";
    /** 显式设置的环境变量映射 */
    set?: Record<string, string>;
    /** 显式移除的环境变量键名列表 */
    unset?: string[];
  };
  /** 输入输出模式与终端配置 */
  io: IOConfig;
}

/**
 * 进程有界资源约束配置。
 */
export interface Limits {
  /** 空闲超时上限（毫秒） */
  idleMs?: number;
  /** 存活时长上限（毫秒） */
  lifetimeMs?: number;
  /** 输出缓冲区容量字节上限 */
  outputBufferBytes?: number;
}

/**
 * 运行时支持的能力集合。
 */
export interface Capabilities {
  /** 是否支持伪终端 */
  pty: boolean;
  /** 是否支持动态调整终端尺寸 */
  resize: boolean;
  /** 是否支持写入关闭输入流 */
  inputEOF: boolean;
  /** 是否支持中断前台作业 */
  interruptForeground: boolean;
  /** 进程终止管理范围 */
  terminationScope: "process" | "process-tree" | "container";
}

/**
 * 受管进程元数据快照。
 */
export interface ProcessInfo {
  /** 进程全局唯一标识符 */
  id: string;
  /** 宿主代次纪元标识 */
  hostEpoch: string;
  /** 进程当前生命周期状态 */
  state: ProcessState;
  /** 进程当前控制状态 */
  control: ControlState;
  /** 进程输入输出通道配置 */
  io: IOConfig;
  /** 运行时能力特征快照 */
  capabilities: Capabilities;
  /** 资源创建时间（UTC ISO 8601 格式） */
  createdAt: string;
  /** 退出状态详情 */
  exit?: { code: number | null; signal: string | null };
  /** 终止原因分类 */
  endReason?:
    | "natural"
    | "requested"
    | "idle"
    | "lifetime"
    | "revoked"
    | "input-failure"
    | "host-lost"
    | "spawn-failure";
  /** 输出流是否已彻底关闭 */
  outputClosed: boolean;
  /** 输出流关闭原因 */
  outputEndReason?: "natural" | "drain-timeout" | "host-lost";
  /** 最终生效的硬性资源限额 */
  effectiveLimits: Required<Limits>;
}

/**
 * 控制权持有凭证。
 */
export interface ControlGrant {
  /** 控制令牌字符串 */
  token: string;
  /** 凭据有效截止时间（UTC ISO 8601 格式） */
  expiresAt: string;
}

/**
 * 单条原始输出数据块。
 */
export interface OutputChunk {
  /** 输出流来源标识 */
  stream: "stdout" | "stderr" | "pty";
  /** 结构化原始字节数据 */
  data: Bytes;
}

/**
 * 输出日志读取结果。
 */
export interface ReadResult {
  /** 本次读取提取到的输出块列表 */
  chunks: OutputChunk[];
  /** 下一次读取推进的游标位置 */
  nextCursor: string;
  /** 当前缓冲区保留的最早未淘汰游标 */
  earliestCursor: string;
  /** 当前缓冲区末尾最新写入游标 */
  tailCursor: string;
  /** 是否因超出单次最大限制或缓冲区淘汰而发生截断 */
  truncated: boolean;
  /** 当发生数据跳跃时指示丢弃区间 */
  gap?: { fromCursor: string; toCursor: string };
  /** 输出是否已结束且游标已追平末尾 */
  eof: boolean;
  /** 当前进程的元数据快照 */
  process: ProcessInfo;
}

/**
 * 异步写入或控制指令的处理收据。
 */
export interface OperationReceipt {
  /** 本次操作的请求幂等标识 */
  requestId: string;
  /** 操作当前调度状态 */
  state: "queued" | "dispatching" | "completed" | "failed" | "unknown";
  /** 成功提交写入的字节数 */
  acceptedBytes?: number;
  /** 失败时的错误码 */
  errorCode?: string;
  /** 失败时的错误消息 */
  errorMessage?: string;
}

/**
 * 一次性运行输入参数。
 */
export interface ProcessRunInput {
  /** 启动规范 */
  spec: LaunchSpec;
  /** 超时时限（毫秒） */
  timeoutMs: number;
  /** 收集输出的最大字节数 */
  maxOutputBytes: number;
}

/**
 * 一次性运行返回结果。
 */
export interface ProcessRunResult {
  /** 进程退出状态 */
  exit: { code: number | null; signal: string | null };
  /** 收集到的输出数据块列表 */
  chunks: OutputChunk[];
  /** 输出是否因达到上限被截断 */
  truncated: boolean;
}

/**
 * 启动受管进程输入参数。
 */
export interface ProcessStartInput {
  /** 创建请求幂等标识 */
  requestId: string;
  /** 启动规范 */
  spec: LaunchSpec;
  /** 可选的资源配额限制 */
  limits?: Limits;
}

/**
 * 启动受管进程返回结果。
 */
export interface ProcessStartResult {
  /** 进程元数据快照 */
  process: ProcessInfo;
  /** 进程输出流初始游标 */
  initialCursor: string;
}

/**
 * 列表查询输入参数。
 */
export interface ProcessListInput {
  /** 分页标记 */
  pageToken?: string;
  /** 单页返回数量上限 */
  limit?: number;
}

/**
 * 列表查询返回结果。
 */
export interface ProcessListResult {
  /** 进程元数据列表 */
  processes: ProcessInfo[];
  /** 下一页分页标记 */
  nextPageToken?: string;
}

/**
 * 申请控制权输入参数。
 */
export interface ProcessAcquireInput {
  /** 申请请求幂等标识 */
  requestId: string;
  /** 最长排队等待时间（毫秒） */
  waitMs: number;
  /** 控制权存活时长（毫秒） */
  ttlMs: number;
}

/**
 * 写入数据输入参数。
 */
export interface ProcessWriteInput {
  /** 控制令牌 */
  token: string;
  /** 写入请求幂等标识 */
  requestId: string;
  /** 写入的原始字节数据 */
  data: Bytes;
}

/**
 * 输出流读取输入参数。
 */
export interface ProcessReadInput {
  /** 起始游标 */
  cursor: string;
  /** 单次读取最大原始字节数 */
  maxBytes: number;
  /** 无新数据时长轮询等待超时（毫秒） */
  waitMs: number;
  /** 遇到数据淘汰断层时的处理策略 */
  onGap: "error" | "skip";
}

/**
 * 进程结构化控制动作定义。
 */
export type ProcessControlAction =
  | { type: "input-eof" }
  | { type: "interrupt-foreground" }
  | { type: "resize"; cols: number; rows: number };

/**
 * 发送控制指令输入参数。
 */
export interface ProcessControlInput {
  /** 控制令牌 */
  token: string;
  /** 控制请求幂等标识 */
  requestId: string;
  /** 具体控制动作 */
  action: ProcessControlAction;
}

/**
 * 终止进程输入参数。
 */
export interface ProcessStopInput {
  /** 终止请求幂等标识 */
  requestId: string;
  /** 优雅退出等待宽限期（毫秒） */
  graceMs: number;
}

/**
 * 统一受管进程操作接口。
 */
export interface ProcessAPI {
  /**
   * 一次性运行外部命令，等待其结束并收集有限输出
   * @param input 运行参数配置
   * @param call 调用选项
   */
  run(
    input: ProcessRunInput,
    call?: CallOptions
  ): Promise<ProcessRunResult>;

  /**
   * 创建长期受管进程资源并返回可寻址元数据与初始输出游标
   * @param input 启动参数配置
   * @param call 调用选项
   */
  start(
    input: ProcessStartInput,
    call?: CallOptions
  ): Promise<ProcessStartResult>;

  /**
   * 查看指定受管进程资源的当前最新状态
   * @param id 进程标识
   * @param call 调用选项
   */
  inspect(id: string, call?: CallOptions): Promise<ProcessInfo>;

  /**
   * 列出当前作用域内可见的受管进程资源
   * @param input 列表分页参数
   * @param call 调用选项
   */
  list(
    input: ProcessListInput,
    call?: CallOptions
  ): Promise<ProcessListResult>;

  /**
   * 申请指定受管进程的独占控制令牌
   * @param id 进程标识
   * @param input 控制权申请参数
   * @param call 调用选项
   */
  acquire(
    id: string,
    input: ProcessAcquireInput,
    call?: CallOptions
  ): Promise<ControlGrant>;

  /**
   * 延长当前有效控制令牌的存活时间
   * @param id 进程标识
   * @param token 当前有效控制令牌
   * @param ttlMs 续租有效时长（毫秒）
   * @param call 调用选项
   */
  renew(
    id: string,
    token: string,
    ttlMs: number,
    call?: CallOptions
  ): Promise<ControlGrant>;

  /**
   * 显式释放控制令牌，允许后续控制者申请
   * @param id 进程标识
   * @param token 当前有效控制令牌
   * @param call 调用选项
   */
  release(
    id: string,
    token: string,
    call?: CallOptions
  ): Promise<void>;

  /**
   * 向受管进程输入流写入原始字节数据
   * @param id 进程标识
   * @param input 写入请求参数
   * @param call 调用选项
   */
  write(
    id: string,
    input: ProcessWriteInput,
    call?: CallOptions
  ): Promise<OperationReceipt>;

  /**
   * 查询指定请求标识的输入或控制操作执行收据
   * @param id 进程标识
   * @param requestId 之前提交操作的请求幂等标识
   * @param call 调用选项
   */
  operation(
    id: string,
    requestId: string,
    call?: CallOptions
  ): Promise<OperationReceipt>;

  /**
   * 按游标读取受管进程的有界原始字节输出流
   * @param id 进程标识
   * @param input 读取参数
   * @param call 调用选项
   */
  read(
    id: string,
    input: ProcessReadInput,
    call?: CallOptions
  ): Promise<ReadResult>;

  /**
   * 向受管进程发送结构化控制指令
   * @param id 进程标识
   * @param input 控制指令参数
   * @param call 调用选项
   */
  control(
    id: string,
    input: ProcessControlInput,
    call?: CallOptions
  ): Promise<OperationReceipt>;

  /**
   * 终止指定的受管进程资源
   * @param id 进程标识
   * @param input 终止参数
   * @param call 调用选项
   */
  stop(
    id: string,
    input: ProcessStopInput,
    call?: CallOptions
  ): Promise<ProcessInfo>;
}

/**
 * @deprecated 旧版进程执行参数，将在后续版本中移除
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
 * @deprecated 旧版进程执行结果，将在后续版本中移除
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
 * Action 间相互调用的执行器接口。
 */
export interface ActionInvoker {
  /**
   * 直接调用指定的 Action
   * @param ref 目标 Action 引用或标识符（严格只接受 ActionRef 或 string）
   * @param input 传递给目标 Action 的输入参数
   */
  (ref: string | ActionRef, input?: unknown): Promise<unknown>;

  /**
   * 调用指定的 Action 并传入参数，返回其执行结果
   * @param action 目标 Action 引用或标识符（严格只接受 ActionRef 或 string）
   * @param input 传递给目标 Action 的输入参数
   */
  invoke<I = unknown, O = unknown>(
    action: ActionRef | string,
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
 * 剥离 ActionContract 冗余属性，仅保留核心执行处理函数。
 */
export interface ActionDefinition<I = unknown, O = unknown> {
  /**
   * Action 的核心业务执行函数
   * @param input 输入参数数据
   * @param ctx 运行时上下文对象
   */
  run(input: I, ctx: ActionContext): Promise<O> | O;
  /** Action 唯一标识 */
  id?: string;
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
  /** 执行宿主会话标识 */
  hostSessionId?: string;
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
  eventId?: string;
  runId: string;
  rootRunId: string;
  sequence: number;
  timestamp: string;
} & (
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string; data?: JsonValue }
  | { type: "progress"; current?: number; total?: number; message?: string }
  | { type: "status"; status: RunStatus }
  | { type: "finish"; result: ExecutionResult }
  | { type: "error"; error: RuntimeError }
);

