/**
 * 单个远端配置环境（Profile）实体定义。
 */
export interface ProfileEntry {
  /** 远端 ActionDock 服务端地址（如 "http://192.168.1.100:5177" 或 "local"） */
  serverUrl: string;
  /**
   * 存储在配置文件中的明文鉴权 Token。
   * @deprecated 强烈建议使用 tokenEnv 或标准环境变量（如 ACTIONDOCK_<PROFILE>_TOKEN），避免明文持久化
   */
  token?: string;
  /** 指定从哪一个操作系统环境变量名动态读取 Token */
  tokenEnv?: string;
  /** 该机器/环境的描述信息 */
  description?: string;
}

/**
 * 全局 profiles.json 配置文件结构契约。
 */
export interface ProfilesConfig {
  /** 当前激活的默认 Profile 名称（默认为 "local"） */
  currentProfile?: string;
  /** 已配置的 Profile 字典映射表 */
  profiles: Record<string, ProfileEntry>;
}

/**
 * Token 解析命中来源枚举。
 */
export type TokenResolutionSource =
  | "cli"        // 来源于显式 CLI 参数 (--token)
  | "tokenEnv"   // 来源于 Profile 显式绑定的 tokenEnv 环境变量
  | "profileEnv" // 来源于自动推导的 ACTIONDOCK_<PROFILE>_TOKEN
  | "profile"    // 来源于 profiles.json 中存储的遗留明文 Token
  | "globalEnv"  // 来源于全局 ACTIONDOCK_TOKEN
  | "none";      // 未配置任何 Token

/**
 * 经过解析后确定的最终执行目标环境。
 */
export interface ResolvedTarget {
  /** 执行环境类型：local (本地 Bun 进程) 或 remote (远端 HTTP Server) */
  type: "local" | "remote";
  /** 命中的 Profile 名称 */
  profileName?: string;
  /** 远端 Server URL */
  serverUrl?: string;
  /** 解析出的有效鉴权 Token */
  token?: string;
  /** Token 数据来源 */
  tokenSource?: TokenResolutionSource;
}

/**
 * 远端服务器健康探测与时延检测结果。
 */
export interface RemoteHealthResult {
  /** 服务端是否连通且鉴权成功 */
  ok: boolean;
  /** 服务端状态标识（如 "ok"） */
  status?: string;
  /** 远端 ActionDock 版本号 */
  version?: string;
  /** 远端服务运行时间（秒） */
  uptime?: number;
  /** 网络往返延迟（毫秒） */
  latencyMs: number;
  /** 探测失败时的错误信息 */
  error?: string;
}
