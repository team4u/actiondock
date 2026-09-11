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
import { ActionResolver } from "../catalog/action-resolver";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { ActionPackageResolver } from "../project/resolver";
import { hasPendingTransactions, recoverPendingTransactions } from "../project/transactions";
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
  UNDECLARED_ACTION_DEPENDENCY,
} from "../errors";
import { DataDirLock } from "../storage/data-dir-lock";
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
  private apps = new Map<string, ActionDockApp>();
  private activeSubRunsPerRoot = new Map<string, number>();
  private hostPublicPackageIds = new Set<string>();
  private resolver?: ActionPackageResolver;
  private maxCallDepth: number;
  private maxSubRuns: number;
  private eventSink: EventSink;
  private isClosed = false;
  private dataDirLock?: DataDirLock;
  private failedLinkedPackages = new Map<string, { path: string; error: string }>();

  constructor(options: ActionDockHostOptions = {}) {
    this.hostSessionId = randomUUID();
    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
    this.eventSink = options.eventSink ?? (options.platform as any)?.eventSink ?? new InMemoryEventSink();

    // 当指定非内存 dataDir 时获取排他目录锁，防止并发冲突
    if (options.dataDir && !options.inMemory) {
      this.dataDirLock = DataDirLock.acquire(options.dataDir, {
        hostSessionId: this.hostSessionId,
      });
    }

    // 注册显式传入的 packages 列表
    if (options.packages && Array.isArray(options.packages)) {
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
            packageContextResolver: this.resolvePackageContext.bind(this),
          });
          this.registerAppInternal(app, true);
        }
      }
    }

    // 自动加载当前工程（若发现工程根目录且未显式禁用）
    if (options.autoLoadCurrentProject !== false) {
      let root = options.projectRoot;
      if (!root) {
        const detected = findProjectRoot();
        if (detected) {
          root = detected;
        }
      }

      if (root && existsSync(root)) {
        // 依据事务日志恢复未完成提交的悬空事务
        if (hasPendingTransactions(root)) {
          recoverPendingTransactions(root);
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
                packageContextResolver: this.resolvePackageContext.bind(this),
              });
              this.registerAppInternal(app, isDirectOrRoot);
            }
          }
        } catch (err: any) {
          if (
            err?.code === ACTION_PACKAGE_VERSION_CONFLICT ||
            err?.code === "PROJECT_RECOVERY_REQUIRED"
          ) {
            throw err;
          }
          // 忽略非 ActionDock 工程目录解析异常
        }
      }
    }

    // 扫描已软链接的外部包并注册至 Host
    if (options.scanLinkedPackages) {
      for (const linked of listLinkedPackages(options.customHome)) {
        if (!this.apps.has(linked.id)) {
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
              packageContextResolver: this.resolvePackageContext.bind(this),
            });
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
    };
  }

  private bindApp(app: ActionDockApp): void {
    const runner = app.executionService?.runner;
    if (runner && typeof runner.setPackageContextResolver === "function") {
      runner.setPackageContextResolver(this.resolvePackageContext.bind(this));
    }
  }

  getApp(packageId: string): ActionDockApp | undefined {
    return this.apps.get(packageId);
  }

  listApps(): ActionDockApp[] {
    return Array.from(this.apps.values());
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

    // 接管与恢复：自动将死亡会话或遗留非终态运行收敛为 interrupted
    const st = app.storage;
    if (st && typeof st.recoverDeadSessionRuns === "function") {
      try {
        st.recoverDeadSessionRuns(this.hostSessionId);
      } catch {
        // 忽略单包恢复异常
      }
    } else if (st && typeof st.recoverRunningRuns === "function") {
      try {
        st.recoverRunningRuns(this.hostSessionId);
      } catch {
        // 忽略单包恢复异常
      }
    }
  }

  registerApp(app: ActionDockApp): void {
    this.registerAppInternal(app, true);
  }

  async info(): Promise<PackageInfo[]> {
    return Promise.all(this.listApps().map((app) => app.info()));
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    let results: ActionSummary[] = [];
    const apps = this.listApps();
    for (const app of apps) {
      const isPublic = this.hostPublicPackageIds.has(app.packageId);
      const appSummaries = await app.listActions();
      for (const item of appSummaries) {
        if (!isPublic && this.resolver && !this.resolver.canRootCall(app.packageId, item.id)) {
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
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch {
      parsed = typeof ref === "object" ? ref : { actionId: ref };
    }

    if (parsed.packageId) {
      const isPublic = this.hostPublicPackageIds.has(parsed.packageId);
      if (!isPublic && this.resolver && !this.resolver.canRootCall(parsed.packageId, parsed.actionId)) {
        throw new Error(
          `UNDECLARED_ACTION_DEPENDENCY: Action '${parsed.packageId}/${parsed.actionId}' is not declared as a direct dependency in actiondock.json and is not delegated by a visible playbook`
        );
      }
      const app = this.getApp(parsed.packageId);
      if (!app) {
        const failed = this.failedLinkedPackages.get(parsed.packageId);
        if (failed) {
          throw new Error(
            `Package '${parsed.packageId}' not found in host (failed to load from '${failed.path}': ${failed.error})`
          );
        }
        throw new Error(`Package '${parsed.packageId}' not found in host`);
      }
      return app.describeAction(parsed.actionId);
    }

    const matches: Array<{ app: ActionDockApp; spec: ActionSpec }> = [];
    for (const app of this.listApps()) {
      try {
        const isPublic = this.hostPublicPackageIds.has(app.packageId);
        if (!isPublic && this.resolver && !this.resolver.canRootCall(app.packageId, parsed.actionId)) {
          continue;
        }
        const spec = await app.describeAction(parsed.actionId);
        matches.push({ app, spec });
      } catch {
        // 忽略未匹配的包
      }
    }

    if (matches.length === 1) {
      return matches[0].spec;
    }
    if (matches.length > 1) {
      const candidates = matches.map((m) => `${m.app.packageId}/${parsed.actionId}`).join(", ");
      const err = new Error(
        `INVALID_ACTION_REF: Action '${parsed.actionId}' is ambiguous and provided by multiple packages: ${candidates}. Please specify '<package-id>/${parsed.actionId}'. (AMBIGUOUS_ACTION_REF)`
      );
      (err as any).code = "INVALID_ACTION_REF";
      (err as any).details = { alias: "AMBIGUOUS_ACTION_REF", candidates: matches.map((m) => m.app.packageId) };
      throw err;
    }

    throw new Error(`ACTION_NOT_FOUND: Action '${parsed.actionId}' not found in any registered package`);
  }

  async listPlaybooks(): Promise<PlaybookSummary[]> {
    const results: PlaybookSummary[] = [];
    const apps = this.listApps();
    for (const app of apps) {
      const isPublic = this.hostPublicPackageIds.has(app.packageId);
      if (!isPublic && this.resolver) {
        const graph = this.resolver.resolveSync();
        if (!graph.directDependencyIds.has(app.packageId)) {
          continue;
        }
      }
      const appPlaybooks = await app.listPlaybooks();
      for (const item of appPlaybooks) {
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
    return results;
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    if (id.includes("/")) {
      const lastSlashIndex = id.lastIndexOf("/");
      const packageId = id.slice(0, lastSlashIndex);
      const playbookId = id.slice(lastSlashIndex + 1);
      const isPublic = this.hostPublicPackageIds.has(packageId);
      if (!isPublic && this.resolver) {
        const graph = this.resolver.resolveSync();
        if (!graph.directDependencyIds.has(packageId)) {
          throw new Error(
            `UNDECLARED_ACTION_DEPENDENCY: Playbook '${id}' belongs to undeclared transitive package '${packageId}'`
          );
        }
      }
      const app = this.getApp(packageId);
      if (!app) {
        throw new Error(`Package '${packageId}' not found in host`);
      }
      return app.describePlaybook(playbookId);
    }

    for (const app of this.listApps()) {
      try {
        const isPublic = this.hostPublicPackageIds.has(app.packageId);
        if (!isPublic && this.resolver) {
          const graph = this.resolver.resolveSync();
          if (!graph.directDependencyIds.has(app.packageId)) {
            continue;
          }
        }
        return await app.describePlaybook(id);
      } catch {
        // 忽略未匹配的包
      }
    }

    throw new Error(`Playbook '${id}' not found in any registered package`);
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
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch {
      parsed = typeof ref === "object" ? ref : { actionId: ref };
    }

    let targetApp: ActionDockApp | undefined;
    let targetActionId = parsed.actionId;
    let targetPackageId = parsed.packageId;

    if (targetPackageId) {
      targetApp = this.getApp(targetPackageId);
      if (!targetApp) {
        const runId = randomUUID();
        const failed = this.failedLinkedPackages.get(targetPackageId);
        const errorMsg = failed
          ? `Package '${targetPackageId}' not found in host (failed to load from '${failed.path}': ${failed.error})`
          : `Package '${targetPackageId}' not found in host`;
        const error: RuntimeError = {
          code: PACKAGE_NOT_FOUND,
          message: errorMsg,
        };
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      }
    } else {
      const matches: ActionDockApp[] = [];
      for (const app of this.listApps()) {
        try {
          const isPublic = this.hostPublicPackageIds.has(app.packageId);
          if (!isPublic && this.resolver && !this.resolver.canRootCall(app.packageId, targetActionId)) {
            continue;
          }
          await app.describeAction(targetActionId);
          matches.push(app);
        } catch {
          // 忽略未找到该 Action 的包
        }
      }

      if (matches.length === 1) {
        targetApp = matches[0];
        targetPackageId = targetApp.packageId;
      } else if (matches.length > 1) {
        const candidates = matches.map((m) => `${m.packageId}/${targetActionId}`).join(", ");
        const runId = randomUUID();
        const error: RuntimeError = {
          code: INVALID_ACTION_REF,
          message: `Action '${targetActionId}' is ambiguous and provided by multiple packages: ${candidates}. Please specify '<package-id>/${targetActionId}'.`,
          details: { alias: "AMBIGUOUS_ACTION_REF", candidates: matches.map((m) => m.packageId) },
        };
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      } else {
        const runId = randomUUID();
        const error: RuntimeError = {
          code: ACTION_NOT_FOUND,
          message: `Action '${targetActionId}' not found in any registered package`,
        };
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
      const isPublic = this.hostPublicPackageIds.has(targetPackageId);
      if (!isPublic && this.resolver && !this.resolver.canRootCall(targetPackageId, targetActionId)) {
        const runId = randomUUID();
        const error: RuntimeError = {
          code: UNDECLARED_ACTION_DEPENDENCY,
          message: `Root call to action '${targetPackageId}/${targetActionId}' is not allowed: package '${targetPackageId}' is not declared as a direct dependency in actiondock.json and is not delegated by a visible playbook`,
          details: {
            target: `${targetPackageId}/${targetActionId}`,
          },
        };
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
                const error: RuntimeError = {
                  code: UNDECLARED_ACTION_DEPENDENCY,
                  message: `Action '${callerPackageId}/${callerActionId}' does not declare dependency on '${targetRef}' in 'uses'`,
                  details: {
                    caller: `${callerPackageId}/${callerActionId}`,
                    target: targetRef,
                    declaredUses: usesList,
                  },
                };
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
          const error: RuntimeError = {
            code: ACTION_CALL_CYCLE,
            message: `Maximum call depth of ${this.maxCallDepth} exceeded`,
            details: { alias: ACTION_MAX_DEPTH_EXCEEDED, reason: "depth_exceeded", maxDepth: this.maxCallDepth },
          };
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
            const error: RuntimeError = {
              code: ACTION_SUBRUN_LIMIT,
              message: `Maximum concurrent sub-runs (${this.maxSubRuns}) reached for root run '${effectiveRootRunId}'`,
              details: { alias: MAX_SUBRUNS_REACHED, limit: this.maxSubRuns },
            };
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

    const ticket = await targetApp.startAction(targetActionId, input, execOptions);

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

  async close(options?: { graceMs?: number }): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    const apps = this.listApps();
    await Promise.all(
      apps.map(async (app) => {
        try {
          await app.close(options);
        } catch {
          // 忽略单个 App 关闭异常，确保全部安全释放
        }
      })
    );

    try {
      this.dataDirLock?.release();
    } catch {
      // 忽略目录排他锁释放异常
    }
  }
}

/**
 * 工厂函数：创建并初始化 ActionDockHost 宿主容器。
 */
export async function createActionDockHost(
  options: ActionDockHostOptions = {}
): Promise<ActionDockHost> {
  return new DefaultActionDockHost(options);
}
