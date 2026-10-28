import type { RuntimeError, RunRecord, RunStatus } from "@actiondock/sdk";
import { ACTION_CANCELLED, ACTION_TIMEOUT } from "../errors";
import type { ConfigItemDefinition } from "../project/types";
import type { ConfigKeyProvider } from "../security/config-cipher";
import type { Clock } from "./clock";

/**
 * 固定的存储 Schema 当前版本常量。
 *
 * 当前版本（3）数据库总是携带 config_encryption 密钥元数据表（无敏感
 * 写入时表保持空置），config 表允许普通 JSON 明文行与 adenc: 密文行
 * 共存。旧版本数据库在存储打开前由 migrations/ 通用版本调度完成升级，
 * 当前版本读写代码不感知历史版本。
 */
export const STORAGE_SCHEMA_VERSION = 3;

/**
 * 幂等去重记录保留窗口（24 小时），与 ActionDockService.info()
 * 中的 idempotencyPolicy.retentionMs 保持单一事实源。
 */
export const IDEMPOTENCY_RETENTION_MS = 86_400_000;

/**
 * 运行记录默认保留时长常量（14 天）。
 */
export const DEFAULT_RUNS_RETENTION_MS = 14 * 86_400_000;

/**
 * 运行记录单个包默认最大终态记录保留条数（5000 条）。
 */
export const DEFAULT_MAX_RUNS_PER_PACKAGE = 5000;

/**
 * 运行记录时间过期清理默认保底保留条数（50 条）。
 */
export const DEFAULT_MIN_RETAIN_RUNS = 50;

/**
 * 运行记录双重保留策略契约（基于时间与基于数量）。
 */
export interface RunsRetentionPolicy {
  /** 最大保留时长（毫秒，默认 14 天） */
  maxAgeMs?: number;
  /** 单个包最大保留终态记录数（默认 5000，超出按最旧先淘汰） */
  maxRuns?: number;
  /** 最小保底保留终态记录数（默认 50，防止全清空） */
  minRetainRuns?: number;
}

/**
 * 运行记录通用检索与统计过滤选项。
 */
export interface RunsQueryFilterOptions {
  /** 目标动作标识筛选 */
  actionId?: string;
  /** 运行生命周期状态筛选 */
  status?: string;
  /** 运行通道筛选（如 http、mcp） */
  channel?: string;
  /** 服务视图名称筛选（如 default、admin） */
  view?: string;
  /** 起始时间筛选（匹配 started_at >= since） */
  since?: string;
  /** 截止时间筛选（匹配 started_at <= until） */
  until?: string;
  /** 根运行标识筛选 */
  rootRunId?: string;
  /** 父运行标识筛选 */
  parentRunId?: string;
  /** 最大返回记录条数限制 */
  limit?: number;
  /** 偏移游标条数（跳过的记录数） */
  offset?: number;
  /** 幂等请求标识列表（经 idempotency_keys 反查） */
  requestIds?: string[];
}

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
 * 事务开启模式。
 *
 * deferred 为历史默认；读后写升级场景（如先读旧行再决定加密写入）
 * 必须使用 immediate，在事务开始即取得写锁，避免并发提交下的
 * 快照升级 SQLITE_BUSY；exclusive 供离线维护取得持续排他锁。
 */
export type SqliteTransactionMode = "deferred" | "immediate" | "exclusive";

/**
 * 统一 SQLite 驱动层接口（严格同步契约）。
 *
 * 本契约为同步驱动：exec、prepare 与 transaction 全部以同步语义返回结果，
 * 不接受任何 Promise 或异步实现。SqliteRuntimeStorage 的公共同步方法
 * （getConfig、listConfig、getRun、listRuns、checkAndRecordIdempotency 等）
 * 直接依赖这一同步保证。异步驱动不应注入本契约，
 * 需通过 RuntimeStorage 的异步外观层另行适配。
 */
export interface SqliteDriver {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction<T>(
    fn: () => T extends PromiseLike<unknown> ? never : T,
    mode?: SqliteTransactionMode
  ): T;
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
 * 配置写入选项。
 *
 * declarations 为写入时目标键的有效声明集合（跨包并集），存储层据此
 * 判定敏感性、执行整键加密并合并历史保护声明；缺省视为无敏感声明。
 */
export interface ConfigWriteOptions {
  /** 写入时目标键的有效配置声明集合 */
  declarations?: readonly ConfigItemDefinition[];
}

/**
 * 单键配置原子读取快照。
 *
 * 单次 SELECT 同时解出业务值与历史保护声明，避免管理视图分两次读取
 * 时因其他进程恰好删除行而出现「旧秘密值 + 空保护」的组合泄漏。
 * 明文行的快照仅含 value；密文行同时携带解密验证后的保护声明。
 */
export interface ConfigSnapshot {
  /** 业务配置值（密文行经透明解密还原） */
  value: unknown;
  /** 历史保护声明（仅密文行存在；用于当前声明弱化后的脱敏兜底） */
  protection?: readonly ConfigItemDefinition[];
}

/**
 * 初始化存储引擎所需的选项。
 */
export interface StorageOptions {
  /** SQLite 数据库文件绝对路径，或 ":memory:" 表示内存数据库 */
  dbPath?: string;
  /** 所绑定的 Package ID */
  packageId: string;
  /** 显式注入的 SQLite 底层驱动（必须满足同步 SqliteDriver 契约） */
  driver?: SqliteDriver;
  /** 可选注入的时间提供器，便于与模拟时钟联动 */
  clock?: Clock;
  /**
   * 是否在打开时收割死亡会话遗留的非终态运行记录（收敛为 interrupted）。
   *
   * 默认 false：旁观查询打开（CLI 的 state/runs/config 类命令）不收割其他进程的在途记录。
   * 仅数据目录持有者（serve、mcp、ad run 等执行宿主）显式置 true，
   * 避免跨进程互毁在途运行。
   */
  recoverOrphans?: boolean;
  /** 运行记录保留策略配置 */
  retentionPolicy?: RunsRetentionPolicy;
  /**
   * 配置加密密钥提供器。
   *
   * 缺省时文件库懒使用本地默认密钥定位（createConfigKeyProvider），
   * 内存库使用一次性随机内存密钥（不读取环境变量或密钥文件）。
   */
  configKeyProvider?: ConfigKeyProvider;
  /**
   * 打开存储时用于版本迁移判定的配置声明字典集合。
   *
   * 包级存储传当前包声明；全局存储传所有已加载包的声明字典（跨包并集
   * 判定敏感性）。声明解析遵循各字典内具体键优先于模板、跨字典取并集。
   * 仅在旧版本数据库需要迁移时被读取；版本迁移只在首次打开执行。
   */
  configDeclarations?: readonly Record<string, ConfigItemDefinition>[];
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
 * 判断指定运行状态是否为终态（收敛 success, failed, cancelled, timed_out, interrupted）。
 */
export function isTerminalRunStatus(status: string): status is TerminalRunStatus {
  return (
    status === "success" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "timed_out" ||
    status === "interrupted"
  );
}

/**
 * 执行终态到运行记录状态的统一映射单一事实源。
 *
 * 成功映射为 success；超时错误码映射为 timed_out；取消错误码映射为 cancelled；
 * 其余失败一律映射为 failed。错误码常量来自全仓统一错误码单一事实源 errors.ts。
 */
export function resultStatusToRunStatus(
  ok: boolean,
  errorCode?: string
): RunStatus {
  if (ok) return "success";
  if (errorCode === ACTION_TIMEOUT) return "timed_out";
  if (errorCode === ACTION_CANCELLED) return "cancelled";
  return "failed";
}

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
  setConfig(key: string, value: unknown, options?: ConfigWriteOptions): void | Promise<void>;
  deleteConfig(key: string): boolean | Promise<boolean>;
  /**
   * 单次读取同时解出业务值与历史保护声明的原子快照。
   *
   * 键不存在返回 undefined；明文行仅含 value；密文行经严格解密验证后
   * 同时携带 protection。管理视图优先使用本方法，避免分离读取的
   * 并发窗口泄漏无保护的秘密值。
   */
  getConfigSnapshot?(key: string): ConfigSnapshot | undefined;
  /**
   * 读取目标键的历史保护声明（密文行解密验证后返回；明文行或不存在返回 undefined）。
   *
   * 用于当前声明弱化（如移除 secret 标记）后的脱敏兜底，防止已加密的
   * 历史敏感值在管理视图重新明文展示。
   */
  getConfigProtection?(key: string): readonly ConfigItemDefinition[] | undefined;

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
  listRuns(options?: RunsQueryFilterOptions): RunRecord[];
  /** 统计符合条件的运行记录总数 */
  countRuns?(options?: RunsQueryFilterOptions): number;
  /** 查询单条运行记录并补齐幂等请求标识关联（详情路径专用） */
  getRunWithRequestId?(id: string): RunRecord | null;
  clearRuns(options?: {
    actionId?: string;
    status?: string;
    olderThanMs?: number;
    keep?: number;
  }): number;
  /** 按保留策略清理过期及超额的终态运行记录（基于时间与数量策略） */
  cleanExpiredRuns?(policy?: RunsRetentionPolicy): number;

  /**
   * 收敛死亡宿主遗留的非终态运行任务（含无会话标识的遗留非终态记录），
   * 统一收敛为 interrupted。历史别名 recoverRunningRuns 已合并至本方法。
   *
   * 判定依据是宿主存活而不是会话归属：仅收割进程探测失败或心跳过期的记录，
   * 无法确认死亡时保守保留，避免误杀并发进程的在途任务。
   */
  recoverDeadSessionRuns?(
    currentHostSessionId?: string,
    options?: { probe?: import("./run-liveness").ProcessLivenessProbe }
  ): number | Promise<number>;

  /** 刷新在途运行记录的心跳时间戳（供执行宿主周期性调用，支撑存活判定） */
  touchRunHeartbeat?(runIds: string[]): number;

  /** 确保底层存储与 Schema 初始化完成 */
  ensureInitialized?(): Promise<void>;

  // --- Idempotency 幂等去重管理 ---
  checkAndRecordIdempotency?(record: IdempotencyRecord): IdempotencyCheckResult;
  getIdempotencyRecord?(ownerId: string, actionRef: string, requestId: string): IdempotencyRecord | undefined;
  /**
   * 按客户端幂等请求标识批量反查运行记录（仅限当前包范围）。
   *
   * 不按 ownerId 隔离：查询方（CLI 旁观视图）与写入方（后台派工进程）分属
   * 不同宿主会话，ownerId 天然不一致；requestId 本身即跨进程全局唯一的外部
   * 事实源，包维度隔离已提供足够边界。
   */
  listRunsByRequestIds?(requestIds: string[], options?: RunsQueryFilterOptions): RunRecord[];
  /** 按客户端幂等请求标识反查关联运行记录总数 */
  countRunsByRequestIds?(requestIds: string[], options?: RunsQueryFilterOptions): number;
  /** 反查运行记录关联的幂等请求标识映射（仅限当前包范围，无关联时不含对应键） */
  getRunRequestIds?(runIds: string[]): Record<string, string>;

  // --- Events 审计事件仓储 ---
  appendEvent?(eventType: string, payload: unknown): void;
  queryEvents?(eventType?: string): any[];

  /** 关闭底层 SQLite 数据库连接并释放句柄 */
  close(): void | Promise<void>;
}

