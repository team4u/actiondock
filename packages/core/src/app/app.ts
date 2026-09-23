import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ActionDefinition,
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import { DefaultExecutionService } from "../execution/service";
import type {
  ActionInvoker,
  CancelResult,
  ExecuteOptions,
  ExecutionService,
  ExecutionTicket,
} from "../execution/types";
import { createNodePlatform, type RuntimePlatform } from "../platform";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { RuntimeConfig } from "../runtime/context";
import { normalizeActionCollection } from "../runtime/action-collection";
import { createGlobalStorage, createLazyStorage, createStorage } from "../storage";
import { isSecretConfigKey, sanitizeConfigDefinitions } from "../storage/mask";
import { decodeStateKey, SqliteRuntimeStorage } from "../storage/sqlite";
import type { RuntimeStorage } from "../storage/types";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";
import { buildStaticActionMap, buildStaticPlaybookMap } from "./static-index";
import type {
  ActionDockApp,
  ActionDockAppOptions,
  ActionSpec,
  ActionSummary,
  ConfigValueView,
  ListActionsOptions,
  PackageInfo,
  PackageRuntime,
  PlaybookSpec,
  PlaybookSummary,
  StateScopeOptions,
  StorageFactoryOptions,
} from "./types";

/**
 * ActionDock 统一应用默认实现。
 * 封装并管理单个 Action Package 的执行引擎、静态元数据索引、配置与状态存储生命周期。
 */
export class DefaultActionDockApp implements ActionDockApp {
  public readonly identity: PackageIdentity;
  public readonly packageId: string;
  public readonly packageInstanceId: string;
  public readonly generationId: string;
  public readonly packageRoot?: string;
  public readonly projectConfig: ProjectConfig;
  public readonly platform: RuntimePlatform;
  public readonly storage: RuntimeStorage;
  public readonly globalStorage?: RuntimeStorage;
  public readonly executionService: ExecutionService;

  public readonly actionsMap: Map<string, ActionDefinition>;
  private readonly options: ActionDockAppOptions;
  private runtimeConfig: RuntimeConfig;
  private isClosed = false;
  /** 静态清单索引缓存：包静态事实（根目录、配置、内存注入集合）在实例生命周期内不变，解析结果同实例内复用 */
  private staticActionIndex?: Map<string, ActionSpec>;
  private staticPlaybookIndex?: Map<string, PlaybookSpec>;

  constructor(options: ActionDockAppOptions = {}) {
    this.options = options;
    // 1. 确定项目根路径与配置对象
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
    this.identity = options.identity || createPackageIdentity({
      id: projectConfig.id,
      instanceId: options.packageInstanceId || (projectConfig as any).packageInstanceId,
      generation: options.generationId || (projectConfig as any).generationId,
    });
    this.packageId = this.identity.id;
    this.packageInstanceId = this.identity.instanceId;
    this.generationId = this.identity.generation;

    // 2. 转换 Action 集合：委托归一化单一入口
    this.actionsMap = normalizeActionCollection(options.actions).actionsMap;

    // 3. 确定平台适配层
    this.platform = options.platform ?? createNodePlatform();

    // 4. 确定并初始化存储实例
    if (options.storage) {
      this.storage = options.storage;
    } else {
      const storageOpts: StorageFactoryOptions = {
        projectRoot: this.packageRoot,
        dataDir: options.dataDir,
        customHome: options.customHome,
        inMemory: options.inMemory,
        // 默认持有者语义：App 主路径打开时收割死亡会话遗留非终态运行记录；
        // CLI 查询旁观视图显式置 recoverOrphans: false 跳过收割
        recoverOrphans: options.recoverOrphans !== false,
      };

      const storageFactory = this.platform.storage as any;
      const initStorage = () => {
        if (typeof storageFactory === "function") {
          return storageFactory(this.packageId, storageOpts);
        } else if (storageFactory && typeof storageFactory.createStorage === "function") {
          return storageFactory.createStorage(this.packageId, storageOpts);
        } else if (storageFactory && typeof storageFactory.create === "function") {
          return storageFactory.create(this.packageId, storageOpts);
        } else {
          return createStorage(this.packageId, storageOpts);
        }
      };

      if (options.inMemory) {
        this.storage = initStorage();
      } else {
        this.storage = createLazyStorage(initStorage);
      }
    }

    // 5. 确定全局存储实例
    if (options.globalStorage) {
      this.globalStorage = options.globalStorage;
    } else if (options.inMemory) {
      this.globalStorage = new SqliteRuntimeStorage({
        dbPath: ":memory:",
        packageId: "__global__",
      });
    } else {
      const globalOpts = {
        customHome: options.customHome,
        dataDir: options.dataDir,
        inMemory: options.inMemory,
        // 与主存储保持同侧收割语义（全局库 runs 表为空集，收割无实际副作用）
        recoverOrphans: options.recoverOrphans !== false,
      };

      const storageFactory = this.platform.storage as any;
      const initGlobalStorage = () => {
        if (storageFactory && typeof storageFactory.createGlobalStorage === "function") {
          return storageFactory.createGlobalStorage(globalOpts);
        }
        return createGlobalStorage(globalOpts);
      };

      this.globalStorage = createLazyStorage(initGlobalStorage);
    }

    // 6. 初始化唯一执行协调服务
    this.executionService = new DefaultExecutionService({
      identity: this.identity,
      packageId: this.packageId,
      packageInstanceId: this.packageInstanceId,
      generationId: this.generationId,
      hostSessionId: options.hostSessionId,
      storage: this.storage,
      globalStorage: this.globalStorage,
      projectRoot: this.packageRoot,
      projectConfig: this.projectConfig,
      configOverrides: options.configOverrides,
      actions: this.actionsMap,
      process: options.process ?? this.platform.process,
      clock: options.clock ?? this.platform.clock,
      logger: options.logger,
      eventSink: options.eventSink ?? (this.platform as any)?.eventSink,
      maxActiveRuns: options.maxActiveRuns,
      maxCallDepth: options.maxCallDepth,
      maxSubRuns: options.maxSubRuns,
      ownerId: options.ownerId,
      actionResolver: options.actionResolver,
      packageContextResolver: options.packageContextResolver,
      customHome: options.customHome,
      platform: this.platform,
      actionInvoker: options.actionInvoker,
    });

    // 7. 初始化配置解析器
    this.runtimeConfig = new RuntimeConfig(
      this.storage,
      options.configOverrides,
      this.projectConfig,
      this.globalStorage
    );
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

  async info(options?: { exposeDebugInfo?: boolean }): Promise<PackageInfo> {
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
    const map = this.getStaticActionMap();
    let summaries: ActionSummary[] = Array.from(map.values()).map((spec) => ({
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

    if (options?.tags && options.tags.length > 0) {
      summaries = summaries.filter((s) =>
        options.tags!.every((t) => s.tags?.includes(t))
      );
    }

    if (options?.query) {
      const q = options.query.toLowerCase();
      summaries = summaries.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      );
    }

    if (options?.prefix) {
      summaries = summaries.filter((s) => s.id.startsWith(options.prefix!));
    }

    return summaries;
  }

  async describeAction(id: string): Promise<ActionSpec> {
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

    let liveAction = this.actionsMap.get(id) || (spec ? this.actionsMap.get(spec.id) : undefined);
    if (!liveAction && this.executionService.getAction) {
      liveAction =
        this.executionService.getAction(id) ||
        (spec ? this.executionService.getAction(spec.id) : undefined);
    }
    if (!liveAction && this.executionService.runner?.resolveAction) {
      try {
        // 仅在本包范围内解析动态动作：限定 packageId 前缀，避免全局兜底搜索把
        // 其他包的动作误计为本包提供者（host 层据此统计候选导致 AMBIGUOUS_ACTION_REF 误报）。
        const qualifiedId = id.includes("/") ? id : `${this.packageId}/${id}`;
        const resolution = await this.executionService.runner.resolveAction(qualifiedId);
        if (resolution.status === "found") {
          liveAction = resolution.action;
        }
      } catch {
        // 忽略动态解析异常
      }
    }

    if (liveAction) {
      const actObj = liveAction as any;
      return {
        id: actObj.id || id,
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
      throw new Error(`Action '${id}' not found in package '${this.packageId}'`);
    }

    return {
      ...spec,
      packageId: this.packageId,
    };
  }

  async listPlaybooks(): Promise<PlaybookSummary[]> {
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
    const map = this.getStaticPlaybookMap();
    const cleanId = id.replace(/\.md$/, "");
    const spec = map.get(cleanId) || map.get(id);

    if (!spec) {
      throw new Error(`Playbook '${id}' not found in package '${this.packageId}'`);
    }

    return {
      ...spec,
      packageId: this.packageId,
    };
  }

  async runAction(
    id: string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    let actionId = id;
    if (actionId.includes("/")) {
      if (actionId.startsWith(`${this.packageId}/`)) {
        actionId = actionId.slice(this.packageId.length + 1);
      } else {
        throw new Error(
          `ActionDockApp only accepts local action short ID '${id}'. Cross-package invocations must be dispatched via Host invoker.`
        );
      }
    }
    return this.executionService.execute(actionId, input, options);
  }

  async startAction(
    id: string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    let actionId = id;
    if (actionId.includes("/")) {
      if (actionId.startsWith(`${this.packageId}/`)) {
        actionId = actionId.slice(this.packageId.length + 1);
      } else {
        throw new Error(
          `ActionDockApp only accepts local action short ID '${id}'. Cross-package invocations must be dispatched via Host invoker.`
        );
      }
    }
    return this.executionService.start(actionId, input, options);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    return this.executionService.get(runId);
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    return this.executionService.cancel(runId, reason);
  }

  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    return this.executionService.events(runId, options);
  }

  public setActionInvoker(invoker?: ActionInvoker): void {
    if (this.executionService && typeof (this.executionService as any).setActionInvoker === "function") {
      (this.executionService as any).setActionInvoker(invoker);
    }
  }

  async listConfig(): Promise<ConfigValueView[]> {
    const declared = this.projectConfig.config || {};
    const stored = this.storage.listConfig();
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
    const itemDef = this.projectConfig.config?.[key];
    const isSecret = isSecretConfigKey(key, itemDef);

    // 委托 RuntimeConfig 五层优先级链单一事实源，避免重复实现解析链
    const resolved = this.runtimeConfig.describe(key);
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
    await this.storage.setConfig(key, value);
  }

  async deleteConfig(key: string): Promise<boolean> {
    return await this.storage.deleteConfig(key);
  }

  /**
   * 状态作用域统一解析辅助函数（单一事实源）。
   *
   * 完成重载消歧与 actionId 冲突校验，返回最终生效的命名空间：
   * - actionId 存在时拼 接 `${actionId}:${namespace}` 或直接 actionId；
   * - 无 actionId 时返回显式 namespace 或空字符串（包级扁平状态）。
   */
  private resolveStateScope(
    actionIdOrKey: string | undefined,
    keyOrOptions: string | StateScopeOptions | undefined,
    options?: StateScopeOptions
  ): { ns: string; opts: StateScopeOptions | undefined } {
    let actionId: string;
    let resolvedOpts: StateScopeOptions | undefined;

    // 消歧规则（与原始重载语义严格一致）：仅当第二参为字符串时认定为
    // (actionId, key, options) 形态；否则（undefined 或选项对象）认定为
    // (key, options) 扁平调用形态，首参是状态键而非 actionId
    if (typeof keyOrOptions === "string") {
      actionId = actionIdOrKey as string;
      resolvedOpts = options;
      if (resolvedOpts?.actionId && resolvedOpts.actionId !== actionId) {
        throw new Error(
          `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${resolvedOpts.actionId}'`
        );
      }
    } else {
      // (key, options) 扁平调用：首参是状态键，无位置 actionId；
      // options.actionId 属于合法的显式指定，直接采纳而非判为冲突
      actionId = "";
      resolvedOpts = keyOrOptions;
    }
    if (!actionId && resolvedOpts?.actionId) {
      actionId = resolvedOpts.actionId;
    }

    const ns = actionId
      ? (resolvedOpts?.namespace ? `${actionId}:${resolvedOpts.namespace}` : actionId)
      : (resolvedOpts?.namespace ?? "");
    return { ns, opts: resolvedOpts };
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
    actionIdOrKey: string,
    keyOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    const { ns, opts } = this.resolveStateScope(actionIdOrKey, keyOrOptions, options);
    const key = typeof keyOrOptions === "string" ? keyOrOptions : actionIdOrKey;

    if (opts?.detail) {
      const entry = await this.storage.findState(key, ns || undefined);
      return entry as unknown as T;
    }
    if (ns) {
      return await this.storage.getState<T>(ns, key);
    }
    const entry = await this.storage.findState<T>(key);
    return entry?.value as T | undefined;
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
    options: StateScopeOptions
  ): Promise<void>;
  async setState<T extends JsonValue = JsonValue>(
    actionIdOrKey: string,
    keyOrValue: any,
    valueOrOptions?: any,
    options?: StateScopeOptions
  ): Promise<void> {
    let key: string;
    let value: T;
    let opts: StateScopeOptions | undefined;
    let actionId: string;

    if (arguments.length >= 4) {
      if (options?.actionId && options.actionId !== actionIdOrKey) {
        throw new Error(
          `Conflicting actionId specified: positional '${actionIdOrKey}' vs options.actionId '${options.actionId}'`
        );
      }
      actionId = actionIdOrKey;
      key = keyOrValue;
      value = valueOrOptions;
      opts = options;
    } else if (arguments.length === 2) {
      actionId = "";
      key = actionIdOrKey;
      value = keyOrValue;
      opts = undefined;
    } else {
      if (
        valueOrOptions !== undefined &&
        (typeof valueOrOptions !== "object" || valueOrOptions === null || Array.isArray(valueOrOptions))
      ) {
        throw new Error(
          "Invalid options provided to setState. Use setActionState(actionId, key, value, options) or 4-argument setState for action state."
        );
      }

      key = actionIdOrKey;
      value = keyOrValue as T;
      opts = valueOrOptions as StateScopeOptions | undefined;
      actionId = opts?.actionId ?? "";
    }

    const ns = actionId
      ? (opts?.namespace ? `${actionId}:${opts.namespace}` : actionId)
      : (opts?.namespace ?? "");

    if (ns) {
      await this.storage.setState<T>(ns, key, value, opts?.ttl);
      return;
    }

    let targetKey = key;
    let targetNs = "";
    try {
      const decoded = decodeStateKey(key);
      targetNs = decoded.namespace;
      targetKey = decoded.key;
    } catch {
      targetNs = "";
    }
    await this.storage.setState<T>(targetNs, targetKey, value, opts?.ttl);
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
    actionIdOrKey: string,
    keyOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<boolean> {
    const { ns } = this.resolveStateScope(actionIdOrKey, keyOrOptions, options);
    const key = typeof keyOrOptions === "string" ? keyOrOptions : actionIdOrKey;

    if (ns) {
      return await this.storage.deleteState(ns, key);
    }

    let targetKey = key;
    let targetNs = "";
    try {
      const decoded = decodeStateKey(key);
      targetNs = decoded.namespace;
      targetKey = decoded.key;
    } catch {
      targetNs = "";
    }
    return await this.storage.deleteState(targetNs, targetKey);
  }

  async getActionState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    const { ns, opts } = this.resolveStateScope(actionId, key, options);
    if (opts?.detail) {
      const entry = await this.storage.findState(key, ns || undefined);
      return entry as unknown as T;
    }
    return await this.storage.getState<T>(ns, key);
  }

  async setActionState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    const { ns, opts } = this.resolveStateScope(actionId, key, options);
    await this.storage.setState<T>(ns, key, value, opts?.ttl);
  }

  async deleteActionState(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    const { ns } = this.resolveStateScope(actionId, key, options);
    return await this.storage.deleteState(ns, key);
  }

  listStateKeys(
    options?: StateScopeOptions
  ): Promise<string[]>;
  listStateKeys(
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]>;
  async listStateKeys(
    actionIdOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<string[]> {
    // 重载消歧：首参为字符串时是 (actionId, options) 调用（完成冲突校验后取其域）；
    // 否则首参本身就是选项对象（或未传），取 options.actionId 或 namespace 扁平域
    let ns: string;
    if (typeof actionIdOrOptions === "string") {
      ns = this.resolveStateScope(actionIdOrOptions, "", options).ns;
    } else {
      const opts = actionIdOrOptions;
      ns = opts?.actionId
        ? (opts.namespace ? `${opts.actionId}:${opts.namespace}` : opts.actionId)
        : (opts?.namespace ?? "");
    }
    const opts = typeof actionIdOrOptions === "string" ? options : actionIdOrOptions;
    return this.storage.listStateKeys(ns ? ns : null, opts?.prefix);
  }

  clearState(
    options?: StateScopeOptions
  ): Promise<number>;
  clearState(
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number>;
  async clearState(
    actionIdOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<number> {
    // 首参为字符串时是 (actionId, options) 调用：以伪 key 消费冲突校验后取其 actionId 域；
    // 否则首参本身就是选项对象（或未传），直接走扁平分支
    if (typeof actionIdOrOptions === "string") {
      const { ns } = this.resolveStateScope(actionIdOrOptions, "", options);
      const finalNs = ns || (options?.namespace ?? "");
      return this.storage.clearState({
        namespace: finalNs ? finalNs : undefined,
        prefix: options?.prefix,
        all: options?.all,
      });
    }
    const opts = actionIdOrOptions;
    const ns = opts?.namespace;
    return this.storage.clearState({
      namespace: ns ? ns : undefined,
      prefix: opts?.prefix,
      all: opts?.all,
    });
  }

  async close(options?: { graceMs?: number }): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      await this.executionService.close(options);
    } finally {
      try {
        this.storage.close();
      } catch {
        // 忽略存储重复关闭异常
      } finally {
        try {
          this.globalStorage?.close();
        } catch {
          // 忽略全局存储关闭异常
        }
      }
    }
  }
}

/**
 * 工厂函数：创建并初始化 ActionDockApp 实例。
 */
export async function createActionDockApp(
  options: ActionDockAppOptions = {}
): Promise<ActionDockApp> {
  return new DefaultActionDockApp(options);
}
