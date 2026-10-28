import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  ActionInvokeOptions,
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
  RuntimeError,
} from "@actiondock/sdk";
import { DefaultPackageRuntime } from "../package/runtime";
import { applyActionSummaryFilters } from "../package/types";
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
  type LocalPackagePreparer,
  type RunOptions,
} from "../invocation/types";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { hasPendingTransactions, isProjectLockHeld, recoverPendingTransactions } from "../project/transactions";
import { listLinkedPackages } from "../registry/registry";
import { InMemoryEventSink, type EventSink } from "../runtime/events";
import { snapshotRunOrigin } from "../runtime/run-origin";
import {
  ActionDockError,
  ACTION_CANCELLED,
  ACTION_NOT_FOUND,
  ACTION_PACKAGE_VERSION_CONFLICT,
  ACTION_SUBRUN_LIMIT,
  ACTION_TIMEOUT,
  EXECUTION_FAILED,
  INVALID_ACTION_REF,
  PACKAGE_ID_CONFLICT,
  PACKAGE_NOT_FOUND,
  PROJECT_BUSY,
  PROJECT_RECOVERY_REQUIRED,
  SERVICE_CLOSED,
  UNDECLARED_ACTION_DEPENDENCY,
  type ErrorCode,
} from "../errors";
import { InvocationPolicy } from "../invocation/policy";
import {
  loadActionBindings,
  resolveActionBinding,
  validateActionBindings,
  type ActionBindings,
} from "../invocation/bindings";
import { RemoteInvocationExecutor } from "../invocation/remote";
import { resolveTarget } from "../profile/manager";
import { createAbortError } from "../ipc/service";
import { DataDirLock } from "../storage/data-dir-lock";
import {
  DefaultActionCatalog,
  DefaultPackageGraph,
  PackageGraphBuilder,
  resolveAction,
  type ActionCatalog,
  type DiscoveredPackage,
  type PackageGraph,
  type ResolvedAction,
} from "../catalog";
import { parseActionRef } from "../catalog/resolve-action";
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
import type { ActionDockHost, ActionDockHostOptions, HostEventsPort } from "./types";
import type {
  RemoteServiceOptions,
  ConfigPort,
  ConfigValueView,
  DiscoveryPort,
  ExecutionPort,
  ListRunsOptions,
  RunEventSubscriptionOptions,
  RunsPort,
  StatePort,
  StateScopeOptions,
} from "../service/types";
import { CAPABILITY_UNAVAILABLE } from "../errors";
import { createGlobalStorage, redactConfigValueAtPaths, redactConfigValueForDeclarations } from "../storage";
import type { RuntimeStorage, StateEntry } from "../storage/types";
import type { ConfigItemDefinition } from "../project/types";
import { filterByIntent } from "../utils/intent";
import {
  assertConcreteConfigKey,
  isConfigTemplate,
  resolveConfigDeclaration,
  validateConfigValue,
} from "../project/config-declarations";

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

/** 并发解析运行记录归属包（公共端口查询，不新建执行服务） */
async function findRunOwnerRuntime(
  runtimes: readonly PackageRuntime[],
  runId: string
): Promise<PackageRuntime | undefined> {
  const results = await Promise.all(
    runtimes.map(async (rt) => ({ rt, record: await rt.getRun(runId).catch(() => undefined) }))
  );
  return results.find((r) => r.record !== undefined)?.rt;
}

/**
 * 包装异步操作以响应 AbortSignal 取消信号。
 * 若信号已中止立即抛出 AbortError，否则挂载一次性中止监听并在操作完成时注销。
 */
function withAbortSignal<T>(op: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }
  if (!signal) {
    return op();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    op().then(
      (res) => {
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

function isActionTimeoutReason(reason: unknown): boolean {
  if (!reason) return false;
  const code = (reason as any)?.code;
  if (code === ACTION_TIMEOUT) return true;
  if ((reason as any)?.details?.code === ACTION_TIMEOUT) return true;
  return false;
}

export class DefaultActionDockHost implements ActionDockHost {
  public readonly hostSessionId: string;
  public readonly options: ActionDockHostOptions;
  public readonly allowInstall?: boolean;
  private runtimes = new Map<string, PackageRuntime>();
  private extraRuntimes = new Set<PackageRuntime>();
  private extraRuntimeScopes = new Map<PackageRuntime, string>();
  public readonly policy: InvocationPolicy;
  private hostPublicPackageIds = new Set<string>();
  private maxCallDepth: number;
  private maxSubRuns: number;
  private eventSink: EventSink;
  private isClosed = false;
  private readonly prepareLocalPackage?: LocalPackagePreparer;
  private readonly closeController = new AbortController();
  private readonly activePreparations = new Set<Promise<void>>();
  private closePromise?: Promise<void>;
  private dataDirLock?: DataDirLock;
  private failedLinkedPackages = new Map<string, { path: string; error: string }>();
  private failedAutoLoad?: { projectRoot: string; error: string };
  /** 透传给内部创建 Runtime 的存储收割开关（Host 默认持有者身份，显式可关） */
  private recoverOrphans: boolean;
  private graph: PackageGraph;
  private catalog: ActionCatalog;
  private globalStorage?: RuntimeStorage;
  private initPromise?: Promise<void>;
  private isInitialized = false;
  private readonly actionBindings = new Map<string, ActionBindings>();
  private readonly remoteTargets = new Map<string, RemoteServiceOptions>();
  private readonly remoteInvoker: RemoteInvocationExecutor;

  public readonly discovery: DiscoveryPort;
  public readonly execution: ExecutionPort;
  public readonly runs: RunsPort;
  public readonly events: HostEventsPort;
  public readonly management?: {
    config: ConfigPort;
    state: StatePort;
  };

  /** 自引用 host 属性，向后兼容服务实例字段访问 */
  public get host(): ActionDockHost {
    return this;
  }

  /**
   * @deprecated 直接使用 new DefaultActionDockHost() 构造已弃用，请迁移至 createActionDockHost() 异步工厂函数以完成完整的生命周期初始化。
   */
  constructor(options: ActionDockHostOptions = {}, internalOptions?: { fromFactory?: boolean }) {
    if (!internalOptions?.fromFactory) {
      const warnMsg =
        "[Host] Direct instantiation via new DefaultActionDockHost() is @deprecated and only performs minimal object assembly. Use createActionDockHost() for full lifecycle initialization.";
      if (options.logger?.warn) {
        options.logger.warn(warnMsg);
      } else {
        console.warn(warnMsg);
      }
    }

    this.hostSessionId = randomUUID();
    this.options = options;
    this.allowInstall = options.allowInstall;
    this.prepareLocalPackage = options.prepareLocalPackage;
    this.remoteInvoker = new RemoteInvocationExecutor({ logger: options.logger });
    this.maxCallDepth = options.maxCallDepth ?? 16;
    this.maxSubRuns = options.maxSubRuns ?? 64;
    this.policy = new InvocationPolicy({
      maxCallDepth: this.maxCallDepth,
      maxSubRuns: this.maxSubRuns,
    });
    this.eventSink = options.eventSink ?? options.platform?.eventSink ?? new InMemoryEventSink();
    // Host 默认声明数据目录持有者身份；查询旁观方（CLI 查询命令）显式置 false
    this.recoverOrphans = options.recoverOrphans !== false;
    this.graph = new DefaultPackageGraph(new Map());
    this.catalog = new DefaultActionCatalog(this.graph);

    const self = this;

    this.discovery = {
      async listPackages(): Promise<PackageInfo[]> {
        await self.ensureInitialized();
        return self.info();
      },

      async listActions(opts?: ListActionsOptions): Promise<ActionSummary[]> {
        await self.ensureInitialized();
        return self.listActions(opts);
      },

      async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
        await self.ensureInitialized();
        return self.describeAction(ref);
      },

      async listPlaybooks(opts?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
        await self.ensureInitialized();
        return self.listPlaybooks(opts);
      },

      async describePlaybook(id: string): Promise<PlaybookSpec> {
        await self.ensureInitialized();
        return self.describePlaybook(id);
      },
    };

    this.execution = {
      async run(
        ref: ActionRef | string,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionResult> {
        const origin = snapshotRunOrigin(opts?.origin);
        await self.ensureInitialized();
        const actionRef: ActionRef = typeof ref === "string" ? parseActionRef(ref) : ref;
        const cleanOpts: RunOptions = {
          signal: opts?.signal,
          timeoutMs: opts?.timeoutMs,
          config: opts?.config,
          requestId: opts?.requestId,
          origin,
        };
        return self.runAction(actionRef, (input ?? {}) as JsonValue, cleanOpts);
      },

      async start(
        ref: ActionRef | string,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionTicket> {
        const origin = snapshotRunOrigin(opts?.origin);
        await self.ensureInitialized();
        const actionRef: ActionRef = typeof ref === "string" ? parseActionRef(ref) : ref;
        const cleanOpts: RunOptions = {
          signal: opts?.signal,
          timeoutMs: opts?.timeoutMs,
          config: opts?.config,
          requestId: opts?.requestId,
          origin,
        };
        return self.startAction(actionRef, (input ?? {}) as JsonValue, cleanOpts);
      },
    };

    this.runs = {
      async list(query?: ListRunsOptions, options?: import("../service/types").RunReadOptions): Promise<RunRecord[]> {
        await self.ensureInitialized();
        const effectiveSignal = options?.signal ?? query?.signal;
        return withAbortSignal(() => self.listRuns(query, effectiveSignal), effectiveSignal);
      },

      async count(query?: ListRunsOptions, options?: import("../service/types").RunReadOptions): Promise<number> {
        await self.ensureInitialized();
        const effectiveSignal = options?.signal ?? query?.signal;
        return withAbortSignal(() => self.countRuns(query, effectiveSignal), effectiveSignal);
      },

      async get(runId: string, options?: import("../service/types").RunReadOptions): Promise<RunRecord | undefined> {
        await self.ensureInitialized();
        const effectiveSignal = options?.signal;
        return withAbortSignal(() => self.getRun(runId, effectiveSignal), effectiveSignal);
      },

      async cancel(runId: string, reason?: string): Promise<CancelResult> {
        await self.ensureInitialized();
        return self.cancelRun(runId, reason);
      },

      async clear(opts?: { packageId?: string; actionId?: string; status?: string; olderThanMs?: number; keep?: number }): Promise<number> {
        await self.ensureInitialized();
        return self.clearRuns(opts);
      },

      async cleanExpired(policy?: import("../storage/types").RunsRetentionPolicy): Promise<number> {
        await self.ensureInitialized();
        return self.cleanExpiredRuns(policy);
      },
    };

    const eventsFn = ((
      runId: string,
      opts?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
    ): AsyncIterable<ExecutionEvent> => {
      return (async function* () {
        await self.ensureInitialized();
        yield* self.subscribeEvents(runId, opts);
      })();
    }) as HostEventsPort;

    eventsFn.events = (
      runId: string,
      opts?: RunEventSubscriptionOptions
    ): AsyncIterable<ExecutionEvent> => {
      return (async function* () {
        await self.ensureInitialized();
        yield* self.subscribeEvents(runId, opts);
      })();
    };

    this.events = eventsFn;

    if (options.enableManagement !== false) {
      this.management = {
        config: {
          async get(packageId: string, key: string): Promise<ConfigValueView> {
            await self.ensureInitialized();
            return self.getConfig(packageId, key);
          },

          async set(packageId: string, key: string, value: JsonValue): Promise<void> {
            await self.ensureInitialized();
            return self.setConfig(packageId, key, value);
          },

          async delete(packageId: string, key: string): Promise<boolean> {
            await self.ensureInitialized();
            return self.deleteConfig(packageId, key);
          },

          async list(packageId: string): Promise<ConfigValueView[]> {
            await self.ensureInitialized();
            return self.listConfig(packageId);
          },
        },

        state: {
          async get<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<T | undefined> {
            await self.ensureInitialized();
            return self.getState<T>(packageId, actionId, key, opts);
          },

          async set<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            value: T,
            opts?: StateScopeOptions
          ): Promise<void> {
            await self.ensureInitialized();
            return self.setState<T>(packageId, actionId, key, value, opts);
          },

          async delete(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<boolean> {
            await self.ensureInitialized();
            return self.deleteState(packageId, actionId, key, opts);
          },

          async list(
            packageId: string,
            actionId?: string,
            opts?: StateScopeOptions
          ): Promise<string[]> {
            await self.ensureInitialized();
            return self.listStateKeys(packageId, actionId, opts);
          },

          async clear(
            packageId: string,
            actionId?: string,
            opts?: StateScopeOptions
          ): Promise<number> {
            await self.ensureInitialized();
            return self.clearState(packageId, actionId, opts);
          },

          async listEntries(
            packageId: string,
            opts?: any
          ): Promise<StateEntry[]> {
            await self.ensureInitialized();
            return self.listStateEntries(packageId, opts);
          },
        },
      };
    }

  }

  /**
   * 静态工厂方法：创建并初始化 ActionDockHost 宿主容器。
   */
  public static async create(
    options: ActionDockHostOptions = {}
  ): Promise<ActionDockHost> {
    let createdHost: DefaultActionDockHost | undefined;
    try {
      createdHost = new DefaultActionDockHost(options, { fromFactory: true });
      await createdHost.ensureInitialized();
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

  /**
   * 确保宿主容器已完成异步生命周期初始化。
   * 当通过 ActionDockHost.create() / createActionDockHost() 创建时在工厂阶段预先就绪；
   * 当直接通过 new DefaultActionDockHost() 构造时，在首次异步调用时惰性触发加载。
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    if (this.isClosed) {
      throw new ActionDockError(SERVICE_CLOSED, "ActionDockHost is closed");
    }
    if (!this.initPromise) {
      this.initPromise = this.performInitialization();
    }
    await this.initPromise;
  }

  private async performInitialization(): Promise<void> {
    try {
      // 当指定非内存 dataDir 且以持有者身份打开时获取排他目录锁，防止并发冲突；
      // 旁观 Host（recoverOrphans: false）不获取执行宿主的排他锁，也不创建数据目录
      if (
        this.options.dataDir &&
        !this.options.inMemory &&
        this.recoverOrphans &&
        !this.dataDirLock
      ) {
        this.dataDirLock = DataDirLock.acquire(this.options.dataDir, {
          hostSessionId: this.hostSessionId,
        });
      }

      // 阶段一：注册显式传入的 packages 列表（仅建立身份与路由，不打开资源）
      this.registerExplicitPackages(this.options);

      // 阶段二：自动加载当前工程（若发现工程根目录且未显式禁用）
      if (this.options.autoLoadCurrentProject !== false) {
        await this.loadCurrentProject(this.options);
      }

      // 阶段三：扫描已软链接的外部包并注册至 Host（仅建立身份与路由）
      if (this.options.scanLinkedPackages) {
        this.registerLinkedPackages(this.options);
      }

      this.rebuildGraphAndCatalog();

      // 阶段四：持有者身份在工厂返回前显式预热全部内部包的存储与运行记录恢复；
      // 旁观身份（recoverOrphans: false）跳过预热，首次持久化调用时才按需打开
      if (this.recoverOrphans) {
        await this.prewarmManagedRuntimes();
      }

      this.isInitialized = true;
    } catch (err) {
      this.initPromise = undefined;
      try {
        await this.rollbackInitialization();
      } catch {
        // 吞没回滚自身的副错误以确保向上抛出原始的初始化异常
      }
      throw err;
    }
  }

  /**
   * 持有者预热：等待内部创建的全部包完成存储准备（含运行记录恢复），
   * 并打开共享全局存储。预热的是存储，不是执行服务、进程接口或业务模块；
   * 任一包准备失败按既有初始化失败时机整体回滚。
   * 外部注入的 Runtime 保持既有生命周期约定，不在此预热。
   */
  private async prewarmManagedRuntimes(): Promise<void> {
    const managed = Array.from(this.runtimes.values()).filter(
      (rt) => rt instanceof DefaultPackageRuntime
    ) as DefaultPackageRuntime[];
    if (managed.length === 0) {
      return;
    }
    await Promise.all(managed.map((rt) => rt.prepareResources()));
    // 持有者在返回前打开共享全局存储，保留对全局库存储错误的提前发现能力
    this.getGlobalStorage();
  }

  /** 返回的 Runtime 由 Host 统一接管，端口只清理自身缓存和附属资源。 */
  private async closeInvocationTargets(): Promise<unknown[]> {
    const extras = Array.from(this.extraRuntimes).filter(
      (runtime) => this.runtimes.get(runtime.packageId) !== runtime
    );
    this.extraRuntimes.clear();
    this.extraRuntimeScopes.clear();
    const results = await Promise.allSettled(extras.map((runtime) => runtime.close()));
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    try {
      await this.options.platform?.invocationTargets?.close?.();
    } catch (error) {
      errors.push(error);
    }
    return errors;
  }

  /**
   * 异步安全回滚初始化失败时所占用的资源。
   */
  public async rollbackInitialization(): Promise<void> {
    this.isInitialized = false;
    this.initPromise = undefined;
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
    const invocationCloseErrors = await this.closeInvocationTargets();
    this.runtimes.clear();
    this.actionBindings.clear();
    this.remoteTargets.clear();
    await this.remoteInvoker.close();

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
    if (invocationCloseErrors.length) throw new AggregateError(invocationCloseErrors, "Invocation target cleanup failed");
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
          globalStorage: (packageOptions as any).globalStorage,
          globalStorageProvider: () => this.getGlobalStorage(),
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
  private async loadCurrentProject(options: ActionDockHostOptions): Promise<void> {
    const explicitRoot = options.projectRoot;
    const root = resolveProjectRoot(options, () => findProjectRoot());
    if (!root) {
      return;
    }

    if (isProjectLockHeld(root)) {
      throw new ActionDockError(
        PROJECT_BUSY,
        "PROJECT_BUSY: Project directory is locked by another active process holding project.lock"
      );
    }
    if (hasPendingTransactions(root)) {
      // 旁观路径（recoverOrphans: false）不自动恢复待恢复事务：
      // 不触发依赖安装或清单回滚，直接报告恢复需求，由持有者入口完成恢复
      if (!this.recoverOrphans) {
        throw new ActionDockError(
          PROJECT_RECOVERY_REQUIRED,
          `PROJECT_RECOVERY_REQUIRED: Project at '${root}' has pending transactions requiring recovery. Run an owner command (e.g. 'ad add' or 'ad run') to complete recovery before querying.`
        );
      }
      if (this.allowInstall === false || process.env.ACTIONDOCK_AUTO_INSTALL === "false") {
        throw new ActionDockError(
          PROJECT_RECOVERY_REQUIRED,
          `PROJECT_RECOVERY_REQUIRED: Project at '${root}' has pending transactions requiring recovery install, but installation is disabled (--no-install or ACTIONDOCK_AUTO_INSTALL=false).`
        );
      }
      await recoverPendingTransactions(root, { frozenInstall: true, allowInstall: this.allowInstall });
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
            globalStorageProvider: () => this.getGlobalStorage(),
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
          globalStorageProvider: () => this.getGlobalStorage(),
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
      context: InvocationContext,
      options?: ActionInvokeOptions
    ): Promise<unknown> => {
      if (this.isClosed) throw new ActionDockError(SERVICE_CLOSED, "ActionDockHost is closed");
      if (context.signal.aborted) throw new ActionDockError(ACTION_CANCELLED, "Caller invocation is cancelled");
      const parsed = parseActionRef(childAction);
      // 裸引用仍由既有解析器消歧；远端专属依赖须使用完全限定引用。
      const localResolved = parsed.packageId ? undefined : resolveAction(childAction, {
        caller: callerRuntime.packageId,
        graph: this.graph,
        catalog: this.catalog,
      });
      const targetPackageId = parsed.packageId ?? localResolved!.package.id;
      const targetActionId = parsed.actionId;
      const canonicalRef = `${targetPackageId}/${targetActionId}`;
      const canonicalActionRef = { packageId: targetPackageId, actionId: targetActionId };
      const callerBindings = this.actionBindings.get(callerRuntime.packageId) ?? {};
      const isNamedTarget = Boolean(options?.binding && options.binding !== "default");

      // 目标装配是同步解析，不在此引入另一条执行或网络调用链。
      const targetOverride = this.options.platform?.invocationTargets?.resolve(
        canonicalActionRef,
        options,
        {
          packageId: callerRuntime.packageId,
          actionId: context.caller?.actionId,
        }
      );

      let targetRuntime: PackageRuntime | undefined;
      let targetScope: string | undefined;
      let isRemote = false;
      let remoteProfile: string | undefined;

      if (targetOverride) {
        if (targetOverride.runtime.packageId !== targetPackageId) {
          throw new ActionDockError(
            INVALID_ACTION_REF,
            `Invocation target packageId mismatch: expected '${targetPackageId}', got '${targetOverride.runtime.packageId}'`
          );
        }
        targetRuntime = targetOverride.runtime;
        this.extraRuntimes.add(targetRuntime);
        this.bindRuntime(targetRuntime);
        targetScope = targetOverride.scope ?? (isNamedTarget ? `binding:${options?.binding}` : undefined);
        if (targetScope) this.extraRuntimeScopes.set(targetRuntime, targetScope);
      } else {
        // 没有绑定的旧调用不引入额外的清单命名约束，保持编程式 Runtime 兼容。
        const binding = options?.binding !== undefined || Object.hasOwn(callerBindings, canonicalRef)
          ? resolveActionBinding(callerBindings, canonicalRef, options?.binding)
          : undefined;
        if (binding?.type === "remote") {
          isRemote = true;
          remoteProfile = binding.profile;
          targetScope = `profile:${binding.profile}`;
        } else {
          isRemote = false;
          if (!localResolved) {
            resolveAction(childAction, { caller: callerRuntime.packageId, graph: this.graph, catalog: this.catalog });
          }
          const isLogicalSamePackage = targetPackageId === callerRuntime.packageId;
          targetRuntime = isLogicalSamePackage ? callerRuntime : this.getRuntime(targetPackageId);
          if (targetRuntime) targetScope = this.extraRuntimeScopes.get(targetRuntime);
          if (!targetRuntime) {
            throw new ActionDockError(PACKAGE_NOT_FOUND, packageNotFoundMessage(targetPackageId, this.failedLinkedPackages));
          }
        }
      }

      const isLogicalSamePackage = targetPackageId === callerRuntime.packageId;
      const isPhysicalSameRuntime = Boolean(targetRuntime && targetRuntime === callerRuntime);
      const requiresExplicitUses = Boolean(
        isRemote ||
        targetOverride?.requiresExplicitUses ||
        (isNamedTarget && targetOverride !== undefined)
      );

      // 跨包 uses 依赖声明校验（统一委托 InvocationPolicy 单一事实源）
      if (!isLogicalSamePackage || requiresExplicitUses) {
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
          {
            packageId: targetPackageId,
            actionId: targetActionId,
            requiresExplicitUses,
          },
          this.graph
        );
        if (authErr) {
          const hint = (authErr.details as any)?.hint;
          const msg = hint ? `${authErr.message}\n${hint}` : authErr.message;
          throw new ActionDockError(authErr.code, msg, authErr.details, undefined, hint);
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
        callerRuntime.packageId,
        targetScope
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
        if (isRemote) {
          const candidate = this.catalog.find({ packageId: targetPackageId, actionId: targetActionId })[0];
          return await this.remoteInvoker.invoke(
            this.remoteTargets.get(remoteProfile!)!,
            { packageId: targetPackageId, actionId: targetActionId },
            childInput,
            { ...context, callStack: nextCallStack },
            { binding: options?.binding ?? "default", profile: remoteProfile! },
            candidate?.contract
          );
        }
        const targetOwner = context.owner
          ? {
              tenantId: context.owner.tenantId,
              principalId: context.owner.principalId,
              packageInstanceId: isPhysicalSameRuntime
                ? (context.owner.packageInstanceId || callerRuntime.identity.instanceId)
                : targetRuntime!.identity.instanceId,
              generationId: isPhysicalSameRuntime
                ? (context.owner.generationId || callerRuntime.identity.generation)
                : targetRuntime!.identity.generation,
            }
          : undefined;

        const subInvocationContext: InvocationContext = {
          runId: context.runId,
          rootRunId: context.rootRunId,
          parentRunId: context.parentRunId,
          caller: context.caller,
          callStack: nextCallStack,
          targetScope,
          package: targetRuntime!.identity,
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
          origin: context.origin,
        };

        const ticket = await this.dispatchLocalInvocation(
          targetRuntime!,
          targetActionId,
          childInput,
          subInvocationContext
        );
        if (!ticket.result) {
          throw new ActionDockError(EXECUTION_FAILED, `Execution ticket for run '${ticket.runId}' has no result Promise`);
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

  listRuntimes(): PackageRuntime[] {
    return Array.from(this.runtimes.values());
  }

  private registerRuntimeInternal(runtime: PackageRuntime, isPublic: boolean): void {
    if (this.runtimes.has(runtime.packageId)) {
      const existing = this.runtimes.get(runtime.packageId)!;
      if (existing === runtime) {
        return;
      }
      throw new ActionDockError(
        PACKAGE_ID_CONFLICT,
        `Package ID conflict: package '${runtime.packageId}' is already registered in host`
      );
    }
    const explicitBindings = this.options.actionBindings;
    const bindings = explicitBindings && Object.hasOwn(explicitBindings, runtime.packageId)
      ? validateActionBindings(explicitBindings[runtime.packageId])
      : runtime.packageRoot ? loadActionBindings(runtime.packageRoot) : validateActionBindings({});
    for (const group of Object.values(bindings)) {
      for (const target of Object.values(group)) {
        if (target.type !== "remote" || this.remoteTargets.has(target.profile)) continue;
        const resolved = resolveTarget({ profile: target.profile }, this.options.customHome);
        if (resolved.type !== "remote" || !resolved.serverUrl) {
          throw new ActionDockError(INVALID_ACTION_REF, `Binding profile '${target.profile}' must identify a remote service`);
        }
        this.remoteTargets.set(target.profile, Object.freeze({
          serverUrl: resolved.serverUrl,
          token: resolved.token,
          insecure: resolved.insecure,
          allowInsecureHttp: resolved.allowInsecureHttp,
        }));
      }
    }
    this.actionBindings.set(runtime.packageId, bindings);
    this.runtimes.set(runtime.packageId, runtime);
    if (isPublic) {
      this.hostPublicPackageIds.add(runtime.packageId);
    }
    this.bindRuntime(runtime);
    this.rebuildGraphAndCatalog();
    // 注册阶段只建立身份与路由；运行记录恢复收敛到包存储准备路径（持有者工厂预热时统一执行），
    // 旁观 Host 注册不触碰其他进程的在途记录
  }

  registerRuntime(runtime: PackageRuntime): void {
    this.registerRuntimeInternal(runtime, true);
  }

  async info(): Promise<PackageInfo[]> {
    await this.ensureInitialized();
    return collectPackageInfos(this.listRuntimes());
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    await this.ensureInitialized();
    // 外层完成可见性筛选与跨包限定名改写后，统一委托共享过滤函数完成检索
    const results: ActionSummary[] = [];
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
    return applyActionSummaryFilters(results, options);
  }

  async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
    await this.ensureInitialized();
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
    await this.ensureInitialized();
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
    await this.ensureInitialized();
    return describeVisiblePlaybook(this.listRuntimes(), id, this.visibility());
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options: RunOptions = {}
  ): Promise<ExecutionResult> {
    const origin = snapshotRunOrigin(options.origin);
    const effectiveOptions = { ...options, origin };
    await this.ensureInitialized();
    const ticket = await this.startAction(ref, input, effectiveOptions);
    if (!ticket.result) {
      throw new ActionDockError(EXECUTION_FAILED, `Execution ticket for run '${ticket.runId}' has no result Promise`);
    }
    return ticket.result;
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options: RunOptions = {}
  ): Promise<ExecutionTicket> {
    const origin = snapshotRunOrigin(options.origin);
    const effectiveOptions = { ...options, origin };
    await this.ensureInitialized();
    if (this.isClosed) {
      throw new ActionDockError(SERVICE_CLOSED, "ActionDockHost is closed: new tasks rejected");
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
      signal: effectiveOptions.signal,
      timeoutMs: effectiveOptions.timeoutMs,
      config: effectiveOptions.config,
      requestId: effectiveOptions.requestId,
      hostSessionId: this.hostSessionId,
      maxCallDepth: this.maxCallDepth,
      process: this.options.process,
      origin: effectiveOptions.origin,
    });

    // 调度目标包执行服务（经由本地分发中枢统一准备与复核）
    return this.dispatchLocalInvocation(
      targetRuntime,
      targetActionId,
      input,
      rootContext
    );
  }

  /**
   * 私有本地 Action 调度中枢。
   * 统一处理本地已授权目标的准备（若已注入 prepareLocalPackage 且存在物理包根路径）、
   * 中断与关闭复核，并分发至目标 Runtime 的 startInvocation。
   */
  private async dispatchLocalInvocation(
    targetRuntime: PackageRuntime,
    targetActionId: string,
    input: unknown,
    context: InvocationContext
  ): Promise<ExecutionTicket> {
    if (this.isClosed) {
      const runId = context.runId;
      const error = buildRuntimeError(
        SERVICE_CLOSED,
        "ActionDockHost is closed: new tasks rejected",
        { package: targetRuntime.packageId, action: targetActionId, phase: "dispatch" }
      );
      return {
        runId,
        status: "failed",
        result: Promise.resolve({ ok: false, runId, error }),
      };
    }

    const isRootCall = !context.caller;
    const initialTimeoutMs = context.initialTimeoutMs ?? (typeof context.timeoutMs === "number" && context.timeoutMs > 0 ? context.timeoutMs : undefined);
    const deadline = context.deadline ?? (initialTimeoutMs !== undefined ? Date.now() + initialTimeoutMs : undefined);

    if (context.signal.aborted) {
      const runId = context.runId;
      const isTimeout = isActionTimeoutReason(context.signal.reason);
      const error = buildRuntimeError(
        isTimeout ? ACTION_TIMEOUT : ACTION_CANCELLED,
        isTimeout
          ? `Action exceeded timeout of ${initialTimeoutMs ?? context.timeoutMs}ms`
          : "Action execution was cancelled before starting",
        { package: targetRuntime.packageId, action: targetActionId, phase: "dispatch" }
      );
      return {
        runId,
        status: "failed",
        result: Promise.resolve({ ok: false, runId, error }),
      };
    }

    let timeoutController: AbortController | undefined;
    let prepTimeoutTimer: NodeJS.Timeout | undefined;

    if (isRootCall && typeof context.timeoutMs === "number" && context.timeoutMs > 0) {
      timeoutController = new AbortController();
      const remaining = deadline ? Math.max(0, deadline - Date.now()) : context.timeoutMs;
      const timeoutReason = new ActionDockError(
        ACTION_TIMEOUT,
        `Action exceeded timeout of ${initialTimeoutMs ?? context.timeoutMs}ms`,
        { package: targetRuntime.packageId, action: targetActionId, phase: "preparation" }
      );
      if (remaining <= 0) {
        timeoutController.abort(timeoutReason);
      } else {
        prepTimeoutTimer = setTimeout(() => {
          timeoutController?.abort(timeoutReason);
        }, remaining);
      }
    }

    const signalSources: AbortSignal[] = [context.signal, this.closeController.signal];
    if (timeoutController) {
      signalSources.push(timeoutController.signal);
    }
    const mergedSignal = AbortSignal.any(signalSources);

    if (this.prepareLocalPackage && targetRuntime.packageRoot) {
      const prepPromise = Promise.resolve().then(() =>
        this.prepareLocalPackage!(
          {
            identity: targetRuntime.identity,
            packageRoot: targetRuntime.packageRoot!,
          },
          {
            signal: mergedSignal,
            rootRunId: context.rootRunId,
          }
        )
      );

      this.activePreparations.add(prepPromise);
      try {
        await prepPromise;
      } catch (err: any) {
        if (prepTimeoutTimer !== undefined) {
          clearTimeout(prepTimeoutTimer);
          prepTimeoutTimer = undefined;
        }

        const errCode = (err as any)?.code;
        const isClosed = this.closeController.signal.aborted;
        const isExternalCancelled = context.signal.aborted;
        const isTimeout =
          timeoutController?.signal.aborted ||
          isActionTimeoutReason(context.signal.reason) ||
          errCode === ACTION_TIMEOUT ||
          (err?.details && (err.details as any).code === ACTION_TIMEOUT);

        let code: ErrorCode;
        let message = err?.message || "Package preparation failed";
        if (isTimeout) {
          code = ACTION_TIMEOUT;
          message = (err?.message && err.message.includes("exceeded timeout"))
            ? err.message
            : `Action exceeded timeout of ${initialTimeoutMs ?? context.timeoutMs}ms`;
        } else if (err instanceof ActionDockError) {
          code = err.code;
        } else if (isClosed) {
          code = SERVICE_CLOSED;
          message = "ActionDockHost is closed: new tasks rejected";
        } else if (isExternalCancelled) {
          code = ACTION_CANCELLED;
          message = "Action execution was cancelled";
        } else if (err?.code && typeof err.code === "string") {
          code = err.code as ErrorCode;
        } else {
          code = EXECUTION_FAILED;
        }

        const hint = err?.details?.hint ?? (err as any)?.hint;
        const details = {
          ...(err?.details || {}),
          package: targetRuntime.packageId,
          action: targetActionId,
          phase: "preparation",
          ...(hint ? { hint } : {}),
        };

        const runId = context.runId;
        const error = buildRuntimeError(code, message, details);
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
        };
      } finally {
        this.activePreparations.delete(prepPromise);
      }
    }

    if (prepTimeoutTimer !== undefined) {
      clearTimeout(prepTimeoutTimer);
      prepTimeoutTimer = undefined;
    }

    // 准备后再次复核取消与 Host 关闭状态
    if (this.isClosed || this.closeController.signal.aborted) {
      const runId = context.runId;
      const error = buildRuntimeError(
        SERVICE_CLOSED,
        "ActionDockHost is closed: new tasks rejected",
        { package: targetRuntime.packageId, action: targetActionId, phase: "post-preparation" }
      );
      return {
        runId,
        status: "failed",
        result: Promise.resolve({ ok: false, runId, error }),
      };
    }

    if (context.signal.aborted) {
      const runId = context.runId;
      const isTimeout = isActionTimeoutReason(context.signal.reason);
      const error = buildRuntimeError(
        isTimeout ? ACTION_TIMEOUT : ACTION_CANCELLED,
        isTimeout
          ? `Action exceeded timeout of ${initialTimeoutMs ?? context.timeoutMs}ms`
          : "Action execution was cancelled after preparation",
        { package: targetRuntime.packageId, action: targetActionId, phase: "post-preparation" }
      );
      return {
        runId,
        status: "failed",
        result: Promise.resolve({ ok: false, runId, error }),
      };
    }

    const remainingBudget = deadline !== undefined
      ? Math.max(0, deadline - Date.now())
      : context.timeoutMs;
    if (deadline !== undefined && typeof remainingBudget === "number" && remainingBudget <= 0) {
      const runId = context.runId;
      const error = buildRuntimeError(
        ACTION_TIMEOUT,
        `Action exceeded timeout of ${initialTimeoutMs ?? context.timeoutMs}ms`,
        { package: targetRuntime.packageId, action: targetActionId, phase: "post-preparation" }
      );
      return {
        runId,
        status: "failed",
        result: Promise.resolve({ ok: false, runId, error }),
      };
    }

    const effectiveContext: InvocationContext = {
      ...context,
      signal: mergedSignal,
      initialTimeoutMs,
      deadline,
      timeoutMs: remainingBudget,
    };

    const ticket = await targetRuntime.startInvocation(
      targetActionId,
      input as JsonValue,
      effectiveContext
    );

    if (ticket.result) {
      ticket.result.finally(() => {
        if (prepTimeoutTimer !== undefined) {
          clearTimeout(prepTimeoutTimer);
        }
      });
    }

    return ticket;
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<RunRecord | undefined> {
    await this.ensureInitialized();
    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }
    for (const runtime of this.listRuntimes()) {
      if (signal?.aborted) {
        throw createAbortError(signal.reason);
      }
      const record = await runtime.getRun(runId);
      if (signal?.aborted) {
        throw createAbortError(signal.reason);
      }
      if (record) return record;
    }
    return undefined;
  }

  async listRuns(query?: ListRunsOptions, signal?: AbortSignal): Promise<RunRecord[]> {
    await this.ensureInitialized();
    const effectiveSignal = signal ?? query?.signal;
    if (effectiveSignal?.aborted) {
      throw createAbortError(effectiveSignal.reason);
    }
    const runtimes = query?.packageId
      ? ([this.getRuntime(query.packageId)].filter(Boolean) as PackageRuntime[])
      : query?.packageAllowlist && query.packageAllowlist.length > 0
        ? (query.packageAllowlist.map((id) => this.getRuntime(id)).filter(Boolean) as PackageRuntime[])
        : this.listRuntimes();

    // 当存在 intent 过滤时：分批读取并在内存中累积命中记录，先过滤后分页
    if (query?.intent) {
      const intentStr = query.intent;
      const matchedRecords: RunRecord[] = [];
      const BATCH_SIZE = 100;
      const targetLimit = query.limit;
      const targetOffset = query.offset ?? 0;
      const neededCount = targetLimit !== undefined ? targetOffset + targetLimit : Infinity;

      if (runtimes.length === 1) {
        const runtime = runtimes[0];
        let batchOffset = 0;
        while (true) {
          if (effectiveSignal?.aborted) {
            throw createAbortError(effectiveSignal.reason);
          }
          const batch = await runtime.listRuns({
            actionId: query.actionId,
            status: query.status,
            channel: query.channel,
            view: query.view,
            since: query.since,
            until: query.until,
            rootRunId: query.rootRunId,
            parentRunId: query.parentRunId,
            requestIds: query.requestIds,
            limit: BATCH_SIZE,
            offset: batchOffset,
            signal: effectiveSignal,
          });
          if (effectiveSignal?.aborted) {
            throw createAbortError(effectiveSignal.reason);
          }
          if (batch.length === 0) break;
          batchOffset += batch.length;

          const normalized = batch.map((r) => ({
            ...r,
            packageId: (r as any).packageId || runtime.packageId,
          }));

          let filtered = normalized;
          if (query.channel) filtered = filtered.filter((r) => r.origin?.channel === query.channel);
          if (query.view) filtered = filtered.filter((r) => r.origin?.viewName === query.view);
          if (query.since) filtered = filtered.filter((r) => r.startedAt >= query.since!);
          if (query.until) filtered = filtered.filter((r) => r.startedAt <= query.until!);
          if (query.rootRunId) filtered = filtered.filter((r) => r.rootRunId === query.rootRunId);
          if (query.parentRunId) filtered = filtered.filter((r) => r.parentRunId === query.parentRunId);

          const intentMatched = filterByIntent(
            filtered,
            intentStr,
            [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
            false
          );
          matchedRecords.push(...intentMatched);

          if (matchedRecords.length >= neededCount) {
            break;
          }

          if (batch.length < BATCH_SIZE) {
            break;
          }
        }
      } else {
        for (const runtime of runtimes) {
          if (effectiveSignal?.aborted) {
            throw createAbortError(effectiveSignal.reason);
          }
          let batchOffset = 0;
          while (true) {
            if (effectiveSignal?.aborted) {
              throw createAbortError(effectiveSignal.reason);
            }
            const batch = await runtime.listRuns({
              actionId: query.actionId,
              status: query.status,
              channel: query.channel,
              view: query.view,
              since: query.since,
              until: query.until,
              rootRunId: query.rootRunId,
              parentRunId: query.parentRunId,
              requestIds: query.requestIds,
              limit: BATCH_SIZE,
              offset: batchOffset,
              signal: effectiveSignal,
            });
            if (effectiveSignal?.aborted) {
              throw createAbortError(effectiveSignal.reason);
            }
            if (batch.length === 0) break;
            batchOffset += batch.length;

            const normalized = batch.map((r) => ({
              ...r,
              packageId: (r as any).packageId || runtime.packageId,
            }));

            let filtered = normalized;
            if (query.channel) filtered = filtered.filter((r) => r.origin?.channel === query.channel);
            if (query.view) filtered = filtered.filter((r) => r.origin?.viewName === query.view);
            if (query.since) filtered = filtered.filter((r) => r.startedAt >= query.since!);
            if (query.until) filtered = filtered.filter((r) => r.startedAt <= query.until!);
            if (query.rootRunId) filtered = filtered.filter((r) => r.rootRunId === query.rootRunId);
            if (query.parentRunId) filtered = filtered.filter((r) => r.parentRunId === query.parentRunId);

            const intentMatched = filterByIntent(
              filtered,
              intentStr,
              [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
              false
            );
            matchedRecords.push(...intentMatched);

            if (batch.length < BATCH_SIZE) {
              break;
            }
          }
        }
        matchedRecords.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      }

      const end = targetLimit !== undefined ? targetOffset + targetLimit : undefined;
      return matchedRecords.slice(targetOffset, end);
    }

    // 当不存在 intent 过滤时：
    if (runtimes.length === 1) {
      if (effectiveSignal?.aborted) {
        throw createAbortError(effectiveSignal.reason);
      }
      const runtime = runtimes[0];
      const recs = await runtime.listRuns(query ? { ...query, signal: effectiveSignal } : { signal: effectiveSignal });
      if (effectiveSignal?.aborted) {
        throw createAbortError(effectiveSignal.reason);
      }
      return recs.map((r) => ({
        ...r,
        packageId: (r as any).packageId || runtime.packageId,
      }));
    }

    // 跨包联合查询：下推 limit/offset 或合并排序
    const records: RunRecord[] = [];
    const fetchLimit = query?.limit !== undefined
      ? (query.offset ?? 0) + query.limit
      : undefined;
    for (const runtime of runtimes) {
      if (effectiveSignal?.aborted) {
        throw createAbortError(effectiveSignal.reason);
      }
      const recs = await runtime.listRuns({
        ...query,
        offset: 0,
        limit: fetchLimit,
        signal: effectiveSignal,
      });
      if (effectiveSignal?.aborted) {
        throw createAbortError(effectiveSignal.reason);
      }
      for (const r of recs) {
        records.push({
          ...r,
          packageId: (r as any).packageId || runtime.packageId,
        });
      }
    }
    records.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const start = query?.offset ?? 0;
    const end = query?.limit !== undefined ? start + query.limit : undefined;
    return records.slice(start, end);
  }

  async countRuns(query?: ListRunsOptions, signal?: AbortSignal): Promise<number> {
    await this.ensureInitialized();
    const effectiveSignal = signal ?? query?.signal;
    if (effectiveSignal?.aborted) {
      throw createAbortError(effectiveSignal.reason);
    }
    const runtimes = query?.packageId
      ? ([this.getRuntime(query.packageId)].filter(Boolean) as PackageRuntime[])
      : query?.packageAllowlist && query.packageAllowlist.length > 0
        ? (query.packageAllowlist.map((id) => this.getRuntime(id)).filter(Boolean) as PackageRuntime[])
        : this.listRuntimes();

    if (query?.intent) {
      const intentStr = query.intent;
      let count = 0;
      const BATCH_SIZE = 100;
      for (const runtime of runtimes) {
        if (effectiveSignal?.aborted) {
          throw createAbortError(effectiveSignal.reason);
        }
        let batchOffset = 0;
        while (true) {
          if (effectiveSignal?.aborted) {
            throw createAbortError(effectiveSignal.reason);
          }
          const batch = await runtime.listRuns({
            actionId: query.actionId,
            status: query.status,
            channel: query.channel,
            view: query.view,
            since: query.since,
            until: query.until,
            rootRunId: query.rootRunId,
            parentRunId: query.parentRunId,
            requestIds: query.requestIds,
            limit: BATCH_SIZE,
            offset: batchOffset,
            signal: effectiveSignal,
          });
          if (effectiveSignal?.aborted) {
            throw createAbortError(effectiveSignal.reason);
          }
          if (batch.length === 0) break;
          batchOffset += batch.length;

          const normalized = batch.map((r) => ({
            ...r,
            packageId: (r as any).packageId || runtime.packageId,
          }));

          let filtered = normalized;
          if (query.channel) filtered = filtered.filter((r) => r.origin?.channel === query.channel);
          if (query.view) filtered = filtered.filter((r) => r.origin?.viewName === query.view);
          if (query.since) filtered = filtered.filter((r) => r.startedAt >= query.since!);
          if (query.until) filtered = filtered.filter((r) => r.startedAt <= query.until!);
          if (query.rootRunId) filtered = filtered.filter((r) => r.rootRunId === query.rootRunId);
          if (query.parentRunId) filtered = filtered.filter((r) => r.parentRunId === query.parentRunId);

          const intentMatched = filterByIntent(
            filtered,
            intentStr,
            [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
            false
          );
          count += intentMatched.length;

          if (batch.length < BATCH_SIZE) {
            break;
          }
        }
      }
      return count;
    }

    let total = 0;
    for (const runtime of runtimes) {
      if (effectiveSignal?.aborted) {
        throw createAbortError(effectiveSignal.reason);
      }
      if (typeof runtime.countRuns === "function") {
        total += await runtime.countRuns(query ? { ...query, signal: effectiveSignal } : { signal: effectiveSignal });
      } else {
        const all = await runtime.listRuns({
          actionId: query?.actionId,
          status: query?.status,
          channel: query?.channel,
          view: query?.view,
          since: query?.since,
          until: query?.until,
          rootRunId: query?.rootRunId,
          parentRunId: query?.parentRunId,
          requestIds: query?.requestIds,
          limit: 100_000,
          signal: effectiveSignal,
        });
        if (effectiveSignal?.aborted) {
          throw createAbortError(effectiveSignal.reason);
        }
        let filtered = all;
        if (query?.channel) filtered = filtered.filter((r) => r.origin?.channel === query.channel);
        if (query?.view) filtered = filtered.filter((r) => r.origin?.viewName === query.view);
        if (query?.since) filtered = filtered.filter((r) => r.startedAt >= query.since!);
        if (query?.until) filtered = filtered.filter((r) => r.startedAt <= query.until!);
        if (query?.rootRunId) filtered = filtered.filter((r) => r.rootRunId === query.rootRunId);
        if (query?.parentRunId) filtered = filtered.filter((r) => r.parentRunId === query.parentRunId);
        total += filtered.length;
      }
    }
    return total;
  }

  async clearRuns(options?: {
    packageId?: string;
    actionId?: string;
    status?: string;
    olderThanMs?: number;
    keep?: number;
  }): Promise<number> {
    await this.ensureInitialized();
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

  async cleanExpiredRuns(policy?: import("../storage/types").RunsRetentionPolicy): Promise<number> {
    await this.ensureInitialized();
    let total = 0;
    for (const runtime of this.listRuntimes()) {
      if (typeof runtime.cleanExpiredRuns === "function") {
        const res = await runtime.cleanExpiredRuns(policy);
        total += res;
      }
    }
    return total;
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    await this.ensureInitialized();
    for (const runtime of this.listRuntimes()) {
      const res = await runtime.cancelRun(runId, reason);
      if (res.outcome !== "not_found") {
        return res;
      }
    }
    return { outcome: "not_found", runId };
  }

  private subscribeEvents(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    const self = this;
    // 事件订阅可异步解析包归属：逐包并发查询运行记录（公共端口，不新建执行服务），
    // 命中则使用该包事件源，全部未命中回退 Host 事件源
    return (async function* () {
      const runtimes = self.listRuntimes();
      const owner = await findRunOwnerRuntime(runtimes, runId);
      if (owner) {
        yield* owner.events(runId, options);
        return;
      }
      // Host 共享事件源作为统一回退（与执行服务装配使用同一 sink，完成事件不丢失）
      yield* self.eventSink.subscribe(runId, options);
    })();
  }

  private getGlobalStorage(): RuntimeStorage {
    if (!this.globalStorage) {
      const hasInMemoryPackage =
        this.options.packages?.some((item) => {
          if (typeof item === "string") return false;
          if (isPackageRuntime(item)) {
            return Boolean(item.inMemory || (item as any).options?.inMemory);
          }
          return Boolean(item.inMemory);
        }) ||
        Array.from(this.runtimes.values()).some((rt) => Boolean(rt.inMemory || (rt as any).options?.inMemory));
      const inMemory = Boolean(this.options.inMemory || hasInMemoryPackage);
      this.globalStorage =
        this.options.platform?.storage?.createGlobalStorage?.({
          dataDir: this.options.dataDir,
          customHome: this.options.customHome,
          ...(inMemory ? { inMemory: true } : {}),
        }) ??
        createGlobalStorage({
          dataDir: this.options.dataDir,
          customHome: this.options.customHome,
          inMemory,
        });
    }
    return this.globalStorage;
  }

  private findAllDeclaredConfigItems(key: string): ConfigItemDefinition[] {
    const items: ConfigItemDefinition[] = [];
    for (const runtime of this.listRuntimes()) {
      const decl = resolveConfigDeclaration(runtime.projectConfig?.config, key);
      if (decl?.item) {
        items.push(decl.item);
      }
    }
    return items;
  }

  private protectGlobalConfigView(view: ConfigValueView): ConfigValueView {
    if (view.source !== "global") return view;
    const items = this.findAllDeclaredConfigItems(view.key);
    if (items.length === 0) return view;
    // 外部注入的运行时可能持有独立全局库；只能加强它返回的安全值，不能换读 Host 的库。
    const merged = redactConfigValueForDeclarations(view.value, items);
    const safe = redactConfigValueAtPaths(merged.value, [...view.redactedPaths, ...merged.redactedPaths]);
    return { ...view, ...safe, secret: view.secret || merged.secret };
  }

  private resolveRuntime(packageId?: string): PackageRuntime | undefined {
    if (packageId) {
      return this.getRuntime(packageId);
    }
    const runtimes = this.listRuntimes();
    return runtimes.length === 1 ? runtimes[0] : undefined;
  }

  /**
   * 解析目标包运行时：未命中时抛出统一的包未找到错误。
   */
  private requireRuntime(packageId: string): PackageRuntime {
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new ActionDockError(PACKAGE_NOT_FOUND, `Package '${packageId}' not found in host`);
    }
    return runtime;
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    await this.ensureInitialized();
    assertConcreteConfigKey(key);
    if (packageId === "global") {
      const globalStorage = this.getGlobalStorage();
      const val = globalStorage.getConfig(key);
      const configured = val !== undefined;
      const items = this.findAllDeclaredConfigItems(key);
      const redacted = redactConfigValueForDeclarations(val, items);
      return {
        key,
        configured,
        secret: redacted.secret,
        source: configured ? "global" : null,
        value: redacted.value,
        redactedPaths: redacted.redactedPaths,
      };
    }
    return this.protectGlobalConfigView(await this.requireRuntime(packageId).getConfig(key));
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    await this.ensureInitialized();
    assertConcreteConfigKey(key);
    if (packageId === "global") {
      const items = this.findAllDeclaredConfigItems(key);
      for (const item of items) {
        validateConfigValue(key, value, item);
      }
      await this.getGlobalStorage().setConfig(key, value);
      return;
    }
    await this.requireRuntime(packageId).setConfig(key, value);
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    await this.ensureInitialized();
    assertConcreteConfigKey(key);
    if (packageId === "global") {
      return await this.getGlobalStorage().deleteConfig(key);
    }
    return await this.requireRuntime(packageId).deleteConfig(key);
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    await this.ensureInitialized();
    if (packageId === "global") {
      const globalStorage = this.getGlobalStorage();
      const all = globalStorage.listConfig();
      const views: ConfigValueView[] = [];
      for (const [key, val] of Object.entries(all)) {
        if (isConfigTemplate(key)) {
          continue;
        }
        const items = this.findAllDeclaredConfigItems(key);
        const redacted = redactConfigValueForDeclarations(val, items);
        views.push({
          key,
          configured: true,
          secret: redacted.secret,
          source: "global",
          value: redacted.value,
          redactedPaths: redacted.redactedPaths,
        });
      }
      return views;
    }
    const views = await this.requireRuntime(packageId).listConfig();
    return views.map((view) => this.protectGlobalConfigView(view));
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    await this.ensureInitialized();
    return this.requireRuntime(packageId).getState<T>(actionId, key, options);
  }

  async setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    await this.ensureInitialized();
    const runtime = this.requireRuntime(packageId);
    if (actionId !== undefined) {
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
    await this.ensureInitialized();
    return this.requireRuntime(packageId).deleteState(actionId, key, options);
  }

  async listStateKeys(
    packageId: string,
    actionId?: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    await this.ensureInitialized();
    return this.requireRuntime(packageId).listStateKeys(actionId, options);
  }

  async clearState(
    packageId: string,
    actionId?: string,
    options?: StateScopeOptions
  ): Promise<number> {
    await this.ensureInitialized();
    return this.requireRuntime(packageId).clearState(actionId, options);
  }

  async listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]> {
    await this.ensureInitialized();
    const runtime = this.resolveRuntime(packageId);
    if (!runtime) {
      throw new ActionDockError(
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
  async close(options?: { timeoutMs?: number; graceMs?: number }): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.isClosed) return;

    this.closePromise = (async () => {
      this.isClosed = true;
      this.closeController.abort(new ActionDockError(SERVICE_CLOSED, "ActionDockHost is closing"));

      if (this.activePreparations.size > 0) {
        await Promise.allSettled(Array.from(this.activePreparations));
      }

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
      const invocationCloseErrors = await this.closeInvocationTargets();
      this.runtimes.clear();
      this.actionBindings.clear();
      this.remoteTargets.clear();
      await this.remoteInvoker.close();

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
      if (invocationCloseErrors.length) throw new AggregateError(invocationCloseErrors, "Invocation target cleanup failed");
    })();

    return this.closePromise;
  }
}

/**
 * 工厂函数：创建并初始化 ActionDockHost 宿主容器。
 */
export async function createActionDockHost(
  options: ActionDockHostOptions = {}
): Promise<ActionDockHost> {
  return DefaultActionDockHost.create(options);
}
