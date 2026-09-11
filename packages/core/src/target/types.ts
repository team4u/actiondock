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

/**
 * 统一协议版本常量。
 */
export const ACTIONDOCK_PROTOCOL_VERSION = "2.0";

/**
 * Target 错误码常量。
 */
export const TARGET_PROTOCOL_UNSUPPORTED = "TARGET_PROTOCOL_UNSUPPORTED";
export const TARGET_CAPABILITY_UNAVAILABLE = "TARGET_CAPABILITY_UNAVAILABLE";
export const TARGET_RESULT_UNKNOWN = "TARGET_RESULT_UNKNOWN";

/**
 * 结构化 Target 异常类。
 */
export class TargetError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TargetError";
    this.code = code;
    this.details = details;
  }
}

/**
 * 关闭超时异常类。
 */
export class CloseTimeoutError extends Error {
  readonly runIds?: string[];
  constructor(message = "Target close operation timed out", runIds?: string[]) {
    super(message);
    this.name = "CloseTimeoutError";
    this.runIds = runIds;
  }
}

/**
 * 幂等性保留策略。
 */
export interface IdempotencyPolicy {
  /** 去重记录保留时长（毫秒） */
  retentionMs?: number;
  /** 去重请求头标识字段名 */
  header?: string;
  [key: string]: unknown;
}

/**
 * 统一目标自省元数据信息。
 */
export interface TargetInfo {
  /** 目标宿主唯一标识 */
  id: string;
  /** 目标宿主名称 */
  name: string;
  /** 统一通信协议版本 */
  protocolVersion: string;
  /** 已加载或已发现的包清单 */
  packages: PackageInfo[];
  /** 服务端声明的能力集合 */
  capabilities: string[];
  /** 去重记录保留与幂等策略 */
  idempotencyPolicy?: IdempotencyPolicy;
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
 * ActionDockTarget 统一调用门面契约。
 * 为 CLI、SDK 及扩展系统屏蔽本地执行与远程调用的物理拓扑差异。
 */
export interface ActionDockTarget {
  /** 获取统一目标自省元数据信息 */
  info(): Promise<TargetInfo>;

  /** 列出目标所有已加载的包清单 */
  listPackages(): Promise<PackageInfo[]>;

  /** 静态列出目标所有可用的 Action 摘要 */
  listActions(options?: ListActionsOptions): Promise<ActionSummary[]>;

  /** 静态查询并返回指定 Action 的规范结构与模式定义 */
  describeAction(ref: ActionRef | string): Promise<ActionSpec>;

  /** 静态列出目标所有可用的 Playbook 规程摘要 */
  listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]>;

  /** 静态查询并返回指定 Playbook 的规范内容与操作指南 */
  describePlaybook(id: string): Promise<PlaybookSpec>;

  /** 同步执行指定 Action 并等待终态结果 */
  runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>;

  /** 异步启动指定 Action 并立即返回任务执行票据 */
  startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket>;

  /** 查询最近的任务执行记录列表 */
  listRuns(options?: ListRunsOptions): Promise<RunRecord[]>;

  /** 查询指定运行标识的记录详情 */
  getRun(runId: string): Promise<RunRecord | undefined>;

  /** 取消指定在运行的任务 */
  cancelRun(runId: string, reason?: string): Promise<CancelResult>;

  /** 清空历史任务运行记录 */
  clearRuns?(options?: { packageId?: string; actionId?: string; status?: string }): Promise<number>;

  /** 订阅指定运行的事件流 */
  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent>;

  /** 获取指定包的单项配置安全视图 */
  getConfig(packageId: string, key: string): Promise<ConfigValueView>;

  /** 写入或覆盖指定包的配置项 */
  setConfig(packageId: string, key: string, value: JsonValue): Promise<void>;

  /** 删除指定包的指定配置项 */
  deleteConfig(packageId: string, key: string): Promise<boolean>;

  /** 列出指定包所有配置项的安全视图列表 */
  listConfig(packageId: string): Promise<ConfigValueView[]>;

  /** 获取指定包指定动作的作用域状态值 */
  getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;

  /** 写入指定包指定动作的作用域状态值 */
  setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void>;

  /** 删除指定包指定动作的作用域状态项 */
  deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;

  /** 列出指定包指定动作在存储中的状态键名列表 */
  listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]>;

  /** 清空指定包指定动作在存储中的状态条目 */
  clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number>;

  /** 列出指定包在存储中的状态条目（含完整元数据） */
  listStateEntries?(packageId: string, options?: any): Promise<StateEntry[]>;

  /** 解包被包装的内部宿主或应用实例（仅本地包装型目标存在） */
  unwrap?(): ActionDockHost | ActionDockApp | undefined;

  /** 关闭目标连接并清理底层资源 */
  close(options?: { timeoutMs?: number }): Promise<void>;
}

/**
 * 历史任务执行记录检索查询选项。
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
 * 本地 Target 初始化选项。
 */
export interface LocalTargetOptions {
  type?: "local";
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
}

/**
 * 远程 Target 初始化选项。
 */
export interface RemoteTargetOptions {
  type?: "remote";
  /** 远端 ActionDock 服务 HTTP 根地址 */
  serverUrl: string;
  /** 鉴权 Bearer Token（可选） */
  token?: string;
  /** 是否允许向非回环地址发送明文 HTTP 请求（默认 false） */
  allowInsecureHttp?: boolean;
  /** 请求超时时间（毫秒） */
  timeoutMs?: number;
  /** 轮询等待基准底线超时时间（毫秒，默认 60000ms） */
  baseTimeoutMs?: number;
}

/**
 * 监督进程 IPC 目标初始化选项。
 */
export interface IpcTargetOptions {
  type?: "ipc";
  /** 已启动的子进程实例（需具备 IPC 通道） */
  childProcess?: any;
  /** 待启动的脚本物理路径 */
  scriptPath?: string;
  /** 启动参数 */
  scriptArgs?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string | undefined>;
  /** 诊断流单流最大转发字节数 */
  maxDiagnosticBytes?: number;
  /** 诊断流每秒最大字节速率 */
  maxDiagnosticRate?: number;
  /** 诊断流目标输出 */
  diagnosticTarget?: any;
}

/**
 * Target 统一工厂选项参数。
 */
export type TargetOptions = LocalTargetOptions | RemoteTargetOptions | IpcTargetOptions;
