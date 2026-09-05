import {
  type Clock,
  createDefaultSqliteDriver,
  getSystemClock,
  type RuntimeStorage,
  type SqliteDriver,
  type StateEntry,
  type TerminalRunStatus,
} from "@actiondock/core";
import type { RuntimeError, RunRecord } from "@actiondock/sdk";

/**
 * 内存运行时存储初始化选项。
 */
export interface MemoryStorageOptions {
  /** 绑定的 Package 标识，默认为 test-pkg */
  packageId?: string;
  /** 可选注入的时间提供器，便于与模拟时钟联动 */
  clock?: Clock;
  /** 可选显式注入的底层 SQLite 驱动 */
  driver?: SqliteDriver;
}

/**
 * 统一内存运行时存储实现。
 * 基于 SQLite 内存模式构建，确保与生产环境核心存储具备完全相同的配置优先级、状态过期契约与运行终态行为。
 */
export class MemoryStorage implements RuntimeStorage {
  private driver: SqliteDriver;
  private packageId: string;
  private clock: Clock;
  private isClosed = false;

  constructor(options: MemoryStorageOptions = {}) {
    this.packageId = options.packageId || "test-pkg";
    this.clock = options.clock || getSystemClock();
    this.driver = options.driver || createDefaultSqliteDriver(":memory:");
    this.init();
  }

  /**
   * 初始化内存表结构与索引。
   */
  private init(): void {
    this.driver.exec("PRAGMA journal_mode = MEMORY;");
    this.driver.exec("PRAGMA synchronous = OFF;");

    this.driver.transaction(() => {
      this.driver.exec(`
        CREATE TABLE IF NOT EXISTS config (
          package_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (package_id, key)
        );

        CREATE TABLE IF NOT EXISTS state (
          package_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at TEXT NOT NULL,
          expires_at TEXT,
          PRIMARY KEY (package_id, namespace, key)
        );

        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          root_run_id TEXT NOT NULL,
          parent_run_id TEXT,
          package_id TEXT NOT NULL,
          package_instance_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          generation_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          status TEXT NOT NULL,
          input_json TEXT,
          output_json TEXT,
          error_json TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          duration_ms INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_runs_action ON runs(package_id, action_id);
        CREATE INDEX IF NOT EXISTS idx_runs_root ON runs(root_run_id);
        CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at);
      `);
    });
  }

  // --- 配置管理 ---

  getConfig<T = unknown>(key: string): T | undefined {
    const stmt = this.driver.prepare(
      "SELECT value_json FROM config WHERE package_id = ? AND key = ?"
    );
    const row = stmt.get<{ value_json: string }>(this.packageId, key);
    if (!row || row.value_json === undefined || row.value_json === null) {
      return undefined;
    }
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return row.value_json as unknown as T;
    }
  }

  listConfig(): Record<string, unknown> {
    const stmt = this.driver.prepare(
      "SELECT key, value_json FROM config WHERE package_id = ?"
    );
    const rows = stmt.all<{ key: string; value_json: string }>(this.packageId);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value_json);
      } catch {
        result[row.key] = row.value_json;
      }
    }
    return result;
  }

  setConfig(key: string, value: unknown): void {
    const stmt = this.driver.prepare(`
      INSERT INTO config (package_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(package_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    const valJson = JSON.stringify(value);
    const now = this.clock.now().toISOString();
    stmt.run(this.packageId, key, valJson, now);
  }

  deleteConfig(key: string): boolean {
    const stmt = this.driver.prepare(
      "DELETE FROM config WHERE package_id = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, key);
    return res.changes > 0;
  }

  // --- 状态管理 ---

  async getState<T = unknown>(
    namespace: string,
    key: string
  ): Promise<T | undefined> {
    const stmt = this.driver.prepare(
      "SELECT value_json, expires_at FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    const row = stmt.get<{ value_json: string; expires_at?: string }>(
      this.packageId,
      namespace,
      key
    );
    if (!row || row.value_json === undefined || row.value_json === null) {
      return undefined;
    }

    if (row.expires_at) {
      const expires = new Date(row.expires_at).getTime();
      const current = this.clock.now().getTime();
      if (current >= expires) {
        this.deleteState(namespace, key).catch(() => {});
        return undefined;
      }
    }

    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return row.value_json as unknown as T;
    }
  }

  async findState<T = unknown>(
    targetKey: string,
    namespace?: string
  ): Promise<StateEntry | undefined> {
    let ns = namespace;
    let actualKey = targetKey;

    if (!ns && targetKey.includes(":")) {
      const parts = targetKey.split(":");
      ns = parts[0];
      actualKey = parts.slice(1).join(":");
    }

    if (ns) {
      const val = await this.getState<T>(ns, actualKey);
      if (val === undefined) return undefined;

      const stmt = this.driver.prepare(
        "SELECT updated_at, expires_at FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
      );
      const row = stmt.get<{ updated_at: string; expires_at?: string }>(
        this.packageId,
        ns,
        actualKey
      );

      return {
        packageId: this.packageId,
        namespace: ns,
        key: actualKey,
        fullKey: targetKey,
        value: val,
        updatedAt: row?.updated_at || this.clock.now().toISOString(),
        expiresAt: row?.expires_at,
      };
    }

    const val = await this.getState<T>("", actualKey);
    if (val !== undefined) {
      const stmt = this.driver.prepare(
        "SELECT updated_at, expires_at FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
      );
      const row = stmt.get<{ updated_at: string; expires_at?: string }>(
        this.packageId,
        "",
        actualKey
      );
      return {
        packageId: this.packageId,
        namespace: "",
        key: actualKey,
        fullKey: actualKey,
        value: val,
        updatedAt: row?.updated_at || this.clock.now().toISOString(),
        expiresAt: row?.expires_at,
      };
    }

    const stmt = this.driver.prepare(
      "SELECT namespace, key, value_json, updated_at, expires_at FROM state WHERE package_id = ? AND key = ?"
    );
    const rows = stmt.all<{
      namespace: string;
      key: string;
      value_json: string;
      updated_at: string;
      expires_at?: string;
    }>(this.packageId, actualKey);

    const now = this.clock.now().getTime();
    for (const row of rows) {
      if (row.expires_at && now >= new Date(row.expires_at).getTime()) {
        continue;
      }
      let parsedVal: unknown;
      try {
        parsedVal = JSON.parse(row.value_json);
      } catch {
        parsedVal = row.value_json;
      }
      return {
        packageId: this.packageId,
        namespace: row.namespace,
        key: row.key,
        fullKey: row.namespace ? `${row.namespace}:${row.key}` : row.key,
        value: parsedVal,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      };
    }

    return undefined;
  }

  async setState<T = unknown>(
    namespace: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    const stmt = this.driver.prepare(`
      INSERT INTO state (package_id, namespace, key, value_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_id, namespace, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `);
    const valJson = JSON.stringify(value);
    const now = this.clock.now();
    const updatedAt = now.toISOString();

    let expiresAt: string | null = null;
    if (typeof ttl === "number" && ttl > 0) {
      expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
    }

    stmt.run(this.packageId, namespace, key, valJson, updatedAt, expiresAt);
  }

  async deleteState(namespace: string, key: string): Promise<boolean> {
    const stmt = this.driver.prepare(
      "DELETE FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, namespace, key);
    return res.changes > 0;
  }

  async deleteStateSmart(
    targetKey: string,
    namespace?: string
  ): Promise<boolean> {
    let ns = namespace;
    let actualKey = targetKey;

    if (!ns && targetKey.includes(":")) {
      const parts = targetKey.split(":");
      ns = parts[0];
      actualKey = parts.slice(1).join(":");
    }

    if (ns !== undefined) {
      return this.deleteState(ns, actualKey);
    }

    const deletedRoot = await this.deleteState("", actualKey);
    if (deletedRoot) return true;

    const stmt = this.driver.prepare(
      "DELETE FROM state WHERE package_id = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, actualKey);
    return res.changes > 0;
  }

  async clearState(
    options: { namespace?: string; all?: boolean; prefix?: string } = {}
  ): Promise<number> {
    let sql = "DELETE FROM state WHERE package_id = ?";
    const params: unknown[] = [this.packageId];

    if (options.namespace !== undefined) {
      sql += " AND namespace = ?";
      params.push(options.namespace);
    }

    if (options.prefix) {
      sql += " AND key LIKE ? ESCAPE '\\'";
      const escapedPrefix = options.prefix.replace(/([%_\\])/g, "\\$1");
      params.push(`${escapedPrefix}%`);
    }

    const stmt = this.driver.prepare(sql);
    const res = stmt.run(...params);
    return res.changes;
  }

  async listStateKeys(
    namespace?: string | null,
    prefix?: string
  ): Promise<string[]> {
    let sql = "SELECT namespace, key, expires_at FROM state WHERE package_id = ?";
    const params: unknown[] = [this.packageId];

    if (namespace !== null && namespace !== undefined) {
      sql += " AND namespace = ?";
      params.push(namespace);
    }

    if (prefix) {
      sql += " AND key LIKE ? ESCAPE '\\'";
      const escapedPrefix = prefix.replace(/([%_\\])/g, "\\$1");
      params.push(`${escapedPrefix}%`);
    }

    const stmt = this.driver.prepare(sql);
    const rows = stmt.all<{
      namespace: string;
      key: string;
      expires_at?: string;
    }>(...params);

    const now = this.clock.now().getTime();
    const result: string[] = [];

    for (const row of rows) {
      if (row.expires_at && now >= new Date(row.expires_at).getTime()) {
        continue;
      }
      if (namespace !== null && namespace !== undefined) {
        result.push(row.key);
      } else {
        result.push(row.namespace ? `${row.namespace}:${row.key}` : row.key);
      }
    }

    return result;
  }

  async listStateEntries(
    options: { namespace?: string; prefix?: string } = {}
  ): Promise<StateEntry[]> {
    let sql = "SELECT namespace, key, value_json, updated_at, expires_at FROM state WHERE package_id = ?";
    const params: unknown[] = [this.packageId];

    if (options.namespace !== undefined) {
      sql += " AND namespace = ?";
      params.push(options.namespace);
    }

    if (options.prefix) {
      sql += " AND key LIKE ? ESCAPE '\\'";
      const escapedPrefix = options.prefix.replace(/([%_\\])/g, "\\$1");
      params.push(`${escapedPrefix}%`);
    }

    const stmt = this.driver.prepare(sql);
    const rows = stmt.all<{
      namespace: string;
      key: string;
      value_json: string;
      updated_at: string;
      expires_at?: string;
    }>(...params);

    const now = this.clock.now().getTime();
    const results: StateEntry[] = [];

    for (const row of rows) {
      if (row.expires_at && now >= new Date(row.expires_at).getTime()) {
        continue;
      }

      let parsedVal: unknown;
      try {
        parsedVal = JSON.parse(row.value_json);
      } catch {
        parsedVal = row.value_json;
      }

      results.push({
        packageId: this.packageId,
        namespace: row.namespace,
        key: row.key,
        fullKey: row.namespace ? `${row.namespace}:${row.key}` : row.key,
        value: parsedVal,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      });
    }

    return results;
  }

  // --- 运行记录管理 ---

  createRun(record: RunRecord): void {
    const stmt = this.driver.prepare(`
      INSERT INTO runs (
        id, root_run_id, parent_run_id, package_id, package_instance_id,
        action_id, generation_id, owner_id, status, input_json, output_json,
        error_json, started_at, finished_at, duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const rootRunId = record.rootRunId || record.id;
    const parentRunId = record.parentRunId || null;
    const packageInstanceId = record.packageInstanceId || record.packageId || this.packageId;
    const generationId = record.generationId || "1";
    const ownerId = record.ownerId || "local";
    const inputJson = record.input !== undefined ? JSON.stringify(record.input) : null;
    const outputJson = record.output !== undefined ? JSON.stringify(record.output) : null;
    const errorJson = record.error ? JSON.stringify(record.error) : null;
    const finishedAt = record.finishedAt || null;
    const durationMs = typeof record.durationMs === "number" ? record.durationMs : null;

    stmt.run(
      record.id,
      rootRunId,
      parentRunId,
      record.packageId || this.packageId,
      packageInstanceId,
      record.actionId,
      generationId,
      ownerId,
      record.status,
      inputJson,
      outputJson,
      errorJson,
      record.startedAt,
      finishedAt,
      durationMs
    );
  }

  updateRun(
    id: string,
    status: TerminalRunStatus,
    output?: unknown,
    error?: RuntimeError,
    finishedAt?: string
  ): void {
    if (this.isClosed) return;
    try {
      const stmt = this.driver.prepare(`
        UPDATE runs
        SET status = ?, output_json = ?, error_json = ?, finished_at = ?
        WHERE id = ?
      `);
      stmt.run(
        status,
        output !== undefined ? JSON.stringify(output) : null,
        error ? JSON.stringify(error) : null,
        finishedAt || this.clock.now().toISOString(),
        id
      );
    } catch {
      // 存储连接已释放时忽略
    }
  }

  getRun(id: string): RunRecord | null {
    const stmt = this.driver.prepare(
      "SELECT * FROM runs WHERE id = ? AND package_id = ?"
    );
    const row = stmt.get<Record<string, unknown>>(id, this.packageId);
    if (!row) return null;
    return this.mapRunRecord(row);
  }

  listRuns(options: { actionId?: string; limit?: number } = {}): RunRecord[] {
    const limit = options.limit || 50;
    let rows: Record<string, unknown>[];
    if (options.actionId) {
      const stmt = this.driver.prepare(`
        SELECT * FROM runs
        WHERE package_id = ? AND action_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all<Record<string, unknown>>(this.packageId, options.actionId, limit);
    } else {
      const stmt = this.driver.prepare(`
        SELECT * FROM runs
        WHERE package_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all<Record<string, unknown>>(this.packageId, limit);
    }
    return rows.map((r) => this.mapRunRecord(r));
  }

  clearRuns(options: { actionId?: string; status?: string } = {}): number {
    let sql = "DELETE FROM runs WHERE package_id = ?";
    const params: unknown[] = [this.packageId];

    if (options.actionId) {
      sql += " AND action_id = ?";
      params.push(options.actionId);
    }

    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }

    const stmt = this.driver.prepare(sql);
    const res = stmt.run(...params);
    return res.changes;
  }

  close(): void {
    if (!this.isClosed) {
      this.isClosed = true;
      this.driver.close();
    }
  }

  private mapRunRecord(row: Record<string, unknown>): RunRecord {
    return {
      id: String(row.id),
      rootRunId: String(row.root_run_id || row.id),
      parentRunId: row.parent_run_id ? String(row.parent_run_id) : undefined,
      packageId: String(row.package_id),
      packageInstanceId: String(row.package_instance_id || row.package_id),
      actionId: String(row.action_id),
      generationId: String(row.generation_id || "1"),
      ownerId: String(row.owner_id || "local"),
      status: row.status as RunRecord["status"],
      input: row.input_json ? JSON.parse(String(row.input_json)) : undefined,
      output: row.output_json ? JSON.parse(String(row.output_json)) : undefined,
      error: row.error_json ? (JSON.parse(String(row.error_json)) as RuntimeError) : undefined,
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : undefined,
      durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    };
  }
}
