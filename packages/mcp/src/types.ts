import type { ActionDockService } from "@actiondock/core";
import type {
  ActionDockHost,
  ServerTlsOptions,
} from "@actiondock/core/server";
import type {
  PackageRuntime,
  RuntimePlatform,
  RuntimeStorage,
} from "@actiondock/core/package";
import type { ActionDefinition } from "@actiondock/sdk";

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
  /** 允许访问执行的 Package ID 白名单列表（为空允许全部） */
  packageAllowlist?: string[];
  /** 允许暴露执行的 Action 标识白名单列表（为空允许全部，支持短名或 packageId/actionId） */
  actionAllowlist?: string[];
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

/** ActionDock MCP 适配层初始化选项别名 */
export type ActionDockMcpServerOptions = ActionDockMcpOptions;

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

