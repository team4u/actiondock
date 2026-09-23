import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  RunRecord,
} from "@actiondock/sdk";
import type {
  PackageInfo,
  PackageRuntime,
  PackageRuntimeOptions,
  PackageRuntimeInternalOptions,
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PlaybookSpec,
  PlaybookSummary,
} from "../package/types";
import type {
  CancelResult,
  ExecutionTicket,
} from "../execution/types";
import type { RunOptions } from "../invocation/types";
import type { Clock } from "../runtime/clock";
import type { EventSink } from "../runtime/events";
import type { RuntimePlatform } from "../platform/types";
import type { ConfigValueView, ListRunsOptions, StateScopeOptions } from "../service/types";
import type { StateEntry } from "../storage/types";

/**
 * ActionDock 宿主容器初始化配置选项。
 */
export interface ActionDockHostOptions {
  /** 显式预注册的包列表（PackageRuntime 实例、PackageRuntimeOptions 配置或包目录物理路径）。Host 统一管理其生命周期，关闭时统一释放。 */
  packages?: Array<PackageRuntime | PackageRuntimeOptions | PackageRuntimeInternalOptions | string>;
  /** 当前工程根目录绝对物理路径 */
  projectRoot?: string;
  /** 是否自动加载当前工程（默认为 true） */
  autoLoadCurrentProject?: boolean;
  /** 是否扫描已软链接的外部包（通过 listLinkedPackages，默认为 false） */
  scanLinkedPackages?: boolean;
  /**
   * 是否以数据目录持有者身份打开包存储：true 时内部创建的 Runtime 存储在打开阶段
   * 收割遗留非终态运行记录。默认 true（Host 本身即持有者）；
   * CLI 查询命令创建旁观 Host 时显式置 false，避免误收割并发 serve 进程的在途运行。
   */
  recoverOrphans?: boolean;
  /** 显式注入的运行时平台适配 */
  platform?: RuntimePlatform;
  /** 全局最大并发活跃运行数 */
  maxActiveRuns?: number;
  /** 全局调用嵌套深度限制（默认 16） */
  maxCallDepth?: number;
  /** 全局子任务数限制（默认 64） */
  maxSubRuns?: number;
  /** 日志记录器 */
  logger?: Logger;
  /** 时钟源 */
  clock?: Clock;
  /** 进程执行器 */
  process?: ProcessAPI;
  /** 数据持久化存储目录 */
  dataDir?: string;
  /** 自定义 ActionDock 家目录 */
  customHome?: string;
  /** 是否采用纯内存运行模式 */
  inMemory?: boolean;
  /** 事件接收器 */
  eventSink?: EventSink;
  /** 是否开启管理能力（配置与状态管理） */
  enableManagement?: boolean;
}

/**
 * ActionDock 多包宿主容器领域契约。
 * 作为多包环境下的全局协调中枢，负责多包生命周期、完全限定引用路由、依赖校验与配额管理。
 */
export interface ActionDockHost {
  /** 宿主容器初始化配置项（只读） */
  readonly options?: ActionDockHostOptions;

  /** 获取所有已注册包的元数据信息列表 */
  info(): Promise<PackageInfo[]>;

  /** 静态列出所有已注册包中可用的 Action 摘要 */
  listActions(options?: ListActionsOptions): Promise<ActionSummary[]>;

  /** 静态查询并返回指定 Action 的规范结构与模式定义 */
  describeAction(ref: ActionRef | string): Promise<ActionSpec>;

  /** 静态列出所有已注册包中可用的 Playbook 规程摘要 */
  listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]>;

  /** 静态查询并返回指定 Playbook 的规范内容与操作指南 */
  describePlaybook(id: string): Promise<PlaybookSpec>;

  /** 同步执行指定 Action 并等待终态结果 */
  runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: RunOptions
  ): Promise<ExecutionResult>;

  /** 异步启动指定 Action 并立即返回任务执行票据 */
  startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: RunOptions
  ): Promise<ExecutionTicket>;

  /** 查询指定运行标识的记录详情 */
  getRun(runId: string): Promise<RunRecord | undefined>;

  /** 列出运行记录 */
  listRuns(query?: ListRunsOptions): Promise<RunRecord[]>;

  /** 清理运行记录 */
  clearRuns(options?: { packageId?: string; actionId?: string; status?: string; olderThanMs?: number }): Promise<number>;

  /** 取消指定在运行的任务 */
  cancelRun(runId: string, reason?: string): Promise<CancelResult>;

  /** 订阅指定运行的事件流 */
  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent>;

  /** 获取配置项视图 */
  getConfig(packageId: string, key: string): Promise<ConfigValueView>;

  /** 设置配置项 */
  setConfig(packageId: string, key: string, value: JsonValue): Promise<void>;

  /** 删除配置项 */
  deleteConfig(packageId: string, key: string): Promise<boolean>;

  /** 列出指定包（或 global）的全部配置项视图 */
  listConfig(packageId: string): Promise<ConfigValueView[]>;

  /** 获取状态项 */
  getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined>;

  /** 设置状态项 */
  setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void>;

  /** 删除状态项 */
  deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean>;

  /** 列出状态项键名 */
  listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]>;

  /** 清理状态项 */
  clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number>;

  /** 列出状态项明细 */
  listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]>;

  /** 根据包唯一标识获取指定 Runtime 实例 */
  getRuntime(packageId: string): PackageRuntime | undefined;

  /** 获取所有当前已注册的 Runtime 实例列表 */
  listRuntimes(): PackageRuntime[];

  /** 注册新的 Runtime 实例至当前宿主容器 */
  registerRuntime(runtime: PackageRuntime): void;

  /** 优雅关闭宿主容器。统一完整关闭所管理的所有 Runtime 实例并安全释放底层资源。 */
  close(options?: { graceMs?: number }): Promise<void>;
}
