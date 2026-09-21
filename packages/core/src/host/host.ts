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
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { ActionPackageResolver } from "../project/resolver";
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
import { DataDirLock } from "../storage/data-dir-lock";
import {
  ambiguousActionMessage,
  buildRuntimeError,
  collectPackageInfos,
  describeActionAcrossApps,
  describeVisiblePlaybook,
  isRootCallVisible,
  listVisiblePlaybooks,
  packageNotFoundMessage,
  parseRefLoose,
  resolveProjectRoot,
  resolveShortRef,
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
  private activeSubRunsPerRoot = new Map<string, number>();
  private hostPublicPackageIds = new Set<string>();
  private resolver?: ActionPackageResolver;
  private maxCallDepth: number;
  private maxSubRuns: number;
  private eventSink: EventSink;
  private isClosed = false;
  private dataDirLock?: DataDirLock;
  private failedLinkedPackages = new Map<string, { path: string; error: string }>();
  private failedAutoLoad?: { projectRoot: string; error: string };
  /** 透传给内部创建 App 的存储收割开关（Host 默认持有者身份，显式可关） */
  private recoverOrphans: boolean;

  constructor(options: ActionDockHostOptions = {}) {
    this.hostSessionId = randomUUID();
    this.options = options;
    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
    this.eventSink = options.eventSink ?? (options.platform as any)?.eventSink ?? new InMemoryEventSink();
    // Host 默认声明数据目录持有者身份；查询旁观方（CLI 查询命令）显式置 false
    this.recoverOrphans = options.recoverOrphans !== false;

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
          packageContextResolver: this.resolvePackageContext.bind(this),
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
      this.hostPublicPackageIds.add(config.id);

      this.resolver = new ActionPackageResolver({
        projectRoot: root,
        manifest: config,
        allowDevLinks: options.scanLinkedPackages,
        customHome: options.customHome,
      });

      const graph = this.resolver.resolveSync();
      this.hostPublicPackageIds.add(graph.rootPackageId);
      for (const depId of graph.directDependencyIds) {
        this.hostPublicPackageIds.add(depId);
      }

      for (const pkg of graph.packages.values()) {
        if (!this.apps.has(pkg.packageId)) {
          const isDirectOrRoot = this.hostPublicPackageIds.has(pkg.packageId);
          const app = new DefaultActionDockApp({
            packageRoot: pkg.packageRoot,
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
            packageContextResolver: this.resolvePackageContext.bind(this),
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
          packageContextResolver: this.resolvePackageContext.bind(this),
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

  private resolvePackageContext(packageId: string) {
    const targetApp = this.getApp(packageId);
    if (!targetApp) return undefined;
    return {
      projectRoot: targetApp.packageRoot,
      projectConfig: targetApp.projectConfig,
      storage: targetApp.storage,
      actions: targetApp.actionsMap,
      packageInstanceId: targetApp.packageInstanceId,
      generationId: targetApp.generationId,
    };
  }

  private bindApp(app: ActionDockApp): void {
    const runner = app.executionService?.runner;
    if (runner && typeof runner.setPackageContextResolver === "function") {
      runner.setPackageContextResolver(this.resolvePackageContext.bind(this));
    }
  }

  /** 路由可见性上下文（公开包集合与依赖解析器） */
  private visibility() {
    return {
      hostPublicPackageIds: this.hostPublicPackageIds as ReadonlySet<string>,
      resolver: this.resolver,
    };
  }

  getApp(packageId: string): ActionDockApp | undefined {
    return this.apps.get(packageId);
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
        if (!isRootCallVisible(app.packageId, item.id, this.hostPublicPackageIds, this.resolver)) {
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
    return describeActionAcrossApps(ref, this.listApps(), this.visibility(), this.failedLinkedPackages);
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

    // - 解析目标包与 Action 动作标识
    const parsed = parseRefLoose(ref);

    let targetApp: ActionDockApp | undefined;
    let targetActionId = parsed.actionId;
    let targetPackageId = parsed.packageId;

    if (targetPackageId) {
      targetApp = this.getApp(targetPackageId);
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
    } else {
      const resolution = await resolveShortRef(this.listApps(), targetActionId, this.visibility());
      if (resolution.kind === "unique") {
        targetApp = resolution.app;
        targetPackageId = targetApp.packageId;
      } else if (resolution.kind === "ambiguous") {
        const runId = randomUUID();
        const error: RuntimeError = buildRuntimeError(
          INVALID_ACTION_REF,
          ambiguousActionMessage(targetActionId, resolution.candidates),
          { alias: "AMBIGUOUS_ACTION_REF", candidates: resolution.candidates }
        );
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      } else {
        const runId = randomUUID();
        const error: RuntimeError = buildRuntimeError(
          ACTION_NOT_FOUND,
          `Action '${targetActionId}' not found in any registered package`
        );
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      }
    }

    // 根调用可见性鉴权
    const parentRunId = options.parentRunId;
    if (!parentRunId && targetPackageId) {
      if (!isRootCallVisible(targetPackageId, targetActionId, this.hostPublicPackageIds, this.resolver)) {
 const runId = randomUUID();
const error: RuntimeError = buildRuntimeError(
          UNDECLARED_ACTION_DEPENDENCY,
          `Root call to action '${targetPackageId}/${targetActionId}' is not allowed: package '${targetPackageId}' is not declared as a direct dependency in actiondock.json and is not delegated by a visible playbook`,
          { target: `${targetPackageId}/${targetActionId}` }
        );
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      }
    }

    // - 父子任务血缘关系、调用配额与跨包 uses 声明依赖校验
    let effectiveRootRunId = options.rootRunId;

    if (parentRunId) {
      const parentRun = await this.getRun(parentRunId);
      if (parentRun) {
        effectiveRootRunId = effectiveRootRunId || parentRun.rootRunId || parentRunId;

        // 跨包 uses 依赖声明校验
        const callerPackageId = parentRun.packageId;
        const callerActionId = parentRun.actionId;
        if (callerPackageId && callerPackageId !== targetPackageId) {
          const callerApp = this.getApp(callerPackageId);
          if (callerApp) {
            try {
              const callerSpec = await callerApp.describeAction(callerActionId);
              const usesList = callerSpec.uses || [];
              const targetRef = `${targetPackageId}/${targetActionId}`;
              const isAllowed = this.resolver
                ? this.resolver.canCascadeCall(callerPackageId, callerActionId, targetPackageId, targetActionId)
                : usesList.some(
                    (u) => u === targetRef || u === `${targetPackageId}/*` || u === targetPackageId
                  );
              if (!isAllowed) {
 const runId = randomUUID();
const error: RuntimeError = buildRuntimeError(
                  UNDECLARED_ACTION_DEPENDENCY,
                  `Action '${callerPackageId}/${callerActionId}' does not declare dependency on '${targetRef}' in 'uses'`,
                  {
                    caller: `${callerPackageId}/${callerActionId}`,
                    target: targetRef,
                    declaredUses: usesList,
                  }
                );
                return {
                  runId,
                  status: "failed",
                  result: Promise.resolve({ ok: false, runId, error }),
                };
              }
            } catch {
              // 忽略规范提取异常，交由执行服务执行
            }
          }
        }

        // 调用嵌套深度限制校验
        let depth = 1;
        let cur: RunRecord | undefined = parentRun;
        while (cur && cur.parentRunId) {
          depth++;
          if (depth > this.maxCallDepth) break;
          cur = await this.getRun(cur.parentRunId);
        }
        if (depth >= this.maxCallDepth) {
 const runId = randomUUID();
const error: RuntimeError = buildRuntimeError(
            ACTION_CALL_CYCLE,
            `Maximum call depth of ${this.maxCallDepth} exceeded`,
            { alias: ACTION_MAX_DEPTH_EXCEEDED, reason: "depth_exceeded", maxDepth: this.maxCallDepth }
          );
          return {
            runId,
            status: "failed",
            result: Promise.resolve({ ok: false, runId, error }),
          };
        }

        // 针对根运行的并发子任务数限制校验
        if (effectiveRootRunId) {
          const currentSubRuns = this.activeSubRunsPerRoot.get(effectiveRootRunId) || 0;
          if (currentSubRuns >= this.maxSubRuns) {
 const runId = randomUUID();
const error: RuntimeError = buildRuntimeError(
              ACTION_SUBRUN_LIMIT,
              `Maximum concurrent sub-runs (${this.maxSubRuns}) reached for root run '${effectiveRootRunId}'`,
              { alias: MAX_SUBRUNS_REACHED, limit: this.maxSubRuns }
            );
            return {
              runId,
              status: "failed",
              result: Promise.resolve({ ok: false, runId, error }),
            };
          }
        }
      }
    }

    // - 构造子运行参数并调度至目标 App 执行
    const execOptions: ExecuteOptions = {
      ...options,
      rootRunId: effectiveRootRunId,
      parentRunId,
      hostSessionId: this.hostSessionId,
      maxCallDepth: options.maxCallDepth ?? this.maxCallDepth,
    };

    if (parentRunId && effectiveRootRunId) {
      this.activeSubRunsPerRoot.set(
        effectiveRootRunId,
        (this.activeSubRunsPerRoot.get(effectiveRootRunId) || 0) + 1
      );
    }

    let ticket: ExecutionTicket;
    try {
      ticket = await targetApp.startAction(targetActionId, input, execOptions);
    } catch (err) {
      // 启动失败（并发上限、仓储不可用、幂等冲突等）时必须回滚配额计数，避免泄漏后误拒后续合法子任务
      if (parentRunId && effectiveRootRunId) {
        const cnt = this.activeSubRunsPerRoot.get(effectiveRootRunId) || 1;
        if (cnt <= 1) {
          this.activeSubRunsPerRoot.delete(effectiveRootRunId);
        } else {
          this.activeSubRunsPerRoot.set(effectiveRootRunId, cnt - 1);
        }
      }
      throw err;
    }

    if (parentRunId && effectiveRootRunId && ticket.result) {
      const rootId = effectiveRootRunId;
      ticket.result = ticket.result.finally(() => {
        const cnt = this.activeSubRunsPerRoot.get(rootId) || 1;
        if (cnt <= 1) {
          this.activeSubRunsPerRoot.delete(rootId);
        } else {
          this.activeSubRunsPerRoot.set(rootId, cnt - 1);
        }
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
