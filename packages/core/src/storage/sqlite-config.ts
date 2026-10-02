import type { SqliteDriver, SqliteStatement } from "./types";
import type { Clock } from "./clock";
import { safeParseStoredJson } from "./utils";

export class SqliteConfigStore {
  private statementCache = new Map<string, SqliteStatement>();
  private driver: SqliteDriver;
  private packageId: string;
  private dbPath: string;
  private clock: Clock;

  constructor(
    driver: SqliteDriver,
    packageId: string,
    dbPath: string,
    clock: Clock
  ) {
    this.driver = driver;
    this.packageId = packageId;
    this.dbPath = dbPath;
    this.clock = clock;
  }

  private getStatement(sql: string): SqliteStatement {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.driver.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  getConfig<T = unknown>(key: string): T | undefined {
    const stmt = this.getStatement(
      "SELECT value_json FROM config WHERE package_id = ? AND key = ?"
    );
    const row = stmt.get<{ value_json: string }>(this.packageId, key);
    if (!row || row.value_json === undefined || row.value_json === null) {
      return undefined;
    }
    return safeParseStoredJson<T>(
      row.value_json,
      `config db=${this.dbPath} package=${this.packageId} key=${key}`
    );
  }

  listConfig(): Record<string, unknown> {
    const stmt = this.getStatement(
      "SELECT key, value_json FROM config WHERE package_id = ?"
    );
    const rows = stmt.all<{ key: string; value_json: string }>(this.packageId);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = safeParseStoredJson(
        row.value_json,
        `config db=${this.dbPath} package=${this.packageId} key=${row.key}`
      );
    }
    return result;
  }

  setConfig(key: string, value: unknown): void {
    const stmt = this.getStatement(`
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
    const stmt = this.getStatement(
      "DELETE FROM config WHERE package_id = ? AND key = ?"
    );
    const res = stmt.run(this.packageId, key);
    return res.changes > 0;
  }

  close(): void {
    this.statementCache.clear();
  }
}
