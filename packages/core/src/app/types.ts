import type {
  ActionDefinition,
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  RunRecord,
} from "@actiondock/sdk";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionService,
  ExecutionTicket,
} from "../execution/types";
import type { ConfigItemDefinition, ProjectConfig } from "../project/types";
import type { Clock } from "../runtime/clock";
import type { EventSink } from "../runtime/events";
import type { RuntimePlatform, StorageFactory, StorageFactoryOptions } from "../platform/types";
import type { RuntimeStorage } from "../storage/types";
import type { ConfigValueView, StateScopeOptions } from "../target/types";

export type { ConfigValueView, RuntimePlatform, StateScopeOptions, StorageFactory, StorageFactoryOptions };

/**
 * 宏包信息契约。
 */
export interface PackageInfo {
  /** 包唯一标识 */
  id: string;
  /** 包名称 */
  name: string;
  /** 包语义化版本号 */
  version: string;
  /** 包描述信息 */
  description?: string;
  /** 包根目录绝对物理路径 */
  packageRoot?: string;
  /** Action 脚本文件目录 */
  actionsDir?: string;
  /** Playbook SOP 文档目录 */
  playbooksDir?: string;
  /** 声明的项目依赖配置项清单 */
  config?: Record<string, ConfigItemDefinition>;
  /** 动作总数统计 */
  actionsCount?: number;
  /** 规程总数统计 */
  playbooksCount?: number;
  /** 动作标识符列表 */
  actions?: string[];
  /** 规程标识符列表 */
  playbooks?: string[];
}

/**
 * Action 简要摘要条目。
 */
export interface ActionSummary {
  /** Action 唯一标识 */
  id: string;
  /** 所属包唯一标识 */
  packageId?: string;
  /** Action 描述信息 */
  description?: string;
  /** 标签列表 */
  tags?: string[];
  /** 入口文件相对路径 */
  entry?: string;
  /** 协议注解元数据 */
  annotations?: Record<string, unknown>;
  /** 静态依赖的 Action 列表 */
  uses?: string[];
  /** 输入模式规范 */
  inputSchema?: Record<string, unknown> | boolean;
  /** 输出模式规范 */
  outputSchema?: Record<string, unknown> | boolean;
}

/**
 * Action 完整规范说明契约。
 */
export interface ActionSpec {
  /** Action 唯一标识 */
  id: string;
  /** 所属包唯一标识 */
  packageId?: string;
  /** Action 描述信息 */
  description?: string;
  /** 输入模式规范 */
  inputSchema?: Record<string, unknown> | boolean;
  /** 输出模式规范 */
  outputSchema?: Record<string, unknown> | boolean;
  /** 标签列表 */
  tags?: string[];
  /** 协议注解元数据 */
  annotations?: Record<string, unknown>;
  /** 静态依赖的 Action 列表 */
  uses?: string[];
  /** 入口文件相对路径 */
  entry?: string;
  /** 入口文件物理绝对路径 */
  filePath?: string;
}

/**
 * Action 列表检索查询选项。
 */
export interface ListActionsOptions {
  /** 标签筛选过滤列表 */
  tags?: string[];
  /** 模糊检索关键词（匹配标识或描述） */
  query?: string;
  /** 标识前缀过滤 */
  prefix?: string;
}

/**
 * Playbook 规程简要摘要条目。
 */
export interface PlaybookSummary {
  /** Playbook 唯一标识 */
  id: string;
  /** 所属包唯一标识 */
  packageId?: string;
  /** Playbook 描述信息 */
  description?: string;
  /** 规程所依赖或调用的 Action 列表 */
  actions?: string[];
  /** 物理源文件路径 */
  filePath?: string;
}

/**
 * Playbook 规程完整规范说明契约。
 */
export interface PlaybookSpec {
  /** Playbook 唯一标识 */
  id: string;
  /** 所属包唯一标识 */
  packageId?: string;
  /** Playbook 描述信息 */
  description?: string;
  /** 规程所依赖或调用的 Action 列表 */
  actions?: string[];
  /** Markdown 正文规程操作指南内容 */
  content: string;
  /** 物理源文件路径 */
  filePath?: string;
}

/**
 * 持久化状态读写操作选项。
 */
export interface StateOptions {
  /** 状态隔离命名空间 */
  namespace?: string;
  /** 存活有效期（秒），仅在设置状态时生效 */
  ttl?: number;
}

/**
 * ActionDockApp 初始化配置选项。
 */
export interface ActionDockAppOptions {
  /** 项目根目录绝对物理路径 */
  packageRoot?: string;
  /** 项目配置文件 (actiondock.json) 对象 */
  projectConfig?: ProjectConfig;
  /** 显式注入的运行时平台适配 */
  platform?: RuntimePlatform;
  /** 显式注入的项目级运行时存储实例 */
  storage?: RuntimeStorage;
  /** 显式注入的全局运行时存储实例 */
  globalStorage?: RuntimeStorage;
  /** 显式注入的事件接收器 */
  eventSink?: EventSink;
  /** 数据持久化存储目录 */
  dataDir?: string;
  /** 自定义家目录绝对路径 */
  customHome?: string;
  /** 是否采用纯内存运行模式 */
  inMemory?: boolean;
  /** 显式注入或预注册的 Action 集合 */
  actions?:
    | Map<string, ActionDefinition>
    | Array<{ id: string; action: ActionDefinition } | (ActionDefinition & { id: string })>
    | Record<string, ActionDefinition>;
  /** 跨包或动态 Action 解析器 */
  actionResolver?: (ref: ActionRef | string) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
  /** 跨包运行上下文解析委托函数 */
  packageContextResolver?: (packageId: string) => Promise<{
    projectRoot?: string;
    projectConfig?: ProjectConfig;
    storage: RuntimeStorage;
    actions?: Map<string, ActionDefinition>;
  } | undefined> | {
    projectRoot?: string;
    projectConfig?: ProjectConfig;
    storage: RuntimeStorage;
    actions?: Map<string, ActionDefinition>;
  } | undefined;
  /** 临时配置覆写字典 */
  configOverrides?: Record<string, unknown>;
  /** 宿主所有者标识 */
  ownerId?: string;
  /** 最大并发活跃运行数 */
  maxActiveRuns?: number;
  /** 最大调用嵌套深度 */
  maxCallDepth?: number;
  /** 最大子任务数限制 */
  maxSubRuns?: number;
  /** 执行宿主会话标识 */
  hostSessionId?: string;
  /** 日志记录器 */
  logger?: Logger;
  /** 时钟源 */
  clock?: Clock;
  /** 进程执行器 */
  process?: ProcessAPI;
  /** 是否暴露调试与物理路径信息 */
  exposeDebugInfo?: boolean;
}

/**
 * ActionDock 统一应用领域契约。
 * 作为单个 Action Package 的唯一运行单元与对外门面。
 */
export interface ActionDockApp {
  /** 包唯一标识 */
  readonly packageId: string;
  /** 包根目录绝对物理路径 */
  readonly packageRoot?: string;
  /** 项目配置对象（actiondock.json 解析结果） */
  readonly projectConfig: ProjectConfig;
  /** 底层运行平台驱动适配契约 */
  readonly platform: RuntimePlatform;
  /** 当前包持久化存储实例 */
  readonly storage: RuntimeStorage;
  /** 全局持久化存储实例 */
  readonly globalStorage?: RuntimeStorage;
  /** 统一执行协调服务实例 */
  readonly executionService: ExecutionService;
  /** 预加载的 Action 定义映射表（短标识至定义） */
  readonly actionsMap: Map<string, ActionDefinition>;

  /** 获取当前包元数据信息 */
  info(options?: { exposeDebugInfo?: boolean }): Promise<PackageInfo>;

  /** 静态列出当前包中所有可用的 Action 摘要 */
  listActions(options?: ListActionsOptions): Promise<ActionSummary[]>;

  /** 静态查询并返回指定 Action 的规范结构与模式定义 */
  describeAction(id: string): Promise<ActionSpec>;

  /** 静态列出当前包中所有可用的 Playbook 摘要 */
  listPlaybooks(): Promise<PlaybookSummary[]>;

  /** 静态查询并返回指定 Playbook 的规范内容与操作指南 */
  describePlaybook(id: string): Promise<PlaybookSpec>;

  /** 同步执行指定 Action 并等待终态结果（仅接受本包短标识） */
  runAction(
    id: string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>;

  /** 异步启动指定 Action 并立即返回任务执行票据（仅接受本包短标识） */
  startAction(
    id: string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket>;

  /** 查询指定运行标识的记录详情 */
  getRun(runId: string): Promise<RunRecord | undefined>;

  /** 取消指定在运行的任务 */
  cancelRun(runId: string, reason?: string): Promise<CancelResult>;

  /** 订阅指定运行的事件流 */
  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent>;

  /** 列出当前包的所有配置安全视图 */
  listConfig(): Promise<ConfigValueView[]>;

  /** 获取指定配置项的安全视图（按五层优先级链解析） */
  getConfig(key: string): Promise<ConfigValueView>;

  /** 写入持久化配置项 */
  setConfig(key: string, value: JsonValue): Promise<void>;

  /** 删除持久化配置项 */
  deleteConfig(key: string): Promise<boolean>;

  /** 获取指定持久化状态值 */
  getState<T extends JsonValue = JsonValue>(
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;
  getState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;

  /** 写入指定持久化状态值 */
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

  /** 删除指定持久化状态项 */
  deleteState(
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;
  deleteState(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;

  /** 显式获取指定 Action 命名空间的状态值 */
  getActionState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;

  /** 显式写入指定 Action 命名空间的状态值 */
  setActionState<T extends JsonValue = JsonValue>(
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void>;

  /** 显式删除指定 Action 命名空间的状态项 */
  deleteActionState(
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;

  /** 列出所有状态键 */
  listStateKeys(
    options?: StateScopeOptions
  ): Promise<string[]>;
  listStateKeys(
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]>;

  /** 清空指定持久化状态项 */
  clearState(
    options?: StateScopeOptions
  ): Promise<number>;
  clearState(
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number>;

  /** 优雅关闭应用并收尾清理所有底层资源 */
  close(options?: { graceMs?: number }): Promise<void>;
}
