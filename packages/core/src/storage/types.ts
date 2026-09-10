import type { JsonValue, RuntimeError, RunRecord } from "@actiondock/sdk";
import type { Clock } from "../runtime/clock";

/**
 * 固定的存储 Schema 目标版本常量。
 */
export const STORAGE_SCHEMA_VERSION = 2;

/**
 * SQLite 基础参数值类型。
 */
export type SqlValue = null | number | string | Uint8Array;

/**
 * SQLite 位置参数数组。
 */
export type SqlParams = readonly SqlValue[];

/**
 * 编译后的 SQLite 参数化语句接口。
 */
export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid?: number | bigint };
  get<T>(...params: any[]): T | undefined;
  all<T>(...params: any[]): T[];
}

/**
 * 统一 SQLite 驱动层接口。
 */
export interface SqliteDriver {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T;
  close(): void;
}

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
  /** 复合完整键名 */
  fullKey: string;
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
  /** 显式注入的 SQLite 底层驱动 */
  driver?: SqliteDriver | any;
  /** 可选注入的时间提供器，便于与模拟时钟联动 */
  clock?: Clock;
}

/**
 * 数据库中存储的幂等请求去重记录实体。
 */
export interface IdempotencyRecord {
  /** 鉴权主体标识 */
  ownerId: string;
  /** 完全限定动作标识 */
  actionRef: string;
  /** 客户端幂等请求标识 */
  requestId: string;
  /** 输入参数与选项的 SHA-256 规范化摘要 */
  inputDigest: string;
  /** 关联的运行记录标识 */
  runId: string;
  /** 创建时间戳（ISO 8601 格式） */
  createdAt?: string;
}

/**
 * 幂等检查与登记结果。
 */
export type IdempotencyCheckResult =
  | { outcome: "new" }
  | { outcome: "duplicate"; runId: string }
  | { outcome: "conflict"; existingDigest: string };

/**
 * Action 执行终态枚举。
 */
export type TerminalRunStatus =
  | "success"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

/**
 * 统一运行时存储抽象接口。
 */
export interface RuntimeStorage {
  /** 数据库是否处于打开状态 */
  readonly isOpen?: boolean;
  /** 数据库是否已关闭 */
  readonly closed?: boolean;

  // --- Config 配置管理 ---
  getConfig<T = unknown>(key: string): T | undefined;
  listConfig(): Record<string, unknown>;
  setConfig(key: string, value: unknown): void | Promise<void>;
  deleteConfig(key: string): boolean | Promise<boolean>;

  // --- State 状态管理 ---
  getState<T = unknown>(namespace: string, key: string): Promise<T | undefined>;
  findState<T = unknown>(
    targetKey: string,
    namespace?: string
  ): Promise<StateEntry | undefined>;
  setState<T = unknown>(
    namespace: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void>;
  deleteState(namespace: string, key: string): Promise<boolean>;
  deleteStateSmart(targetKey: string, namespace?: string): Promise<boolean>;
  clearState(options?: { namespace?: string; all?: boolean; prefix?: string }): Promise<number>;
  cleanExpiredState?(): Promise<number>;
  listStateKeys(namespace?: string | null, prefix?: string): Promise<string[]>;
  listStateEntries(options?: { namespace?: string; prefix?: string }): Promise<StateEntry[]>;

  // --- Runs 运行记录管理 ---
  createRun(record: RunRecord): void;
  updateRun(
    id: string,
    status: TerminalRunStatus,
    output?: unknown,
    error?: RuntimeError,
    finishedAt?: string
  ): void;
  getRun(id: string): RunRecord | null;
  listRuns(options?: { actionId?: string; limit?: number }): RunRecord[];
  clearRuns(options?: { actionId?: string; status?: string }): number;

  /** 故障重启恢复：将遗留非终态运行收敛为 interrupted */
  recoverRunningRuns?(currentHostSessionId?: string): number | Promise<number>;

  /** 收敛死亡会话遗留的非终态运行任务 */
  recoverDeadSessionRuns?(currentHostSessionId?: string): number | Promise<number>;

  /** 确保底层存储与 Schema 初始化完成 */
  ensureInitialized?(): Promise<void>;

  // --- Idempotency 幂等去重管理 ---
  checkAndRecordIdempotency?(record: IdempotencyRecord): IdempotencyCheckResult;
  getIdempotencyRecord?(ownerId: string, actionRef: string, requestId: string): IdempotencyRecord | undefined;

  /** 关闭底层 SQLite 数据库连接并释放句柄 */
  close(): void | Promise<void>;
}

