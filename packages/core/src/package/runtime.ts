import { randomUUID } from "node:crypto";
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
  ExecutionService,
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

/**
 * ActionDock 统一包运行时默认实现。
 * 封装并管理单个 Action Package 的执行引擎、静态元数据索引、配置与状态存储生命周期。
 */
export class DefaultPackageRuntime implements HostManagedPackageRuntime {
  public readonly identity: PackageIdentity;
  public readonly packageId: string;
  public readonly packageInstanceId: string;
  public readonly generationId: string;
  public readonly packageRoot?: string;
  public readonly projectConfig: ProjectConfig;
  private readonly platform: RuntimePlatform;
  private readonly storage: RuntimeStorage;
  private readonly globalStorage?: RuntimeStorage;
  private readonly executionService: ExecutionService;
  private readonly actionsMap: Map<string, ActionDefinition>;
  private readonly options: PackageRuntimeInternalOptions;
  private runtimeConfig: RuntimeConfig;
  private isClosed = false;
  private injectedGlobalStorage = false;
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

    // - 确定平台适配层
    this.platform = options.platform ?? createNodePlatform();

    // - 确定并初始化存储实例
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

      this.storage = this.platform.storage.createStorage(this.packageId, storageOpts);
    }

    // - 确定全局存储实例
    if (options.globalStorage) {
      this.globalStorage = options.globalStorage;
      this.injectedGlobalStorage = true;
    } else if (options.inMemory) {
      this.globalStorage = new SqliteRuntimeStorage({
        dbPath: ":memory:",
        packageId: "__global__",
      });
      this.injectedGlobalStorage = false;
    } else {
      const globalOpts = {
        customHome: options.customHome,
        dataDir: options.dataDir,
        inMemory: options.inMemory,
        // 与主存储保持同侧收割语义（全局库 runs 表为空集，收割无实际副作用）
        recoverOrphans: options.recoverOrphans !== false,
      };

      this.globalStorage = this.platform.storage.createGlobalStorage(globalOpts);
      this.injectedGlobalStorage = false;
    }

    // - 初始化唯一执行协调服务
    this.executionService = new DefaultExecutionService({
      identity: this.identity,
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
      eventSink: options.eventSink ?? this.platform.eventSink,
      maxActiveRuns: options.maxActiveRuns,
      ownerId: options.ownerId,
      actionResolver: options.actionResolver,
      customHome: options.customHome,
      moduleLoader: this.platform.modules,
      actionInvoker: options.actionInvoker,
    });

    if (!options.actionInvoker) {
      const unsupportedInvoker: ActionInvoker = async () => {
        throw new ActionDockError(
          INVOCATION_UNSUPPORTED,
          "Cascaded action invocation (ctx.actions.invoke) is not supported in standalone PackageRuntime. Actions must be executed within an ActionDock Host."
        );
      };
      this.executionService.setActionInvoker?.(unsupportedInvoker);
    }

    // - 初始化配置解析器
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

    const liveAction =
      this.actionsMap.get(id) ||
      (spec ? this.actionsMap.get(spec.id) : undefined) ||
      (this.executionService.getAction
        ? this.executionService.getAction(id) || (spec ? this.executionService.getAction(spec.id) : undefined)
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
    return this.executionService.execute(actionId, input, context);
  }

  async startAction(
    id: string,
    input: JsonValue,
    options?: RunOptions
  ): Promise<ExecutionTicket> {
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
    return this.executionService.start(actionId, input, context);
  }

  async startInvocation(
    actionId: string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionTicket> {
    let targetId = actionId;
    if (targetId.startsWith(`${this.packageId}/`)) {
      targetId = targetId.slice(this.packageId.length + 1);
    }
    return this.executionService.start(targetId, input, context);
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
    this.executionService.setActionInvoker?.(invoker);
  }

  public recoverDeadSessionRuns(sessionId?: string): void {
    this.storage.recoverDeadSessionRuns?.(sessionId);
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
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    if (options?.detail) {
      const entry = await this.storage.findState(key, explicitScope ? ns : undefined);
      return entry as unknown as T;
    }
    if (explicitScope || ns) {
      return await this.storage.getState<T>(ns, key);
    }
    const entry = await this.storage.findState<T>(key);
    return entry?.value as T | undefined;
  }

  private async setStateInternal<T extends JsonValue = JsonValue>(
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    if (explicitScope || ns) {
      await this.storage.setState<T>(ns, key, value, options?.ttl);
      return;
    }

    const target = this.decodeStateKeyParts(key);
    await this.storage.setState<T>(target.namespace, target.key, value, options?.ttl);
  }

  private async deleteStateInternal(
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    if (explicitScope || ns) {
      return await this.storage.deleteState(ns, key);
    }

    const target = this.decodeStateKeyParts(key);
    return await this.storage.deleteState(target.namespace, target.key);
  }

  private async listStateKeysInternal(
    options?: StateScopeOptions
  ): Promise<string[]> {
    if (options?.namespace === null) {
      return this.storage.listStateKeys(null, options?.prefix);
    }
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    const targetNs = explicitScope ? ns : (ns ? ns : null);
    return this.storage.listStateKeys(targetNs, options?.prefix);
  }

  private async clearStateInternal(
    options?: StateScopeOptions
  ): Promise<number> {
    const explicitScope = this.hasExplicitStateScope(options);
    const ns = this.computeStateNamespace(options);
    const targetNs = options?.all ? undefined : (explicitScope ? ns : (ns ? ns : undefined));
    return this.storage.clearState({
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
    const normalizedOptions = normalizeStateScopeArgs(actionIdOrOptions, options);
    return this.clearStateInternal(normalizedOptions);
  }

  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    return this.storage.listRuns({
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
    return this.storage.clearRuns({
      actionId: options?.actionId,
      status: options?.status,
      olderThanMs: options?.olderThanMs,
      keep: options?.keep,
    });
  }

  async cleanExpiredRuns(policy?: import("../storage/types").RunsRetentionPolicy): Promise<number> {
    return this.storage.cleanExpiredRuns?.(policy) ?? 0;
  }

  async listStateEntries(options?: any): Promise<import("../storage/types").StateEntry[]> {
    if (typeof this.storage.listStateEntries === "function") {
      return this.storage.listStateEntries(options);
    }
    throw new ActionDockError(
      CAPABILITY_UNAVAILABLE,
      `CAPABILITY_UNAVAILABLE: listStateEntries is not supported by package '${this.packageId}' storage`
    );
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
        if (!this.injectedGlobalStorage) {
          try {
            this.globalStorage?.close();
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

