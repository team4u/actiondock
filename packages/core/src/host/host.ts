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
  ActionDockAppOptions,
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
import { listLinkedPackages } from "../registry/registry";
import { InMemoryEventSink, type EventSink } from "../runtime/events";
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
  private apps = new Map<string, ActionDockApp>();
  private activeSubRunsPerRoot = new Map<string, number>();
  private maxCallDepth: number;
  private maxSubRuns: number;
  private eventSink: EventSink;
  private isClosed = false;

  constructor(options: ActionDockHostOptions = {}) {
    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
    this.eventSink = options.eventSink ?? (options.platform as any)?.eventSink ?? new InMemoryEventSink();

    // 1. 注册显式传入的 packages 列表
    if (options.packages && Array.isArray(options.packages)) {
      for (const item of options.packages) {
        if (isActionDockApp(item)) {
          this.registerApp(item);
        } else {
          const app = new DefaultActionDockApp({
            ...item,
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
          this.registerApp(app);
        }
      }
    }

    // 2. 自动加载当前工程（若发现工程根目录且未显式禁用）
    if (options.autoLoadCurrentProject !== false) {
      let root = options.projectRoot;
      if (!root) {
        const detected = findProjectRoot();
        if (detected) {
          root = detected;
        }
      }

      if (root && existsSync(root)) {
        try {
          const config = loadProjectConfig(root);
          if (!this.apps.has(config.id)) {
            const mainApp = new DefaultActionDockApp({
              packageRoot: root,
              projectConfig: config,
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
            this.registerApp(mainApp);
          }
        } catch {
          // 忽略非 ActionDock 工程目录解析异常
        }
      }
    }

    // 3. 扫描已软链接的外部包
    if (options.scanLinkedPackages) {
      try {
        const linked = listLinkedPackages(options.customHome);
        for (const entry of linked) {
          if (!this.apps.has(entry.id) && existsSync(entry.path)) {
            try {
              const linkedApp = new DefaultActionDockApp({
                packageRoot: entry.path,
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
              this.registerApp(linkedApp);
            } catch {
              // 忽略损坏的外部链接包
            }
          }
        }
      } catch {
        // 忽略扫描外部链接包异常
      }
    }
  }

  private resolvePackageContext(packageId: string) {
    const targetApp = this.getApp(packageId);
    if (!targetApp) return undefined;
    return {
      projectRoot: (targetApp as any).packageRoot,
      projectConfig: (targetApp as any).projectConfig,
      storage: targetApp.storage,
      actions: (targetApp as any).actionsMap,
    };
  }

  private bindApp(app: ActionDockApp): void {
    const runner = (app as any).executionService?.runner;
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

  registerApp(app: ActionDockApp): void {
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
    this.bindApp(app);
  }

  async info(): Promise<PackageInfo[]> {
    return Promise.all(this.listApps().map((app) => app.info()));
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    let results: ActionSummary[] = [];
    const apps = this.listApps();
    for (const app of apps) {
      const appSummaries = await app.listActions();
      for (const item of appSummaries) {
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
      const app = this.getApp(parsed.packageId);
      if (!app) {
        throw new Error(`Package '${parsed.packageId}' not found in host`);
      }
      return app.describeAction(parsed.actionId);
    }

    const matches: Array<{ app: ActionDockApp; spec: ActionSpec }> = [];
    for (const app of this.listApps()) {
      try {
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
      throw new Error(
        `AMBIGUOUS_ACTION_REF: Action '${parsed.actionId}' is provided by multiple packages: ${candidates}. Please specify '<package-id>/${parsed.actionId}'.`
      );
    }

    throw new Error(`ACTION_NOT_FOUND: Action '${parsed.actionId}' not found in any registered package`);
  }

  async listPlaybooks(): Promise<PlaybookSummary[]> {
    const results: PlaybookSummary[] = [];
    const apps = this.listApps();
    for (const app of apps) {
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
      const app = this.getApp(packageId);
      if (!app) {
        throw new Error(`Package '${packageId}' not found in host`);
      }
      return app.describePlaybook(playbookId);
    }

    for (const app of this.listApps()) {
      try {
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

    // 1. 解析目标包与 Action 动作标识
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
        const error: RuntimeError = {
          code: "PACKAGE_NOT_FOUND",
          message: `Package '${targetPackageId}' not found in host`,
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
          code: "AMBIGUOUS_ACTION_REF",
          message: `Action '${targetActionId}' is provided by multiple packages: ${candidates}. Please specify '<package-id>/${targetActionId}'.`,
        };
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      } else {
        const runId = randomUUID();
        const error: RuntimeError = {
          code: "ACTION_NOT_FOUND",
          message: `Action '${targetActionId}' not found in any registered package`,
        };
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      }
    }

    // 2. 父子任务血缘关系、调用配额与跨包 uses 声明依赖校验
    let effectiveRootRunId = options.rootRunId;
    const parentRunId = options.parentRunId;

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
              const isAllowed = usesList.some(
                (u) => u === targetRef || u === `${targetPackageId}/*` || u === targetPackageId
              );
              if (!isAllowed) {
                const runId = randomUUID();
                const error: RuntimeError = {
                  code: "UNDECLARED_ACTION_DEPENDENCY",
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
            code: "ACTION_MAX_DEPTH_EXCEEDED",
            message: `Maximum call depth of ${this.maxCallDepth} exceeded`,
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
              code: "MAX_SUBRUNS_REACHED",
              message: `Maximum concurrent sub-runs (${this.maxSubRuns}) reached for root run '${effectiveRootRunId}'`,
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

    // 3. 构造子运行参数并调度至目标 App 执行
    const execOptions: ExecuteOptions = {
      ...options,
      rootRunId: effectiveRootRunId,
      parentRunId,
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
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent> {
    for (const app of this.listApps()) {
      if ((app as any).executionService?.getActiveHandle?.(runId)) {
        return app.events(runId, options);
      }
    }
    for (const app of this.listApps()) {
      const storageRecord = (app as any).storage?.getRun?.(runId);
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
