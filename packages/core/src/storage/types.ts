import type { RuntimeError, RunRecord } from "@actiondock/sdk";

/**
 * 数据库中存储的配置条目实体。
 */
export interface ConfigEntry {
  /** 所属 Package ID */
  packageId: string;
  /** 配置键名 */
  key: string;
  /** 配置值（JSON 序列化存储） */
  value: unknown;
  /** 最近更新时间（ISO 8601 格式） */
  updatedAt: string;
}

/**
 * 数据库中存储的状态条目实体。
 */
export interface StateEntry {
  /** 所属 Package ID */
  packageId: string;
  /** 状态隔离命名空间 */
  namespace: string;
  /** 状态键名 */
  key: string;
  /** 状态值（JSON 序列化存储） */
  value: unknown;
  /** 最近更新时间（ISO 8601 格式） */
  updatedAt: string;
  /** 自动过期时间戳（ISO 8601 格式，null/undefined 表示不过期） */
  expiresAt?: string;
}

/**
 * 初始化存储引擎所需的选项。
 */
export interface StorageOptions {
  /** SQLite 数据库文件绝对路径，或 ":memory:" 表示内存数据库 */
  dbPath?: string;
  /** 所绑定的 Package ID */
  packageId: string;
}

/**
 * Action 执行终态枚举（已结束状态）。
 */
export type TerminalRunStatus = "success" | "failed" | "cancelled";

/**
 * 统一运行时存储抽象接口（RuntimeStorage）。
 * 集中管理单个 Package 下的 Config（配置）、State（状态与 TTL）、Runs（执行历史记录）。
 */
export interface RuntimeStorage {
  // --- Config 配置管理 ---
  /** 读取指定配置键的值 */
  getConfig<T = unknown>(key: string): T | undefined;
  /** 列出该 Package 存储的所有配置键值映射 */
  listConfig(): Record<string, unknown>;
  /** 设置或更新配置键值 */
  setConfig(key: string, value: unknown): void;
  /** 删除指定配置键，返回是否成功删除 */
  deleteConfig(key: string): boolean;

  // --- State 状态管理 ---
  /** 读取指定命名空间下的状态值（已过期则自动清除并返回 undefined） */
  getState<T = unknown>(namespace: string, key: string): Promise<T | undefined>;
  /** 写入状态值，可指定 TTL 存活秒数 */
  setState<T = unknown>(
    namespace: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void>;
  /** 删除指定命名空间下的状态数据 */
  deleteState(namespace: string, key: string): Promise<void>;
  /** 列出指定命名空间下匹配前缀的所有状态键（自动触发过期键清理） */
  listStateKeys(namespace: string, prefix?: string): Promise<string[]>;

  // --- Runs 运行记录管理 ---
  /** 创建并记录一条初始运行记录（status: running） */
  createRun(record: RunRecord): void;
  /** 更新运行记录至终态（success/failed/cancelled）并记录输出或错误 */
  updateRun(
    id: string,
    status: TerminalRunStatus,
    output?: unknown,
    error?: RuntimeError,
    finishedAt?: string
  ): void;
  /** 根据 ID 查询单条运行记录 */
  getRun(id: string): RunRecord | null;
  /** 分页或按 Action 查询历史运行记录列表（按 startedAt 倒序排列） */
  listRuns(options?: { actionId?: string; limit?: number }): RunRecord[];

  /** 关闭底层 SQLite 数据库连接并释放句柄 */
  close(): void;
}
