import type { ServerRuntimeRegistry } from "./runtime-registry";

export interface CoreHttpServerInstance {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
}

export type CoreHttpServerFactory = (options: {
  port: number;
  host: string;
  fetch: (req: Request) => Promise<Response>;
}) => CoreHttpServerInstance | Promise<CoreHttpServerInstance>;

/**
 * 启动 ActionDock HTTP Runner 服务端的配置选项。
 */
export interface ServerOptions {
  /** 监听端口号（默认 5177） */
  port?: number;
  /** 绑定监听的主机地址（默认 "127.0.0.1"） */
  host?: string;
  /** 用于 HTTP Bearer Token 鉴权的密钥令牌 */
  token?: string;
  /** 服务的项目根目录（可选，若未指定则自动向上查找或进入全局 Registry 模式） */
  projectRoot?: string;
  /** 自定义 ActionDock 用户家目录 */
  customHome?: string;
  /** 是否允许非回环地址（如 0.0.0.0）在未配置 Token 的情况下启动（不安全） */
  allowInsecureNoAuth?: boolean;
  /** 允许跨域请求的 CORS Origin 白名单列表 */
  corsOrigins?: string[];
  /** 最大允许的请求体字节限制（默认 1MB，防 DoS） */
  maxBodyBytes?: number;
  /** 是否在 health 和 info 接口中透传本地 projectRoot 等调试路径 */
  exposeDebugInfo?: boolean;
  /** 是否启用一体化 MCP 协议支持（默认开启） */
  enableMcp?: boolean;
  /** 自定义 MCP 请求处理器钩子（若挂载则 /mcp 路由交由其处理） */
  mcpHandler?: (req: Request) => Promise<Response | null | undefined> | Response | null | undefined;
}

/**
 * 已启动的 ActionDock HTTP Runner 实例句柄。
 */
export interface ActionDockServerInstance {
  /** 实际监听的端口号 */
  port: number;
  /** 实际绑定的主机地址 */
  host: string;
  /** 服务端可访问的基础 URL（如 "http://127.0.0.1:5177"） */
  url: string;
  /** 关联的 ServerRuntimeRegistry 运行时注册表 */
  runtimeRegistry?: ServerRuntimeRegistry;
  /** 优雅关闭服务端并释放所有存储连接 */
  stop: () => Promise<void> | void;
}

