import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import type {
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PackageInfo,
  PackageRuntime,
  PackageRuntimeOptions,
  PlaybookSpec,
  PlaybookSummary,
} from "../package/types";
import type {
  CancelResult,
  ExecutionTicket,
} from "../execution/types";
import type { RunOptions } from "../invocation/types";
import type { ActionDockHost, ActionDockHostOptions } from "../host/types";
import type { RuntimePlatform } from "../platform/types";
import type { StateEntry } from "../storage/types";
import { ActionDockError } from "../errors";

/**
 * 统一协议版本常量。
 */
export const ACTIONDOCK_PROTOCOL_VERSION = "2.0";

/**
 * 服务端/通信协议错误码常量。
 */
export const PROTOCOL_UNSUPPORTED = "PROTOCOL_UNSUPPORTED";
export const SERVICE_RESULT_UNKNOWN = "SERVICE_RESULT_UNKNOWN";
export const SERVICE_CLOSED = "SERVICE_CLOSED";

/**
 * 结构化服务通信异常类。
 */
export class ServiceError extends ActionDockError {
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "ServiceError";
    this.details = details;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

/**
 * 服务关闭超时异常类。
 */
export class CloseTimeoutError extends Error {
  readonly runIds?: string[];
  constructor(message = "Service close operation timed out", runIds?: string[]) {
    super(message);
    this.name = "CloseTimeoutError";
    this.runIds = runIds;
  }
}

/**
 * 服务自省元数据信息。
 */
export interface ServiceInfo {
  id: string;
  name: string;
  protocolVersion: string;
  packages: PackageInfo[];
  capabilities: string[];
  idempotencyPolicy?: {
    retentionMs?: number;
    header?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * 配置项安全视图契约。
 * 屏蔽敏感配置原文，仅暴露是否已配置、是否为秘密及实际解析来源。
 */
export interface ConfigValueView {
  /** 配置项键名 */
  key: string;
  /** 是否已显式配置或存在有效值 */
  configured: boolean;
  /** 是否为秘密敏感配置 */
  secret: boolean;
  /** 配置值实际解析来源 */
  source: string;
  /** 非秘密配置的实际数据值 */
  value?: JsonValue;
}

/**
 * 状态作用域与筛选控制选项。
 */
export interface StateScopeOptions {
  /** 显式绑定的 Action 标识 */
  actionId?: string;
  /** 显式子命名空间（相对于 Action 根命名空间） */
  namespace?: string;
  /** 存活有效期（秒），仅在写入状态时生效 */
  ttl?: number;
  /** 键名前缀过滤匹配 */
  prefix?: string;
  /** 是否清空所有条目 */
  all?: boolean;
  /** 是否返回完整条目详情 */
  detail?: boolean;
}

/**
 * 任务运行记录列表查询选项。
 */
export interface ListRunsOptions {
  /** 目标包唯一标识 */
  packageId?: string;
  /** Action 动作唯一标识 */
  actionId?: string;
  /** 运行终态状态筛选 */
  status?: string;
  /** 模糊意图检索模式 */
  intent?: string;
  /** 最大返回记录条数限制 */
  limit?: number;
}

/**
 * 远程服务连接配置选项。
 */
export interface RemoteServiceOptions {
  /** 远端 ActionDock 服务 HTTP 根地址 */
  serverUrl: string;
  /** 鉴权 Bearer Token（可选） */
  token?: string;
  /** 是否允许向非回环地址发送明文 HTTP 请求（默认 false） */
  allowInsecureHttp?: boolean;
  /** 是否跳过 TLS 证书合法性校验（用于局域网自签证书） */
  insecure?: boolean;
  /** 自定义底层 HTTP 调度器（平台中立） */
  dispatcher?: unknown;
  /** 请求超时时间（毫秒） */
  timeoutMs?: number;
  /** 轮询等待基准底线超时时间（毫秒，默认 60000ms） */
  baseTimeoutMs?: number;
  /** 是否启用配置与状态管理端口（默认 true） */
  enableManagement?: boolean;
}

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
    input?: unknown,
    options?: RunOptions
  ): Promise<ExecutionResult>;
  /** 异步启动指定 Action 并立即返回任务执行票据 */
  start(
    ref: ActionRef | string,
    input?: unknown,
    options?: RunOptions
  ): Promise<ExecutionTicket>;
}

/**
 * 运行事件订阅控制选项。
 */
export interface RunEventSubscriptionOptions {
  /** 起始游标位置（序号或标识） */
  after?: number | string;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 最大背压队列深度 */
  maxQueueSize?: number;
}

/**
 * 任务执行事件流服务端口。
 */
export interface EventsPort {
  /** 订阅指定运行的事件流 */
  events(runId: string, options?: RunEventSubscriptionOptions): AsyncIterable<ExecutionEvent>;
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
  /** 执行事件流服务端口（可选，若通道不支持流式事件则为 undefined） */
  events?: EventsPort;
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
  /** 模式类型（可选） */
  type?: "local";
  /** 包装的 ActionDockHost 实例 */
  host?: ActionDockHost;
  /** 包装的 PackageRuntime 实例 */
  runtime?: PackageRuntime;
  /** 包装的 PackageRuntime 实例别名 */
  packageRuntime?: PackageRuntime;
  /** 单包 PackageRuntime 初始化配置（若未提供 host/packageRuntime） */
  runtimeOptions?: PackageRuntimeOptions;
  /** 宿主 Host 初始化配置 */
  hostOptions?: ActionDockHostOptions;
  /** 当前工程根目录绝对路径 */
  projectRoot?: string;
  /** 是否自动加载当前工程（默认为 true） */
  autoLoadCurrentProject?: boolean;
  /** 预注册包配置列表 */
  packages?: Array<PackageRuntime | PackageRuntimeOptions>;
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
