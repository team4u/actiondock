import { chmodSync, existsSync, mkdirSync } from "node:fs";
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
  type IdempotencyCheckResult,
  type IdempotencyRecord,
  type RunsRetentionPolicy,
  type RuntimeStorage,
  type SqliteDriver,
  type StateEntry,
  type StorageOptions,
  type TerminalRunStatus,
} from "./types";
import { initSchema } from "./sqlite-schema";
import { SqliteRunsStore } from "./sqlite-runs";
import { SqliteStateStore } from "./sqlite-state";
import { SqliteConfigStore } from "./sqlite-config";
import { SqliteEventsStore } from "./sqlite-events";

export {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
};

export interface SqliteStorageOptions extends StorageOptions {
  logger?: Logger;
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

    if (dbPath !== ":memory:" && existsSync(dbPath)) {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // 忽略文件权限设置异常
      }
    }

    this.init();
  }

  private init(): void {
    // 延迟初始化子存储以便它们可以访问 driver 等，但把初始化本身移到了 schema
    this.configStore = new SqliteConfigStore(this.driver, this.packageId, this.dbPath, this.clock);
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

    initSchema(
      this.driver,
      this.dbPath,
      this.recoverOrphans,
      () => this.recoverDeadSessionRuns(),
      () => this.cleanExpiredRuns()
    );

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

  setConfig(key: string, value: unknown): void {
    this.configStore.setConfig(key, value);
  }

  deleteConfig(key: string): boolean {
    return this.configStore.deleteConfig(key);
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

  listRuns(options: { actionId?: string; status?: string; limit?: number; offset?: number } = {}): RunRecord[] {
    return this.runsStore.listRuns(options);
  }

  countRuns(options: { actionId?: string; status?: string; requestIds?: string[] } = {}): number {
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

  listRunsByRequestIds(requestIds: string[]): RunRecord[] {
    return this.runsStore.listRunsByRequestIds(this.isClosed, requestIds);
  }

  countRunsByRequestIds(requestIds: string[], options: { actionId?: string; status?: string } = {}): number {
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
