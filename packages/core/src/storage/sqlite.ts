import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
  type Logger,
  type RuntimeError,
  type RunRecord,
} from "@actiondock/sdk";
import { type Clock, SystemClock } from "./clock";
import { NodeSqliteDriver } from "./sqlite-driver";
import {
  type ConfigSnapshot,
  type ConfigWriteOptions,
  type IdempotencyCheckResult,
  type IdempotencyRecord,
  type RunsQueryFilterOptions,
  type RunsRetentionPolicy,
  type RuntimeStorage,
  type SqliteDriver,
  type StateEntry,
  type StorageOptions,
  type TerminalRunStatus,
} from "./types";
import { ensureStorageSchema } from "./migrations/index";
import { SqliteRunsStore } from "./sqlite-runs";
import { SqliteStateStore } from "./sqlite-state";
import { SqliteConfigStore } from "./sqlite-config";
import { SqliteEventsStore } from "./sqlite-events";
import { createConfigKeyProvider } from "../security/config-key";
import type { ConfigKeyProvider } from "../security/config-cipher";
import type { ConfigItemDefinition } from "../project/types";

export {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
};

export interface SqliteStorageOptions extends StorageOptions {
  logger?: Logger;
}

/**
 * 内存库默认密钥提供器：一次性随机内存密钥。
 *
 * 通过 createConfigKeyProvider({ key }) 注入纯内存材料，懒加载缓存，
 * 绝不读取环境变量，也绝不访问或创建任何密钥文件；同一存储实例
 * 生命周期内密钥恒定，进程退出即失效。
 */
function createMemoryConfigKeyProvider(): ConfigKeyProvider {
  return createConfigKeyProvider({ key: randomBytes(32) });
}

/** 解析存储级密钥提供器：显式注入优先，否则按库类型选择默认。 */
function resolveConfigKeyProvider(dbPath: string, injected?: ConfigKeyProvider): ConfigKeyProvider {
  if (injected) return injected;
  return dbPath === ":memory:" ? createMemoryConfigKeyProvider() : createConfigKeyProvider();
}

export class SqliteRuntimeStorage implements RuntimeStorage {
  private driver: SqliteDriver;
  private packageId: string;
  private clock: Clock;
  private logger?: Logger;
  private isClosed = false;
  private dbPath: string;
  private recoverOrphans: boolean;
  private retentionPolicy?: RunsRetentionPolicy;
  private configKeyProvider?: ConfigKeyProvider;
  private configDeclarations?: readonly Record<string, ConfigItemDefinition>[];

  private runsStore!: SqliteRunsStore;
  private stateStore!: SqliteStateStore;
  private configStore!: SqliteConfigStore;
  private eventsStore!: SqliteEventsStore;

  get isOpen(): boolean {
    return !this.isClosed;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  private logWarn(message: string, ...args: unknown[]): void {
    if (this.logger) {
      this.logger.warn(message, ...args);
    } else {
      console.warn(message, ...args);
    }
  }

  constructor(options: SqliteStorageOptions) {
    this.packageId = options.packageId;
    this.clock = options.clock ?? new SystemClock();
    this.logger = options.logger;
    const dbPath = options.dbPath || ":memory:";
    this.dbPath = dbPath;
    this.recoverOrphans = options.recoverOrphans === true;
    this.retentionPolicy = options.retentionPolicy;
    this.configKeyProvider = options.configKeyProvider;
    this.configDeclarations = options.configDeclarations;

    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          chmodSync(dir, 0o700);
        } catch {
          // 忽略系统权限设置失败
        }
      }
    }

    this.driver = options.driver ?? new NodeSqliteDriver(dbPath);

    try {
      this.init();
    } catch (err) {
      // 构造失败回收自建连接，避免数据库文件锁泄漏：注入的 driver 归调用方管理，
      // 自建的 driver 生命周期归本实例，初始化失败时必须立即关闭
      if (options.driver === undefined) {
        try {
          this.driver.close();
        } catch {
          // 回收失败不得掩盖导致构造失败的原始异常
        }
      }
      throw err;
    }
  }

  private init(): void {
    const keyProvider = resolveConfigKeyProvider(this.dbPath, this.configKeyProvider);

    // 版本就绪：新库建当前版本、旧库迁移、当前库校验。
    // 迁移先于任何正常子存储构造（当前版本实现始终假定库已是当前版本），
    // 也先于运行记录恢复（恢复依赖子存储）。
    ensureStorageSchema({
      driver: this.driver,
      dbPath: this.dbPath,
      packageId: this.packageId,
      declarations: this.configDeclarations ?? [],
      keyProvider,
      clock: this.clock,
    });

    // 构造正常子存储
    this.configStore = new SqliteConfigStore(
      this.driver,
      this.packageId,
      this.dbPath,
      this.clock,
      keyProvider
    );
    this.stateStore = new SqliteStateStore(
      this.driver,
      this.packageId,
      this.dbPath,
      this.clock,
      this.logger,
      (msg) => this.logWarn(msg)
    );
    this.runsStore = new SqliteRunsStore(
      this.driver,
      this.packageId,
      this.dbPath,
      this.clock,
      this.retentionPolicy,
      <T>(k: string) => this.getConfig<T>(k),
      this.logger,
      (msg) => this.logWarn(msg)
    );
    this.eventsStore = new SqliteEventsStore(this.driver, this.packageId, this.clock);

    // 数据目录持有者语义下的遗留运行收割（与迁移无关，依赖子存储就绪）
    if (this.recoverOrphans) {
      this.recoverDeadSessionRuns();
      this.cleanExpiredRuns();
    }

    if (this.dbPath !== ":memory:" && existsSync(this.dbPath)) {
      try {
        chmodSync(this.dbPath, 0o600);
      } catch {
        // 忽略文件权限设置异常
      }
    }
  }

  public recoverDeadSessionRuns(
    currentHostSessionId?: string,
    options?: { probe?: import("./run-liveness").ProcessLivenessProbe }
  ): number {
    return this.runsStore.recoverDeadSessionRuns(this.isClosed, currentHostSessionId, options);
  }

  // --- Config 配置管理 ---

  getConfig<T = unknown>(key: string): T | undefined {
    return this.configStore.getConfig<T>(key);
  }

  listConfig(): Record<string, unknown> {
    return this.configStore.listConfig();
  }

  setConfig(key: string, value: unknown, options?: ConfigWriteOptions): void {
    this.configStore.setConfig(key, value, options);
  }

  deleteConfig(key: string): boolean {
    return this.configStore.deleteConfig(key);
  }

  getConfigSnapshot(key: string): ConfigSnapshot | undefined {
    return this.configStore.getConfigSnapshot(key);
  }

  getConfigProtection(key: string): readonly ConfigItemDefinition[] | undefined {
    return this.configStore.getConfigProtection(key);
  }

  // --- State 状态管理 ---

  async getState<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    return this.stateStore.getState<T>(namespace, key);
  }

  async findState<T = unknown>(targetKey: string, namespace?: string): Promise<StateEntry | undefined> {
    return this.stateStore.findState<T>(targetKey, namespace);
  }

  async setState<T = unknown>(namespace: string, key: string, value: T, ttl?: number): Promise<void> {
    return this.stateStore.setState<T>(namespace, key, value, ttl);
  }

  async deleteState(namespace: string, key: string): Promise<boolean> {
    return this.stateStore.deleteState(namespace, key);
  }

  async deleteStateSmart(targetKey: string, namespace?: string): Promise<boolean> {
    return this.stateStore.deleteStateSmart(targetKey, namespace);
  }

  async cleanExpiredState(): Promise<number> {
    return this.stateStore.cleanExpiredState(this.isClosed);
  }

  async clearState(options: { namespace?: string; all?: boolean; prefix?: string } = {}): Promise<number> {
    return this.stateStore.clearState(options);
  }

  async listStateKeys(namespace?: string | null, prefix?: string): Promise<string[]> {
    return this.stateStore.listStateKeys(namespace, prefix, this.isClosed);
  }

  async listStateEntries(options: { namespace?: string; prefix?: string } = {}): Promise<StateEntry[]> {
    return this.stateStore.listStateEntries(options, this.isClosed);
  }

  // --- Runs 运行记录管理 ---

  createRun(record: RunRecord | any): void {
    this.runsStore.createRun(record);
  }

  updateRun(id: string, status: TerminalRunStatus, output?: unknown, error?: RuntimeError, finishedAt?: string): void {
    this.runsStore.updateRun(id, status, this.isClosed, output, error, finishedAt);
  }

  getRun(id: string): RunRecord | null {
    return this.runsStore.getRun(id);
  }

  listRuns(options: RunsQueryFilterOptions = {}): RunRecord[] {
    return this.runsStore.listRuns(options);
  }

  countRuns(options: RunsQueryFilterOptions = {}): number {
    return this.runsStore.countRuns(options, this.isClosed);
  }

  clearRuns(options: { actionId?: string; status?: string; olderThanMs?: number; keep?: number } = {}): number {
    return this.runsStore.clearRuns(options);
  }

  cleanExpiredRuns(policy?: RunsRetentionPolicy): number {
    return this.runsStore.cleanExpiredRuns(this.isClosed, policy);
  }

  touchRunHeartbeat(runIds: string[]): number {
    return this.runsStore.touchRunHeartbeat(this.isClosed, runIds);
  }

  // --- Idempotency 幂等去重管理 ---

  checkAndRecordIdempotency(record: IdempotencyRecord): IdempotencyCheckResult {
    return this.runsStore.checkAndRecordIdempotency(this.isClosed, record);
  }

  getIdempotencyRecord(ownerId: string, actionRef: string, requestId: string): IdempotencyRecord | undefined {
    return this.runsStore.getIdempotencyRecord(this.isClosed, ownerId, actionRef, requestId);
  }

  listRunsByRequestIds(requestIds: string[], options: RunsQueryFilterOptions = {}): RunRecord[] {
    return this.runsStore.listRunsByRequestIds(this.isClosed, requestIds, options);
  }

  countRunsByRequestIds(requestIds: string[], options: RunsQueryFilterOptions = {}): number {
    return this.runsStore.countRunsByRequestIds(this.isClosed, requestIds, options);
  }

  getRunRequestIds(runIds: string[]): Record<string, string> {
    return this.runsStore.getRunRequestIds(this.isClosed, runIds);
  }

  getRunWithRequestId(id: string): RunRecord | null {
    return this.runsStore.getRunWithRequestId(id, this.isClosed);
  }

  // --- Events 审计事件仓储 ---
  
  appendEvent(eventType: string, payload: unknown): void {
    this.eventsStore.appendEvent(eventType, payload);
  }

  queryEvents(eventType?: string): any[] {
    return this.eventsStore.queryEvents(eventType);
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    this.configStore.close();
    this.stateStore.close();
    this.runsStore.close();
    this.eventsStore.close();

    try {
      this.driver.close();
    } catch (err) {
      this.logWarn(
        `[actiondock] storage close failed (db=${this.dbPath}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
