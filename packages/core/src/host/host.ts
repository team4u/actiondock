import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
  RuntimeError,
} from "@actiondock/sdk";
import { DefaultPackageRuntime } from "../package/runtime";
import type {
  HostManagedPackageRuntime,
  PackageInfo,
  PackageRuntime,
  PackageRuntimeOptions,
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PlaybookSpec,
  PlaybookSummary,
} from "../package/types";
import type {
  ActionInvoker,
  CancelResult,
  ExecutionTicket,
} from "../execution/types";
import {
  createRootInvocationContext,
  type InvocationContext,
  type RunOptions,
} from "../invocation/types";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { hasPendingTransactions, isProjectLockHeld, recoverPendingTransactions } from "../project/transactions";
import { listLinkedPackages } from "../registry/registry";
import { InMemoryEventSink, type EventSink } from "../runtime/events";
import {
  ActionDockError,
  ACTION_CALL_CYCLE,
  ACTION_NOT_FOUND,
  ACTION_PACKAGE_VERSION_CONFLICT,
  ACTION_SUBRUN_LIMIT,
  INVALID_ACTION_REF,
  PACKAGE_NOT_FOUND,
  PROJECT_BUSY,
  PROJECT_RECOVERY_REQUIRED,
  UNDECLARED_ACTION_DEPENDENCY,
  type ErrorCode,
} from "../errors";
import { InvocationPolicy } from "../invocation/policy";
import { DataDirLock } from "../storage/data-dir-lock";
import {
  DefaultActionCatalog,
  DefaultPackageGraph,
  PackageGraphBuilder,
  resolveAction,
  type ActionCatalog,
  type DiscoveredPackage,
  type PackageGraph,
  type PackageNode,
  type ResolvedAction,
} from "../catalog";
import { createPackageIdentity } from "../runtime/identity";
import {
  buildRuntimeError,
  collectPackageInfos,
  describeActionAcrossRuntimes,
  describeVisiblePlaybook,
  isRootCallVisible,
  listVisiblePlaybooks,
  packageNotFoundMessage,
  parseRefLoose,
  resolveProjectRoot,
} from "./routing";
import type { ActionDockHost, ActionDockHostOptions } from "./types";
import type { ConfigValueView, ListRunsOptions, StateScopeOptions } from "../service/types";
import { ServiceError } from "../service/types";
import { CAPABILITY_UNAVAILABLE } from "../errors";
import { createGlobalStorage, isSecretConfigKey } from "../storage";
import type { RuntimeStorage, StateEntry } from "../storage/types";
import type { ConfigItemDefinition } from "../project/types";
import { filterByIntent } from "../filter";

function isPackageRuntime(item: unknown): item is PackageRuntime {
  return (
    typeof item === "object" &&
    item !== null &&
    "info" in item &&
    typeof (item as PackageRuntime).info === "function" &&
    "runAction" in item &&
    typeof (item as PackageRuntime).runAction === "function"
  );
}

export class DefaultActionDockHost implements ActionDockHost {
  public readonly hostSessionId: string;
  public readonly options: ActionDockHostOptions;
  private runtimes = new Map<string, PackageRuntime>();
  public readonly policy: InvocationPolicy;
  private hostPublicPackageIds = new Set<string>();
  private maxCallDepth: number;
  private maxSubRuns: number;
  private eventSink: EventSink;
  private isClosed = false;
  private dataDirLock?: DataDirLock;
  private failedLinkedPackages = new Map<string, { path: string; error: string }>();
  private failedAutoLoad?: { projectRoot: string; error: string };
  /** 透传给内部创建 Runtime 的存储收割开关（Host 默认持有者身份，显式可关） */
  private recoverOrphans: boolean;
  private graph: PackageGraph;
  private catalog: ActionCatalog;
  private globalStorage?: RuntimeStorage;

  constructor(options: ActionDockHostOptions = {}, internalOptions?: { deferInit?: boolean }) {
    this.hostSessionId = randomUUID();
    this.options = options;
    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
    this.policy = new InvocationPolicy({
      maxCallDepth: this.maxCallDepth,
      maxSubRuns: this.maxSubRuns,
    });
    this.eventSink = options.eventSink ?? (options.platform as any)?.eventSink ?? new InMemoryEventSink();
    // Host 默认声明数据目录持有者身份；查询旁观方（CLI 查询命令）显式置 false
    this.recoverOrphans = options.recoverOrphans !== false;
    this.graph = new DefaultPackageGraph(new Map());
    this.catalog = new DefaultActionCatalog(this.graph);

    // 当指定非内存 dataDir 时获取排他目录锁，防止并发冲突
    if (options.dataDir && !options.inMemory) {
      this.dataDirLock = DataDirLock.acquire(options.dataDir, {
        hostSessionId: this.hostSessionId,
      });
    }

    if (internalOptions?.deferInit) {
      try {
        this.registerExplicitPackages(this.options);
      } catch (err) {
        this.rollbackSync();
        throw err;
      }
      return;
    }

    try {
      this.initializeSync();
    } catch (err) {
      this.rollbackSync();
      throw err;
    }
  }

  private initializeSync(): void {
    // 阶段一：注册显式传入的 packages 列表
    this.registerExplicitPackages(this.options);

    // 阶段二：自动加载当前工程（若发现工程根目录且未显式禁用）
    if (this.options.autoLoadCurrentProject !== false) {
      this.loadCurrentProject(this.options);
    }

    // 阶段三：扫描已软链接的外部包并注册至 Host
    if (this.options.scanLinkedPackages) {
      this.registerLinkedPackages(this.options);
    }

    this.rebuildGraphAndCatalog();
  }

  public async initializeAsync(): Promise<void> {
    // 阶段二：自动加载当前工程（若发现工程根目录且未显式禁用）
    if (this.options.autoLoadCurrentProject !== false) {
      this.loadCurrentProject(this.options);
    }

    // 阶段三：扫描已软链接的外部包并注册至 Host
    if (this.options.scanLinkedPackages) {
      this.registerLinkedPackages(this.options);
    }

    this.rebuildGraphAndCatalog();
  }

  /**
   * 异步安全回滚初始化失败时所占用的资源。
   */
  public async rollbackInitialization(): Promise<void> {
    const allRuntimes = Array.from(this.runtimes.values());
    await Promise.all(
      allRuntimes.map(async (runtime) => {
        try {
          await runtime.close();
        } catch {
          // 忽略 Runtime 关闭异常
        }
      })
    );
    this.runtimes.clear();

    try {
      this.globalStorage?.close();
    } catch {
      // 忽略全局存储关闭异常
    }
    this.globalStorage = undefined;

    try {
      this.dataDirLock?.release();
    } catch {
      // 忽略排他锁释放异常
    }
    this.dataDirLock = undefined;
    this.isClosed = true;
  }

  private rollbackSync(): void {
    try {
      this.dataDirLock?.release();
    } catch {
      // 忽略排他锁释放异常
    }
    this.dataDirLock = undefined;

    // 安全关闭宿主管理的所有 Runtime 实例
    for (const runtime of this.runtimes.values()) {
      try {
        const closePromise = runtime.close();
        if (closePromise && typeof (closePromise as any).catch === "function") {
          (closePromise as any).catch(() => {});
        }
      } catch {
        // 忽略 runtime 关闭异常
      }
    }
    this.runtimes.clear();

    try {
      this.globalStorage?.close();
    } catch {
      // 忽略全局存储关闭异常
    }
    this.globalStorage = undefined;
    this.isClosed = true;
  }

  /**
   * 阶段函数：注册显式传入的 packages 列表（PackageRuntimeOptions 配置或包目录物理路径）。
   */
  private registerExplicitPackages(options: ActionDockHostOptions): void {
    if (!options.packages || !Array.isArray(options.packages)) {
      return;
    }
    for (const item of options.packages) {
      if (isPackageRuntime(item)) {
        this.registerRuntimeInternal(item, true);
      } else {
        const packageOptions: PackageRuntimeOptions =
          typeof item === "string" ? { packageRoot: item } : item;
        const runtime = new DefaultPackageRuntime({
          ...packageOptions,
          hostSessionId: this.hostSessionId,
          globalStorage: (packageOptions as any).globalStorage ?? this.getGlobalStorage(),
          platform: packageOptions.platform ?? options.platform,
          inMemory: packageOptions.inMemory ?? options.inMemory,
          customHome: packageOptions.customHome ?? options.customHome,
          dataDir: packageOptions.dataDir ?? options.dataDir,
          clock: packageOptions.clock ?? options.clock,
          process: packageOptions.process ?? options.process,
          logger: packageOptions.logger ?? options.logger,
          eventSink: (packageOptions as any).eventSink ?? this.eventSink,
          maxCallDepth: packageOptions.maxCallDepth ?? this.maxCallDepth,
          maxSubRuns: packageOptions.maxSubRuns ?? this.maxSubRuns,
          recoverOrphans: this.recoverOrphans,
        });
        this.registerRuntimeInternal(runtime, true);
      }
    }
  }

  /**
   * 阶段函数：自动加载当前工程并注册依赖闭包内的全部包。
   *
   * 失败语义区分场景：
   * - 显式传入 projectRoot 时，任何解析失败（损坏 actiondock.json、文件系统错误等）
   *   必须向上抛出，由调用方感知，严禁吞没；
   * - 自动探测场景（未传 projectRoot，由 findProjectRoot 发现）失败时记录实例诊断
   *   failedAutoLoad 并在创建时输出单行告警，保持宿主其余能力可用但绝不无声。
   */
  private loadCurrentProject(options: ActionDockHostOptions): void {
    const explicitRoot = options.projectRoot;
    const root = resolveProjectRoot(options, () => findProjectRoot());
    if (!root) {
      return;
    }

    if (isProjectLockHeld(root)) {
      const err: any = new Error(
        "PROJECT_BUSY: Project directory is locked by another active process holding project.lock"
      );
      err.code = PROJECT_BUSY;
      throw err;
    }
    if (hasPendingTransactions(root)) {
      const err: any = new Error(
        `PROJECT_RECOVERY_REQUIRED: Project directory '${root}' has pending transactions requiring recovery; use async createActionDockHost() to recover automatically`
      );
      err.code = PROJECT_RECOVERY_REQUIRED;
      throw err;
    }

    try {
      const config = loadProjectConfig(root);
      const builder = new PackageGraphBuilder({
        projectRoot: root,
        manifest: config,
        allowDevLinks: options.scanLinkedPackages,
        customHome: options.customHome,
      });

      const graph = builder.buildSync();
      if (graph.rootPackageId) {
        this.hostPublicPackageIds.add(graph.rootPackageId);
      }
      for (const depId of graph.directDependencyIds) {
        this.hostPublicPackageIds.add(depId);
      }

      for (const pkg of graph.packages.values()) {
        if (!this.runtimes.has(pkg.packageId)) {
          const isDirectOrRoot = this.hostPublicPackageIds.has(pkg.packageId);
          const runtime = new DefaultPackageRuntime({
            packageRoot: pkg.root,
            projectConfig: pkg.manifest,
            identity: pkg.identity,
            hostSessionId: this.hostSessionId,
            globalStorage: this.getGlobalStorage(),
            platform: options.platform,
            inMemory: options.inMemory,
            customHome: options.customHome,
            dataDir: options.dataDir,
            clock: options.clock,
            process: options.process,
            logger: options.logger,
            eventSink: this.eventSink,
            maxCallDepth: this.maxCallDepth,
            maxSubRuns: this.maxSubRuns,
            recoverOrphans: this.recoverOrphans,
          });
          this.registerRuntimeInternal(runtime, isDirectOrRoot);
        }
      }
    } catch (err: any) {
      if (
        err?.code === ACTION_PACKAGE_VERSION_CONFLICT ||
        err?.code === PROJECT_RECOVERY_REQUIRED ||
        err?.code === PROJECT_BUSY
      ) {
        throw err;
      }
      if (explicitRoot) {
        // 显式指定的工程根目录解析失败必须抛出：调用方明确指定了位置，损坏配置不允许被吞没
        throw err;
      }
      // 自动探测场景：记录实例诊断并输出单行告警，避免损坏工程被无声跳过
      const detail = err?.message || String(err);
      this.failedAutoLoad = { projectRoot: root, error: detail };
      console.warn(`[Host] Failed to auto-load project at '${root}': ${detail}`);
    }
  }

  /**
   * 阶段函数：扫描全局注册表中已软链接的外部包并注册至 Host。
   * 加载失败的链接包记录至 failedLinkedPackages 诊断并在调阅时透传精准失败原因。
   */
  private registerLinkedPackages(options: ActionDockHostOptions): void {
    for (const linked of listLinkedPackages(options.customHome)) {
      if (this.runtimes.has(linked.id)) {
        continue;
      }
      if (!existsSync(linked.path)) {
        const err = `Linked package '${linked.id}' path does not exist on disk: '${linked.path}'`;
        this.failedLinkedPackages.set(linked.id, { path: linked.path, error: err });
        options.logger?.warn?.(`[Host] ${err}`);
        continue;
      }
      try {
        const config = loadProjectConfig(linked.path);
        this.hostPublicPackageIds.add(linked.id);
        const runtime = new DefaultPackageRuntime({
          packageRoot: linked.path,
          projectConfig: config,
          hostSessionId: this.hostSessionId,
          globalStorage: this.getGlobalStorage(),
          platform: options.platform,
          inMemory: options.inMemory,
          customHome: options.customHome,
          dataDir: options.dataDir,
          clock: options.clock,
          process: options.process,
          logger: options.logger,
          eventSink: this.eventSink,
          maxCallDepth: this.maxCallDepth,
          maxSubRuns: this.maxSubRuns,
          recoverOrphans: this.recoverOrphans,
        });
        this.registerRuntimeInternal(runtime, true);
      } catch (err: any) {
        const errDetail = err?.message || String(err);
        this.failedLinkedPackages.set(linked.id, { path: linked.path, error: errDetail });
        options.logger?.warn?.(
          `[Host] Failed to load linked package '${linked.id}' from '${linked.path}': ${errDetail}`
        );
      }
    }
  }

  private bindRuntime(runtime: PackageRuntime): void {
    const invoker = this.createActionInvoker(runtime);
    if ("setActionInvoker" in runtime && typeof (runtime as HostManagedPackageRuntime).setActionInvoker === "function") {
      (runtime as HostManagedPackageRuntime).setActionInvoker(invoker);
    }
  }

  /**
   * 构造应用专属动作调用委托器。
   * 铁律 2：跨包调用改走 ActionInvoker 回到 Host 执行主链，经由唯一的 InvocationPolicy 授权后调用目标 Package 的 ExecutionService。
   */
  private createActionInvoker(
    callerRuntime: PackageRuntime
  ): ActionInvoker {
    return async (
      childAction: ActionRef | string,
      childInput: unknown,
      context: InvocationContext
    ): Promise<unknown> => {
      const resolved = resolveAction(childAction, {
        caller: callerRuntime.packageId,
        graph: this.graph,
        catalog: this.catalog,
      });

      const targetPackageId = resolved.package.id;
      const targetActionId = resolved.ref.actionId;
      const isSamePackage = targetPackageId === callerRuntime.packageId;
      const targetRuntime = isSamePackage ? callerRuntime : this.getRuntime(targetPackageId);

      if (!targetRuntime) {
        throw new ActionDockError(PACKAGE_NOT_FOUND, packageNotFoundMessage(targetPackageId, this.failedLinkedPackages));
      }

      // 跨包 uses 依赖声明校验（统一委托 InvocationPolicy 单一事实源）
      if (!isSamePackage) {
        let declaredUses = context.caller?.declaredUses;
        if (!declaredUses) {
          try {
            const callerSpec = await callerRuntime.describeAction(context.caller?.actionId || "");
            declaredUses = callerSpec.uses;
          } catch {
            // 忽略规范提取异常
          }
        }
        const authErr = this.policy.checkUsesAuthorization(
          {
            packageId: callerRuntime.packageId,
            actionId: context.caller?.actionId || "",
            declaredUses,
          },
          { packageId: targetPackageId, actionId: targetActionId },
          this.graph
        );
        if (authErr) {
          throw new ActionDockError(authErr.code, authErr.message, authErr.details);
        }
      }

      // 调用嵌套深度限制校验
      const depthErr = this.policy.checkCallDepth(
        context.callStack,
        targetActionId,
        context.maxCallDepth
      );
      if (depthErr) {
        throw new ActionDockError(depthErr.code, depthErr.message, depthErr.details);
      }

      // 调用链环路死锁检测
      const cycle = this.policy.checkCycle(
        context.callStack,
        targetActionId,
        targetPackageId,
        callerRuntime.packageId
      );
      if (cycle.error) {
        throw new ActionDockError(cycle.error.code, cycle.error.message, cycle.error.details);
      }

      // 针对根运行的并发子任务配额校验与申请
      const rootRunId = context.rootRunId;
      const quotaErr = this.policy.checkSubRunQuota(rootRunId);
      if (quotaErr) {
        throw new ActionDockError(quotaErr.code, quotaErr.message, quotaErr.details);
      }
      if (!this.policy.acquireSubRun(rootRunId)) {
        throw new ActionDockError(
          ACTION_SUBRUN_LIMIT,
          `Maximum concurrent sub-runs (${this.policy.maxSubRuns}) reached`,
          { limit: this.policy.maxSubRuns }
        );
      }

      try {
        const nextCallStack = [...context.callStack, cycle.callKey];
        const targetOwner = context.owner
          ? {
              tenantId: context.owner.tenantId,
              principalId: context.owner.principalId,
              packageInstanceId: isSamePackage
                ? (context.owner.packageInstanceId || callerRuntime.identity.instanceId)
                : targetRuntime.identity.instanceId,
              generationId: isSamePackage
                ? (context.owner.generationId || callerRuntime.identity.generation)
                : targetRuntime.identity.generation,
            }
          : undefined;

        const subInvocationContext: InvocationContext = {
          runId: context.runId,
          rootRunId: context.rootRunId,
          parentRunId: context.parentRunId,
          caller: context.caller,
          callStack: nextCallStack,
          package: targetRuntime.identity,
          signal: context.signal,
          timeoutMs: context.timeoutMs,
          config: context.config,
          requestId: context.requestId,
          tenantId: context.tenantId,
          principalId: context.principalId,
          hostSessionId: context.hostSessionId || this.hostSessionId,
          maxCallDepth: context.maxCallDepth ?? this.maxCallDepth,
          logger: context.logger,
          progress: context.progress,
          process: context.process,
          owner: targetOwner,
        };

        const ticket = await targetRuntime.startInvocation(
          targetActionId,
          childInput as JsonValue,
          subInvocationContext
        );
        if (!ticket.result) {
          throw new Error(`Execution ticket for run '${ticket.runId}' has no result Promise`);
        }
        const result = await ticket.result;
        if (!result.ok) {
          throw new ActionDockError(result.error.code as ErrorCode, result.error.message, result.error.details);
        }
        return result.data;
      } finally {
        this.policy.releaseSubRun(rootRunId);
      }
    };
  }

  /** 路由可见性上下文（公开包集合与包依赖图） */
  private visibility() {
    return {
      hostPublicPackageIds: this.hostPublicPackageIds as ReadonlySet<string>,
      graph: this.graph,
    };
  }

  private rebuildGraphAndCatalog(): void {
    const discovered: DiscoveredPackage[] = Array.from(this.runtimes.values()).map((runtime) => ({
      id: runtime.packageId,
      root: runtime.packageRoot || "",
      manifest: runtime.projectConfig,
      identity: runtime.identity,
      isCurrentProject: this.hostPublicPackageIds.has(runtime.packageId),
    }));

    const rootRuntime = Array.from(this.runtimes.values()).find((runtime) =>
      this.hostPublicPackageIds.has(runtime.packageId)
    );

    const builder = new PackageGraphBuilder({
      packages: discovered,
      root: rootRuntime?.packageRoot || rootRuntime?.packageId,
    });
    this.graph = builder.buildSync();
    this.catalog = new DefaultActionCatalog(this.graph, (pkgId) => {
      const runtime = this.getRuntime(pkgId);
      if (!runtime) return undefined;
      return new Map<string, any>((runtime as any).actionsMap);
    });
    this.policy.setVisibilityContext(this.visibility());
  }

  getRuntime(packageId: string): PackageRuntime | undefined {
    return this.runtimes.get(packageId);
  }

  getGraph(): PackageGraph {
    return this.graph;
  }

  getCatalog(): ActionCatalog {
    return this.catalog;
  }

  listRuntimes(): PackageRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * 获取自动加载工程的失败诊断信息。
   * 仅自动探测场景会记录此诊断；显式传入 projectRoot 的加载失败会直接抛出，不产生此诊断。
   */
  getAutoLoadFailure(): { projectRoot: string; error: string } | undefined {
    return this.failedAutoLoad;
  }

  private registerRuntimeInternal(runtime: PackageRuntime, isPublic: boolean): void {
    if (this.runtimes.has(runtime.packageId)) {
      const existing = this.runtimes.get(runtime.packageId)!;
      if (existing === runtime) {
        return;
      }
      throw new Error(
        `Package ID conflict: package '${runtime.packageId}' is already registered in host`
      );
    }
    this.runtimes.set(runtime.packageId, runtime);
    if (isPublic) {
      this.hostPublicPackageIds.add(runtime.packageId);
    }
    this.bindRuntime(runtime);
    this.rebuildGraphAndCatalog();

    // 接管与恢复：仅持有者身份的 Host 自动将死亡会话或遗留非终态运行收敛为 interrupted；
    // 旁观查询 Host（CLI state/runs/config 命令）跳过本步骤，不动其他进程的在途记录
    if (this.recoverOrphans) {
      if (typeof (runtime as any).recoverDeadSessionRuns === "function") {
        try {
          (runtime as any).recoverDeadSessionRuns(this.hostSessionId);
        } catch (err) {
          // 单包恢复失败不阻断整体接管流程，但必须可观测
          console.warn(
            `[actiondock] recoverDeadSessionRuns failed for package '${runtime.packageId}': ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  registerRuntime(runtime: PackageRuntime): void {
    this.registerRuntimeInternal(runtime, true);
  }

  async info(): Promise<PackageInfo[]> {
    return collectPackageInfos(this.listRuntimes());
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    let results: ActionSummary[] = [];
    const runtimes = this.listRuntimes();
    for (const runtime of runtimes) {
      const runtimeSummaries = await runtime.listActions();
      for (const item of runtimeSummaries) {
        if (!isRootCallVisible(runtime.packageId, item.id, this.hostPublicPackageIds, this.graph)) {
          continue;
        }
        const qualifiedId =
          runtimes.length > 1 && !item.id.includes("/")
            ? `${runtime.packageId}/${item.id}`
            : item.id;
        results.push({
          ...item,
          id: qualifiedId,
          packageId: runtime.packageId,
        });
      }
    }

    if (options?.tags && options.tags.length > 0) {
      results = results.filter((s) =>
        options.tags!.every((t) => s.tags?.includes(t))
      );
    }

    if (options?.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      );
    }

    if (options?.prefix) {
      results = results.filter((s) => s.id.startsWith(options.prefix!));
    }

    return results;
  }

  async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
    return describeActionAcrossRuntimes(
      ref,
      this.listRuntimes(),
      this.visibility(),
      this.failedLinkedPackages,
      this.catalog,
      this.graph
    );
  }

  async listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
    let pbs = await listVisiblePlaybooks(this.listRuntimes(), this.visibility());
    if (options?.package) {
      pbs = pbs.filter((p) => p.packageId === options.package);
    }
    if (options?.intent) {
      pbs = filterByIntent(
        pbs,
        options.intent,
        [(p) => p.id, (p) => p.description || "", (p) => p.packageId || "", (p) => (p.actions || []).join(" ")],
        false
      );
    }
    return pbs;
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    return describeVisiblePlaybook(this.listRuntimes(), id, this.visibility());
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options: RunOptions = {}
  ): Promise<ExecutionResult> {
    const ticket = await this.startAction(ref, input, options);
    if (!ticket.result) {
      throw new Error(`Execution ticket for run '${ticket.runId}' has no result Promise`);
    }
    return ticket.result;
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options: RunOptions = {}
  ): Promise<ExecutionTicket> {
    if (this.isClosed) {
      throw new Error("ActionDockHost is closed: new tasks rejected");
    }

    // - 统一基于纯领域 resolveAction 解析目标包与 Action 动作标识
    let resolved: ResolvedAction;
    try {
      resolved = resolveAction(ref, {
        graph: this.graph,
        catalog: this.catalog,
      });
    } catch (err: any) {
      const runId = randomUUID();
      let code = err.code || ACTION_NOT_FOUND;
      let message = err.message || String(err);
      if (code === PACKAGE_NOT_FOUND) {
        code = PACKAGE_NOT_FOUND;
        const parsed = parseRefLoose(ref);
        if (parsed.packageId) {
          message = packageNotFoundMessage(parsed.packageId, this.failedLinkedPackages);
        }
      } else if (code === INVALID_ACTION_REF && err.details?.alias === "AMBIGUOUS_ACTION_REF") {
        return {
          runId,
          status: "failed",
          result: Promise.resolve({
            ok: false,
            runId,
            error: buildRuntimeError(INVALID_ACTION_REF, message, err.details),
          }),
        };
      }
      return {
        runId,
        status: "failed",
        result: Promise.resolve({
          ok: false,
          runId,
          error: buildRuntimeError(code, message),
        }),
      };
    }

    const targetPackageId = resolved.package.id;
    const targetActionId = resolved.ref.actionId;
    const targetRuntime = this.getRuntime(targetPackageId);

    if (!targetRuntime) {
      const runId = randomUUID();
      const error: RuntimeError = buildRuntimeError(
        PACKAGE_NOT_FOUND,
        packageNotFoundMessage(targetPackageId, this.failedLinkedPackages)
      );
      return {
        runId,
        status: "failed",
        result: Promise.resolve({ ok: false, runId, error }),
      };
    }

    // 根调用可见性鉴权（统一委托 InvocationPolicy 单一事实源断言）
    try {
      this.policy.assertRootVisibility(resolved, this.visibility());
    } catch (err: any) {
      const runId = randomUUID();
      return {
        runId,
        status: "failed",
        result: Promise.resolve({
          ok: false,
          runId,
          error: buildRuntimeError(err.code || UNDECLARED_ACTION_DEPENDENCY, err.message, err.details),
        }),
      };
    }

    // 在边界安全组装受信任的根调用上下文（纯 Root Call，无父级血缘）
    const rootKey = `${targetPackageId}/${targetActionId}`;
    const rootContext = createRootInvocationContext({
      targetPackage: targetRuntime.identity,
      callStack: [rootKey],
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      config: options.config,
      requestId: options.requestId,
      hostSessionId: this.hostSessionId,
      maxCallDepth: this.maxCallDepth,
      process: this.options.process,
    });

    // 调度目标包执行服务
    return targetRuntime.startInvocation(
      targetActionId,
      input,
      rootContext
    );
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    for (const runtime of this.listRuntimes()) {
      const record = await runtime.getRun(runId);
      if (record) return record;
    }
    return undefined;
  }

  async listRuns(query?: ListRunsOptions): Promise<RunRecord[]> {
    const runtimes = query?.packageId
      ? [this.getRuntime(query.packageId)].filter(Boolean) as PackageRuntime[]
      : this.listRuntimes();
    const records: RunRecord[] = [];
    for (const runtime of runtimes) {
      const recs = await runtime.listRuns(query);
      for (const r of recs) {
        records.push({
          ...r,
          packageId: (r as any).packageId || runtime.packageId,
        });
      }
    }
    records.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    let result = records;
    if (query?.intent) {
      result = filterByIntent(
        result,
        query.intent,
        [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
        false
      );
    }
    if (query?.limit && result.length > query.limit) {
      result.length = query.limit;
    }
    return result;
  }

  async clearRuns(options?: { packageId?: string; actionId?: string; status?: string; olderThanMs?: number }): Promise<number> {
    const runtimes = options?.packageId
      ? [this.getRuntime(options.packageId)].filter(Boolean) as PackageRuntime[]
      : this.listRuntimes();
    let total = 0;
    for (const runtime of runtimes) {
      const res = await runtime.clearRuns(options);
      total += res;
    }
    return total;
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    for (const runtime of this.listRuntimes()) {
      const res = await runtime.cancelRun(runId, reason);
      if (res.outcome !== "not_found") {
        return res;
      }
    }
    return { outcome: "not_found", runId };
  }

  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    for (const runtime of this.listRuntimes()) {
      const storageRecord = (runtime as any).storage?.getRun?.(runId);
      if (storageRecord) {
        return runtime.events(runId, options);
      }
    }
    const firstRuntime = this.listRuntimes()[0];
    if (firstRuntime) {
      return firstRuntime.events(runId, options);
    }
    return this.eventSink.subscribe(runId, options);
  }

  private getGlobalStorage(): RuntimeStorage {
    if (!this.globalStorage) {
      const hasInMemoryPackage = this.options.packages?.some(
        (item) => typeof item !== "string" && !isPackageRuntime(item) && item.inMemory
      );
      const inMemory = Boolean(this.options.inMemory || hasInMemoryPackage);
      this.globalStorage =
        this.options.platform?.storage?.createGlobalStorage?.({
          dataDir: this.options.dataDir,
          customHome: this.options.customHome,
        }) ??
        createGlobalStorage({
          dataDir: this.options.dataDir,
          customHome: this.options.customHome,
          inMemory,
        });
    }
    return this.globalStorage;
  }

  private findDeclaredConfigItem(key: string): ConfigItemDefinition | undefined {
    let foundItem: ConfigItemDefinition | undefined;
    for (const runtime of this.listRuntimes()) {
      const item = runtime.projectConfig?.config?.[key];
      if (item) {
        if (item.secret) return item;
        foundItem = item;
      }
    }
    return foundItem;
  }

  private resolveRuntime(packageId?: string): PackageRuntime | undefined {
    if (packageId) {
      return this.getRuntime(packageId);
    }
    const runtimes = this.listRuntimes();
    return runtimes.length === 1 ? runtimes[0] : undefined;
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    if (packageId === "global") {
      const globalStorage = this.getGlobalStorage();
      const val = globalStorage.getConfig(key);
      const configured = val !== undefined;
      const declaredItem = this.findDeclaredConfigItem(key);
      const isSecret = isSecretConfigKey(key, declaredItem);
      return {
        key,
        configured,
        secret: isSecret,
        source: configured ? "global" : "default",
        value: !isSecret && configured ? (val as JsonValue) : undefined,
      };
    }
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return runtime.getConfig(key);
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    if (packageId === "global") {
      await this.getGlobalStorage().setConfig(key, value);
      return;
    }
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    await runtime.setConfig(key, value);
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    if (packageId === "global") {
      return await this.getGlobalStorage().deleteConfig(key);
    }
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return await runtime.deleteConfig(key);
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    if (packageId === "global") {
      const globalStorage = this.getGlobalStorage();
      const all = globalStorage.listConfig();
      return Object.entries(all).map(([key, val]) => {
        const declaredItem = this.findDeclaredConfigItem(key);
        const isSecret = isSecretConfigKey(key, declaredItem);
        return {
          key,
          configured: true,
          secret: isSecret,
          source: "global",
          value: isSecret ? undefined : (val as JsonValue),
        };
      });
    }
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return runtime.listConfig();
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return runtime.getState<T>(actionId, key, options);
  }

  async setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    if (actionId) {
      await runtime.setActionState<T>(actionId, key, value, options);
    } else {
      await runtime.setState<T>(key, value, options);
    }
  }

  async deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return runtime.deleteState(actionId, key, options);
  }

  async listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return runtime.listStateKeys(actionId, options);
  }

  async clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number> {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return runtime.clearState(actionId, options);
  }

  async listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]> {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new ServiceError(
        CAPABILITY_UNAVAILABLE,
        `CAPABILITY_UNAVAILABLE: Package '${packageId}' not found in host`
      );
    }
    if (!runtime.listStateEntries) {
      return [];
    }
    return runtime.listStateEntries(options);
  }

  /**
   * 优雅关闭宿主容器。
   * 仅对内部创建的 Runtime 实例执行 close 并安全释放底层资源；
   * 外部传入借用的 Runtime 实例生命周期完全由调用方负责管理，Host 关闭时仅解绑引用并清理自身内部实例。
   */
  async close(options?: { graceMs?: number }): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    const allRuntimes = Array.from(this.runtimes.values());
    await Promise.all(
      allRuntimes.map(async (runtime) => {
        try {
          await runtime.close(options);
        } catch {
          // 忽略 Runtime 关闭异常，确保全部安全释放
        }
      })
    );
    this.runtimes.clear();

    try {
      this.globalStorage?.close();
    } catch {
      // 忽略全局存储关闭异常
    }
    this.globalStorage = undefined;

    try {
      this.dataDirLock?.release();
    } catch {
      // 忽略目录排他锁释放异常
    }
    this.dataDirLock = undefined;
  }
}

/**
 * 工厂函数：创建并初始化 ActionDockHost 宿主容器。
 */
export async function createActionDockHost(
  options: ActionDockHostOptions = {}
): Promise<ActionDockHost> {
  let createdHost: DefaultActionDockHost | undefined;
  try {
    createdHost = new DefaultActionDockHost(options, { deferInit: true });

    if (options.autoLoadCurrentProject !== false) {
      const root = resolveProjectRoot(options, () => findProjectRoot());
      if (root) {
        if (isProjectLockHeld(root)) {
          throw new ActionDockError(
            PROJECT_BUSY,
            "PROJECT_BUSY: Project directory is locked by another active process holding project.lock"
          );
        }
        // 依据事务日志恢复未完成提交的悬空事务（锁持有者存活时严禁判定为崩溃事务并禁止自动恢复）
        if (hasPendingTransactions(root)) {
          await recoverPendingTransactions(root, { frozenInstall: true });
        }
      }
    }

    await createdHost.initializeAsync();
    return createdHost;
  } catch (err) {
    if (createdHost) {
      try {
        await createdHost.rollbackInitialization();
      } catch {
        // 忽略宿主回滚异常，确保抛出原始异常
      }
    }
    throw err;
  }
}
