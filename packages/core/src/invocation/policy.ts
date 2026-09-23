import {
  ACTION_CALL_CYCLE,
  ACTION_SUBRUN_LIMIT,
  UNDECLARED_ACTION_DEPENDENCY,
  ActionDockError,
  type ErrorCode,
} from "../errors";
import type { PackageGraph } from "../catalog/graph";

/**
 * 调用治理策略初始化选项。
 */
export interface InvocationPolicyOptions {
  /** 最大调用嵌套深度限制（默认 16） */
  maxCallDepth?: number;
  /** 单个根任务下最大并发活跃子任务数（默认 64） */
  maxSubRuns?: number;
}

/**
 * 根调用可见性上下文。
 */
export interface RootVisibilityContext {
  /** 宿主公开暴露的包标识集合 */
  hostPublicPackageIds: ReadonlySet<string>;
  /** 包依赖拓扑图 */
  graph?: PackageGraph;
}

/**
 * 调用方声明规范契约。
 */
export interface CallerActionInfo {
  packageId: string;
  actionId: string;
  declaredUses?: string[];
}

/**
 * 目标 Action 规范契约。
 */
export interface TargetActionInfo {
  packageId: string;
  actionId: string;
}

/**
 * 调用治理策略错误描述。
 */
export interface PolicyError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * 环路检测结果。
 */
export interface CycleCheckResult {
  callKey: string;
  error?: PolicyError;
}

/**
 * 全局统一调用治理策略服务（InvocationPolicy）。
 *
 * 铁律 5 单一事实源：统一负责 root visibility、caller -> callee authorization、
 * uses 检查、max call depth、cycle detection、subrun quota 与 lineage policy。
 * 彻底消除 Host、ExecutionService 与 ActionRunner 中分散重复的检查逻辑。
 */
export class InvocationPolicy {
  public readonly maxCallDepth: number;
  public readonly maxSubRuns: number;
  private readonly activeSubRunsPerRoot = new Map<string, number>();
  private visibilityContext?: RootVisibilityContext;

  constructor(options: InvocationPolicyOptions = {}) {
    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
  }

  /**
   * 设置路由可见性上下文。
   */
  public setVisibilityContext(context?: RootVisibilityContext): void {
    this.visibilityContext = context;
  }

  /**
   * 严格断言根调用可见性（Root Visibility Assertion）。
   * 若不可见则抛出 ActionDockError(UNDECLARED_ACTION_DEPENDENCY, ...)。
   */
  public assertRootVisibility(
    resolved: { package: { id: string }; ref: { actionId: string } },
    context?: RootVisibilityContext
  ): void {
    const ctx = context ?? this.visibilityContext;
    if (!ctx) {
      return;
    }
    const error = this.checkRootVisibility(resolved.package.id, resolved.ref.actionId, ctx);
    if (error) {
      throw new ActionDockError(error.code, error.message, error.details);
    }
  }

  /**
   * 根调用可见性判定与鉴权（Root Visibility Policy）。
   *
   * 判定规则：
   * - 宿主公开注册的包（直接依赖包或显式声明包）允许根调用；
   * - 传递依赖包必须经由可见 Playbook 委托授权，否则拦截并返回 UNDECLARED_ACTION_DEPENDENCY。
   *
   * @param targetPackageId 目标包标识
   * @param targetActionId 目标 Action 标识
   * @param context 路由可见性上下文
   * @returns 若拦截返回标准 RuntimeError，通过则返回 undefined
   */
  public checkRootVisibility(
    targetPackageId: string,
    targetActionId: string,
    context: RootVisibilityContext
  ): PolicyError | undefined {
    const isPublic = context.hostPublicPackageIds.has(targetPackageId);
    if (isPublic) {
      return undefined;
    }

    if (context.graph && !context.graph.canRootCall(targetPackageId, targetActionId)) {
      return {
        code: UNDECLARED_ACTION_DEPENDENCY,
        message: `Root call to action '${targetPackageId}/${targetActionId}' is not allowed: package '${targetPackageId}' is not declared as a direct dependency in actiondock.json and is not delegated by a visible playbook`,
        details: { target: `${targetPackageId}/${targetActionId}` },
      };
    }

    return undefined;
  }

  /**
   * 调用方至目标动作 uses 依赖声明授权校验（Caller -> Callee Authorization & Uses Policy）。
   *
   * 判定规则：
   * - 同包内部 Action 互调自然合法，豁免 uses 声明；
   * - 跨包调用必须在调用方 Action 的 uses 声明列表中显式声明目标（完全限定名、通配符或包名），
   *   或经由 PackageGraph.canCascadeCall 裁决通过；未声明直接拦截。
   *
   * @param caller 调用方 Action 标识与声明上下文
   * @param target 目标 Action 标识
   * @param graph 可选的包依赖拓扑图
   * @returns 若鉴权未通过返回标准 RuntimeError，通过则返回 undefined
   */
  public checkUsesAuthorization(
    caller: CallerActionInfo,
    target: TargetActionInfo,
    graph?: PackageGraph
  ): PolicyError | undefined {
    // 同包调用完全自由开放，不作限制
    if (!caller.packageId || !target.packageId || caller.packageId === target.packageId) {
      return undefined;
    }

    const targetRef = `${target.packageId}/${target.actionId}`;
    const callerNode = graph?.getNode(caller.packageId);
    const shortActionId = caller.actionId.includes("/")
      ? caller.actionId.split("/").pop()!
      : caller.actionId;
    const usesList =
      caller.declaredUses ||
      callerNode?.manifest?.actions?.[shortActionId]?.uses ||
      callerNode?.manifest?.actions?.[caller.actionId]?.uses ||
      [];

    const isAllowed = graph
      ? graph.canCascadeCall(caller.packageId, caller.actionId, target.packageId, target.actionId)
      : usesList.some(
          (u) => u === targetRef || u === `${target.packageId}/*` || u === target.packageId
        );

    if (!isAllowed) {
      return {
        code: UNDECLARED_ACTION_DEPENDENCY,
        message: `Undeclared cross-package dependency: Action '${caller.packageId}/${caller.actionId}' does not declare dependency on '${targetRef}' in 'uses'`,
        details: {
          caller: `${caller.packageId}/${caller.actionId}`,
          target: targetRef,
          declaredUses: usesList,
        },
      };
    }

    return undefined;
  }

  /**
   * 调用嵌套最大深度限制校验（Max Call Depth Policy）。
   *
   * 超限时返回标准 ACTION_CALL_CYCLE 错误。
   *
   * @param callStack 当前已累积的调用栈切片
   * @param targetActionId 欲调用的目标 Action 标识
   * @param maxDepthOverride 临时执行覆盖的最大深度限制
   * @returns 超限错误或 undefined
   */
  public checkCallDepth(
    callStack: readonly string[],
    targetActionId: string,
    maxDepthOverride?: number
  ): PolicyError | undefined {
    const limit = maxDepthOverride ?? this.maxCallDepth;
    if (callStack.length >= limit) {
      return {
        code: ACTION_CALL_CYCLE,
        message: `Maximum call depth of ${limit} exceeded: ${callStack.join(" -> ")} -> ${targetActionId}`,
        details: {
          reason: "depth_exceeded",
          maxDepth: limit,
          callStack: [...callStack],
        },
      };
    }
    return undefined;
  }

  /**
   * 调用链环路死锁检测（Cycle Detection Policy）。
   *
   * 计算目标调用键并在历史调用栈中执行检测，杜绝 A -> B -> A 形成死锁。
   * 命中环路时返回 ACTION_CALL_CYCLE 错误。
   *
   * @param callStack 当前已累积的调用栈切片
   * @param targetActionId 欲调用的目标 Action 标识
   * @param targetPackageId 目标 Action 所属包标识
   * @param currentPackageId 当前执行发起方包标识
   * @returns 包含规范化 callKey 与可选错误的结构体
   */
  public checkCycle(
    callStack: readonly string[],
    targetActionId: string,
    targetPackageId?: string,
    currentPackageId?: string
  ): CycleCheckResult {
    const isExternal = Boolean(
      targetPackageId && currentPackageId && targetPackageId !== currentPackageId
    );
    const callKey = targetPackageId
      ? `${targetPackageId}/${targetActionId}`
      : targetActionId;

    let hasCycle = false;
    if (isExternal) {
      hasCycle = callStack.includes(callKey);
    } else {
      hasCycle =
        callStack.includes(callKey) ||
        callStack.includes(targetActionId) ||
        (targetPackageId ? callStack.includes(`${targetPackageId}/${targetActionId}`) : false);
    }

    if (hasCycle) {
      return {
        callKey,
        error: {
          code: ACTION_CALL_CYCLE,
          message: `Cycle detected in action invocation: ${callStack.join(" -> ")} -> ${callKey}`,
          details: {
            reason: "cycle_detected",
            callStack: [...callStack],
            target: callKey,
          },
        },
      };
    }

    return { callKey };
  }

  /**
   * 并发活跃子任务配额检查（Sub-Run Quota Policy）。
   *
   * 针对同源 rootRunId 限制派生的并发子任务上限，防止资源耗尽。
   *
   * @param rootRunId 根运行标识符
   * @returns 超限错误或 undefined
   */
  public checkSubRunQuota(rootRunId: string): PolicyError | undefined {
    const current = this.activeSubRunsPerRoot.get(rootRunId) || 0;
    if (current >= this.maxSubRuns) {
      return {
        code: ACTION_SUBRUN_LIMIT,
        message: `Maximum concurrent sub-runs (${this.maxSubRuns}) reached for root run '${rootRunId}'`,
        details: {
          limit: this.maxSubRuns,
        },
      };
    }
    return undefined;
  }

  /**
   * 申请子任务并发配额槽位。
   *
   * @param rootRunId 根运行标识符
   * @returns 是否成功获取槽位（若已达上限返回 false）
   */
  public acquireSubRun(rootRunId: string): boolean {
    const current = this.activeSubRunsPerRoot.get(rootRunId) || 0;
    if (current >= this.maxSubRuns) {
      return false;
    }
    this.activeSubRunsPerRoot.set(rootRunId, current + 1);
    return true;
  }

  /**
   * 释放已申请的子任务并发配额槽位。
   *
   * @param rootRunId 根运行标识符
   */
  public releaseSubRun(rootRunId: string): void {
    const current = this.activeSubRunsPerRoot.get(rootRunId) || 1;
    if (current <= 1) {
      this.activeSubRunsPerRoot.delete(rootRunId);
    } else {
      this.activeSubRunsPerRoot.set(rootRunId, current - 1);
    }
  }

  /**
   * 获取指定根运行当前的活跃并发子任务计数。
   */
  public getActiveSubRuns(rootRunId: string): number {
    return this.activeSubRunsPerRoot.get(rootRunId) || 0;
  }
}
