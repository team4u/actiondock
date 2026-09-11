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

/** 宿主子进程已退出，调用无法送达 */
export const HOST_PROCESS_EXITED = "HOST_PROCESS_EXITED";

/** 调用在启动前已被取消 */
export const EXECUTION_ABORTED = "EXECUTION_ABORTED";

/** 远程运行等待超时 */
export const TIMEOUT = "TIMEOUT";

/** 远程服务器网络连接失败 */
export const NETWORK_ERROR = "NETWORK_ERROR";

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
