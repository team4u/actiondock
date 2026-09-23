import type {
  ActionDockService,
} from "@actiondock/core";
import type {
  ActionDockHost,
  ServerTlsOptions,
} from "@actiondock/core/server";
import type {
  PackageRuntime,
  RuntimePlatform,
  RuntimeStorage,
} from "@actiondock/core/package";
import type { ActionDefinition, RunRecord, RunStatus } from "@actiondock/sdk";

/**
 * MCP 任务状态枚举（兼容 Model Context Protocol Task 规范）。
 */
export type McpTaskStatus = "working" | "completed" | "failed" | "cancelled";

/**
 * MCP 任务状态数据载荷结构体。
 */
export interface McpTaskPayload {
  taskId: string;
  status: McpTaskStatus;
  createdAt: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

/**
 * 将 ActionDock 内部的 RunStatus 转换为 MCP 标准的 TaskStatus。
 */
export function toMcpTaskStatus(status: RunStatus): McpTaskStatus {
  switch (status) {
    case "running":
      return "working";
    case "success":
      return "completed";
    case "failed":
    case "timed_out":
    case "interrupted":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

/**
 * 将内部 RunRecord 实体转换为向 MCP 客户端暴露的 McpTaskPayload。
 */
export function toMcpTaskPayload(run: RunRecord): McpTaskPayload {
  return {
    taskId: run.id,
    status: toMcpTaskStatus(run.status),
    createdAt: run.startedAt,
    finishedAt: run.finishedAt,
    input: run.input,
    output: run.output,
    error: run.error,
  };
}

/**
 * ActionDock MCP 适配层初始化选项。
 * 统一以 service（及可选 host, runtime）为核心。
 */
export interface ActionDockMcpOptions {
  /** 目标 ActionDockService 标准服务端口实例 */
  service?: ActionDockService;
  /** 目标 ActionDockHost 宿主实例 */
  host?: ActionDockHost;
  /** 目标 PackageRuntime 应用运行时实例 */
  runtime?: PackageRuntime;
  /** 单个目标项目根目录 */
  projectRoot?: string;
  /** 多个项目根目录（用于多包聚合提供） */
  projectRoots?: string[];
  /** 目标 Package ID */
  packageId?: string;
  /** 多个 Package ID 列表 */
  packageIds?: string[];
  /** 是否聚合暴露全局 Registry 中的所有 Package */
  all?: boolean;
  /** 自定义家目录路径 */
  customHome?: string;
  /** 自定义全局数据存储目录 */
  dataDir?: string;
  /** 运行时底层平台适配（如提供 NodeProcessDriver 的平台实例） */
  platform?: RuntimePlatform;
  /** 配置动态覆盖项 */
  configOverrides?: Record<string, unknown>;
  /** 单个 Tool 执行超时时间（毫秒） */
  timeoutMs?: number;
  /** 预加载的 Action 集合（单元测试或内存模式使用） */
  actions?:
    | Map<string, ActionDefinition>
    | Array<{ id: string; action: ActionDefinition } | (ActionDefinition & { id: string })>
    | Record<string, ActionDefinition>;
  /** 底层存储实例（单元测试或特定场景注入） */
  storage?: RuntimeStorage;
  /**
   * 是否由适配层接管外部注入 storage 的生命周期。
   * 默认 false：外部注入的 storage 由注入方自行管理，适配层不具备 close 语义；
   * 置为 true 时透传原始实例，随 service.close() 级联关闭。
   */
  ownStorageLifecycle?: boolean;
  /**
   * 实例 close 是否级联关闭 service 门面。
   * 默认 false：适配层产物可能被 SDK 传输层按请求（或按连接）创建与销毁，
   * 级联语义会误杀共享 service，生命周期统一由外层入口的 stop/cleanup 收敛；
   * 仅在调用方自行持有实例并需要一次 close 同时释放 service 时置 true。
   */
  cascadeServiceClose?: boolean;
}

/**
 * HTTP 传输协议安全配置项。
 */
export interface HttpSecurityOptions {
  host?: string;
  port?: number;
  token?: string;
  allowInsecureNoAuth?: boolean;
  allowQueryToken?: boolean;
  allowInsecureHttp?: boolean;
  corsOrigins?: string[];
  maxBodyBytes?: number;
  /** 服务端 TLS/HTTPS 安全传输选项 */
  tls?: ServerTlsOptions;
}

export interface ActionDockMcpHttpOptions
  extends Omit<ActionDockMcpOptions, "host">,
    Omit<HttpSecurityOptions, "host"> {
  host?: string | ActionDockHost;
}

export interface ActionDockMcpHttpServerInstance {
  port: number;
  host: string;
  url: string;
  service: ActionDockService;
  stop: () => Promise<void>;
}

