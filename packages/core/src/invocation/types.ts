import type {
  ActionDefinition,
  ActionRef,
  Logger,
  ProcessAPI,
  ProgressReporter,
} from "@actiondock/sdk";
import { randomUUID } from "node:crypto";
import type { ProcessOwner } from "../process";
import type { RuntimePlatform } from "../platform/types";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";

export { createPackageIdentity };
export type { PackageIdentity };

export type { RunOptions } from "../service/types";

/**
 * 内部调用方身份凭证（InvocationCaller）。
 */
export interface InvocationCaller {
  /** 调用方所在包标识 */
  readonly packageId: string;
  /** 调用方 Action 标识 */
  readonly actionId: string;
  /** 调用方运行 ID */
  readonly runId?: string;
  /** 调用方声明的 uses 列表 */
  readonly declaredUses?: string[];
}

/**
 * 内部调用上下文（InvocationContext）。
 * 贯穿 Host -> Resolution -> PackageRuntime -> ExecutionService 的内部调用链路上下文。
 */
export interface InvocationContext {
  /** 本次执行的全局唯一运行标识 */
  readonly runId: string;
  /** 根运行标识（调用链起点） */
  readonly rootRunId: string;
  /** 直接父运行标识（嵌套子调用时关联） */
  readonly parentRunId?: string;
  /** 调用方上下文（若为嵌套/跨包调用） */
  readonly caller?: InvocationCaller;
  /** 调用栈数组快照（用于环路检测与调用深度限制） */
  readonly callStack: readonly string[];
  /** 目标包物理与快照身份标识 */
  readonly package: PackageIdentity;
  /** 取消信号 */
  readonly signal: AbortSignal;
  /** 超时毫秒数 */
  readonly timeoutMs?: number;
  /** 配置覆盖项 */
  readonly config?: Record<string, unknown>;
  /** 幂等请求标识 */
  readonly requestId?: string;
  /** 租户标识 */
  readonly tenantId?: string;
  /** 主体标识 */
  readonly principalId?: string;
  /** 执行宿主会话标识 */
  readonly hostSessionId?: string;
  /** 最大调用深度覆盖 */
  readonly maxCallDepth?: number;
  /** 日志记录器 */
  readonly logger?: Logger;
  /** 进度报告器 */
  readonly progress?: ProgressReporter;
  /** 进程执行器 */
  readonly process?: ProcessAPI;
  /** 运行时底层平台 */
  readonly platform?: RuntimePlatform;
  /** 进程属主身份 */
  readonly owner?: ProcessOwner;
}

/**
 * 内部调用上下文选项契约。
 * 强制要求提供确定的 PackageIdentity，禁止隐式兜底 mock 默认包。
 */
export interface CreateInvocationContextOptions extends Omit<Partial<InvocationContext>, "package"> {
  /** 目标包物理与快照身份标识（必填单一事实源） */
  package: PackageIdentity;
}

/**
 * 构造合法的内部调用上下文（InvocationContext）。
 * 供测试或内部直接调用执行服务时便捷装配上下文凭据。
 */
export function createInvocationContext(options: CreateInvocationContextOptions): InvocationContext {
  const runId = options.runId ?? randomUUID();
  const rootRunId = options.rootRunId ?? runId;
  const pkg = options.package;
  return {
    runId,
    rootRunId,
    parentRunId: options.parentRunId,
    caller: options.caller,
    callStack: options.callStack ? [...options.callStack] : [],
    package: pkg,
    signal: options.signal ?? new AbortController().signal,
    timeoutMs: options.timeoutMs,
    config: options.config,
    requestId: options.requestId,
    tenantId: options.tenantId,
    principalId: options.principalId,
    hostSessionId: options.hostSessionId,
    maxCallDepth: options.maxCallDepth,
    logger: options.logger,
    progress: options.progress,
    process: options.process,
    platform: options.platform,
    owner: options.owner ?? {
      tenantId: options.tenantId || "default",
      principalId: options.principalId || "default",
      packageInstanceId: pkg.instanceId,
      generationId: pkg.generation,
    },
  };
}

/**
 * 构造受信任的根调用上下文选项。
 */
export interface CreateRootInvocationContextOptions {
  /** 目标包物理与快照身份标识（必填单一事实源） */
  targetPackage: PackageIdentity;
  /** 外部传入的 AbortSignal 取消信号 */
  signal?: AbortSignal;
  /** 最大超时时间（毫秒） */
  timeoutMs?: number;
  /** 执行级临时配置覆盖字典 */
  config?: Record<string, unknown>;
  /** 幂等请求标识 */
  requestId?: string;
  /** 执行宿主会话标识 */
  hostSessionId?: string;
  /** 最大调用嵌套深度限制 */
  maxCallDepth?: number;
  /** 外部进程执行器注入 */
  process?: ProcessAPI;
  /** 可选的底层运行平台契约 */
  platform?: RuntimePlatform;
  /** 租户标识 */
  tenantId?: string;
  /** 主体标识 */
  principalId?: string;
  /** 日志记录器 */
  logger?: Logger;
  /** 进度报告器 */
  progress?: ProgressReporter;
  /** 显式执行归属所有者契约 */
  owner?: ProcessOwner;
}

/**
 * 构造合法的受信任根调用上下文（Root InvocationContext）。
 * 在 Host 服务边界装配，严格保证无父级调用血缘（parentRunId 为 undefined），
 * 根运行 ID 等同于自身运行 ID，调用栈为空，且仅透传受信任参数。
 */
export function createRootInvocationContext(options: CreateRootInvocationContextOptions): InvocationContext {
  const runId = randomUUID();
  const pkg = options.targetPackage;
  return {
    runId,
    rootRunId: runId,
    parentRunId: undefined,
    caller: undefined,
    callStack: [],
    package: pkg,
    signal: options.signal ?? new AbortController().signal,
    timeoutMs: options.timeoutMs,
    config: options.config,
    requestId: options.requestId,
    hostSessionId: options.hostSessionId,
    maxCallDepth: options.maxCallDepth,
    logger: options.logger,
    progress: options.progress,
    process: options.process,
    platform: options.platform,
    owner: options.owner ?? {
      tenantId: options.tenantId || "default",
      principalId: options.principalId || "default",
      packageInstanceId: pkg.instanceId,
      generationId: pkg.generation,
    },
  };
}

/**
 * Action 执行上下文（ActionExecutionContext）。
 * ActionRunner 启动单次 Action 执行时内部装配的完整上下文状态。
 */
export interface ActionExecutionContext {
  /** 运行 ID */
  readonly runId: string;
  /** 根运行 ID */
  readonly rootRunId: string;
  /** 父运行 ID */
  readonly parentRunId?: string;
  /** 当前执行所属包标识 */
  readonly packageIdentity: PackageIdentity;
  /** 目标 Action 标识 */
  readonly targetActionId: string;
  /** 输入数据 */
  readonly input: unknown;
  /** 目标 Action 定义（若已解析就绪） */
  readonly action?: ActionDefinition;
  /** 调用栈数组快照 */
  readonly callStack: readonly string[];
  /** 取消中断控制器 */
  readonly controller: AbortController;
  /** 执行开始时间戳 */
  readonly startedAt: string;
  /** 生效的进程执行器 */
  readonly effectiveProcess?: ProcessAPI;
  /** 进程属主信息 */
  readonly owner: ProcessOwner;
  /** 日志记录器 */
  readonly logger?: Logger;
  /** 进度报告器 */
  readonly progress?: ProgressReporter;
  /** 配置覆盖项 */
  readonly configOverrides?: Record<string, unknown>;
  /** 嵌套子调用委托函数 */
  readonly actionInvoker?: (
    childAction: ActionRef | string,
    childInput: unknown,
    callerRunId?: string
  ) => Promise<unknown>;
}
