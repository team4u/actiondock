import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonValue, RuntimeError, RunRecord } from "@actiondock/sdk";
import { createDefaultSqliteDriver } from "./driver";
import type {
  RuntimeStorage,
  SqliteDriver,
  StateEntry,
  StorageOptions,
  TerminalRunStatus,
} from "./types";

/**
 * 统一 SQLite 运行时存储实现。
 * 通过 SqliteDriver 抽象驱动，解耦底层具体运行时引擎（Node.js / Bun）。
 */
export class SqliteRuntimeStorage implements RuntimeStorage {
  private driver: SqliteDriver;
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
          // 忽略系统权限设置失败
        }
      }
    }

    this.driver = options.driver ?? createDefaultSqliteDriver(dbPath);

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
   * 初始化数据库结构并执行无损版本升级。
   */
  private init(): void {
    this.driver.exec("PRAGMA journal_mode = WAL;");
    this.driver.exec("PRAGMA synchronous = NORMAL;");

    // 读取 Schema 版本号
    const versionRes = this.driver.prepare("PRAGMA user_version;").get<{
      user_version: number;
    }>();
    const version = versionRes?.user_version ?? 0;

    if (version === 0) {
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

          PRAGMA user_version = 3;
        `);
      });
    } else if (version < 2) {
      this.driver.transaction(() => {
        try {
          const columns = this.driver
            .prepare("PRAGMA table_info(state);")
            .all<{ name: string }>();
          const hasExpiresAt = columns.some((c) => c.name === "expires_at");
          if (!hasExpiresAt) {
            this.driver.exec("ALTER TABLE state ADD COLUMN expires_at TEXT;");
          }
        } catch {
          // 忽略表已存在或字段已添加
        }
        this.driver.exec(
          "CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at);"
        );
        this.driver.exec("PRAGMA user_version = 2;");
      });
    }

    // 升级至版本 3：补齐运行记录调用链与实例字段
    if (version < 3) {
      this.driver.transaction(() => {
        try {
          const columns = this.driver
            .prepare("PRAGMA table_info(runs);")
            .all<{ name: string }>();
          const columnNames = new Set(columns.map((c) => c.name));

          if (!columnNames.has("root_run_id")) {
            this.driver.exec("ALTER TABLE runs ADD COLUMN root_run_id TEXT DEFAULT '';");
            this.driver.exec("UPDATE runs SET root_run_id = id WHERE root_run_id = '' OR root_run_id IS NULL;");
          }
          if (!columnNames.has("package_instance_id")) {
            this.driver.exec("ALTER TABLE runs ADD COLUMN package_instance_id TEXT DEFAULT '';");
          }
          if (!columnNames.has("generation_id")) {
            this.driver.exec("ALTER TABLE runs ADD COLUMN generation_id TEXT DEFAULT '1';");
          }
          if (!columnNames.has("owner_id")) {
            this.driver.exec("ALTER TABLE runs ADD COLUMN owner_id TEXT DEFAULT 'local';");
          }
          if (!columnNames.has("duration_ms")) {
            this.driver.exec("ALTER TABLE runs ADD COLUMN duration_ms INTEGER;");
          }
        } catch {
          // 忽略已存在的字段
        }
        this.driver.exec("CREATE INDEX IF NOT EXISTS idx_runs_root ON runs(root_run_id);");
        this.driver.exec("PRAGMA user_version = 3;");
      });
    }
  }

  // --- Config 配置管理 ---

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
    const now = new Date().toISOString();
    stmt.run(this.packageId, key, valJson, now);
  }

  deleteConfig(key: string): boolean {
    const stmt = this.driver.prepare(
      "DELETE FROM config WHERE package_id = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, key);
    return res.changes > 0;
  }

  // --- State 状态管理 ---

  async getState<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
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
      if (Date.now() >= expires) {
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
        updatedAt: row?.updated_at || new Date().toISOString(),
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
        updatedAt: row?.updated_at || new Date().toISOString(),
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

    const now = Date.now();
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
    const now = new Date();
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

  async deleteStateSmart(targetKey: string, namespace?: string): Promise<boolean> {
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
    const params: any[] = [this.packageId];

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
    const params: any[] = [this.packageId];

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

    const now = Date.now();
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
    const params: any[] = [this.packageId];

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

    const now = Date.now();
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

  // --- Runs 运行记录管理 ---

  createRun(record: RunRecord | any): void {
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
        finishedAt || new Date().toISOString(),
        id
      );
    } catch {
      // 数据库已关闭或操作异常，安全忽略
    }
  }

  getRun(id: string): RunRecord | null {
    const stmt = this.driver.prepare(
      "SELECT * FROM runs WHERE id = ? AND package_id = ?"
    );
    const row = stmt.get<any>(id, this.packageId);
    if (!row) return null;
    return this.mapRunRecord(row);
  }

  listRuns(options: { actionId?: string; limit?: number } = {}): RunRecord[] {
    const limit = options.limit || 50;
    let rows: any[];
    if (options.actionId) {
      const stmt = this.driver.prepare(`
        SELECT * FROM runs
        WHERE package_id = ? AND action_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(this.packageId, options.actionId, limit);
    } else {
      const stmt = this.driver.prepare(`
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
    const stmt = this.driver.prepare(sql);
    const res = stmt.run(...params);
    return res.changes;
  }

  private mapRunRecord(row: any): RunRecord {
    let input: JsonValue | undefined;
    let output: JsonValue | undefined;
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
      rootRunId: row.root_run_id || row.id,
      parentRunId: row.parent_run_id || undefined,
      packageId: row.package_id,
      packageInstanceId: row.package_instance_id || row.package_id,
      actionId: row.action_id,
      generationId: row.generation_id || "1",
      ownerId: row.owner_id || "local",
      status: row.status,
      input,
      output,
      error,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
      durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    };
  }

  close(): void {
    this.isClosed = true;
    try {
      this.driver.close();
    } catch {
      // 忽略重复关闭异常
    }
  }
}
