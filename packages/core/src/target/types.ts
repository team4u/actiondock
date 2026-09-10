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
 * ActionDockTarget 统一调用门面契约。
 * 为 CLI、SDK 及扩展系统屏蔽本地执行与远程调用的物理拓扑差异。
 */
export interface ActionDockTarget {
  /** 获取目标包或集群的元数据信息 */
  info(): Promise<PackageInfo | PackageInfo[]>;

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
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent>;

  /** 获取指定包的单项配置值 */
  getConfig(packageId: string, key: string): Promise<any>;

  /** 写入或覆盖指定包的配置项 */
  setConfig(packageId: string, key: string, value: JsonValue): Promise<void>;

  /** 删除指定包的指定配置项 */
  deleteConfig(packageId: string, key: string): Promise<boolean>;

  /** 列出指定包所有已配置的键值字典 */
  listConfig(packageId: string): Promise<Record<string, any>>;

  /** 获取指定包的状态项值 */
  getState<T = JsonValue>(packageId: string, key: string, options?: any): Promise<T | undefined>;

  /** 写入指定包的状态项值 */
  setState<T = JsonValue>(packageId: string, key: string, value: T, options?: any): Promise<void>;

  /** 删除指定包的状态项 */
  deleteState(packageId: string, key: string, options?: any): Promise<boolean>;

  /** 列出指定包在存储中的状态键名列表 */
  listStateKeys?(packageId: string, options?: any): Promise<string[]>;

  /** 清空指定包在存储中的状态条目 */
  clearState?(packageId: string, options?: any): Promise<number>;

  /** 列出指定包在存储中的状态条目（含完整元数据） */
  listStateEntries?(packageId: string, options?: any): Promise<StateEntry[]>;

  /** 关闭目标连接并清理底层资源 */
  close(): Promise<void>;
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
  /** 请求超时时间（毫秒） */
  timeoutMs?: number;
}

/**
 * Target 统一工厂选项参数。
 */
export type TargetOptions = LocalTargetOptions | RemoteTargetOptions;
