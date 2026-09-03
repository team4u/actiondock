import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeError, RunRecord } from "@actiondock/sdk";
import type { RuntimeStorage, StateEntry, StorageOptions, TerminalRunStatus } from "./types";

/**
 * 基于 Bun 内置原生 SQLite (`bun:sqlite`) 实现的高性能运行时存储。
 * 
 * 关键特性：
 * 1. 零网络与外部进程开销：直接通过 Bun C-API 高速操作 SQLite 数据库文件。
 * 2. 高并发优化：开启 `WAL`（Write-Ahead Logging）模式与 `synchronous = NORMAL`，支持高并发读写。
 * 3. 严格的安全权限：自动配置目录权限为 0700，数据库文件权限为 0600。
 * 4. 自动版本迁移：基于 SQLite `user_version` PRAGMA 实现无损自动 Schema 迁移。
 * 5. TTL 自动过期：支持状态的过期清理。
 */
export class SqliteRuntimeStorage implements RuntimeStorage {
  private db: Database;
  private packageId: string;
  private isClosed = false;

  constructor(options: StorageOptions) {
    this.packageId = options.packageId;
    const dbPath = options.dbPath || ":memory:";

    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          chmodSync(dir, 0o700);
        } catch {
          // 忽略系统权限设置失败（如只读文件系统）
        }
      }
    }

    this.db = new Database(dbPath);
    if (dbPath !== ":memory:" && existsSync(dbPath)) {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // 忽略文件权限设置异常
      }
    }
    this.init();
  }

  /**
   * 初始化数据库 Schema 并执行版本迁移。
   */
  private init(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    // 读取 Schema 版本号
    const versionRes = this.db.query("PRAGMA user_version;").get() as {
      user_version: number;
    };
    const version = versionRes?.user_version ?? 0;

    if (version === 0) {
      this.db.transaction(() => {
        this.db.exec(`
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
            package_id TEXT NOT NULL,
            action_id TEXT NOT NULL,
            parent_run_id TEXT,
            status TEXT NOT NULL,
            input_json TEXT,
            output_json TEXT,
            error_json TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_runs_action ON runs(package_id, action_id);
          CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
          CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at);

          PRAGMA user_version = 2;
        `);
      })();
    } else if (version < 2) {
      this.db.transaction(() => {
        try {
          const columns = this.db
            .query("PRAGMA table_info(state);")
            .all() as Array<{ name: string }>;
          const hasExpiresAt = columns.some((c) => c.name === "expires_at");
          if (!hasExpiresAt) {
            this.db.exec("ALTER TABLE state ADD COLUMN expires_at TEXT;");
          }
        } catch {
          // If table doesn't exist yet or already altered
        }
        this.db.exec(
          "CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at);"
        );
        this.db.exec("PRAGMA user_version = 2;");
      })();
    }
  }

  // --- Config ---

  getConfig<T = unknown>(key: string): T | undefined {
    const stmt = this.db.prepare(
      "SELECT value_json FROM config WHERE package_id = ? AND key = ?"
    );
    const row = stmt.get(this.packageId, key) as { value_json: string } | null;
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
    const stmt = this.db.prepare(
      "SELECT key, value_json FROM config WHERE package_id = ?"
    );
    const rows = stmt.all(this.packageId) as Array<{
      key: string;
      value_json: string;
    }>;
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
    const stmt = this.db.prepare(`
      INSERT INTO config (package_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(package_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    const valJson = JSON.stringify(value);
    const now = new Date().toISOString();
    stmt.run(this.packageId, key, valJson, now);
  }

  deleteConfig(key: string): boolean {
    const stmt = this.db.prepare(
      "DELETE FROM config WHERE package_id = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, key);
    return res.changes > 0;
  }

  // --- State ---

  async getState<T = unknown>(
    namespace: string,
    key: string
  ): Promise<T | undefined> {
    const stmt = this.db.prepare(
      "SELECT value_json, expires_at FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    const row = stmt.get(this.packageId, namespace, key) as {
      value_json: string;
      expires_at: string | null;
    } | null;
    if (!row || row.value_json === undefined || row.value_json === null) {
      return undefined;
    }
    if (row.expires_at) {
      const expiresTime = new Date(row.expires_at).getTime();
      if (!isNaN(expiresTime) && expiresTime <= Date.now()) {
        await this.deleteState(namespace, key);
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
    let row: any = null;

    if (namespace !== undefined) {
      const stmt = this.db.prepare(
        "SELECT * FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
      );
      row = stmt.get(this.packageId, namespace, targetKey);
    } else {
      // 1. 先在根命名空间精确查找
      const rootStmt = this.db.prepare(
        "SELECT * FROM state WHERE package_id = ? AND namespace = '' AND key = ?"
      );
      row = rootStmt.get(this.packageId, targetKey);

      // 2. 若未命中且包含 ':'，尝试通过 (namespace || ':' || key) 复合匹配
      if (!row && targetKey.includes(":")) {
        const compositeStmt = this.db.prepare(
          "SELECT * FROM state WHERE package_id = ? AND (namespace || ':' || key) = ?"
        );
        row = compositeStmt.get(this.packageId, targetKey);
      }
    }

    if (!row) return undefined;

    // 校验过期
    if (row.expires_at) {
      const expiresTime = new Date(row.expires_at).getTime();
      if (!isNaN(expiresTime) && expiresTime <= Date.now()) {
        await this.deleteState(row.namespace, row.key);
        return undefined;
      }
    }

    let parsedVal: unknown;
    try {
      parsedVal =
        row.value_json !== null && row.value_json !== undefined
          ? JSON.parse(row.value_json)
          : row.value_json;
    } catch {
      parsedVal = row.value_json;
    }

    const fullKey = row.namespace ? `${row.namespace}:${row.key}` : row.key;
    return {
      packageId: row.package_id,
      namespace: row.namespace,
      key: row.key,
      fullKey,
      value: parsedVal as T,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at || undefined,
    };
  }

  async setState<T = unknown>(
    namespace: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    const expiresAtStr =
      typeof ttl === "number" && ttl > 0
        ? new Date(Date.now() + ttl * 1000).toISOString()
        : null;

    const stmt = this.db.prepare(`
      INSERT INTO state (package_id, namespace, key, value_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_id, namespace, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `);
    const valJson = JSON.stringify(value);
    const now = new Date().toISOString();
    stmt.run(this.packageId, namespace, key, valJson, now, expiresAtStr);
  }

  async deleteState(namespace: string, key: string): Promise<boolean> {
    const stmt = this.db.prepare(
      "DELETE FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, namespace, key);
    return res.changes > 0;
  }

  async deleteStateSmart(
    targetKey: string,
    namespace?: string
  ): Promise<boolean> {
    if (namespace !== undefined) {
      return this.deleteState(namespace, targetKey);
    }
    // 1. 先尝试在根命名空间删除
    const rootDeleted = await this.deleteState("", targetKey);
    if (rootDeleted) return true;

    // 2. 若 targetKey 包含 ':'，尝试按 (namespace || ':' || key) 复合键删除
    if (targetKey.includes(":")) {
      const stmt = this.db.prepare(
        "DELETE FROM state WHERE package_id = ? AND (namespace || ':' || key) = ?"
      );
      const res = stmt.run(this.packageId, targetKey);
      return res.changes > 0;
    }

    return false;
  }

  async clearState(
    options: { namespace?: string; all?: boolean; prefix?: string } = {}
  ): Promise<number> {
    if (options.all) {
      const stmt = this.db.prepare("DELETE FROM state WHERE package_id = ?");
      const res = stmt.run(this.packageId);
      return res.changes;
    }

    if (options.namespace !== undefined) {
      if (options.prefix) {
        const stmt = this.db.prepare(
          "DELETE FROM state WHERE package_id = ? AND namespace = ? AND key LIKE ?"
        );
        const res = stmt.run(
          this.packageId,
          options.namespace,
          `${options.prefix}%`
        );
        return res.changes;
      } else {
        const stmt = this.db.prepare(
          "DELETE FROM state WHERE package_id = ? AND namespace = ?"
        );
        const res = stmt.run(this.packageId, options.namespace);
        return res.changes;
      }
    }

    if (options.prefix) {
      const pattern = `${options.prefix}%`;
      const stmt = this.db.prepare(
        "DELETE FROM state WHERE package_id = ? AND (CASE WHEN namespace = '' THEN key ELSE (namespace || ':' || key) END) LIKE ?"
      );
      const res = stmt.run(this.packageId, pattern);
      return res.changes;
    }

    const stmt = this.db.prepare(
      "DELETE FROM state WHERE package_id = ? AND namespace = ''"
    );
    const res = stmt.run(this.packageId);
    return res.changes;
  }

  async listStateKeys(
    namespace?: string | null,
    prefix = ""
  ): Promise<string[]> {
    const nowStr = new Date().toISOString();
    try {
      const cleanupStmt = this.db.prepare(
        "DELETE FROM state WHERE package_id = ? AND expires_at IS NOT NULL AND expires_at <= ?"
      );
      cleanupStmt.run(this.packageId, nowStr);
    } catch {
      // Best-effort cleanup
    }

    if (namespace === null || namespace === undefined) {
      const pattern = prefix ? `${prefix}%` : "%";
      const stmt = this.db.prepare(
        "SELECT namespace, key FROM state WHERE package_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (CASE WHEN namespace = '' THEN key ELSE (namespace || ':' || key) END) LIKE ? ORDER BY namespace ASC, key ASC"
      );
      const rows = stmt.all(this.packageId, nowStr, pattern) as Array<{
        namespace: string;
        key: string;
      }>;
      return rows.map((r) => (r.namespace ? `${r.namespace}:${r.key}` : r.key));
    } else {
      const pattern = prefix ? `${prefix}%` : "%";
      const stmt = this.db.prepare(
        "SELECT key FROM state WHERE package_id = ? AND namespace = ? AND key LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key ASC"
      );
      const rows = stmt.all(
        this.packageId,
        namespace,
        pattern,
        nowStr
      ) as Array<{
        key: string;
      }>;
      return rows.map((r) => r.key);
    }
  }

  async listStateEntries(
    options: { namespace?: string; prefix?: string } = {}
  ): Promise<StateEntry[]> {
    const nowStr = new Date().toISOString();
    try {
      const cleanupStmt = this.db.prepare(
        "DELETE FROM state WHERE package_id = ? AND expires_at IS NOT NULL AND expires_at <= ?"
      );
      cleanupStmt.run(this.packageId, nowStr);
    } catch {}

    const pattern = options.prefix ? `${options.prefix}%` : "%";
    let rows: any[] = [];

    if (options.namespace !== undefined) {
      const stmt = this.db.prepare(
        "SELECT * FROM state WHERE package_id = ? AND namespace = ? AND key LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key ASC"
      );
      rows = stmt.all(this.packageId, options.namespace, pattern, nowStr);
    } else {
      const stmt = this.db.prepare(
        "SELECT * FROM state WHERE package_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (CASE WHEN namespace = '' THEN key ELSE (namespace || ':' || key) END) LIKE ? ORDER BY namespace ASC, key ASC"
      );
      rows = stmt.all(this.packageId, nowStr, pattern);
    }

    return rows.map((row) => {
      let parsedVal: unknown;
      try {
        parsedVal =
          row.value_json !== null && row.value_json !== undefined
            ? JSON.parse(row.value_json)
            : row.value_json;
      } catch {
        parsedVal = row.value_json;
      }
      return {
        packageId: row.package_id,
        namespace: row.namespace,
        key: row.key,
        fullKey: row.namespace ? `${row.namespace}:${row.key}` : row.key,
        value: parsedVal,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at || undefined,
      };
    });
  }

  // --- Runs ---

  createRun(record: RunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (
        id, package_id, action_id, parent_run_id, status,
        input_json, output_json, error_json, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      this.packageId,
      record.actionId,
      record.parentRunId || null,
      record.status,
      record.input !== undefined ? JSON.stringify(record.input) : null,
      record.output !== undefined ? JSON.stringify(record.output) : null,
      record.error ? JSON.stringify(record.error) : null,
      record.startedAt,
      record.finishedAt || null
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
      const stmt = this.db.prepare(`
        UPDATE runs SET
          status = ?,
          output_json = ?,
          error_json = ?,
          finished_at = ?
        WHERE id = ?
      `);
      stmt.run(
        status,
        output !== undefined ? JSON.stringify(output) : null,
        error ? JSON.stringify(error) : null,
        finishedAt || new Date().toISOString(),
        id
      );
    } catch {
      // 数据库已关闭，安全忽略
    }
  }

  getRun(id: string): RunRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM runs WHERE id = ? AND package_id = ?"
    );
    const row = stmt.get(id, this.packageId) as any;
    if (!row) return null;
    return this.mapRunRecord(row);
  }

  listRuns(options: { actionId?: string; limit?: number } = {}): RunRecord[] {
    const limit = options.limit || 50;
    let rows: any[];
    if (options.actionId) {
      const stmt = this.db.prepare(`
        SELECT * FROM runs
        WHERE package_id = ? AND action_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(this.packageId, options.actionId, limit);
    } else {
      const stmt = this.db.prepare(`
        SELECT * FROM runs
        WHERE package_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(this.packageId, limit);
    }
    return rows.map((r) => this.mapRunRecord(r));
  }

  clearRuns(options: { actionId?: string; status?: string } = {}): number {
    let sql = "DELETE FROM runs WHERE package_id = ?";
    const params: any[] = [this.packageId];
    if (options.actionId) {
      sql += " AND action_id = ?";
      params.push(options.actionId);
    }
    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...params);
    return res.changes;
  }

  private mapRunRecord(row: any): RunRecord {
    let input: unknown;
    let output: unknown;
    let error: RuntimeError | undefined;

    try {
      input = row.input_json ? JSON.parse(row.input_json) : undefined;
    } catch {
      input = row.input_json;
    }

    try {
      output = row.output_json ? JSON.parse(row.output_json) : undefined;
    } catch {
      output = row.output_json;
    }

    try {
      error = row.error_json ? JSON.parse(row.error_json) : undefined;
    } catch {
      error = undefined;
    }

    return {
      id: row.id,
      packageId: row.package_id,
      actionId: row.action_id,
      parentRunId: row.parent_run_id || undefined,
      status: row.status,
      input,
      output,
      error,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
    };
  }

  close(): void {
    this.isClosed = true;
    try {
      this.db.close();
    } catch {
      // 忽略重复关闭异常
    }
  }
}
