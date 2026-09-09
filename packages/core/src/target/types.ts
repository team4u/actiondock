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
} from "../app/types";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import type { ActionDockHost, ActionDockHostOptions } from "../host/types";
import type { RuntimePlatform } from "../platform/types";

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

  /** 查询指定运行标识的记录详情 */
  getRun(runId: string): Promise<RunRecord | undefined>;

  /** 取消指定在运行的任务 */
  cancelRun(runId: string, reason?: string): Promise<CancelResult>;

  /** 订阅指定运行的事件流 */
  events(
    runId: string,
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent>;

  /** 关闭目标连接并清理底层资源 */
  close(): Promise<void>;
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
