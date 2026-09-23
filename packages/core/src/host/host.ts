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
import { DefaultActionDockApp } from "../app/app";
import type {
  ActionDockApp,
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PackageInfo,
  PlaybookSpec,
  PlaybookSummary,
} from "../app/types";
import type {
  ActionInvoker,
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import type { InvocationContext } from "../invocation/types";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { hasPendingTransactions, isProjectLockHeld, recoverPendingTransactions } from "../project/transactions";
import { listLinkedPackages } from "../registry/registry";
import { InMemoryEventSink, type EventSink } from "../runtime/events";
import {
  ACTION_CALL_CYCLE,
  ACTION_MAX_DEPTH_EXCEEDED,
  ACTION_NOT_FOUND,
  ACTION_PACKAGE_VERSION_CONFLICT,
  ACTION_SUBRUN_LIMIT,
  INVALID_ACTION_REF,
  MAX_SUBRUNS_REACHED,
  PACKAGE_NOT_FOUND,
  PROJECT_BUSY,
  PROJECT_RECOVERY_REQUIRED,
  UNDECLARED_ACTION_DEPENDENCY,
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
  describeActionAcrossApps,
  describeVisiblePlaybook,
  isRootCallVisible,
  listVisiblePlaybooks,
  packageNotFoundMessage,
  parseRefLoose,
  resolveProjectRoot,
} from "./routing";
import type { ActionDockHost, ActionDockHostOptions } from "./types";

function isActionDockApp(item: unknown): item is ActionDockApp {
  return (
    typeof item === "object" &&
    item !== null &&
    "info" in item &&
    typeof (item as ActionDockApp).info === "function" &&
    "runAction" in item &&
    typeof (item as ActionDockApp).runAction === "function"
  );
}

/**
 * ActionDock 统一多包宿主容器默认实现。
 * 负责聚合与调度多个 ActionDockApp 实例，提供跨包引用路由、依赖声明校验与资源配额控制。
 */
export class DefaultActionDockHost implements ActionDockHost {
  public readonly hostSessionId: string;
  public readonly options: ActionDockHostOptions;
  private apps = new Map<string, ActionDockApp>();
  private readonly internallyCreatedApps = new Set<ActionDockApp>();
  public readonly policy: InvocationPolicy;
  private hostPublicPackageIds = new Set<string>();
  private maxCallDepth: number;
  private maxSubRuns: number;
  private eventSink: EventSink;
  private isClosed = false;
  private dataDirLock?: DataDirLock;
  private failedLinkedPackages = new Map<string, { path: string; error: string }>();
  private failedAutoLoad?: { projectRoot: string; error: string };
  /** 透传给内部创建 App 的存储收割开关（Host 默认持有者身份，显式可关） */
  private recoverOrphans: boolean;
  private graph: PackageGraph;
  private catalog: ActionCatalog;

  constructor(options: ActionDockHostOptions = {}) {
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

    try {
      // 阶段一：注册显式传入的 packages 列表
      this.registerExplicitPackages(options);

      // 阶段二：自动加载当前工程（若发现工程根目录且未显式禁用）
      if (options.autoLoadCurrentProject !== false) {
        this.loadCurrentProject(options);
      }

      // 阶段三：扫描已软链接的外部包并注册至 Host
      if (options.scanLinkedPackages) {
        this.registerLinkedPackages(options);
      }

      this.rebuildGraphAndCatalog();
    } catch (err) {
      try {
        this.dataDirLock?.release();
      } catch {
        // 忽略排他锁释放异常
      }
      this.dataDirLock = undefined;

      // 仅安全关闭宿主内部创建的子 app，外部传入的 app 保持调用方生命周期与所有权
      for (const app of this.internallyCreatedApps) {
        try {
          const closePromise = app.close();
          if (closePromise && typeof (closePromise as any).catch === "function") {
            (closePromise as any).catch(() => {});
          }
        } catch {
          // 忽略 app 关闭异常
        }
      }
      this.internallyCreatedApps.clear();
      this.apps.clear();
      throw err;
    }
  }

  /**
   * 阶段函数：注册显式传入的 packages 列表（现成 App 实例或 AppOptions 配置）。
   */
  private registerExplicitPackages(options: ActionDockHostOptions): void {
    if (!options.packages || !Array.isArray(options.packages)) {
      return;
    }
    for (const item of options.packages) {
      if (isActionDockApp(item)) {
        this.registerAppInternal(item, true);
      } else {
        const app = new DefaultActionDockApp({
          ...item,
          hostSessionId: this.hostSessionId,
          platform: item.platform ?? options.platform,
          inMemory: item.inMemory ?? options.inMemory,
          customHome: item.customHome ?? options.customHome,
          dataDir: item.dataDir ?? options.dataDir,
          clock: item.clock ?? options.clock,
          process: item.process ?? options.process,
          logger: item.logger ?? options.logger,
          eventSink: item.eventSink ?? this.eventSink,
          maxCallDepth: item.maxCallDepth ?? this.maxCallDepth,
          maxSubRuns: item.maxSubRuns ?? this.maxSubRuns,
          recoverOrphans: this.recoverOrphans,
        });
        this.internallyCreatedApps.add(app);
        this.registerAppInternal(app, true);
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
        if (!this.apps.has(pkg.packageId)) {
          const isDirectOrRoot = this.hostPublicPackageIds.has(pkg.packageId);
          const app = new DefaultActionDockApp({
            packageRoot: pkg.root,
            projectConfig: pkg.manifest,
            hostSessionId: this.hostSessionId,
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
          this.internallyCreatedApps.add(app);
          this.registerAppInternal(app, isDirectOrRoot);
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
      if (this.apps.has(linked.id)) {
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
        const app = new DefaultActionDockApp({
          packageRoot: linked.path,
          projectConfig: config,
          hostSessionId: this.hostSessionId,
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
        this.internallyCreatedApps.add(app);
        this.registerAppInternal(app, true);
      } catch (err: any) {
        const errDetail = err?.message || String(err);
        this.failedLinkedPackages.set(linked.id, { path: linked.path, error: errDetail });
        options.logger?.warn?.(
          `[Host] Failed to load linked package '${linked.id}' from '${linked.path}': ${errDetail}`
        );
      }
    }
  }

  private bindApp(app: ActionDockApp): void {
    const invoker = this.createActionInvoker(app);
    if (typeof (app as any).setActionInvoker === "function") {
      (app as any).setActionInvoker(invoker);
    } else if (app.executionService && typeof (app.executionService as any).setActionInvoker === "function") {
      (app.executionService as any).setActionInvoker(invoker);
    }
    const runner = app.executionService?.runner;
    if (runner && typeof (runner as any).setActionInvoker === "function") {
      (runner as any).setActionInvoker(invoker);
    }
  }

  /**
   * 构造应用专属动作调用委托器。
   * 铁律 2：跨包调用改走 ActionInvoker 回到 Host 执行主链，经由唯一的 InvocationPolicy 授权后调用目标 Package 的 ExecutionService。
   */
  private createActionInvoker(
    callerApp: ActionDockApp
  ): ActionInvoker {
    return async (
      childAction: ActionRef | string,
      childInput: unknown,
      context: InvocationContext
    ): Promise<unknown> => {
      const resolved = resolveAction(childAction, {
        caller: callerApp.packageId,
        graph: this.graph,
        catalog: this.catalog,
      });

      const targetPackageId = resolved.package.id;
      const targetActionId = resolved.ref.actionId;
      const isSamePackage = targetPackageId === callerApp.packageId;
      const targetApp = isSamePackage ? callerApp : this.getApp(targetPackageId);

      if (!targetApp) {
        const err = new Error(packageNotFoundMessage(targetPackageId, this.failedLinkedPackages));
        (err as any).code = PACKAGE_NOT_FOUND;
        throw err;
      }

      // 跨包 uses 依赖声明校验（统一委托 InvocationPolicy 单一事实源）
      if (!isSamePackage) {
        let declaredUses = context.caller?.declaredUses;
        if (!declaredUses) {
          try {
            const callerSpec = await callerApp.describeAction(context.caller?.actionId || "");
            declaredUses = callerSpec.uses;
          } catch {
            // 忽略规范提取异常
          }
        }
        const authErr = this.policy.checkUsesAuthorization(
          {
            packageId: callerApp.packageId,
            actionId: context.caller?.actionId || "",
            declaredUses,
          },
          { packageId: targetPackageId, actionId: targetActionId },
          this.graph
        );
        if (authErr) {
          const err = new Error(authErr.message);
          (err as any).code = authErr.code;
          (err as any).details = authErr.details;
          throw err;
        }
      }

      // 调用嵌套深度限制校验
      const depthErr = this.policy.checkCallDepth(
        context.callStack,
        targetActionId,
        context.maxCallDepth
      );
      if (depthErr) {
        const err = new Error(depthErr.message);
        (err as any).code = depthErr.code;
        (err as any).details = depthErr.details;
        throw err;
      }

      // 调用链环路死锁检测
      const cycle = this.policy.checkCycle(
        context.callStack,
        targetActionId,
        targetPackageId,
        callerApp.packageId
      );
      if (cycle.error) {
        const err = new Error(cycle.error.message);
        (err as any).code = cycle.error.code;
        (err as any).details = cycle.error.details;
        throw err;
      }

      // 针对根运行的并发子任务配额校验与申请
      const rootRunId = context.rootRunId;
      const quotaErr = this.policy.checkSubRunQuota(rootRunId);
      if (quotaErr) {
        const err = new Error(quotaErr.message);
        (err as any).code = quotaErr.code;
        (err as any).details = quotaErr.details;
        throw err;
      }
      if (!this.policy.acquireSubRun(rootRunId)) {
        const err = new Error(`Maximum concurrent sub-runs (${this.policy.maxSubRuns}) reached`);
        (err as any).code = ACTION_SUBRUN_LIMIT;
        (err as any).details = { alias: MAX_SUBRUNS_REACHED, limit: this.policy.maxSubRuns };
        throw err;
      }

      try {
        const nextCallStack = [...context.callStack, cycle.callKey];
        const targetOwner = context.owner
          ? {
              tenantId: context.owner.tenantId,
              principalId: context.owner.principalId,
              packageInstanceId: isSamePackage
                ? (context.owner.packageInstanceId || callerApp.identity.instanceId)
                : targetApp.identity.instanceId,
              generationId: isSamePackage
                ? (context.owner.generationId || callerApp.identity.generation)
                : targetApp.identity.generation,
            }
          : undefined;

        const subInvocationContext: InvocationContext = {
          runId: context.runId,
          rootRunId: context.rootRunId,
          parentRunId: context.parentRunId,
          caller: context.caller,
          callStack: nextCallStack,
          package: targetApp.identity,
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
          platform: context.platform,
          owner: targetOwner,
        };

        const ticket = await targetApp.executionService.start(
          targetActionId,
          childInput as JsonValue,
          subInvocationContext
        );
        if (!ticket.result) {
          throw new Error(`Execution ticket for run '${ticket.runId}' has no result Promise`);
        }
        const result = await ticket.result;
        if (!result.ok) {
          const err = new Error(result.error.message);
          (err as any).code = result.error.code;
          (err as any).details = result.error.details;
          throw err;
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
    const discovered: DiscoveredPackage[] = Array.from(this.apps.values()).map((app) => ({
      id: app.packageId,
      root: app.packageRoot || "",
      manifest: app.projectConfig,
      isCurrentProject: this.hostPublicPackageIds.has(app.packageId),
    }));

    const rootApp = Array.from(this.apps.values()).find((app) =>
      this.hostPublicPackageIds.has(app.packageId)
    );

    const builder = new PackageGraphBuilder({
      packages: discovered,
      root: rootApp?.packageRoot || rootApp?.packageId,
    });
    this.graph = builder.buildSync();
    this.catalog = new DefaultActionCatalog(this.graph, (pkgId) => {
      const app = this.getApp(pkgId);
      if (!app) return undefined;
      const map = new Map<string, any>(app.actionsMap);
      const runnerRegistry = (app.executionService as any)?._runner?.registry?.map;
      if (runnerRegistry) {
        for (const [k, v] of runnerRegistry) {
          map.set(k, v);
        }
      }
      return map;
    });
  }

  getApp(packageId: string): ActionDockApp | undefined {
    return this.apps.get(packageId);
  }

  getGraph(): PackageGraph {
    return this.graph;
  }

  getCatalog(): ActionCatalog {
    return this.catalog;
  }

  listApps(): ActionDockApp[] {
    return Array.from(this.apps.values());
  }

  /**
   * 获取自动加载工程的失败诊断信息。
   * 仅自动探测场景会记录此诊断；显式传入 projectRoot 的加载失败会直接抛出，不产生此诊断。
   */
  getAutoLoadFailure(): { projectRoot: string; error: string } | undefined {
    return this.failedAutoLoad;
  }

  private registerAppInternal(app: ActionDockApp, isPublic: boolean): void {
    if (this.apps.has(app.packageId)) {
      const existing = this.apps.get(app.packageId)!;
      if (existing === app) {
        return;
      }
      throw new Error(
        `Package ID conflict: package '${app.packageId}' is already registered in host`
      );
    }
    this.apps.set(app.packageId, app);
    if (isPublic) {
      this.hostPublicPackageIds.add(app.packageId);
    }
    this.bindApp(app);
    this.rebuildGraphAndCatalog();

    // 接管与恢复：仅持有者身份的 Host 自动将死亡会话或遗留非终态运行收敛为 interrupted；
    // 旁观查询 Host（CLI state/runs/config 命令）跳过本步骤，不动其他进程的在途记录
    if (this.recoverOrphans) {
      const st = app.storage;
      if (st && typeof st.recoverDeadSessionRuns === "function") {
        try {
          st.recoverDeadSessionRuns(this.hostSessionId);
        } catch (err) {
          // 单包恢复失败不阻断整体接管流程，但必须可观测
          console.warn(
            `[actiondock] recoverDeadSessionRuns failed for package '${app.packageId}': ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  registerApp(app: ActionDockApp): void {
    this.registerAppInternal(app, true);
  }

  async info(): Promise<PackageInfo[]> {
    return collectPackageInfos(this.listApps());
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    let results: ActionSummary[] = [];
    const apps = this.listApps();
    for (const app of apps) {
      const appSummaries = await app.listActions();
      for (const item of appSummaries) {
        if (!isRootCallVisible(app.packageId, item.id, this.hostPublicPackageIds, this.graph)) {
          continue;
        }
        const qualifiedId =
          apps.length > 1 && !item.id.includes("/")
            ? `${app.packageId}/${item.id}`
            : item.id;
        results.push({
          ...item,
          id: qualifiedId,
          packageId: app.packageId,
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
    return describeActionAcrossApps(
      ref,
      this.listApps(),
      this.visibility(),
      this.failedLinkedPackages,
      this.catalog,
      this.graph
    );
  }

  async listPlaybooks(): Promise<PlaybookSummary[]> {
    return listVisiblePlaybooks(this.listApps(), this.visibility());
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    return describeVisiblePlaybook(this.listApps(), id, this.visibility());
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options: ExecuteOptions = {}
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
    options: ExecuteOptions = {}
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
    const targetApp = this.getApp(targetPackageId);

    if (!targetApp) {
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

    // 根调用可见性鉴权（统一委托 InvocationPolicy 单一事实源）
    const parentRunId = options.parentRunId;
    if (!parentRunId && targetPackageId) {
      const visibilityErr = this.policy.checkRootVisibility(targetPackageId, targetActionId, this.visibility());
      if (visibilityErr) {
        const runId = randomUUID();
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error: visibilityErr }),
        };
      }
    }

    // 父子任务血缘关系、调用配额与跨包 uses 声明依赖校验（统一委托 InvocationPolicy 单一事实源）
    let effectiveRootRunId = options.rootRunId;
    let effectiveCallStack: string[] = (options as any).callStack ? [...(options as any).callStack] : [];

    if (parentRunId) {
      const parentRun = await this.getRun(parentRunId);
      if (parentRun) {
        const lineage = this.policy.resolveLineage({
          runId: parentRun.id,
          rootRunId: options.rootRunId,
          parentRunId,
          parentRecord: parentRun,
        });
        effectiveRootRunId = lineage.rootRunId;

        // 跨包 uses 依赖声明校验
        const callerPackageId = parentRun.packageId;
        const callerActionId = parentRun.actionId;
        if (callerPackageId && callerPackageId !== targetPackageId) {
          const callerApp = this.getApp(callerPackageId);
          let declaredUses: string[] | undefined;
          if (callerApp) {
            try {
              const callerSpec = await callerApp.describeAction(callerActionId);
              declaredUses = callerSpec.uses;
            } catch {
              // 忽略规范提取异常，交由执行服务执行
            }
          }
          const authErr = this.policy.checkUsesAuthorization(
            { packageId: callerPackageId, actionId: callerActionId, declaredUses },
            { packageId: targetPackageId, actionId: targetActionId },
            this.graph
          );
          if (authErr) {
            const runId = randomUUID();
            return {
              runId,
              status: "failed",
              result: Promise.resolve({ ok: false, runId, error: authErr }),
            };
          }
        }

        // 调用嵌套深度限制校验（通过父子运行血缘链追溯深度）
        let depth = 1;
        let cur: RunRecord | undefined = parentRun;
        while (cur && cur.parentRunId) {
          depth++;
          if (depth > this.maxCallDepth) break;
          cur = await this.getRun(cur.parentRunId);
        }
        if (depth >= this.maxCallDepth) {
          const depthErr = this.policy.checkCallDepth(
            new Array(depth).fill(""),
            targetActionId,
            options.maxCallDepth
          );
          if (depthErr) {
            const runId = randomUUID();
            return {
              runId,
              status: "failed",
              result: Promise.resolve({ ok: false, runId, error: depthErr }),
            };
          }
        }

        // 调用链环路检测（仅当显式传递活跃调用栈时执行，避免误判合法并发或迭代子任务）
        if (options.callStack && options.callStack.length > 0) {
          const cycle = this.policy.checkCycle(
            options.callStack,
            targetActionId,
            targetPackageId,
            parentRun.packageId
          );
          if (cycle.error) {
            const runId = randomUUID();
            return {
              runId,
              status: "failed",
              result: Promise.resolve({ ok: false, runId, error: cycle.error }),
            };
          }
        }

        // 针对根运行的并发子任务数限制校验
        if (effectiveRootRunId) {
          const quotaErr = this.policy.checkSubRunQuota(effectiveRootRunId);
          if (quotaErr) {
            const runId = randomUUID();
            return {
              runId,
              status: "failed",
              result: Promise.resolve({ ok: false, runId, error: quotaErr }),
            };
          }
        }
      }
    }

    // 构造子运行参数并调度至目标 App 执行
    const execOptions: ExecuteOptions = {
      ...options,
      rootRunId: effectiveRootRunId,
      parentRunId,
      hostSessionId: this.hostSessionId,
      maxCallDepth: options.maxCallDepth ?? this.maxCallDepth,
    };

    if (parentRunId && effectiveRootRunId) {
      this.policy.acquireSubRun(effectiveRootRunId);
    }

    let ticket: ExecutionTicket;
    try {
      ticket = await targetApp.startAction(targetActionId, input, execOptions);
    } catch (err) {
      if (parentRunId && effectiveRootRunId) {
        this.policy.releaseSubRun(effectiveRootRunId);
      }
      throw err;
    }

    if (parentRunId && effectiveRootRunId && ticket.result) {
      const rootId = effectiveRootRunId;
      ticket.result = ticket.result.finally(() => {
        this.policy.releaseSubRun(rootId);
      });
    }

    return ticket;
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    for (const app of this.listApps()) {
      const record = await app.getRun(runId);
      if (record) return record;
    }
    return undefined;
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    for (const app of this.listApps()) {
      const res = await app.cancelRun(runId, reason);
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
    for (const app of this.listApps()) {
      if (app.executionService?.getActiveHandle?.(runId)) {
        return app.events(runId, options);
      }
    }
    for (const app of this.listApps()) {
      const storageRecord = app.storage?.getRun?.(runId);
      if (storageRecord) {
        return app.events(runId, options);
      }
    }
    const firstApp = this.listApps()[0];
    if (firstApp) {
      return firstApp.events(runId, options);
    }
    return (async function* () {})();
  }

  /**
   * 优雅关闭宿主容器。
   * 仅对内部创建的 App 实例执行 close 并安全释放底层资源；
   * 外部传入借用的 App 实例生命周期完全由调用方负责管理，Host 关闭时仅解绑引用并清理自身内部实例。
   */
  async close(options?: { graceMs?: number }): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    const internalApps = Array.from(this.internallyCreatedApps);
    await Promise.all(
      internalApps.map(async (app) => {
        try {
          await app.close(options);
        } catch {
          // 忽略内部 App 关闭异常，确保全部安全释放
        }
      })
    );
    this.internallyCreatedApps.clear();
    this.apps.clear();

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
    if (options.autoLoadCurrentProject !== false) {
      const root = resolveProjectRoot(options, () => findProjectRoot());
      if (root) {
        if (isProjectLockHeld(root)) {
          const err: any = new Error(
            "PROJECT_BUSY: Project directory is locked by another active process holding project.lock"
          );
          err.code = PROJECT_BUSY;
          throw err;
        }
        // 依据事务日志恢复未完成提交的悬空事务（锁持有者存活时严禁判定为崩溃事务并禁止自动恢复）
        if (hasPendingTransactions(root)) {
          await recoverPendingTransactions(root, { frozenInstall: true });
        }
      }
    }

    createdHost = new DefaultActionDockHost(options);
    return createdHost;
  } catch (err) {
    if (createdHost) {
      try {
        await createdHost.close();
      } catch {
        // 忽略宿主关闭异常
      }
    }
    throw err;
  }
}
