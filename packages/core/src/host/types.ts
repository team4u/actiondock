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
import type { Clock } from "../runtime/clock";
import type { EventSink } from "../runtime/events";
import type { RuntimePlatform } from "../platform/types";

/**
 * ActionDock 宿主容器初始化配置选项。
 */
export interface ActionDockHostOptions {
  /** 显式预注册的包列表（现成 ActionDockApp 实例或 ActionDockAppOptions 配置）。外部传入的 App 属于借用（borrowed），生命周期完全由调用方负责管理，Host 关闭或初始化失败时仅解绑引用并清理自身内部实例，严禁关闭外部借用的 App 实例。 */
  packages?: Array<ActionDockApp | ActionDockAppOptions>;
  /** 当前工程根目录绝对物理路径 */
  projectRoot?: string;
  /** 是否自动加载当前工程（默认为 true） */
  autoLoadCurrentProject?: boolean;
  /** 是否扫描已软链接的外部包（通过 listLinkedPackages，默认为 false） */
  scanLinkedPackages?: boolean;
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
}

/**
 * ActionDock 多包宿主容器领域契约。
 * 作为多包环境下的全局协调中枢，负责多包生命周期、完全限定引用路由、依赖校验与配额管理。
 */
export interface ActionDockHost {
  /** 获取所有已注册包的元数据信息列表 */
  info(): Promise<PackageInfo[]>;

  /** 静态列出所有已注册包中可用的 Action 摘要 */
  listActions(options?: ListActionsOptions): Promise<ActionSummary[]>;

  /** 静态查询并返回指定 Action 的规范结构与模式定义 */
  describeAction(ref: ActionRef | string): Promise<ActionSpec>;

  /** 静态列出所有已注册包中可用的 Playbook 规程摘要 */
  listPlaybooks(): Promise<PlaybookSummary[]>;

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

  /** 查询指定运行标识的记录详情 */
  getRun(runId: string): Promise<RunRecord | undefined>;

  /** 取消指定在运行的任务 */
  cancelRun(runId: string, reason?: string): Promise<CancelResult>;

  /** 订阅指定运行的事件流 */
  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent>;

  /** 根据包唯一标识获取指定 App 实例 */
  getApp(packageId: string): ActionDockApp | undefined;

  /** 获取所有当前已注册的 App 实例列表 */
  listApps(): ActionDockApp[];

  /** 注册新的 App 实例至当前宿主容器 */
  registerApp(app: ActionDockApp): void;

  /** 优雅关闭宿主容器。仅对内部创建的 App 实例执行 close 并安全释放底层资源；外部传入借用的 App 实例生命周期完全由调用方负责管理，Host 关闭时仅解绑引用并清理自身内部实例。 */
  close(options?: { graceMs?: number }): Promise<void>;
}
