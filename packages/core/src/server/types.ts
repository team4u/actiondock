import type { ActionDockService } from "../service/types";

export interface CoreHttpServerInstance {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
  ready?: Promise<void>;
}

export interface ServerTlsOptions {
  /** TLS 证书内容（PEM 格式字符串或 Buffer） */
  cert?: string | Buffer;
  /** TLS 私钥内容（PEM 格式字符串或 Buffer） */
  key?: string | Buffer;
  /** TLS 证书文件绝对或相对路径 */
  certPath?: string;
  /** TLS 私钥文件绝对或相对路径 */
  keyPath?: string;
  /** CA 根证书或证书链内容/路径 */
  ca?: string | Buffer | Array<string | Buffer>;
  /** 私钥密码口令（若私钥被密码加密） */
  passphrase?: string;
}

/**
 * 启动 ActionDock HTTP Runner 服务端的配置选项。
 */
export interface ServerOptions {
  /** 监听端口号（默认 5177） */
  port?: number;
  /** 绑定监听的主机地址（默认 "127.0.0.1"） */
  hostname?: string;
  /** 绑定监听的主机地址（hostname 的字符串别名） */
  host?: string;
  /** 关联的标准 ActionDockService 服务端口实例 */
  service?: ActionDockService;
  /** 用于 HTTP Bearer Token 鉴权的密钥令牌 */
  token?: string;
  /** 是否允许通过 URL 查询参数携带 Token 进行鉴权（默认 false，关闭以防泄露） */
  allowQueryToken?: boolean;
  /** 服务的项目根目录（可选，若未指定则自动向上查找或进入全局 Registry 模式） */
  projectRoot?: string;
  /** 自定义 ActionDock 用户家目录 */
  customHome?: string;
  /** 数据持久化存储目录 */
  dataDir?: string;
  /** 是否采用纯内存运行模式 */
  inMemory?: boolean;
  /** 是否允许非回环地址（如 0.0.0.0）在未配置 Token 的情况下启动（不安全） */
  allowInsecureNoAuth?: boolean;
  /** 允许跨域请求的 CORS Origin 白名单列表 */
  corsOrigins?: string[];
  /** 允许访问执行的 Package ID 白名单列表（为空允许全部） */
  packageAllowlist?: string[];
  /** 允许访问执行的 Action 标识白名单列表（为空允许全部，支持短名或 packageId/actionId） */
  actionAllowlist?: string[];
  /** 最大允许的请求体字节限制（默认 1MB，防 DoS） */
  maxBodyBytes?: number;
  /** 是否在 health 和 info 接口中透传本地 projectRoot 等调试路径 */
  exposeDebugInfo?: boolean;
  /** 是否启用一体化 MCP 协议支持（默认开启） */
  enableMcp?: boolean;
  /** 自定义 MCP 请求处理器钩子（若挂载则 /mcp 路由交由其处理） */
  mcpHandler?: (req: Request) => Promise<Response | null | undefined> | Response | null | undefined;
  /** 可选注入的统一运行时底层平台 */
  platform?: import("../platform/types").RuntimePlatform;
  /** 是否显式开启配置与状态管理路由能力（默认关闭，关闭时返回 403） */
  enableManagement?: boolean;
  /** 是否扫描并加载外部链接包（默认在未指定 projectRoot 时为 true，指定时为 false） */
  scanLinkedPackages?: boolean;
  /** 服务端 TLS/HTTPS 安全传输选项 */
  tls?: ServerTlsOptions;
}

/**
 * 已启动的 ActionDock HTTP Runner 实例句柄。
 */
export interface ActionDockServerInstance {
  /** 实际监听的端口号 */
  port: number;
  /** 关联的 ActionDockService 服务端口实例 */
  service: ActionDockService;
  /** 服务端可访问的基础 URL（如 "http://127.0.0.1:5177"） */
  url: string;
  /** 服务就绪 Promise（可等待端口解析与监听建立） */
  ready?: Promise<void>;
  /** 优雅关闭服务端并释放底层资源 */
  stop: (options?: { graceMs?: number }) => Promise<void> | void;
}
