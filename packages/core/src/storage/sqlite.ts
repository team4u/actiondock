import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeError, RunRecord } from "@actiondock/sdk";
import type { RuntimeStorage, StorageOptions } from "./types";

export class SqliteRuntimeStorage implements RuntimeStorage {
  private db: Database;
  private packageId: string;

  constructor(options: StorageOptions) {
    this.packageId = options.packageId;
    const dbPath = options.dbPath || ":memory:";

    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    // Check version
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

          PRAGMA user_version = 1;
        `);
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
      "SELECT value_json FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    const row = stmt.get(this.packageId, namespace, key) as {
      value_json: string;
    } | null;
    if (!row || row.value_json === undefined || row.value_json === null) {
      return undefined;
    }
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return row.value_json as unknown as T;
    }
  }

  async setState<T = unknown>(
    namespace: string,
    key: string,
    value: T
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO state (package_id, namespace, key, value_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(package_id, namespace, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    const valJson = JSON.stringify(value);
    const now = new Date().toISOString();
    stmt.run(this.packageId, namespace, key, valJson, now);
  }

  async deleteState(namespace: string, key: string): Promise<void> {
    const stmt = this.db.prepare(
      "DELETE FROM state WHERE package_id = ? AND namespace = ? AND key = ?"
    );
    stmt.run(this.packageId, namespace, key);
  }

  async listStateKeys(namespace: string, prefix = ""): Promise<string[]> {
    const pattern = prefix ? `${prefix}%` : "%";
    const stmt = this.db.prepare(
      "SELECT key FROM state WHERE package_id = ? AND namespace = ? AND key LIKE ? ORDER BY key ASC"
    );
    const rows = stmt.all(this.packageId, namespace, pattern) as Array<{
      key: string;
    }>;
    return rows.map((r) => r.key);
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
    status: "success" | "failed",
    output?: unknown,
    error?: RuntimeError,
    finishedAt?: string
  ): void {
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
    this.db.close();
  }
}
