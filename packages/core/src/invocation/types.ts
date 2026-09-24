import type {
  ActionDefinition,
  ActionRef,
  Logger,
  ProcessAPI,
  ProgressReporter,
} from "@actiondock/sdk";
import type { ProcessOwner } from "../process";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";

export { createPackageIdentity };
export type { PackageIdentity };

export type { RunOptions } from "../service/types";

/**
 * 构造默认进程归属所有者（ProcessOwner）的单一事实源工厂。
 *
 * 兜底语义：租户与主体标识缺失时回退 "default"，包实例与代次标识缺失时回退
 * 调用方提供的兜底值；全部五处默认 Owner 构造点（invocation、runner、runtime
 * 上下文与进程执行器）必须统一经由本工厂，禁止散落字面量拷贝。
 */
export function createDefaultProcessOwner(options?: {
  /** 租户标识，缺省回退 "default" */
  tenantId?: string;
  /** 主体标识，缺省回退 "default" */
  principalId?: string;
  /** 包物理实例标识兜底值，缺省回退 "default" */
  packageInstanceId?: string;
  /** 快照代次标识兜底值，缺省回退 "default" */
  generationId?: string;
}): ProcessOwner {
  return {
    tenantId: options?.tenantId || "default",
    principalId: options?.principalId || "default",
    packageInstanceId: options?.packageInstanceId || "default",
    generationId: options?.generationId || "default",
  };
}

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
  const runId = options.runId ?? crypto.randomUUID();
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
    owner: options.owner ??
      createDefaultProcessOwner({
        tenantId: options.tenantId,
        principalId: options.principalId,
        packageInstanceId: pkg.instanceId,
        generationId: pkg.generation,
      }),
  };
}

/**
 * 构造受信任的根调用上下文选项。
 */
export interface CreateRootInvocationContextOptions {
  /** 目标包物理与快照身份标识（必填单一事实源） */
  targetPackage: PackageIdentity;
  /** 可选的初始调用栈（根调用通常为 [rootKey]） */
  callStack?: readonly string[];
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
 * 根运行 ID 等同于自身运行 ID，且仅透传受信任参数。
 *
 * 实现委托 createInvocationContext 单一事实源：不传入 runId/rootRunId/parentRunId/caller，
 * 由公共构造逻辑兜底生成 runId 并令 rootRunId 收敛为自身 runId；随后显式覆写
 * parentRunId 与 caller 为 undefined，并按根调用契约挑选字段，保持无血缘血缘字段的键序不变。
 */
export function createRootInvocationContext(options: CreateRootInvocationContextOptions): InvocationContext {
  const base = createInvocationContext({
    package: options.targetPackage,
    callStack: options.callStack,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    config: options.config,
    requestId: options.requestId,
    hostSessionId: options.hostSessionId,
    maxCallDepth: options.maxCallDepth,
    logger: options.logger,
    progress: options.progress,
    process: options.process,
    owner: options.owner,
    tenantId: options.tenantId,
    principalId: options.principalId,
  });
  return {
    runId: base.runId,
    rootRunId: base.rootRunId,
    parentRunId: undefined,
    caller: undefined,
    callStack: base.callStack,
    package: base.package,
    signal: base.signal,
    timeoutMs: base.timeoutMs,
    config: base.config,
    requestId: base.requestId,
    hostSessionId: base.hostSessionId,
    maxCallDepth: base.maxCallDepth,
    logger: base.logger,
    progress: base.progress,
    process: base.process,
    owner: base.owner,
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
