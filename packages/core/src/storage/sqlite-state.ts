import { decodeStateKey, encodeStateKey, type Logger } from "@actiondock/sdk";
import type { SqliteDriver, SqliteStatement, StateEntry } from "./types";
import type { Clock } from "./clock";
import { safeParseStoredJson } from "./utils";
import { ActionDockError, AMBIGUOUS_STATE_KEY } from "../errors";
import { IDEMPOTENCY_RETENTION_MS } from "./types";

export class SqliteStateStore {
  private statementCache = new Map<string, SqliteStatement>();
  private driver: SqliteDriver;
  private packageId: string;
  private dbPath: string;
  private clock: Clock;
  private logger?: Logger;
  private logWarnFn?: (msg: string) => void;

  constructor(
    driver: SqliteDriver,
    packageId: string,
    dbPath: string,
    clock: Clock,
    logger?: Logger,
    logWarnFn?: (msg: string) => void
  ) {
    this.driver = driver;
    this.packageId = packageId;
    this.dbPath = dbPath;
    this.clock = clock;
    this.logger = logger;
    this.logWarnFn = logWarnFn;
  }

  private logWarn(message: string): void {
    if (this.logWarnFn) {
      this.logWarnFn(message);
    } else if (this.logger) {
      this.logger.warn(message);
    } else {
      console.warn(message);
    }
  }

  private getStatement(sql: string): SqliteStatement {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.driver.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

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
        this.deleteState(namespace, key).catch((err) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.logWarn(
            `[actiondock] expired state lazy delete failed (namespace='${namespace}' key='${key}'): ${reason}`
          );
        });
        return undefined;
      }
    }

    return safeParseStoredJson<T>(
      row.value_json,
      `state db=${this.dbPath} package=${this.packageId} namespace=${namespace} key=${key}`
    );
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
      // ignore
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

    const rawRows = Array.isArray(rawResult) ? rawResult : [];
    const now = this.clock.now().getTime();
    const uniqueMap = new Map<string, (typeof rawRows)[0]>();

    for (const r of rawRows) {
      if (r.expires_at && now >= new Date(r.expires_at).getTime()) {
        const ns = r.namespace;
        const k = r.key;
        this.deleteState(ns, k).catch((err) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.logWarn(
            `[actiondock] expired state lazy delete failed (namespace='${ns}' key='${k}'): ${reason}`
          );
        });
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
      throw new ActionDockError(
        AMBIGUOUS_STATE_KEY,
        `Ambiguous state key '${targetKey}': matches ${matchingRows.length} entries (${matchingRows.map((r) => `${r.namespace}:${r.key}`).join(", ")})`
      );
    }
    if (matchingRows.length === 0) {
      return undefined;
    }

    const row = matchingRows[0];
    const parsedVal = safeParseStoredJson(
      row.value_json,
      `state db=${this.dbPath} package=${this.packageId} namespace=${row.namespace} key=${row.key}`
    );
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
      throw new ActionDockError(
        AMBIGUOUS_STATE_KEY,
        `Ambiguous state key '${targetKey}': matches ${matchingRows.length} entries for deletion (${matchingRows.map((r) => `${r.namespace}:${r.key}`).join(", ")})`
      );
    }
    if (matchingRows.length === 1) {
      return this.deleteState(matchingRows[0].namespace, matchingRows[0].key);
    }

    return this.deleteState("", targetKey);
  }

  async cleanExpiredState(isClosed: boolean): Promise<number> {
    if (isClosed) return 0;
    try {
      const now = this.clock.now();
      const stmt = this.getStatement(
        "DELETE FROM state WHERE package_id = ? AND expires_at IS NOT NULL AND expires_at <= ?"
      );
      const res = stmt.run(this.packageId, now.toISOString());

      const retentionCutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS).toISOString();
      try {
        this.getStatement(
          "DELETE FROM idempotency_keys WHERE created_at < ?"
        ).run(retentionCutoff);
      } catch (err) {
        this.logWarn(
          `[actiondock] idempotency retention cleanup failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      return res.changes;
    } catch (err) {
      this.logWarn(
        `[actiondock] cleanExpiredState failed: ${err instanceof Error ? err.message : String(err)}`
      );
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
    prefix?: string,
    isClosed?: boolean
  ): Promise<string[]> {
    await this.cleanExpiredState(isClosed || false);
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
    const rows = Array.isArray(rawResult) ? rawResult : [];

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
    options: { namespace?: string; prefix?: string } = {},
    isClosed?: boolean
  ): Promise<StateEntry[]> {
    await this.cleanExpiredState(isClosed || false);
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
    const rows = Array.isArray(rawResult) ? rawResult : [];

    const now = this.clock.now().getTime();
    const results: StateEntry[] = [];

    for (const row of rows) {
      if (row.expires_at && now >= new Date(row.expires_at).getTime()) {
        continue;
      }

      const parsedVal = safeParseStoredJson(
        row.value_json,
        `state db=${this.dbPath} package=${this.packageId} namespace=${row.namespace} key=${row.key}`
      );

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

  close(): void {
    this.statementCache.clear();
  }
}
