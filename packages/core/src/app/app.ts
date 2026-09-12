import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ActionDefinition,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import { DefaultExecutionService } from "../execution/service";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionService,
  ExecutionTicket,
} from "../execution/types";
import { createDefaultPlatform, type RuntimePlatform } from "../platform";
import { findProjectRoot, loadPlaybooks, loadProjectConfig } from "../project/loader";
import { loadManifest } from "../project/manifest";
import type { ProjectConfig } from "../project/types";
import { RuntimeConfig } from "../runtime/context";
import { normalizeActionCollection } from "../runtime/action-collection";
import { createGlobalStorage, createLazyStorage, createStorage } from "../storage";
import { isSecretConfigKey, sanitizeConfigDefinitions } from "../storage/mask";
import { decodeStateKey, SqliteRuntimeStorage } from "../storage/sqlite";
import type { RuntimeStorage } from "../storage/types";
import type {
  ActionDockApp,
  ActionDockAppOptions,
  ActionSpec,
  ActionSummary,
  ConfigValueView,
  ListActionsOptions,
  PackageInfo,
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
  public readonly packageId: string;
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
        try {
          projectConfig = loadProjectConfig(packageRoot);
        } catch {
          // 忽略解析失败，使用回退配置
        }
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
    this.packageId = projectConfig.id;

    // 2. 转换 Action 集合：委托归一化单一入口
    this.actionsMap = normalizeActionCollection(options.actions).actionsMap;

    // 3. 确定平台适配层
    this.platform = options.platform ?? createDefaultPlatform();

    // 4. 确定并初始化存储实例
    if (options.storage) {
      this.storage = options.storage;
    } else {
      const storageOpts: StorageFactoryOptions = {
        projectRoot: this.packageRoot,
        dataDir: options.dataDir,
        customHome: options.customHome,
        inMemory: options.inMemory,
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
      packageId: this.packageId,
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
   * 不产生全量模块导入与执行副作用。
   */
  private getStaticActionMap(): Map<string, ActionSpec> {
    const map = new Map<string, ActionSpec>();

    // 1. 读取声明式清单文件 (actiondock.json)
    if (this.packageRoot) {
      try {
        const manifest = loadManifest(this.packageRoot);
        if (manifest?.actions) {
          for (const [id, item] of Object.entries(manifest.actions)) {
            map.set(id, {
              id,
              packageId: this.packageId,
              description: item.description,
              inputSchema: item.inputSchema,
              outputSchema: item.outputSchema,
              tags: item.tags ? [...item.tags] : [],
              annotations: item.annotations,
              uses: item.uses ? [...item.uses] : [],
              entry: item.entry,
              filePath: item.entry ? resolve(this.packageRoot, item.entry) : undefined,
            });
          }
        }
      } catch {
        // 忽略清单缺失或解析异常
      }
    }

    // 2. 读取项目配置文件中声明的 actions (Manifest v2 格式)
    if (this.projectConfig && this.projectConfig.actions) {
      const rawActions = this.projectConfig.actions;
      if (typeof rawActions === "object" && rawActions !== null) {
        for (const [id, item] of Object.entries(rawActions as Record<string, any>)) {
          const existing = map.get(id);
          map.set(id, {
            id,
            packageId: this.packageId,
            description: item.description ?? existing?.description,
            inputSchema: item.inputSchema ?? existing?.inputSchema,
            outputSchema: item.outputSchema ?? existing?.outputSchema,
            tags: item.tags ?? existing?.tags,
            annotations: item.annotations ?? existing?.annotations,
            uses: item.uses ?? existing?.uses,
            entry: item.entry ?? existing?.entry,
            filePath: item.entry && this.packageRoot
              ? resolve(this.packageRoot, item.entry)
              : existing?.filePath,
          });
        }
      }
    }

    // 3. 读取内存显式注入的 Action 定义
    for (const [id, act] of this.actionsMap) {
      const existing = map.get(id);
      const actObj = act as any;
      map.set(id, {
        id,
        packageId: this.packageId,
        description: actObj.description ?? existing?.description,
        inputSchema: actObj.inputSchema ?? existing?.inputSchema,
        outputSchema: actObj.outputSchema ?? existing?.outputSchema,
        tags: actObj.tags ? [...actObj.tags] : existing?.tags,
        annotations: actObj.annotations ?? existing?.annotations,
        uses: actObj.uses ? [...actObj.uses] : existing?.uses,
        entry: existing?.entry,
        filePath: existing?.filePath,
      });
    }

    return map;
  }

  /**
   * 静态读取并聚合当前包的 Playbook 规范索引。
   */
  private getStaticPlaybookMap(): Map<string, PlaybookSpec> {
    const map = new Map<string, PlaybookSpec>();

    // 1. 扫描磁盘规程文件
    if (this.packageRoot) {
      const playbooksDir = this.projectConfig?.playbooksDir || "playbooks";
      const dirPath = join(this.packageRoot, playbooksDir);
      if (existsSync(dirPath)) {
        try {
          const loaded = loadPlaybooks(this.packageRoot, playbooksDir);
          for (const [id, def] of loaded) {
            map.set(id, {
              id: def.id,
              packageId: this.packageId,
              description: def.description,
              actions: def.actions,
              content: def.content,
              filePath: def.filePath,
            });
          }
        } catch {
          // 忽略规程加载异常
        }
      }
    }

    // 2. 读取项目配置文件中的 playbooks
    if (this.projectConfig && this.projectConfig.playbooks) {
      const rawPlaybooks = this.projectConfig.playbooks;
      if (typeof rawPlaybooks === "object" && rawPlaybooks !== null) {
        for (const [id, item] of Object.entries(rawPlaybooks as Record<string, any>)) {
          const existing = map.get(id);
          let content = item.content ?? existing?.content ?? "";
          let filePath = item.entry && this.packageRoot
            ? resolve(this.packageRoot, item.entry)
            : existing?.filePath;

          if (!content && filePath && existsSync(filePath)) {
            try {
              content = readFileSync(filePath, "utf-8");
            } catch {
              // 忽略读取异常
            }
          }

          map.set(id, {
            id,
            packageId: this.packageId,
            description: item.description ?? existing?.description,
            actions: item.actions ?? existing?.actions,
            content,
            filePath,
          });
        }
      }
    }

    return map;
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

  async getState<T extends JsonValue = JsonValue>(
    actionIdOrKey: string,
    keyOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    let actionId: string;
    let key: string;
    let opts: StateScopeOptions | undefined;

    if (typeof keyOrOptions === "string") {
      actionId = actionIdOrKey;
      key = keyOrOptions;
      opts = options;
      if (opts?.actionId && opts.actionId !== actionId) {
        throw new Error(
          `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${opts.actionId}'`
        );
      }
    } else {
      actionId = "";
      key = actionIdOrKey;
      opts = keyOrOptions;
    }
    if (!actionId && opts?.actionId) {
      actionId = opts.actionId;
    }

    const ns = actionId
      ? (opts?.namespace ? `${actionId}:${opts.namespace}` : actionId)
      : (opts?.namespace ?? "");

    if (opts?.detail) {
      const entry = await this.storage.findState(key, ns || undefined);
      return entry as unknown as T;
    }
    if (actionId) {
      return await this.storage.getState<T>(ns, key);
    }
    if (ns) {
      return await this.storage.getState<T>(ns, key);
    }
    const entry = await this.storage.findState<T>(key);
    return entry?.value as T | undefined;
  }

  async setState<T extends JsonValue = JsonValue>(
    actionIdOrKey: string,
    keyOrValue: any,
    valueOrOptions?: any,
    options?: StateScopeOptions
  ): Promise<void> {
    let actionId: string;
    let key: string;
    let value: T;
    let opts: StateScopeOptions | undefined;

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

  async deleteState(
    actionIdOrKey: string,
    keyOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<boolean> {
    let actionId: string;
    let key: string;
    let opts: StateScopeOptions | undefined;

    if (typeof keyOrOptions === "string") {
      actionId = actionIdOrKey;
      key = keyOrOptions;
      opts = options;
      if (opts?.actionId && opts.actionId !== actionId) {
        throw new Error(
          `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${opts.actionId}'`
        );
      }
    } else {
      actionId = "";
      key = actionIdOrKey;
      opts = keyOrOptions;
    }
    if (!actionId && opts?.actionId) {
      actionId = opts.actionId;
    }

    const ns = actionId
      ? (opts?.namespace ? `${actionId}:${opts.namespace}` : actionId)
      : (opts?.namespace ?? "");

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
    if (options?.actionId && options.actionId !== actionId) {
      throw new Error(
        `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${options.actionId}'`
      );
    }
    const ns = options?.namespace ? `${actionId}:${options.namespace}` : actionId;
    if (options?.detail) {
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
    if (options?.actionId && options.actionId !== actionId) {
      throw new Error(
        `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${options.actionId}'`
      );
    }
    const ns = options?.namespace ? `${actionId}:${options.namespace}` : actionId;
    await this.storage.setState<T>(ns, key, value, options?.ttl);
  }

  async deleteActionState(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    if (options?.actionId && options.actionId !== actionId) {
      throw new Error(
        `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${options.actionId}'`
      );
    }
    const ns = options?.namespace ? `${actionId}:${options.namespace}` : actionId;
    return await this.storage.deleteState(ns, key);
  }

  async listStateKeys(
    actionIdOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<string[]> {
    let actionId: string;
    let opts: StateScopeOptions | undefined;

    if (typeof actionIdOrOptions === "string") {
      actionId = actionIdOrOptions;
      opts = options;
      if (opts?.actionId && opts.actionId !== actionId) {
        throw new Error(
          `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${opts.actionId}'`
        );
      }
    } else {
      actionId = "";
      opts = actionIdOrOptions;
    }
    if (!actionId && opts?.actionId) {
      actionId = opts.actionId;
    }

    const ns = actionId
      ? (opts?.namespace ? `${actionId}:${opts.namespace}` : actionId)
      : (opts?.namespace ?? null);
    return this.storage.listStateKeys(ns, opts?.prefix);
  }

  async clearState(
    actionIdOrOptions?: string | StateScopeOptions,
    options?: StateScopeOptions
  ): Promise<number> {
    let actionId: string;
    let opts: StateScopeOptions | undefined;

    if (typeof actionIdOrOptions === "string") {
      actionId = actionIdOrOptions;
      opts = options;
      if (opts?.actionId && opts.actionId !== actionId) {
        throw new Error(
          `Conflicting actionId specified: positional '${actionId}' vs options.actionId '${opts.actionId}'`
        );
      }
    } else {
      actionId = "";
      opts = actionIdOrOptions;
    }
    if (!actionId && opts?.actionId) {
      actionId = opts.actionId;
    }

    const ns = actionId
      ? (opts?.namespace ? `${actionId}:${opts.namespace}` : actionId)
      : (opts?.namespace ?? undefined);
    return this.storage.clearState({
      namespace: ns,
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
