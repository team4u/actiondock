import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ActionDefinition,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import { DefaultExecutionService } from "../execution/service";
import type {
  ActionInvoker,
  CancelResult,
  ExecutionTicket,
} from "../execution/types";
import { createNodePlatform, type RuntimePlatform } from "../platform";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { RuntimeConfig } from "../runtime/context";
import { normalizeActionCollection } from "../runtime/action-collection";
import { isSecretConfigKey, sanitizeConfigDefinitions } from "../storage/mask";
import { decodeStateKey, SqliteRuntimeStorage } from "../storage/sqlite";
import type { RuntimeStorage } from "../storage/types";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";
import {
  ACTION_NOT_FOUND,
  ActionDockError,
  CAPABILITY_UNAVAILABLE,
  INVALID_ARGUMENT,
  INVOCATION_UNSUPPORTED,
  NOT_FOUND,
  SERVICE_CLOSED,
} from "../errors";
import { createRootInvocationContext, type InvocationContext, type RunOptions } from "../invocation/types";
import { buildStaticActionMap, buildStaticPlaybookMap } from "./static-index";
import type {
  ActionSpec,
  ActionSummary,
  ConfigValueView,
  HostManagedPackageRuntime,
  ListActionsOptions,
  ListRunsOptions,
  PackageInfo,
  PackageRuntime,
  PackageRuntimeOptions,
  PackageRuntimeInternalOptions,
  PlaybookSpec,
  PlaybookSummary,
  StateScopeOptions,
  StorageFactoryOptions,
} from "./types";
import { applyActionSummaryFilters } from "./types";

function normalizeStateReadArgs(
  arg1: string,
  arg2?: string | StateScopeOptions,
  arg3?: StateScopeOptions
): { key: string; options?: StateScopeOptions } {
  if (typeof arg2 === "string") {
    if (arg3?.actionId !== undefined && arg3.actionId !== arg1) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Conflicting actionId specified: positional '${arg1}' vs options.actionId '${arg3.actionId}'`
      );
    }
    return {
      key: arg2,
      options: { ...arg3, actionId: arg1 },
    };
  }

  return {
    key: arg1,
    options: arg2 as StateScopeOptions | undefined,
  };
}

function normalizeStateWriteArgs<T>(
  arg1: string,
  arg2: any,
  arg3?: any,
  arg4?: StateScopeOptions,
  argsCount?: number
): { key: string; value: T; options?: StateScopeOptions } {
  const isFourArgs = argsCount !== undefined ? argsCount >= 4 : arg4 !== undefined;
  if (isFourArgs) {
    if (arg4?.actionId !== undefined && arg4.actionId !== arg1) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Conflicting actionId specified: positional '${arg1}' vs options.actionId '${arg4.actionId}'`
      );
    }
    return {
      key: String(arg2),
      value: arg3,
      options: { ...arg4, actionId: arg1 },
    };
  }

  if (
    arg3 !== undefined &&
    (typeof arg3 !== "object" || arg3 === null || Array.isArray(arg3))
  ) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid options provided to setState. Use setActionState(actionId, key, value, options) or 4-argument setState for action state."
    );
  }

  return {
    key: arg1,
    value: arg2 as T,
    options: arg3 as StateScopeOptions | undefined,
  };
}

function normalizeStateScopeArgs(
  actionIdOrOptions?: string | StateScopeOptions,
  options?: StateScopeOptions
): StateScopeOptions | undefined {
  if (typeof actionIdOrOptions === "string") {
    if (options?.actionId !== undefined && options.actionId !== actionIdOrOptions) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Conflicting actionId specified: positional '${actionIdOrOptions}' vs options.actionId '${options.actionId}'`
      );
    }
    return { ...options, actionId: actionIdOrOptions };
  }
  if (actionIdOrOptions === undefined) {
    return options;
  }
  return actionIdOrOptions;
}

/** 包存储槽位：实例与在途初始化 Promise（并发首次访问共享同一结果） */
interface StorageSlot {
  instance?: RuntimeStorage;
  initPromise?: Promise<RuntimeStorage>;
}

/** 执行服务槽位：实例与在途初始化 Promise（依赖存储准备完成） */
interface ExecutionSlot {
  instance?: DefaultExecutionService;
  initPromise?: Promise<DefaultExecutionService>;
}

/** 全局存储资源所有权归类 */
type GlobalStorageOwnership =
  | { kind: "external"; storage: RuntimeStorage }
  | { kind: "own"; storage: RuntimeStorage };

/**
 * ActionDock 统一包运行时默认实现。
 * 封装并管理单个 Action Package 的执行引擎、静态元数据索引、配置与状态存储生命周期。
 *
 * 资源按需装配契约：
 * - 构造函数只完成身份、清单与内存注入动作的归一化，不打开数据库、
 *   不创建进程接口、不注册模块加载钩子、不实例化执行服务；
 * - 包存储、执行服务、全局存储与配置解析器拆分为内部资源槽位，
 *   首次实际调用时准备并缓存复用；
 * - info / list / describe / 规程发现等静态查询全程零资源创建。
 */
export class DefaultPackageRuntime implements HostManagedPackageRuntime {
  public readonly identity: PackageIdentity;
  public readonly packageId: string;
  public readonly packageInstanceId: string;
  public readonly generationId: string;
  public readonly packageRoot?: string;
  public readonly projectConfig: ProjectConfig;
  private readonly platform: RuntimePlatform;
  private readonly actionsMap: Map<string, ActionDefinition>;
  private readonly options: PackageRuntimeInternalOptions;
  private isClosed = false;

  // - 资源槽位（构造阶段全部为空，按需准备）
  private storageSlot: StorageSlot = {};
  private executionSlot: ExecutionSlot = {};
  /** 全局存储：显式注入或首次准备后固定，配合 ownership 判定关闭归属 */
  private globalStorageRes?: GlobalStorageOwnership;
  private runtimeConfig?: RuntimeConfig;
  /** 执行委托暂存：执行服务尚未创建时只保存，不触发资源初始化 */
  private pendingInvoker?: ActionInvoker;
  /** Host 会话级恢复标记：存储准备阶段收敛执行一次，避免重复执行恢复链 */
  private recoveredForHostSession = false;

  /** 静态清单索引缓存：包静态事实（根目录、配置、内存注入集合）在实例生命周期内不变，解析结果同实例内复用 */
  private staticActionIndex?: Map<string, ActionSpec>;
  private staticPlaybookIndex?: Map<string, PlaybookSpec>;

  constructor(options: PackageRuntimeInternalOptions = {}) {
    this.options = options;
    // - 确定项目根路径与配置对象
    let packageRoot = options.packageRoot;
    let projectConfig = options.projectConfig;

    if (!packageRoot && !projectConfig) {
      const detected = findProjectRoot();
      if (detected) {
        packageRoot = detected;
      }
    }

    if (!projectConfig && packageRoot) {
      const configPath = join(packageRoot, "actiondock.json");
      if (existsSync(configPath)) {
        // 文件存在但解析失败（损坏 JSON、校验失败）时直接向上抛出：
        // 仅当确实不存在 actiondock.json 文件时才允许回退默认配置，杜绝幽灵包配置
        projectConfig = loadProjectConfig(packageRoot);
      }
    }

    if (!projectConfig) {
      projectConfig = {
        id: "default",
        name: "default",
        version: "0.1.0",
      };
    }

    this.packageRoot = packageRoot;
    this.projectConfig = projectConfig;
    // 兼容未在公开选项契约中显式声明的包实例标识与代系标识内部参数透传
    this.identity = options.identity || createPackageIdentity({
      id: projectConfig.id,
      instanceId: (options as any)?.packageInstanceId || (projectConfig as any).packageInstanceId,
      generation: (options as any)?.generationId || (projectConfig as any).generationId,
    });
    this.packageId = this.identity.id;
    this.packageInstanceId = this.identity.instanceId;
    this.generationId = this.identity.generation;

    // - 转换 Action 集合：委托归一化单一入口
    this.actionsMap = normalizeActionCollection(options.actions).actionsMap;

    // - 确定平台适配层：默认平台对象自身不打开数据库、不注册加载钩子、不创建进程接口
    this.platform = options.platform ?? createNodePlatform();

    if (options.storage) {
      this.storageSlot.instance = options.storage;
    }

    if (options.globalStorage) {
      this.globalStorageRes = { kind: "external", storage: options.globalStorage };
    }
  }

  /**
   * 静态读取并聚合当前包的 Action 规范索引。
   * 聚合逻辑委托 static-index 单一事实源；同实例内复用首次解析结果，
   * 消除重复查询单次调用内的重复读盘（磁盘清单在实例生命周期内视为静态事实）。
   */
  private getStaticActionMap(): Map<string, ActionSpec> {
    if (!this.staticActionIndex) {
      this.staticActionIndex = buildStaticActionMap({
        packageRoot: this.packageRoot,
        packageId: this.packageId,
        projectConfig: this.projectConfig,
        actionsMap: this.actionsMap,
      });
    }
    return this.staticActionIndex;
  }

  /**
   * 静态读取并聚合当前包的 Playbook 规范索引。
   * 聚合逻辑委托 static-index 单一事实源；同实例内复用首次解析结果。
   */
  private getStaticPlaybookMap(): Map<string, PlaybookSpec> {
    if (!this.staticPlaybookIndex) {
      this.staticPlaybookIndex = buildStaticPlaybookMap({
        packageRoot: this.packageRoot,
        packageId: this.packageId,
        projectConfig: this.projectConfig,
      });
    }
    return this.staticPlaybookIndex;
  }

  private assertOpen(): void {
    if (this.isClosed) {
      throw new ActionDockError(
        SERVICE_CLOSED,
        `PackageRuntime for package '${this.packageId}' is closed`
      );
    }
  }

  // -------------------------------------------------------------------------
  // - 内部资源准备路径（存储 / 全局存储 / 执行服务 / 配置解析器）
  // -------------------------------------------------------------------------

  /**
   * 准备包存储：打开（或复用注入的）包数据库，等待可选的 ensureInitialized，
   * 并在持有者模式下完成运行记录恢复（允许返回 Promise 的恢复接口必须被等待）。
   * 并发首次调用共享同一在途 Promise；失败时释放新建资源、清空失败 Promise、透传原始错误。
   */
  private ensureStorage(): Promise<RuntimeStorage> {
    if (this.storageSlot.instance) {
      return Promise.resolve(this.storageSlot.instance);
    }
    if (!this.storageSlot.initPromise) {
      const init = this.openStorageAsync();
      this.storageSlot.initPromise = init;
      init.catch(() => {
        // 失败后清空在途 Promise 供后续显式调用重试；同时防止未处理拒绝告警
        if (this.storageSlot.initPromise === init) {
          this.storageSlot.initPromise = undefined;
        }
      });
    }
    return this.storageSlot.initPromise;
  }

  private async openStorageAsync(): Promise<RuntimeStorage> {
    let storage: RuntimeStorage | undefined;
    try {
      storage = this.platform.storage.createStorage(this.packageId, this.buildStorageOptions());
      if (typeof storage.ensureInitialized === "function") {
        await storage.ensureInitialized();
      }
      // 存储打开阶段无会话参数的恢复（初始化链语义）已完成：
      // 这里补充 Host 会话粒度的恢复（同一宿主会话内只收敛执行一次，返回 Promise 时被等待）
      await this.recoverForHostSessionOnce(storage);
      this.storageSlot.instance = storage;
      return storage;
    } catch (err) {
      // 初始化失败：释放本次新建且由本层拥有的资源，透传原始错误
      if (storage) {
        try {
          await storage.close();
        } catch {
          // 忽略清理阶段的副异常，确保原始错误优先透传
        }
      }
      throw err;
    }
  }

  /** 构造包存储工厂选项（单一事实源，异步与同步打开路径共用） */
  private buildStorageOptions(): StorageFactoryOptions {
    return {
      projectRoot: this.packageRoot,
      dataDir: this.options.dataDir,
      customHome: this.options.customHome,
      inMemory: this.options.inMemory,
      // 默认持有者语义：App 主路径打开时收割死亡会话遗留非终态运行记录；
      // CLI 查询旁观视图显式置 recoverOrphans: false 跳过收割
      recoverOrphans: this.options.recoverOrphans !== false,
    };
  }

  /**
   * Host 会话级运行记录恢复：同实例生命周期内最多执行一次。
   * 允许返回 Promise 的恢复接口被等待：恢复完成（或失败透传）前存储不发布；
   * 恢复失败沿用既有可观测处理（告警透传），不因异步化静默丢失。
   */
  private async recoverForHostSessionOnce(storage: RuntimeStorage): Promise<void> {
    if (this.recoveredForHostSession) {
      return;
    }
    this.recoveredForHostSession = true;
    if (this.options.recoverOrphans === false) {
      return;
    }
    if (typeof storage.recoverDeadSessionRuns !== "function") {
      return;
    }
    try {
      await storage.recoverDeadSessionRuns(this.options.hostSessionId);
    } catch (err) {
      // 单包恢复失败不阻断整体接管流程，但必须可观测：告警后透传，不静默丢失
      const message =
        err instanceof Error ? err.message : String(err);
      console.warn(
        `[actiondock] recoverDeadSessionRuns failed for package '${this.packageId}': ${message}`
      );
      throw err;
    }
  }

  /**
   * 准备全局存储：显式注入优先，其次 Host 共享提供函数，最后独立使用平台存储工厂。
   * 同步契约：RuntimeConfig 与 ctx.config.get() 的读取是同步的，故全局库必须同步可得。
   */
  private ensureGlobalStorageSync(): RuntimeStorage {
    if (this.globalStorageRes) {
      return this.globalStorageRes.storage;
    }
    const provider = this.options.globalStorageProvider;
    if (provider) {
      // Host 提供函数复用 Host 级缓存，同一 Host 不为每个包重复打开全局库
      // （优先级高于独立内存自建路径，保证 Host 与包共享同一全局库实例）
      const storage = provider();
      this.globalStorageRes = { kind: "external", storage };
      return storage;
    }
    if (this.options.inMemory) {
      // 独立内存包的全局库：包自建自关（同步创建，无 IO）
      const storage = new SqliteRuntimeStorage({
        dbPath: ":memory:",
        packageId: "__global__",
      });
      this.globalStorageRes = { kind: "own", storage };
      return storage;
    }
    const globalOpts = {
      customHome: this.options.customHome,
      dataDir: this.options.dataDir,
      inMemory: this.options.inMemory,
      // 与主存储保持同侧收割语义（全局库 runs 表为空集，收割无实际副作用）
      recoverOrphans: this.options.recoverOrphans !== false,
    };
    const storage = this.platform.storage.createGlobalStorage(globalOpts);
    this.globalStorageRes = { kind: "own", storage };
    return storage;
  }

  /**
   * 异步准备全局存储：供执行服务装配前调用，保证可选的异步初始化完成。
   * 同步路径（RuntimeConfig 读取）仍走 ensureGlobalStorageSync 复用同一实例。
   */
  private async ensureGlobalStorage(): Promise<RuntimeStorage> {
    const storage = this.ensureGlobalStorageSync();
    if (typeof storage.ensureInitialized === "function") {
      await storage.ensureInitialized();
    }
    return storage;
  }

  /**
   * 准备配置解析器：依赖包存储与全局存储（五层优先级链既有实现不变）。
   * 同步契约：RuntimeConfig 与 ctx.config.get() 的读取是同步的，故同步打开包库；
   * 若异步准备已在途，同步路径仅在实例已发布后复用，避免双打开竞态。
   */
  private ensureRuntimeConfig(): RuntimeConfig {
    if (!this.runtimeConfig) {
      this.runtimeConfig = new RuntimeConfig(
        this.getStorageAlreadyPrepared(),
        this.options.configOverrides,
        this.projectConfig,
        this.ensureGlobalStorageSync()
      );
    }
    return this.runtimeConfig;
  }

  /**
   * 获取已就绪的包存储（同步契约专用）：
   * - 已发布实例直接复用；
   * - 异步准备在途时等待其结算后复用同一实例；
   * - 未准备时同步打开并登记在途 Promise 已完成状态。
   * 单一事实源：同步打开也走 buildStorageOptions，并补齐会话恢复等待语义的同步近似。
   */
  private getStorageAlreadyPrepared(): RuntimeStorage {
    if (this.storageSlot.instance) {
      return this.storageSlot.instance;
    }
    if (this.storageSlot.initPromise) {
      // 异步准备在途：无法同步等待，抛出明确错误供调用方改用异步入口
      throw new ActionDockError(
        SERVICE_CLOSED,
        `Package storage for '${this.packageId}' is still initializing; retry after initialization settles`
      );
    }
    return this.openStorageSync();
  }

  /** 同步打开包存储（仅当异步准备从未发起时使用） */
  private openStorageSync(): RuntimeStorage {
    this.assertOpen();
    const storage = this.platform.storage.createStorage(this.packageId, this.buildStorageOptions());
    this.storageSlot.instance = storage;
    this.storageSlot.initPromise = Promise.resolve(storage);
    return storage;
  }

  /**
   * 准备执行服务：等待存储与全局存储就绪后创建唯一 DefaultExecutionService。
   * 失败时只回收执行初始化独自新建的资源，不关闭仍被状态查询使用的包存储。
   */
  private ensureExecutionService(): Promise<DefaultExecutionService> {
    if (this.executionSlot.instance) {
      return Promise.resolve(this.executionSlot.instance);
    }
    if (!this.executionSlot.initPromise) {
      const init = this.buildExecutionService();
      this.executionSlot.initPromise = init;
      init.catch(() => {
        // 失败后清空在途 Promise 供后续显式调用重试；同时防止未处理拒绝告警
        if (this.executionSlot.initPromise === init) {
          this.executionSlot.initPromise = undefined;
        }
      });
    }
    return this.executionSlot.initPromise;
  }

  private async buildExecutionService(): Promise<DefaultExecutionService> {
    try {
      const storage = await this.prepareStorageAsync();
      const globalStorage = await this.ensureGlobalStorage();
      const service = new DefaultExecutionService({
        identity: this.identity,
        hostSessionId: this.options.hostSessionId,
        storage,
        globalStorage,
        projectRoot: this.packageRoot,
        projectConfig: this.projectConfig,
        configOverrides: this.options.configOverrides,
        actions: this.actionsMap,
        process: this.options.process ?? this.platform.process,
        clock: this.options.clock ?? this.platform.clock,
        logger: this.options.logger,
        eventSink: this.options.eventSink ?? this.platform.eventSink,
        maxActiveRuns: this.options.maxActiveRuns,
        ownerId: this.options.ownerId,
        actionResolver: this.options.actionResolver,
        customHome: this.options.customHome,
        moduleLoader: this.platform.modules,
        // 委托优先级：最后一次绑定的 pendingInvoker 优先，否则透传显式注入的构造选项委托
        actionInvoker: this.pendingInvoker ?? this.options.actionInvoker,
      });
      // 服务创建后使用最后一次绑定的委托；单包独立使用保留 INVOCATION_UNSUPPORTED 限制
      if (!this.pendingInvoker && !this.options.actionInvoker) {
        const unsupportedInvoker: ActionInvoker = async () => {
          throw new ActionDockError(
            INVOCATION_UNSUPPORTED,
            "Cascaded action invocation (ctx.actions.invoke) is not supported in standalone PackageRuntime. Actions must be executed within an ActionDock Host."
          );
        };
        service.setActionInvoker?.(unsupportedInvoker);
      } else {
        service.setActionInvoker?.(this.pendingInvoker ?? this.options.actionInvoker);
      }
      this.executionSlot.instance = service;
      return service;
    } catch (err) {
      // 执行准备失败：只回收执行初始化独自新建的资源，不关闭仍被状态查询使用的包存储；
      // 在途 Promise 由 ensureExecutionService 的失败回调清空（不缓存永久失败，不后台轮询）
      throw err;
    }
  }

  /** 异步等待存储准备完成（供执行准备与异步入口复用；单一赋值入口） */
  private async prepareStorageAsync(): Promise<RuntimeStorage> {
    this.assertOpen();
    if (this.storageSlot.instance) {
      return this.storageSlot.instance;
    }
    return this.ensureStorage();
  }

  /** 获取已创建的执行服务（若存在），不触发创建 */
  private peekExecutionService(): DefaultExecutionService | undefined {
    return this.executionSlot.instance;
  }

  async info(options?: { exposeDebugInfo?: boolean }): Promise<PackageInfo> {
    this.assertOpen();
    const actionsMap = this.getStaticActionMap();
    const playbooksMap = this.getStaticPlaybookMap();
    const actions = Array.from(actionsMap.keys());
    const playbooks = Array.from(playbooksMap.keys());
    const showPackageRoot = (options?.exposeDebugInfo ?? this.options.exposeDebugInfo) !== false;

    return {
      id: this.packageId,
      name: this.projectConfig.name || this.packageId,
      version: this.projectConfig.version || "0.1.0",
      description: this.projectConfig.description,
      ...(showPackageRoot ? { packageRoot: this.packageRoot } : {}),
      actionsDir: this.projectConfig.actionsDir,
      playbooksDir: this.projectConfig.playbooksDir,
      config: sanitizeConfigDefinitions(this.projectConfig.config),
      actions,
      actionsCount: actions.length,
      playbooks,
      playbooksCount: playbooks.length,
    };
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    this.assertOpen();
    const map = this.getStaticActionMap();
    const summaries: ActionSummary[] = Array.from(map.values()).map((spec) => ({
      id: spec.id,
      packageId: this.packageId,
      description: spec.description,
      tags: spec.tags,
      entry: spec.entry,
      annotations: spec.annotations,
      uses: spec.uses,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
    }));
    return applyActionSummaryFilters(summaries, options);
  }

  async describeAction(id: string): Promise<ActionSpec> {
    this.assertOpen();
    const map = this.getStaticActionMap();

    let spec = map.get(id);
    if (!spec && id.startsWith(`${this.packageId}/`)) {
      spec = map.get(id.slice(this.packageId.length + 1));
    }
    if (!spec) {
      for (const [key, value] of map) {
        if (key === id || `${this.packageId}/${key}` === id) {
          spec = value;
          break;
        }
      }
    }

    // 仅读取内存注入动作与已存在（不触发创建）的执行服务缓存，不调用动态解析器
    const cachedService = this.peekExecutionService();
    const liveAction =
      this.actionsMap.get(id) ||
      (spec ? this.actionsMap.get(spec.id) : undefined) ||
      (cachedService?.getAction
        ? cachedService.getAction(id) || (spec ? cachedService.getAction(spec.id) : undefined)
        : undefined);

    if (liveAction) {
      // 第三方 Action 实例或内存注册 Action 可能存在规范外的运行时元数据扩展字段
      const actObj = liveAction as any;
      return {
        id: actObj.id || spec?.id || id,
        packageId: this.packageId,
        description: actObj.description ?? spec?.description,
        inputSchema: actObj.inputSchema ?? spec?.inputSchema,
        outputSchema: actObj.outputSchema ?? spec?.outputSchema,
        tags: actObj.tags ? [...actObj.tags] : spec?.tags,
        annotations: actObj.annotations ?? spec?.annotations,
        uses: actObj.uses ? [...actObj.uses] : spec?.uses,
        entry: spec?.entry,
        filePath: spec?.filePath,
      };
    }

    if (!spec) {
      throw new ActionDockError(ACTION_NOT_FOUND, `Action '${id}' not found in package '${this.packageId}'`);
    }

    return {
      ...spec,
      packageId: this.packageId,
    };
  }

  async listPlaybooks(): Promise<PlaybookSummary[]> {
    this.assertOpen();
    const map = this.getStaticPlaybookMap();
    return Array.from(map.values()).map((spec) => ({
      id: spec.id,
      packageId: this.packageId,
      description: spec.description,
      actions: spec.actions,
      filePath: spec.filePath,
    }));
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    this.assertOpen();
    const map = this.getStaticPlaybookMap();
    const cleanId = id.replace(/\.md$/, "");
    const spec = map.get(cleanId) || map.get(id);

    if (!spec) {
      throw new ActionDockError(NOT_FOUND, `Playbook '${id}' not found in package '${this.packageId}'`);
    }

    return {
      ...spec,
      packageId: this.packageId,
    };
  }

  private buildRootInvocationContext(actionId: string, options?: RunOptions): InvocationContext {
    const rootKey = `${this.packageId}/${actionId}`;
    return createRootInvocationContext({
      targetPackage: this.identity,
      callStack: [rootKey],
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      config: options?.config,
      requestId: options?.requestId,
      hostSessionId: this.options.hostSessionId,
      maxCallDepth: this.options.maxCallDepth,
      logger: this.options.logger,
      process: this.options.process ?? this.platform.process,
    });
  }

  async runAction(
    id: string,
    input: JsonValue,
    options?: RunOptions
  ): Promise<ExecutionResult> {
    const service = await this.prepareExecution();
    let actionId = id;
    if (actionId.includes("/")) {
      if (actionId.startsWith(`${this.packageId}/`)) {
        actionId = actionId.slice(this.packageId.length + 1);
      } else {
        throw new ActionDockError(
          INVOCATION_UNSUPPORTED,
          `PackageRuntime only accepts local action short ID '${id}'. Cross-package invocations must be dispatched via Host invoker.`
        );
      }
    }
    const context = this.buildRootInvocationContext(actionId, options);
    return service.execute(actionId, input, context);
  }

  async startAction(
    id: string,
    input: JsonValue,
    options?: RunOptions
  ): Promise<ExecutionTicket> {
    const service = await this.prepareExecution();
    let actionId = id;
    if (actionId.includes("/")) {
      if (actionId.startsWith(`${this.packageId}/`)) {
        actionId = actionId.slice(this.packageId.length + 1);
      } else {
        throw new ActionDockError(
          INVOCATION_UNSUPPORTED,
          `PackageRuntime only accepts local action short ID '${id}'. Cross-package invocations must be dispatched via Host invoker.`
        );
      }
    }
    const context = this.buildRootInvocationContext(actionId, options);
    return service.start(actionId, input, context);
  }

  async startInvocation(
    actionId: string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionTicket> {
    const service = await this.prepareExecution();
    let targetId = actionId;
    if (targetId.startsWith(`${this.packageId}/`)) {
      targetId = targetId.slice(this.packageId.length + 1);
    }
    return service.start(targetId, input, context);
  }

  /** 执行前统一准备：关闭检查与执行服务就绪 */
  private async prepareExecution(): Promise<DefaultExecutionService> {
    this.assertOpen();
    return this.ensureExecutionService();
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    this.assertOpen();
    // 历史读取复用存储能力，不创建执行服务
    const record = (await this.prepareStorageAsync()).getRun(runId);
    return record ?? undefined;
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    this.assertOpen();
    // 包已有执行服务时交由该服务处理活动任务与取消信号；
    // 没有服务时只读取历史记录，不为了取消不存在的本地活动任务创建执行服务
    const service = this.peekExecutionService();
    if (service) {
      return service.cancel(runId, reason);
    }
    const record = (await this.prepareStorageAsync()).getRun(runId);
    if (record) {
      return { outcome: "already_terminal", runId, status: record.status };
    }
    return { outcome: "not_found", runId };
  }

  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    this.assertOpen();
    // 已有执行服务时沿用其事件源；没有服务时复用注入/平台事件源，不新建执行服务
    const service = this.peekExecutionService();
    if (service) {
      return service.events(runId, options);
    }
    const sink = this.options.eventSink ?? this.platform.eventSink;
    if (sink) {
      return sink.subscribe(runId, options);
    }
    // 无任何事件源时返回空流（不新建执行服务）
    return (async function* () {})();
  }

  public setActionInvoker(invoker?: ActionInvoker): void {
    // 执行服务尚未创建时只保存委托，不触发资源初始化；服务创建后使用最后一次绑定的委托
    this.pendingInvoker = invoker;
    const service = this.peekExecutionService();
    if (service) {
      service.setActionInvoker?.(invoker);
    }
  }

  /**
   * Host 持有者路径预热入口：完成包存储准备（含运行记录恢复），不创建执行服务。
   * 延迟装配下旁观路径零资源创建，持有者工厂在返回前调用本方法保持既有初始化时机。
   */
  public async prepareResources(): Promise<void> {
    this.assertOpen();
    const storage = await this.prepareStorageAsync();
    // 注入存储路径也应执行会话级恢复：持有者预热返回前恢复必须完成（含返回 Promise 的实现）
    await this.recoverForHostSessionOnce(storage);
  }

  /**
   * 显式触发运行记录恢复（Host 持有者路径兼容入口）。
   * 延迟装配下恢复已收敛到存储准备路径，本方法确保存储已就绪后按需补一次会话恢复。
   */
  public recoverDeadSessionRuns(sessionId?: string): void {
    if (this.isClosed) {
      throw new ActionDockError(
        SERVICE_CLOSED,
        `PackageRuntime for package '${this.packageId}' is closed`
      );
    }
    const storage = this.storageSlot.instance ?? this.openStorageSync();
    if (typeof storage.recoverDeadSessionRuns === "function") {
      try {
        const result = storage.recoverDeadSessionRuns(sessionId ?? this.options.hostSessionId);
        if (result instanceof Promise) {
          void result.catch((err) => {
            console.warn(
              `[actiondock] recoverDeadSessionRuns failed for package '${this.packageId}': ${err instanceof Error ? err.message : String(err)}`
            );
          });
        }
      } catch (err) {
        console.warn(
          `[actiondock] recoverDeadSessionRuns failed for package '${this.packageId}': ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  async listConfig(): Promise<ConfigValueView[]> {
    this.assertOpen();
    const declared = this.projectConfig.config || {};
    const stored = (await this.prepareStorageAsync()).listConfig();
    const allKeys = Array.from(new Set([...Object.keys(declared), ...Object.keys(stored)]));
    const views: ConfigValueView[] = [];
    for (const key of allKeys) {
      const item = await this.getConfig(key);
      if (item) {
        views.push(item);
      }
    }
    return views;
  }

  async getConfig(key: string): Promise<ConfigValueView> {
    this.assertOpen();
    const itemDef = this.projectConfig.config?.[key];
    const isSecret = isSecretConfigKey(key, itemDef);

    // 委托 RuntimeConfig 五层优先级链单一事实源，避免重复实现解析链
    const resolved = this.ensureRuntimeConfig().describe(key);
    // overrides 来源对外统一星现为包级覆盖视角
    const source = resolved.source === "overrides" ? "package" : resolved.source;
    const configured = resolved.source !== "default";

    return {
      key,
      configured,
      secret: isSecret,
      source,
      value: isSecret ? undefined : (resolved.value as JsonValue),
    };
  }

  async setConfig(key: string, value: JsonValue): Promise<void> {
    this.assertOpen();
    await (await this.prepareStorageAsync()).setConfig(key, value);
  }

  async deleteConfig(key: string): Promise<boolean> {
    this.assertOpen();
    return await (await this.prepareStorageAsync()).deleteConfig(key);
  }

  /**
   * 将可能携带命名空间前缀的状态键解码为 (namespace, key)。
   * 解码失败时按无命名空间处理。
   */
  private decodeStateKeyParts(key: string): { namespace: string; key: string } {
    try {
      const decoded = decodeStateKey(key);
      return { namespace: decoded.namespace, key: decoded.key };
    } catch {
      return { namespace: "", key };
    }
  }

  private hasExplicitStateScope(options?: StateScopeOptions): boolean {
    return options?.actionId !== undefined || options?.namespace !== undefined;
  }

  private computeStateNamespace(options?: StateScopeOptions): string {
    const actionId = options?.actionId ?? "";
    return actionId
      ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
      : (options?.namespace ?? "");
  }

  private async getStateInternal<T extends JsonValue = JsonValue>(
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    const storage = await this.prepareStorageAsync();
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    if (options?.detail) {
      const entry = await storage.findState(key, explicitScope ? ns : undefined);
      return entry as unknown as T;
    }
    if (explicitScope || ns) {
      return await storage.getState<T>(ns, key);
    }
    const entry = await storage.findState<T>(key);
    return entry?.value as T | undefined;
  }

  private async setStateInternal<T extends JsonValue = JsonValue>(
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    const storage = await this.prepareStorageAsync();
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    if (explicitScope || ns) {
      await storage.setState<T>(ns, key, value, options?.ttl);
      return;
    }

    const target = this.decodeStateKeyParts(key);
    await storage.setState<T>(target.namespace, target.key, value, options?.ttl);
  }

  private async deleteStateInternal(
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    const storage = await this.prepareStorageAsync();
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    if (explicitScope || ns) {
      return await storage.deleteState(ns, key);
    }

    const target = this.decodeStateKeyParts(key);
    return await storage.deleteState(target.namespace, target.key);
  }

  private async listStateKeysInternal(
    options?: StateScopeOptions
  ): Promise<string[]> {
    const storage = await this.prepareStorageAsync();
    if (options?.namespace === null) {
      return storage.listStateKeys(null, options?.prefix);
    }
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    const targetNs = explicitScope ? ns : (ns ? ns : null);
    return storage.listStateKeys(targetNs, options?.prefix);
  }

  private async clearStateInternal(
    options?: StateScopeOptions
  ): Promise<number> {
    const storage = await this.prepareStorageAsync();
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    const targetNs = options?.all ? undefined : (explicitScope ? ns : (ns ? ns : undefined));
    return storage.clearState({
      namespace: targetNs,
      prefix: options?.prefix,
      all: options?.all,
    });
  }

  getState<T extends JsonValue = JsonValue>(
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;
  getState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;
  async getState<T extends JsonValue = JsonValue>(
    arg1: string,
    arg2?: string | StateScopeOptions,
    arg3?: StateScopeOptions
  ): Promise<T | undefined> {
    this.assertOpen();
    const { key, options } = normalizeStateReadArgs(arg1, arg2, arg3);
    return this.getStateInternal<T>(key, options);
  }

  setState<T extends JsonValue = JsonValue>(
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void>;
  setState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void>;
  async setState<T extends JsonValue = JsonValue>(
    arg1: string,
    arg2: any,
    arg3?: any,
    arg4?: StateScopeOptions
  ): Promise<void> {
    this.assertOpen();
    const { key, value, options } = normalizeStateWriteArgs<T>(
      arg1,
      arg2,
      arg3,
      arg4,
      arguments.length
    );
    return this.setStateInternal<T>(key, value, options);
  }

  deleteState(
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;
  deleteState(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;
  async deleteState(
    arg1: string,
    arg2?: string | StateScopeOptions,
    arg3?: StateScopeOptions
  ): Promise<boolean> {
    this.assertOpen();
    const { key, options } = normalizeStateReadArgs(arg1, arg2, arg3);
    return this.deleteStateInternal(key, options);
  }

  async getActionState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    if (options?.actionId !== undefined && options.actionId !== actionId) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${options.actionId}'`
      );
    }
    return this.getStateInternal<T>(key, { ...options, actionId });
  }

  async setActionState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    if (options?.actionId !== undefined && options.actionId !== actionId) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${options.actionId}'`
      );
    }
    return this.setStateInternal<T>(key, value, { ...options, actionId });
  }

  async deleteActionState(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    if (options?.actionId !== undefined && options.actionId !== actionId) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${options.actionId}'`
      );
    }
    return this.deleteStateInternal(key, { ...options, actionId });
  }

  listStateKeys(
    options?: StateScopeOptions
  ): Promise<string[]>;
  listStateKeys(
    actionId?: string,
    options?: StateScopeOptions
  ): Promise<string[]>;
  async listStateKeys(
    actionIdOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<string[]> {
    this.assertOpen();
    const normalizedOptions = normalizeStateScopeArgs(actionIdOrOptions, options);
    return this.listStateKeysInternal(normalizedOptions);
  }

  clearState(
    options?: StateScopeOptions
  ): Promise<number>;
  clearState(
    actionId?: string,
    options?: StateScopeOptions
  ): Promise<number>;
  async clearState(
    actionIdOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<number> {
    this.assertOpen();
    const normalizedOptions = normalizeStateScopeArgs(actionIdOrOptions, options);
    return this.clearStateInternal(normalizedOptions);
  }

  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    this.assertOpen();
    return (await this.prepareStorageAsync()).listRuns({
      actionId: options?.actionId,
      status: options?.status,
      limit: options?.limit,
    });
  }

  async clearRuns(options?: {
    actionId?: string;
    status?: string;
    olderThanMs?: number;
    keep?: number;
  }): Promise<number> {
    this.assertOpen();
    return (await this.prepareStorageAsync()).clearRuns({
      actionId: options?.actionId,
      status: options?.status,
      olderThanMs: options?.olderThanMs,
      keep: options?.keep,
    });
  }

  async cleanExpiredRuns(policy?: import("../storage/types").RunsRetentionPolicy): Promise<number> {
    this.assertOpen();
    const storage = await this.prepareStorageAsync();
    return storage.cleanExpiredRuns?.(policy) ?? 0;
  }

  async listStateEntries(options?: any): Promise<import("../storage/types").StateEntry[]> {
    this.assertOpen();
    const storage = await this.prepareStorageAsync();
    if (typeof storage.listStateEntries === "function") {
      return storage.listStateEntries(options);
    }
    throw new ActionDockError(
      CAPABILITY_UNAVAILABLE,
      `CAPABILITY_UNAVAILABLE: listStateEntries is not supported by package '${this.packageId}' storage`
    );
  }

  async close(options?: { graceMs?: number }): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    // 等待已经开始的资源准备结算；初始化完成后不把实例发布给已关闭对象
    const pendingStorage = this.storageSlot.initPromise?.catch(() => undefined);
    const pendingExecution = this.executionSlot.initPromise?.catch(() => undefined);
    await Promise.allSettled([pendingStorage, pendingExecution]);

    const service = this.executionSlot.instance;
    this.executionSlot.instance = undefined;
    this.executionSlot.initPromise = undefined;

    try {
      if (service) {
        await service.close(options);
      }
    } finally {
      const storage = this.storageSlot.instance;
      this.storageSlot.instance = undefined;
      this.storageSlot.initPromise = undefined;
      try {
        storage?.close();
      } catch {
        // 忽略存储重复关闭异常
      } finally {
        // 共享全局库由 Host 关闭；独立包自建的全局库由包关闭；外部注入存储不在此关闭
        const globalRes = this.globalStorageRes;
        this.globalStorageRes = undefined;
        if (globalRes?.kind === "own") {
          try {
            globalRes.storage.close();
          } catch {
            // 忽略全局存储关闭异常
          }
        }
      }
    }
  }
}

/**
 * 工厂函数：创建并初始化 PackageRuntime 实例。
 */
export async function createPackageRuntime(
  options: PackageRuntimeOptions = {}
): Promise<PackageRuntime> {
  return new DefaultPackageRuntime(options);
}
