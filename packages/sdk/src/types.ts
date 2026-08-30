/**
 * 标准 JSON Schema 结构定义。
 * 支持对象模式（Object Schema）或布尔模式（Boolean Schema）。
 */
export type JsonSchema = Record<string, unknown> | boolean;

/**
 * ActionDock 标准运行时错误对象。
 */
export interface RuntimeError {
  /** 机器可读的唯一错误码，例如 ACTION_NOT_FOUND, INPUT_VALIDATION_FAILED, ACTION_TIMEOUT 等 */
  code: string;
  /** 人类可读的错误描述信息 */
  message: string;
  /** 结构化的附加错误详情（如 JSON Schema 校验失败的具体字段列表） */
  details?: unknown;
  /** 导致此错误的底层原始异常或原因 */
  cause?: unknown;
}

/**
 * 标准执行结果信封（JSON Envelope）。
 * ActionDock 在 CLI、独立二进制、HTTP Runner 和 MCP 等所有场景中均输出该格式。
 */
export type ExecutionResult<T = unknown> =
  | {
      /** 执行是否成功 */
      ok: true;
      /** 本次执行的全局唯一运行 ID（UUIDv4） */
      runId: string;
      /** Action 执行返回的业务数据 */
      data: T;
    }
  | {
      /** 执行是否失败 */
      ok: false;
      /** 本次执行的全局唯一运行 ID（UUIDv4） */
      runId: string;
      /** 运行时错误详情 */
      error: RuntimeError;
    };

/**
 * 配置提供器接口（只读查询）。
 * 遵循 5 层优先级链：CLI 参数 > 本地 SQLite > 全局 SQLite > 环境变量 > 项目默认值 > 回退默认值。
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
   * 检查指定键是否存在配置值（无论来源于哪一层优先级）
   * @param key 配置键名
   */
  has(key: string): boolean;
}

/**
 * 共享状态持久化存储接口。
 * 提供跨 Action 调用的数据共享与持久化存储能力，支持命名空间与基于秒的 TTL 自动过期机制。
 */
export interface StateStore {
  /**
   * 读取指定键的状态值。若键已过期则返回 undefined
   * @param key 状态键名
   */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /**
   * 设置状态键值对，可选指定过期存活时间（TTL）
   * @param key 状态键名
   * @param value 要存储的数据值（会自动进行深拷贝/序列化）
   * @param ttl 存活时间（单位：秒）。不传或 <= 0 表示永久有效
   */
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
  /**
   * 删除指定键的状态数据
   * @param key 状态键名
   */
  delete(key: string): Promise<void>;
  /**
   * 列出当前命名空间下所有匹配前缀的状态键名（已自动过滤已过期的键）
   * @param prefix 键名前缀过滤条件
   */
  keys(prefix?: string): Promise<string[]>;
  /**
   * 创建一个具有独立命名空间隔离的子 StateStore 实例
   * @param namespace 命名空间标识
   */
  scope(namespace: string): StateStore;
}

/**
 * 结构化日志记录器接口。
 * 所有日志输出均定向到 stderr，确保不污染 stdout 中的 JSON 信封。
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
 * Action 间相互调用的执行器接口。
 * 支持在 Action 内部安全调用同 Package 或其他 Action，内置调用栈防死循环环路检测。
 */
export interface ActionInvoker {
  /**
   * 调用指定的 Action 并传入参数，返回其执行结果
   * @param action 目标 Action 定义对象
   * @param input 传递给目标 Action 的输入参数
   */
  invoke<I, O>(
    action: ActionDefinition<I, O>,
    input: I
  ): Promise<O>;
}

/**
 * 传递给 Action `run` 处理函数的运行时上下文对象。
 */
export interface ActionContext {
  /** 配置读取接口，自动按多层优先级解析配置 */
  config: Config;
  /** 状态持久化存储接口，提供跨 Action 调用的数据存取与 TTL */
  state: StateStore;
  /** Action 相互调用接口，支持模块化组合与复用 */
  actions: ActionInvoker;
  /** 结构化日志接口，输出定向至 stderr */
  log: Logger;
  /** 取消信号，用于感知客户端中断、超时或 SIGINT */
  signal: AbortSignal;
}

/**
 * Action 动作定义契约。
 * 通过 `defineAction({...})` 声明。
 */
export interface ActionDefinition<I = unknown, O = unknown> {
  /** Action 唯一标识符（例如: "github.get-pr" 或 "sample.greet"） */
  id: string;
  /** Action 功能描述，用于 CLI 帮助文档、Agent 发现以及 MCP Tool 描述 */
  description?: string;
  /** 输入参数的 JSON Schema 校验规范 */
  inputSchema?: JsonSchema;
  /** 输出结果的 JSON Schema 校验规范 */
  outputSchema?: JsonSchema;
  /**
   * Action 的核心业务执行函数
   * @param input 符合 inputSchema 契约的输入数据
   * @param ctx 运行时上下文对象（包含 config, state, actions, log, signal）
   */
  run(input: I, ctx: ActionContext): Promise<O> | O;
}

/**
 * 运行记录状态枚举。
 */
export type RunStatus = "running" | "success" | "failed" | "cancelled";

/**
 * Action 执行运行历史记录。
 */
export interface RunRecord {
  /** 全局唯一运行 ID (UUIDv4) */
  id: string;
  /** 所属 Action Package 的唯一 ID */
  packageId: string;
  /** 所执行的 Action ID */
  actionId: string;
  /** 父级调用的运行 ID（若由其他 Action 嵌套调用触发） */
  parentRunId?: string;
  /** 运行生命周期状态 */
  status: RunStatus;
  /** 输入参数快照 */
  input: unknown;
  /** 执行成功时的输出结果 */
  output?: unknown;
  /** 执行失败时的错误信息 */
  error?: RuntimeError;
  /** 开始执行时间（ISO 8601 格式） */
  startedAt: string;
  /** 结束执行时间（ISO 8601 格式，进行中时为 undefined） */
  finishedAt?: string;
}
