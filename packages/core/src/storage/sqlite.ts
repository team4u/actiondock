import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
  type JsonValue,
  type RuntimeError,
  type RunRecord,
} from "@actiondock/sdk";
import { type Clock, SystemClock } from "../runtime/clock";
import { createDefaultSqliteDriver } from "./driver";
import {
  STORAGE_SCHEMA_VERSION,
  type IdempotencyCheckResult,
  type IdempotencyRecord,
  type RuntimeStorage,
  type SqliteDriver,
  type SqliteStatement,
  type StateEntry,
  type StorageOptions,
  type TerminalRunStatus,
} from "./types";

export {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
};

/**
 * 统一 SQLite 运行时存储实现。
 * 通过 SqliteDriver 抽象驱动，解耦底层具体运行时引擎（Node.js / Bun）。
 */
export class SqliteRuntimeStorage implements RuntimeStorage {
  private driver: SqliteDriver;
  private packageId: string;
  private clock: Clock;
  private isClosed = false;
  private statementCache = new Map<string, SqliteStatement>();
  private dbPath: string;
  private syncReader?: SqliteDriver;

  get isOpen(): boolean {
    return !this.isClosed;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  constructor(options: StorageOptions) {
    this.packageId = options.packageId;
    this.clock = options.clock ?? new SystemClock();
    const dbPath = options.dbPath || ":memory:";
    this.dbPath = dbPath;

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
   * 初始化数据库结构并执行严格版本校验。
   *
   * 规则：
   * - 空数据目录首次初始化在单个事务中完成完整 Schema 构建。
   * - 若创建事务失败则拒绝启动且不留下残缺表。
   * - 打开旧版本或不兼容版本的数据库时，在写事务前直接抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动。
   */
  private init(): void {
    this.driver.exec("PRAGMA journal_mode = WAL;");
    this.driver.exec("PRAGMA synchronous = NORMAL;");

    // 读取 Schema 版本号
    const versionRes = this.driver.prepare("PRAGMA user_version;").get<{
      user_version: number;
    }>();
    const version = Number(versionRes?.user_version ?? 0);

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
            host_session_id TEXT,
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
          CREATE INDEX IF NOT EXISTS idx_runs_host_session ON runs(host_session_id);
          CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at);

          CREATE TABLE IF NOT EXISTS idempotency_keys (
            owner_id TEXT NOT NULL,
            action_ref TEXT NOT NULL,
            request_id TEXT NOT NULL,
            input_digest TEXT NOT NULL,
            run_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (owner_id, action_ref, request_id)
          );
          CREATE INDEX IF NOT EXISTS idx_idemp_run ON idempotency_keys(run_id);

          PRAGMA user_version = ${STORAGE_SCHEMA_VERSION};
        `);
      });
    } else if (version !== STORAGE_SCHEMA_VERSION) {
      const err: any = new Error(
        `UNSUPPORTED_STORAGE_SCHEMA: Database schema version ${version} is incompatible (expected ${STORAGE_SCHEMA_VERSION}). Silent upgrade and database overwriting are strictly prohibited.`
      );
      err.code = "UNSUPPORTED_STORAGE_SCHEMA";
      throw err;
    }

    // 确保已有历史数据库补充迁移 host_session_id 列
    if (version !== 0) {
      try {
        const columns = this.driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>();
        if (Array.isArray(columns) && !columns.some((c) => c.name === "host_session_id")) {
          this.driver.exec("ALTER TABLE runs ADD COLUMN host_session_id TEXT;");
        }
      } catch {
        // 忽略非结构化表或兼容驱动异常
      }
    }

    // 重启恢复：将未正常结算的 running 与 pending 状态自动收敛为 interrupted
    this.recoverRunningRuns();
  }

  /**
   * 重启恢复：将未正常结算的非终态（running/pending）记录自动收敛为 interrupted。
   * 若指定了当前新 Host 会话标识，将收敛不属于该会话（包括旧会话或空会话）的死亡任务。
   */
  public recoverRunningRuns(currentHostSessionId?: string): number {
    return this.recoverDeadSessionRuns(currentHostSessionId);
  }

  /**
   * 收敛死亡会话遗留的非终态运行任务。
   */
  public recoverDeadSessionRuns(currentHostSessionId?: string): number {
    if (this.isClosed) return 0;
    try {
      const now = this.clock.now().toISOString();
      let sql = `
        UPDATE runs
        SET status = 'interrupted',
            finished_at = ?,
            error_json = '{"code":"RUN_INTERRUPTED","message":"Execution interrupted by system shutdown or restart"}'
        WHERE status IN ('running', 'pending')
      `;
      const params: any[] = [now];
      if (currentHostSessionId) {
        sql += " AND (host_session_id IS NULL OR host_session_id != ?)";
        params.push(currentHostSessionId);
      }
      const stmt = this.getStatement(sql);
      const res = stmt.run(...params);
      return res.changes;
    } catch {
      return 0;
    }
  }

  /**
   * 获取或复用预编译 SQL 语句缓存。
   */
  private getStatement(sql: string): SqliteStatement {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.driver.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  // --- Config 配置管理 ---

  getConfig<T = unknown>(key: string): T | undefined {
    const stmt = this.getStatement(
      "SELECT value_json FROM config WHERE package_id = ? AND key = ?"
    );
    let row: any = stmt.get<{ value_json: string }>(this.packageId, key);
    if (row && typeof row.then === "function") {
      if (this.dbPath && this.dbPath !== ":memory:" && existsSync(this.dbPath)) {
        try {
          if (!this.syncReader) {
            this.syncReader = createDefaultSqliteDriver(this.dbPath);
          }
          row = this.syncReader.prepare(
            "SELECT value_json FROM config WHERE package_id = ? AND key = ?"
          ).get(this.packageId, key);
        } catch {
          // ignore fallback error
        }
      }
    }
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
    const stmt = this.getStatement(
      "SELECT key, value_json FROM config WHERE package_id = ?"
    );
    let rawRows: any = stmt.all<{ key: string; value_json: string }>(this.packageId);
    if (rawRows && typeof rawRows.then === "function") {
      if (this.dbPath && this.dbPath !== ":memory:" && existsSync(this.dbPath)) {
        try {
          if (!this.syncReader) {
            this.syncReader = createDefaultSqliteDriver(this.dbPath);
          }
          rawRows = this.syncReader.prepare(
            "SELECT key, value_json FROM config WHERE package_id = ?"
          ).all(this.packageId);
        } catch {
          // ignore fallback error
        }
      }
    }
    const rows = Array.isArray(rawRows) ? rawRows : [];
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

  setConfig(key: string, value: unknown): void | Promise<void> {
    const stmt = this.getStatement(`
      INSERT INTO config (package_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(package_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    const valJson = JSON.stringify(value);
    const now = this.clock.now().toISOString();
    const res = stmt.run(this.packageId, key, valJson, now);
    if (res && typeof (res as any).then === "function") {
      return (res as unknown) as Promise<void>;
    }
  }

  deleteConfig(key: string): boolean | Promise<boolean> {
    const stmt = this.getStatement(
      "DELETE FROM config WHERE package_id = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, key);
    if (res && typeof (res as any).then === "function") {
      return (res as any).then((r: any) => r.changes > 0);
    }
    return res.changes > 0;
  }

  // --- State 状态管理 ---

  async getState<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    const stmt = this.getStatement(
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
      if (this.clock.now().getTime() >= expires) {
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

  private async findMatchingStateRows(targetKey: string): Promise<Array<{
    namespace: string;
    key: string;
    value_json: string;
    updated_at: string;
    expires_at?: string;
  }>> {
    let decoded: { namespace: string; key: string } | undefined;
    try {
      decoded = decodeStateKey(targetKey);
    } catch {
      // 键名包含多个未转义冒号
    }

    const candidateStmt = this.getStatement(`
      SELECT namespace, key, value_json, updated_at, expires_at FROM state
      WHERE package_id = ? AND (
        (CASE WHEN ? IS NOT NULL THEN (namespace = ? AND key = ?) ELSE 0 END)
        OR (CASE WHEN namespace = '' THEN key ELSE namespace || ':' || key END) = ?
        OR key = ?
      )
    `);

    const rawResult = candidateStmt.all<{
      namespace: string;
      key: string;
      value_json: string;
      updated_at: string;
      expires_at?: string;
    }>(
      this.packageId,
      decoded ? 1 : null,
      decoded?.namespace ?? "",
      decoded?.key ?? "",
      targetKey,
      targetKey
    );

    const rawRows: Array<{
      namespace: string;
      key: string;
      value_json: string;
      updated_at: string;
      expires_at?: string;
    }> = (rawResult instanceof Promise || typeof (rawResult as any)?.then === "function")
      ? await rawResult
      : (Array.isArray(rawResult) ? rawResult : []);

    const now = this.clock.now().getTime();
    const uniqueMap = new Map<string, (typeof rawRows)[0]>();
    for (const r of rawRows) {
      if (r.expires_at && now >= new Date(r.expires_at).getTime()) {
        this.deleteState(r.namespace, r.key).catch(() => {});
        continue;
      }
      uniqueMap.set(`${r.namespace}\0${r.key}`, r);
    }

    return Array.from(uniqueMap.values());
  }

  async findState<T = unknown>(
    targetKey: string,
    namespace?: string
  ): Promise<StateEntry | undefined> {
    if (namespace !== undefined) {
      const val = await this.getState<T>(namespace, targetKey);
      if (val === undefined) return undefined;

      const stmt = this.getStatement(
        "SELECT updated_at, expires_at FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
      );
      const row = stmt.get<{ updated_at: string; expires_at?: string }>(
        this.packageId,
        namespace,
        targetKey
      );

      return {
        packageId: this.packageId,
        namespace,
        key: targetKey,
        fullKey: encodeStateKey(namespace, targetKey),
        value: val,
        updatedAt: row?.updated_at || this.clock.now().toISOString(),
        expiresAt: row?.expires_at,
      };
    }

    const matchingRows = await this.findMatchingStateRows(targetKey);
    if (matchingRows.length > 1) {
      throw new Error(
        `Ambiguous state key '${targetKey}': matches ${matchingRows.length} entries (${matchingRows.map((r) => `${r.namespace}:${r.key}`).join(", ")})`
      );
    }
    if (matchingRows.length === 0) {
      return undefined;
    }

    const row = matchingRows[0];
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
      fullKey: encodeStateKey(row.namespace, row.key),
      value: parsedVal as T,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  async setState<T = unknown>(
    namespace: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    const stmt = this.getStatement(`
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
    const stmt = this.getStatement(
      "DELETE FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, namespace, key);
    return res.changes > 0;
  }

  async deleteStateSmart(targetKey: string, namespace?: string): Promise<boolean> {
    if (namespace !== undefined) {
      return this.deleteState(namespace, targetKey);
    }

    const matchingRows = await this.findMatchingStateRows(targetKey);
    if (matchingRows.length > 1) {
      throw new Error(
        `Ambiguous state key '${targetKey}': matches ${matchingRows.length} entries for deletion (${matchingRows.map((r) => `${r.namespace}:${r.key}`).join(", ")})`
      );
    }
    if (matchingRows.length === 1) {
      return this.deleteState(matchingRows[0].namespace, matchingRows[0].key);
    }

    return this.deleteState("", targetKey);
  }

  /**
   * 清理已过期的状态记录
   */
  async cleanExpiredState(): Promise<number> {
    if (this.isClosed) return 0;
    try {
      const now = this.clock.now().toISOString();
      const stmt = this.getStatement(
        "DELETE FROM state WHERE package_id = ? AND expires_at IS NOT NULL AND expires_at <= ?"
      );
      const res = stmt.run(this.packageId, now);
      return res.changes;
    } catch {
      return 0;
    }
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

    const stmt = this.getStatement(sql);
    const res = stmt.run(...params);
    return res.changes;
  }

  async listStateKeys(
    namespace?: string | null,
    prefix?: string
  ): Promise<string[]> {
    await this.cleanExpiredState();
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

    const stmt = this.getStatement(sql);
    const rawResult = stmt.all<{
      namespace: string;
      key: string;
      expires_at?: string;
    }>(...params);
    const rows = (rawResult instanceof Promise || typeof (rawResult as any)?.then === "function")
      ? await rawResult
      : (Array.isArray(rawResult) ? rawResult : []);

    const now = this.clock.now().getTime();
    const result: string[] = [];

    for (const row of rows) {
      if (row.expires_at && now >= new Date(row.expires_at).getTime()) {
        continue;
      }
      if (namespace !== null && namespace !== undefined) {
        result.push(row.key);
      } else {
        result.push(encodeStateKey(row.namespace, row.key));
      }
    }

    return result;
  }

  async listStateEntries(
    options: { namespace?: string; prefix?: string } = {}
  ): Promise<StateEntry[]> {
    await this.cleanExpiredState();
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

    const stmt = this.getStatement(sql);
    const rawResult = stmt.all<{
      namespace: string;
      key: string;
      value_json: string;
      updated_at: string;
      expires_at?: string;
    }>(...params);
    const rows = (rawResult instanceof Promise || typeof (rawResult as any)?.then === "function")
      ? await rawResult
      : (Array.isArray(rawResult) ? rawResult : []);

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
        fullKey: encodeStateKey(row.namespace, row.key),
        value: parsedVal,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      });
    }

    return results;
  }

  // --- Runs 运行记录管理 ---

  createRun(record: RunRecord | any): void {
    const stmt = this.getStatement(`
      INSERT INTO runs (
        id, root_run_id, parent_run_id, package_id, package_instance_id,
        action_id, generation_id, owner_id, host_session_id, status, input_json, output_json,
        error_json, started_at, finished_at, duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const rootRunId = record.rootRunId || record.id;
    const parentRunId = record.parentRunId || null;
    const packageInstanceId = record.packageInstanceId || record.packageId || this.packageId;
    const generationId = record.generationId || "1";
    const ownerId = record.ownerId || "local";
    const hostSessionId = record.hostSessionId || null;
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
      record.actionId ?? "",
      generationId,
      ownerId,
      hostSessionId,
      record.status,
      inputJson,
      outputJson,
      errorJson,
      record.startedAt || new Date().toISOString(),
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
      const finishIso = finishedAt || this.clock.now().toISOString();
      const stmt = this.getStatement(`
        UPDATE runs
        SET status = ?, output_json = ?, error_json = ?, finished_at = ?,
            duration_ms = CASE
              WHEN started_at IS NOT NULL THEN MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER))
              ELSE NULL
            END
        WHERE id = ? AND status = 'running'
      `);
      stmt.run(
        status,
        output !== undefined ? JSON.stringify(output) : null,
        error ? JSON.stringify(error) : null,
        finishIso,
        finishIso,
        id
      );
    } catch (err) {
      if (this.isClosed) return;
      console.warn(`[SqliteRuntimeStorage] Failed to update run "${id}":`, err);
      throw err;
    }
  }

  getRun(id: string): RunRecord | null {
    const stmt = this.getStatement(
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
      const stmt = this.getStatement(`
        SELECT * FROM runs
        WHERE package_id = ? AND action_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(this.packageId, options.actionId, limit);
    } else {
      const stmt = this.getStatement(`
        SELECT * FROM runs
        WHERE package_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(this.packageId, limit);
    }
    if (rows && typeof (rows as any).then === "function") {
      return (rows as any).then((r: any[]) => r.map((item: any) => this.mapRunRecord(item)));
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
    const stmt = this.getStatement(sql);
    const res = stmt.run(...params);

    // 运行记录清理后，级联清理已无对应运行的孤立去重索引记录
    try {
      this.getStatement("DELETE FROM idempotency_keys WHERE run_id NOT IN (SELECT id FROM runs)").run();
    } catch {}

    return res.changes;
  }

  // --- Idempotency 幂等去重管理 ---

  checkAndRecordIdempotency(record: IdempotencyRecord): IdempotencyCheckResult {
    if (this.isClosed) {
      throw new Error("SqliteRuntimeStorage is closed");
    }
    return this.driver.transaction(() => {
      const checkStmt = this.getStatement(`
        SELECT input_digest, run_id FROM idempotency_keys
        WHERE owner_id = ? AND action_ref = ? AND request_id = ?
      `);
      const existing = checkStmt.get<{ input_digest: string; run_id: string }>(
        record.ownerId,
        record.actionRef,
        record.requestId
      );

      if (existing) {
        // 检查关联的运行记录是否仍存在于运行表中
        const runStmt = this.getStatement("SELECT id FROM runs WHERE id = ?");
        const runExists = runStmt.get<{ id: string }>(existing.run_id);
        if (!runExists) {
          // 原运行记录已被清理淘汰，允许复用该 requestId
          const delStmt = this.getStatement(`
            DELETE FROM idempotency_keys
            WHERE owner_id = ? AND action_ref = ? AND request_id = ?
          `);
          delStmt.run(record.ownerId, record.actionRef, record.requestId);
        } else {
          if (existing.input_digest !== record.inputDigest) {
            return { outcome: "conflict", existingDigest: existing.input_digest };
          }
          return { outcome: "duplicate", runId: existing.run_id };
        }
      }

      const insertStmt = this.getStatement(`
        INSERT INTO idempotency_keys (owner_id, action_ref, request_id, input_digest, run_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const createdAt = record.createdAt || this.clock.now().toISOString();
      insertStmt.run(
        record.ownerId,
        record.actionRef,
        record.requestId,
        record.inputDigest,
        record.runId,
        createdAt
      );

      return { outcome: "new" };
    });
  }

  getIdempotencyRecord(ownerId: string, actionRef: string, requestId: string): IdempotencyRecord | undefined {
    if (this.isClosed) return undefined;
    const stmt = this.getStatement(`
      SELECT owner_id, action_ref, request_id, input_digest, run_id, created_at
      FROM idempotency_keys
      WHERE owner_id = ? AND action_ref = ? AND request_id = ?
    `);
    const row = stmt.get<any>(ownerId, actionRef, requestId);
    if (!row) return undefined;
    return {
      ownerId: row.owner_id,
      actionRef: row.action_ref,
      requestId: row.request_id,
      inputDigest: row.input_digest,
      runId: row.run_id,
      createdAt: row.created_at,
    };
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
      hostSessionId: row.host_session_id || undefined,
      status: row.status,
      input,
      output,
      error,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
      durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    };
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    this.statementCache.clear();
    if (this.syncReader) {
      try {
        this.syncReader.close();
      } catch {}
      this.syncReader = undefined;
    }
    try {
      const res: any = this.driver.close();
      if (res && typeof res.then === "function") {
        await res;
      }
    } catch {
      // 忽略重复关闭异常
    }
  }
}
