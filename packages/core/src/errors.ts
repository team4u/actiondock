/**
 * 全仓统一错误码单一事实源。
 *
 * 职责：
 * - 集中定义所有跨模块、跨包协议中传输的结构化错误码字符串常量。
 * - 任何新错误码必须先在此登记再使用，严禁在业务代码中散落硬编码字面量。
 * - 附带 Action 加载失败根因的统一判定与结构化描述构造能力。
 */

/** 目标包未安装或不可解析 */
export const PACKAGE_NOT_FOUND = "PACKAGE_NOT_FOUND";
export const ACTION_PACKAGE_VERSION_CONFLICT = "ACTION_PACKAGE_VERSION_CONFLICT";

/** Action 在注册表、链接包与解析器中均未命中 */
export const ACTION_NOT_FOUND = "ACTION_NOT_FOUND";

/** Action 源码模块加载失败 */
export const ACTION_LOAD_FAILED = "ACTION_LOAD_FAILED";

/** Action 业务逻辑抛出的未分类失败 */
export const ACTION_FAILED = "ACTION_FAILED";

/** Action 执行超过时限 */
export const ACTION_TIMEOUT = "ACTION_TIMEOUT";

/** Action 执行被取消信号中断 */
export const ACTION_CANCELLED = "ACTION_CANCELLED";

/** 入参不符合 Action 声明的 inputSchema */
export const INPUT_VALIDATION_FAILED = "INPUT_VALIDATION_FAILED";

/** 出参不符合 Action 声明的 outputSchema */
export const OUTPUT_VALIDATION_FAILED = "OUTPUT_VALIDATION_FAILED";

/** 入参不是合法的 JSON 兼容结构 */
export const INPUT_NOT_JSON = "INPUT_NOT_JSON";

/** 出参不是合法的 JSON 兼容结构 */
export const OUTPUT_NOT_JSON = "OUTPUT_NOT_JSON";

/** 根运行并发子任务数达到上限 */
export const ACTION_SUBRUN_LIMIT = "ACTION_SUBRUN_LIMIT";

/** 子任务数达限错误的别名标记（details.alias 专用，非独立错误码） */
export const MAX_SUBRUNS_REACHED = "MAX_SUBRUNS_REACHED";

/** Action 调用链出现环路 */
export const ACTION_CALL_CYCLE = "ACTION_CALL_CYCLE";

/** 调用链环路检测的别名标记（details.alias 专用，非独立错误码） */
export const ACTION_CYCLE_DETECTED = "ACTION_CYCLE_DETECTED";

/** 调用链深度超限的别名标记（details.alias 专用，非独立错误码） */
export const ACTION_MAX_DEPTH_EXCEEDED = "ACTION_MAX_DEPTH_EXCEEDED";

/** 跨包调用未在 uses 中声明依赖 */
export const UNDECLARED_ACTION_DEPENDENCY = "UNDECLARED_ACTION_DEPENDENCY";

/** Action 引用存在多包歧义 */
export const INVALID_ACTION_REF = "INVALID_ACTION_REF";

/** 幂等请求参数摘要冲突 */
export const IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT";

/** 运行以失败态终结且缺少结构化错误 */
export const EXECUTION_FAILED = "EXECUTION_FAILED";

/** 执行服务外层捕获到未处理异常 */
export const UNHANDLED_EXECUTION_ERROR = "UNHANDLED_EXECUTION_ERROR";

/** 运行仓储不可用（存储层异常） */
export const RUN_REPOSITORY_UNAVAILABLE = "RUN_REPOSITORY_UNAVAILABLE";

/** 运行记录持久化失败 */
export const RUN_PERSISTENCE_FAILED = "RUN_PERSISTENCE_FAILED";

/** 独立单执行二进制拒绝异步启动语义 */
export const STANDALONE_ASYNC_UNSUPPORTED = "STANDALONE_ASYNC_UNSUPPORTED";

/** 独立运行模式不支持级联调用 */
export const INVOCATION_UNSUPPORTED = "INVOCATION_UNSUPPORTED";

/** 宿主子进程已退出，调用无法送达 */
export const HOST_PROCESS_EXITED = "HOST_PROCESS_EXITED";

/** 调用在启动前已被取消 */
export const EXECUTION_ABORTED = "EXECUTION_ABORTED";

/** 远程运行等待超时 */
export const TIMEOUT = "TIMEOUT";

/** 服务已关闭拒绝继续调用 */
export const SERVICE_CLOSED = "SERVICE_CLOSED";

/** 远程服务器网络连接失败 */
export const NETWORK_ERROR = "NETWORK_ERROR";

/** 非本地明文 HTTP 传输违规 */
export const INSECURE_TRANSPORT = "INSECURE_TRANSPORT";

/** 远程 HTTP 请求失败 */
export const REMOTE_REQUEST_FAILED = "REMOTE_REQUEST_FAILED";

/** 远程事件流全部候选路由均不可用 */
export const REMOTE_STREAM_UNAVAILABLE = "REMOTE_STREAM_UNAVAILABLE";

/** 远程目标未启用管理接口能力 */
export const CAPABILITY_UNAVAILABLE = "CAPABILITY_UNAVAILABLE";

/** 远程状态键不存在 */
export const STATE_KEY_NOT_FOUND = "STATE_KEY_NOT_FOUND";

/** SQLite 数据库忙或锁定 */
export const STORAGE_BUSY = "STORAGE_BUSY";

/** 工程事务锁被其他活跃进程持有 */
export const PROJECT_BUSY = "PROJECT_BUSY";

/** 工程存在未恢复的崩溃事务，需要执行恢复流程 */
export const PROJECT_RECOVERY_REQUIRED = "PROJECT_RECOVERY_REQUIRED";

/** SQLite 工作线程已退出 */
export const STORAGE_WORKER_EXITED = "STORAGE_WORKER_EXITED";

/** 事件订阅队列积压超过背压上限 */
export const EVENT_BACKPRESSURE_LIMIT = "EVENT_BACKPRESSURE_LIMIT";
export const EVENT_CURSOR_EXPIRED = "EVENT_CURSOR_EXPIRED";

/** 子进程输出超过字节上限 */
export const PROCESS_OUTPUT_LIMIT = "PROCESS_OUTPUT_LIMIT";

/** 子进程启动失败 */
export const PROCESS_SPAWN_ERROR = "PROCESS_SPAWN_ERROR";

/** 子进程被取消 */
export const PROCESS_CANCELLED = "PROCESS_CANCELLED";

/** 子进程执行超时 */
export const PROCESS_TIMEOUT = "PROCESS_TIMEOUT";

/** HTTP 服务鉴权失败 */
export const UNAUTHORIZED = "UNAUTHORIZED";

/** HTTP 服务资源不存在 */
export const NOT_FOUND = "NOT_FOUND";

/** HTTP 服务内部错误 */
export const SERVER_ERROR = "SERVER_ERROR";

/** HTTP 服务请求非法 */
export const BAD_REQUEST = "BAD_REQUEST";

/** 目标包未列入允许白名单（403 禁止访问） */
export const PACKAGE_FORBIDDEN = "PACKAGE_FORBIDDEN";

/** 目标规程未找到 */
export const PLAYBOOK_NOT_FOUND = "PLAYBOOK_NOT_FOUND";

/** 请求体体积超出安全限制 */
export const REQUEST_TOO_LARGE = "REQUEST_TOO_LARGE";

/** 动作异步启动失败 */
export const ACTION_START_FAILED = "ACTION_START_FAILED";

/** 动作执行发生内部错误 */
export const ACTION_EXECUTION_ERROR = "ACTION_EXECUTION_ERROR";

/** 动作列表检索失败 */
export const ACTIONS_LIST_ERROR = "ACTIONS_LIST_ERROR";

/** 规程列表检索失败 */
export const PLAYBOOKS_LIST_ERROR = "PLAYBOOKS_LIST_ERROR";

/** 运行记录列表检索失败 */
export const RUNS_LIST_ERROR = "RUNS_LIST_ERROR";

/** 运行记录清空操作失败 */
export const RUNS_CLEAR_ERROR = "RUNS_CLEAR_ERROR";

/** 服务大纲信息自省失败 */
export const INFO_ERROR = "INFO_ERROR";

/** 包信息检索失败 */
export const PACKAGES_INFO_ERROR = "PACKAGES_INFO_ERROR";

/** 环境诊断体检执行失败 */
export const DOCTOR_ERROR = "DOCTOR_ERROR";

/** 运行由于服务中断或异常退出被置为中断态 */
export const RUN_INTERRUPTED = "RUN_INTERRUPTED";

/** 配置项环境变量生成失败 */
export const CONFIG_ENV_ERROR = "CONFIG_ENV_ERROR";

/** 配置项列表检索失败 */
export const CONFIG_LIST_ERROR = "CONFIG_LIST_ERROR";

/** 配置项写入失败 */
export const CONFIG_SET_ERROR = "CONFIG_SET_ERROR";

/** 配置项删除失败 */
export const CONFIG_DELETE_ERROR = "CONFIG_DELETE_ERROR";

/** 状态条目列表检索失败 */
export const STATE_LIST_ERROR = "STATE_LIST_ERROR";

/** 状态清空操作失败 */
export const STATE_CLEAR_ERROR = "STATE_CLEAR_ERROR";

/** 状态键操作异常 */
export const STATE_KEY_ERROR = "STATE_KEY_ERROR";

/** 数据目录已被其他活跃会话持有 */
export const DATA_DIR_IN_USE = "DATA_DIR_IN_USE";

/** 数据目录存在未完成的事务，需执行恢复 */
export const DATA_DIR_RECOVERY_REQUIRED = "DATA_DIR_RECOVERY_REQUIRED";

/** 存储底层 Schema 版本不受支持 */
export const UNSUPPORTED_STORAGE_SCHEMA = "UNSUPPORTED_STORAGE_SCHEMA";

/** 持久化运行错误对象反序列化解码失败 */
export const STORED_ERROR_DECODE_FAILED = "STORED_ERROR_DECODE_FAILED";

/** 子进程执行失败终结 */
export const PROCESS_FAILED = "PROCESS_FAILED";

/** 生成的类型定义已过期 */
export const GENERATED_TYPES_OUTDATED = "GENERATED_TYPES_OUTDATED";

/** 通信协议版本或格式不受支持 */
export const PROTOCOL_UNSUPPORTED = "PROTOCOL_UNSUPPORTED";

/** 服务调用结果未知 */
export const SERVICE_RESULT_UNKNOWN = "SERVICE_RESULT_UNKNOWN";

/** MCP 工具命名发生冲突 */
export const MCP_TOOL_NAME_COLLISION = "MCP_TOOL_NAME_COLLISION";

/** 跨进程 IPC 通信或调用异常 */
export const IPC_ERROR = "IPC_ERROR";

/**
 * 判定错误消息根因是否为依赖模块缺失。
 * 兼容 Node.js 与打包器（Bun 等）两类加载器的报错文案。
 */
export function isMissingModuleError(message: string): boolean {
  return (
    message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("Could not resolve")
  );
}

/**
 * Action 加载失败的上下文信息。
 */
export interface ActionLoadFailureContext {
  /** 加载失败的 Action 标识 */
  actionId: string;
  /** 所属包标识 */
  packageId: string;
  /** 包项目根目录绝对路径 */
  projectRoot: string;
}

/**
 * 统一构造 ACTION_LOAD_FAILED 结构化错误描述。
 * 作为 Runner 与执行服务两处加载失败错误构造的单一事实源。
 */
export function describeActionLoadFailure(
  err: unknown,
  context: ActionLoadFailureContext
): {
  code: typeof ACTION_LOAD_FAILED;
  message: string;
  details: {
    packageId: string;
    projectRoot: string;
    rootCause: string;
    hint: string | undefined;
  };
} {
  const rootCause = err instanceof Error ? err.message : String(err ?? "");
  const isMissingModule = isMissingModuleError(rootCause);
  const hint = isMissingModule
    ? `依赖未安装，在 '${context.projectRoot}' 执行 npm install 或先执行 'ad run ${context.packageId}/${context.actionId}'`
    : undefined;

  return {
    code: ACTION_LOAD_FAILED,
    message: `Failed to load action '${context.actionId}' from package '${context.packageId}' (${context.projectRoot}): ${rootCause}`,
    details: {
      packageId: context.packageId,
      projectRoot: context.projectRoot,
      rootCause,
      hint,
    },
  };
}

/** 访问被拒绝或缺少必要权限 */
export const ACCESS_DENIED = "ACCESS_DENIED";

/** 目标运行环境不支持所声明的能力 */
export const UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY";

/** 控制权已被其他调用方持有处于忙碌状态 */
export const CONTROL_BUSY = "CONTROL_BUSY";

/** 控制权有效租约已过期 */
export const CONTROL_EXPIRED = "CONTROL_EXPIRED";

/** 控制权已被主动撤销或强制收回 */
export const CONTROL_REVOKED = "CONTROL_REVOKED";

/** 进程由于异常控制失效已进入隔离状态 */
export const PROCESS_QUARANTINED = "PROCESS_QUARANTINED";

/** 进程已被宿主标记丢失且状态不可恢复 */
export const PROCESS_LOST = "PROCESS_LOST";

/** 具有相同请求标识但携带不同负载的冲突操作 */
export const REQUEST_CONFLICT = "REQUEST_CONFLICT";

/** 输入交付结果不确定 */
export const INPUT_OUTCOME_UNKNOWN = "INPUT_OUTCOME_UNKNOWN";

/** 输出日志发生淘汰缺口且策略要求报错阻断 */
export const OUTPUT_GAP = "OUTPUT_GAP";

/** 历史输出已不可用 */
export const OUTPUT_UNAVAILABLE = "OUTPUT_UNAVAILABLE";

/** 游标格式错误或超出有效范围 */
export const INVALID_CURSOR = "INVALID_CURSOR";

/** 输入待写入队列已达容量上限 */
export const QUEUE_FULL = "QUEUE_FULL";

/** 资源使用超出配额限制 */
export const QUOTA_EXCEEDED = "QUOTA_EXCEEDED";

/** 输入通道已关闭拒绝继续写入 */
export const INPUT_CLOSED = "INPUT_CLOSED";

/** 扁平入参赋值表达式格式非法 */
export const INVALID_FLAT_ARGUMENT = "INVALID_FLAT_ARGUMENT";

/** 完整 JSON 文档解析失败 */
export const INVALID_JSON = "INVALID_JSON";

/** JSON 字面量解析失败或包含非有限数值 */
export const INVALID_JSON_LITERAL = "INVALID_JSON_LITERAL";

/** 扁平入参路径冲突 */
export const INPUT_PATH_CONFLICT = "INPUT_PATH_CONFLICT";

/** 扁平入参超出安全阈值上限 */
export const FLAT_INPUT_LIMIT_EXCEEDED = "FLAT_INPUT_LIMIT_EXCEEDED";

/** 输入数据超出上限（字节大小、嵌套深度等） */
export const INPUT_LIMIT_EXCEEDED = "INPUT_LIMIT_EXCEEDED";

/** 输入违反 ActionDock 安全策略（如包含全局禁止属性） */
export const INPUT_POLICY_VIOLATION = "INPUT_POLICY_VIOLATION";

/** 输入源互斥冲突 */
export const INPUT_CONFLICT = "INPUT_CONFLICT";

/** 输入文件不存在 */
export const INPUT_FILE_NOT_FOUND = "INPUT_FILE_NOT_FOUND";

/** 输入文件或流读取失败 */
export const INPUT_FILE_READ_FAILED = "INPUT_FILE_READ_FAILED";

/** 命令参数或选项非法 */
export const INVALID_ARGUMENT = "INVALID_ARGUMENT";

/** 目标包未列入白名单 */
export const PACKAGE_NOT_ALLOWED = "PACKAGE_NOT_ALLOWED";

/** 包标识符格式非法或包含越界字符 */
export const INVALID_PACKAGE_ID = "INVALID_PACKAGE_ID";

/** 路径越界违规访问 */
export const PATH_TRAVERSAL = "PATH_TRAVERSAL";

/** 状态键存在多命名空间歧义 */
export const AMBIGUOUS_STATE_KEY = "AMBIGUOUS_STATE_KEY";

/** 目标运行记录未找到 */
export const RUN_NOT_FOUND = "RUN_NOT_FOUND";

/** 目标运行已进入终态不可操作 */
export const RUN_ALREADY_FINISHED = "RUN_ALREADY_FINISHED";

/**
 * ActionDock 统一基础结构化异常类。
 * 全仓各领域异常与跨层透传异常的统一事实源基类。
 */
export class ActionDockError<T = any> extends Error {
  public readonly code: ErrorCode;
  public readonly details?: T;
  public readonly status?: number;

  constructor(code: ErrorCode, message: string, details?: T, status?: number) {
    super(message);
    this.name = "ActionDockError";
    this.code = code;
    this.details = details;
    this.status = status;
    Object.setPrototypeOf(this, ActionDockError.prototype);
  }
}

/**
 * 集中定义的标准结构化错误码联合类型。
 */
export type ErrorCode =
  | typeof PACKAGE_NOT_FOUND
  | typeof ACTION_PACKAGE_VERSION_CONFLICT
  | typeof ACTION_NOT_FOUND
  | typeof ACTION_LOAD_FAILED
  | typeof ACTION_FAILED
  | typeof ACTION_TIMEOUT
  | typeof ACTION_CANCELLED
  | typeof INPUT_VALIDATION_FAILED
  | typeof OUTPUT_VALIDATION_FAILED
  | typeof INPUT_NOT_JSON
  | typeof OUTPUT_NOT_JSON
  | typeof ACTION_SUBRUN_LIMIT
  | typeof MAX_SUBRUNS_REACHED
  | typeof ACTION_CALL_CYCLE
  | typeof ACTION_CYCLE_DETECTED
  | typeof ACTION_MAX_DEPTH_EXCEEDED
  | typeof UNDECLARED_ACTION_DEPENDENCY
  | typeof INVALID_ACTION_REF
  | typeof IDEMPOTENCY_CONFLICT
  | typeof EXECUTION_FAILED
  | typeof UNHANDLED_EXECUTION_ERROR
  | typeof RUN_REPOSITORY_UNAVAILABLE
  | typeof RUN_PERSISTENCE_FAILED
  | typeof STANDALONE_ASYNC_UNSUPPORTED
  | typeof INVOCATION_UNSUPPORTED
  | typeof HOST_PROCESS_EXITED
  | typeof EXECUTION_ABORTED
  | typeof TIMEOUT
  | typeof SERVICE_CLOSED
  | typeof NETWORK_ERROR
  | typeof INSECURE_TRANSPORT
  | typeof REMOTE_REQUEST_FAILED
  | typeof REMOTE_STREAM_UNAVAILABLE
  | typeof CAPABILITY_UNAVAILABLE
  | typeof STATE_KEY_NOT_FOUND
  | typeof STORAGE_BUSY
  | typeof PROJECT_BUSY
  | typeof PROJECT_RECOVERY_REQUIRED
  | typeof STORAGE_WORKER_EXITED
  | typeof EVENT_BACKPRESSURE_LIMIT
  | typeof EVENT_CURSOR_EXPIRED
  | typeof PROCESS_OUTPUT_LIMIT
  | typeof PROCESS_SPAWN_ERROR
  | typeof PROCESS_CANCELLED
  | typeof PROCESS_TIMEOUT
  | typeof UNAUTHORIZED
  | typeof NOT_FOUND
  | typeof SERVER_ERROR
  | typeof BAD_REQUEST
  | typeof PACKAGE_FORBIDDEN
  | typeof PLAYBOOK_NOT_FOUND
  | typeof REQUEST_TOO_LARGE
  | typeof ACTION_START_FAILED
  | typeof ACTION_EXECUTION_ERROR
  | typeof ACTIONS_LIST_ERROR
  | typeof PLAYBOOKS_LIST_ERROR
  | typeof RUNS_LIST_ERROR
  | typeof RUNS_CLEAR_ERROR
  | typeof INFO_ERROR
  | typeof PACKAGES_INFO_ERROR
  | typeof DOCTOR_ERROR
  | typeof RUN_INTERRUPTED
  | typeof CONFIG_ENV_ERROR
  | typeof CONFIG_LIST_ERROR
  | typeof CONFIG_SET_ERROR
  | typeof CONFIG_DELETE_ERROR
  | typeof STATE_LIST_ERROR
  | typeof STATE_CLEAR_ERROR
  | typeof STATE_KEY_ERROR
  | typeof DATA_DIR_IN_USE
  | typeof DATA_DIR_RECOVERY_REQUIRED
  | typeof UNSUPPORTED_STORAGE_SCHEMA
  | typeof STORED_ERROR_DECODE_FAILED
  | typeof PROCESS_FAILED
  | typeof GENERATED_TYPES_OUTDATED
  | typeof PROTOCOL_UNSUPPORTED
  | typeof SERVICE_RESULT_UNKNOWN
  | typeof MCP_TOOL_NAME_COLLISION
  | typeof ACCESS_DENIED
  | typeof UNSUPPORTED_CAPABILITY
  | typeof CONTROL_BUSY
  | typeof CONTROL_EXPIRED
  | typeof CONTROL_REVOKED
  | typeof PROCESS_QUARANTINED
  | typeof PROCESS_LOST
  | typeof REQUEST_CONFLICT
  | typeof INPUT_OUTCOME_UNKNOWN
  | typeof OUTPUT_GAP
  | typeof OUTPUT_UNAVAILABLE
  | typeof INVALID_CURSOR
  | typeof QUEUE_FULL
  | typeof QUOTA_EXCEEDED
  | typeof INPUT_CLOSED
  | typeof INVALID_FLAT_ARGUMENT
  | typeof INVALID_JSON
  | typeof INVALID_JSON_LITERAL
  | typeof INPUT_PATH_CONFLICT
  | typeof FLAT_INPUT_LIMIT_EXCEEDED
  | typeof INPUT_LIMIT_EXCEEDED
  | typeof INPUT_POLICY_VIOLATION
  | typeof INPUT_CONFLICT
  | typeof INPUT_FILE_NOT_FOUND
  | typeof INPUT_FILE_READ_FAILED
  | typeof INVALID_ARGUMENT
  | typeof PACKAGE_NOT_ALLOWED
  | typeof INVALID_PACKAGE_ID
  | typeof PATH_TRAVERSAL
  | typeof AMBIGUOUS_STATE_KEY
  | typeof RUN_NOT_FOUND
  | typeof RUN_ALREADY_FINISHED
  | typeof IPC_ERROR;

/**
 * 进程领域结构化异常类。
 */
export class ProcessError extends ActionDockError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "ProcessError";
    Object.setPrototypeOf(this, ProcessError.prototype);
  }
}

