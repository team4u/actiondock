import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
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
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import type { ActionDockHost, ActionDockHostOptions } from "../host/types";
import type { RuntimePlatform } from "../platform/types";
import type { StateEntry } from "../storage/types";
import type {
  ConfigValueView,
  ListRunsOptions,
  RemoteTargetOptions,
  StateScopeOptions,
} from "../target/types";

/**
 * 资产与元数据发现服务端口。
 */
export interface DiscoveryPort {
  /** 列出已注册的所有宏包元数据 */
  listPackages(): Promise<PackageInfo[]>;
  /** 列出所有可用的 Action 摘要 */
  listActions(options?: ListActionsOptions): Promise<ActionSummary[]>;
  /** 查询指定 Action 的规范结构与模式定义 */
  describeAction(ref: ActionRef | string): Promise<ActionSpec>;
  /** 列出可用的 Playbook 规程摘要 */
  listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]>;
  /** 查询指定 Playbook 的规范内容与操作指南 */
  describePlaybook(id: string): Promise<PlaybookSpec>;
}

/**
 * Action 执行调用服务端口。
 */
export interface ExecutionPort {
  /** 同步执行指定 Action 并等待终态结果 */
  run(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>;
  /** 异步启动指定 Action 并立即返回任务执行票据 */
  start(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket>;
}

/**
 * 任务运行记录管理服务端口。
 */
export interface RunsPort {
  /** 查询任务执行记录列表 */
  list(query?: ListRunsOptions): Promise<RunRecord[]>;
  /** 查询指定运行标识的记录详情 */
  get(runId: string): Promise<RunRecord | undefined>;
  /** 取消指定在运行的任务 */
  cancel(runId: string, reason?: string): Promise<CancelResult>;
  /** 订阅指定运行的事件流 */
  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent>;
  /** 清空历史任务运行记录 */
  clear?(options?: { packageId?: string; actionId?: string; status?: string }): Promise<number>;
}

/**
 * 配置项管理服务端口。
 */
export interface ConfigPort {
  /** 获取指定包的单项配置安全视图 */
  get(packageId: string, key: string): Promise<ConfigValueView>;
  /** 写入或覆盖指定包的配置项 */
  set(packageId: string, key: string, value: JsonValue): Promise<void>;
  /** 删除指定包的指定配置项 */
  delete(packageId: string, key: string): Promise<boolean>;
  /** 列出指定包所有配置项的安全视图列表 */
  list(packageId: string): Promise<ConfigValueView[]>;
}

/**
 * 状态存储管理服务端口。
 */
export interface StatePort {
  /** 获取指定包指定动作的作用域状态值 */
  get<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;
  /** 写入指定包指定动作的作用域状态值 */
  set<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void>;
  /** 删除指定包指定动作的作用域状态项 */
  delete(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;
  /** 列出指定包指定动作在存储中的状态键名列表 */
  list(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]>;
  /** 清空指定包指定动作在存储中的状态条目 */
  clear(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number>;
  /** 列出指定包在存储中的状态条目（含完整元数据） */
  listEntries?(packageId: string, options?: any): Promise<StateEntry[]>;
}

/**
 * ActionDock 统一聚合服务端口契约。
 */
export interface ActionDockService {
  /** 获取所有包的基础信息概览 */
  info(): Promise<PackageInfo[]>;
  /** 发现服务端口 */
  discovery: DiscoveryPort;
  /** 执行服务端口 */
  execution: ExecutionPort;
  /** 运行记录服务端口 */
  runs: RunsPort;
  /** 管理服务端口（可选，若服务端未开启管理能力则为 undefined） */
  management?: {
    config: ConfigPort;
    state: StatePort;
  };
  /** 关闭服务并释放底层关联资源 */
  close(options?: { timeoutMs?: number; graceMs?: number }): Promise<void>;
}

/**
 * 创建 ActionDock 本地服务选项。
 */
export interface CreateActionDockOptions {
  /** 包装的 ActionDockHost 实例 */
  host?: ActionDockHost;
  /** 包装的 ActionDockApp 实例 */
  app?: ActionDockApp;
  /** 单包 App 初始化配置（若未提供 host/app） */
  appOptions?: ActionDockAppOptions;
  /** 宿主 Host 初始化配置 */
  hostOptions?: ActionDockHostOptions;
  /** 当前工程根目录绝对路径 */
  projectRoot?: string;
  /** 预注册包配置列表 */
  packages?: Array<ActionDockApp | ActionDockAppOptions>;
  /** 自定义 ActionDock 家目录 */
  customHome?: string;
  /** 是否采用纯内存运行模式 */
  inMemory?: boolean;
  /** 自定义全局数据存储目录 */
  dataDir?: string;
  /** 是否扫描已软链接的外部包 */
  scanLinkedPackages?: boolean;
  /** 运行时平台适配 */
  platform?: RuntimePlatform;
  /** 是否以数据目录持有者身份打开本地存储 */
  recoverOrphans?: boolean;
  /** 是否开启管理端口（默认 true） */
  enableManagement?: boolean;
}

/**
 * 连接 ActionDock 远程服务选项。
 */
export interface ConnectActionDockOptions {
  /** 远端 ActionDock 服务 HTTP 根地址 */
  serverUrl?: string;
  /** 鉴权 Bearer Token（可选） */
  token?: string;
  /** 是否允许向非回环地址发送明文 HTTP 请求（默认 false） */
  allowInsecureHttp?: boolean;
  /** 是否跳过 TLS 证书合法性校验 */
  insecure?: boolean;
  /** 自定义底层 HTTP 调度器 */
  dispatcher?: unknown;
  /** 请求超时时间（毫秒） */
  timeoutMs?: number;
  /** 轮询等待基准底线超时时间（毫秒，默认 60000ms） */
  baseTimeoutMs?: number;
  /** 是否开启管理端口（默认 true） */
  enableManagement?: boolean;
  /** 自定义 ActionDock 家目录（用于读取自定义位置 profiles.json） */
  customHome?: string;
}
