import type { JsonValue, Logger, RuntimeError, RunRecord } from "@actiondock/sdk";
import type { SqliteDriver, SqliteStatement, TerminalRunStatus, RunsRetentionPolicy, IdempotencyRecord, IdempotencyCheckResult } from "./types";
import { isTerminalRunStatus, DEFAULT_MAX_RUNS_PER_PACKAGE, DEFAULT_MIN_RETAIN_RUNS, DEFAULT_RUNS_RETENTION_MS } from "./types";
import type { Clock } from "./clock";
import { safeParseStoredJson } from "./utils";
import { ActionDockError, STORAGE_CLOSED, STORED_ERROR_DECODE_FAILED } from "../errors";

export class SqliteRunsStore {
  private statementCache = new Map<string, SqliteStatement>();
  private runInsertCount = 0;
  private lastRunsCleanupAt = 0;
  private static readonly RUNS_CLEANUP_INTERVAL_MS = 3600_000;
  private static readonly RUNS_CLEANUP_BATCH_THRESHOLD = 50;

  private driver: SqliteDriver;
  private packageId: string;
  private dbPath: string;
  private clock: Clock;
  private retentionPolicy?: RunsRetentionPolicy;
  private getConfigFn?: <T>(key: string) => T | undefined;
  private logger?: Logger;
  private logWarnFn?: (msg: string) => void;

  constructor(
    driver: SqliteDriver,
    packageId: string,
    dbPath: string,
    clock: Clock,
    retentionPolicy?: RunsRetentionPolicy,
    getConfigFn?: <T>(key: string) => T | undefined,
    logger?: Logger,
    logWarnFn?: (msg: string) => void
  ) {
    this.driver = driver;
    this.packageId = packageId;
    this.dbPath = dbPath;
    this.clock = clock;
    this.retentionPolicy = retentionPolicy;
    this.getConfigFn = getConfigFn;
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

  recoverDeadSessionRuns(isClosed: boolean, currentHostSessionId?: string): number {
    if (isClosed) return 0;
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
    } catch (err) {
      this.logWarn(
        `[actiondock] recoverDeadSessionRuns failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }

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

    this.runInsertCount++;
    const nowMs = this.clock.now().getTime();
    if (
      this.runInsertCount >= SqliteRunsStore.RUNS_CLEANUP_BATCH_THRESHOLD &&
      nowMs - this.lastRunsCleanupAt >= SqliteRunsStore.RUNS_CLEANUP_INTERVAL_MS
    ) {
      this.lastRunsCleanupAt = nowMs;
      this.runInsertCount = 0;
      try {
        this.cleanExpiredRuns(false);
      } catch (cleanupErr) {
        this.logWarn(
          `[actiondock] opportunistic cleanExpiredRuns failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
        );
      }
    }
  }

  updateRun(
    id: string,
    status: TerminalRunStatus,
    isClosed: boolean,
    output?: unknown,
    error?: RuntimeError,
    finishedAt?: string
  ): void {
    if (isClosed) return;
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
      const res = stmt.run(
        status,
        output !== undefined ? JSON.stringify(output) : null,
        error ? JSON.stringify(error) : null,
        finishIso,
        finishIso,
        id
      );
      if (res.changes === 0 && isTerminalRunStatus(status)) {
        this.logWarn(
          `[actiondock] updateRun matched 0 rows: run '${id}' is no longer 'running' in db=${this.dbPath}; terminal status '${status}' was not persisted (record likely settled or recovered by another holder process)`
        );
      }
    } catch (err) {
      if (isClosed) return;
      this.logWarn(`[SqliteRuntimeStorage] Failed to update run "${id}": ${err instanceof Error ? err.message : String(err)}`);
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

  listRuns(options: { actionId?: string; status?: string; limit?: number } = {}): RunRecord[] {
    const limit = options.limit || 50;
    let sql = "SELECT * FROM runs WHERE package_id = ?";
    const params: any[] = [this.packageId];
    if (options.actionId) {
      sql += " AND action_id = ?";
      params.push(options.actionId);
    }
    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }
    sql += " ORDER BY started_at DESC LIMIT ?";
    params.push(limit);
    const stmt = this.getStatement(sql);
    const rows = stmt.all<any>(...params);
    return rows.map((r) => this.mapRunRecord(r));
  }

  clearRuns(options: {
    actionId?: string;
    status?: string;
    olderThanMs?: number;
    keep?: number;
  } = {}): number {
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
    if (typeof options.olderThanMs === "number" && options.olderThanMs > 0) {
      const cutoff = new Date(this.clock.now().getTime() - options.olderThanMs).toISOString();
      sql += " AND started_at < ?";
      params.push(cutoff);
    }
    if (typeof options.keep === "number" && options.keep > 0) {
      let subQuery = "SELECT id FROM runs WHERE package_id = ?";
      const subParams: any[] = [this.packageId];
      if (options.actionId) {
        subQuery += " AND action_id = ?";
        subParams.push(options.actionId);
      }
      if (options.status) {
        subQuery += " AND status = ?";
        subParams.push(options.status);
      }
      subQuery += " ORDER BY started_at DESC LIMIT ?";
      subParams.push(options.keep);

      sql += ` AND id NOT IN (${subQuery})`;
      params.push(...subParams);
    }

    const stmt = this.getStatement(sql);
    const res = stmt.run(...params);

    try {
      this.getStatement("DELETE FROM idempotency_keys WHERE run_id NOT IN (SELECT id FROM runs)").run();
    } catch (err) {
      this.logWarn(
        `[actiondock] orphaned idempotency keys cleanup failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return res.changes;
  }

  cleanExpiredRuns(isClosed: boolean, policy?: RunsRetentionPolicy): number {
    if (isClosed) return 0;
    try {
      const resolved = this.resolveRetentionPolicy(policy);
      const { maxAgeMs, maxRuns, minRetainRuns } = resolved;
      let totalDeleted = 0;

      if (maxAgeMs > 0) {
        const now = this.clock.now().getTime();
        const cutoff = new Date(now - maxAgeMs).toISOString();

        if (minRetainRuns > 0) {
          const stmt = this.getStatement(`
            DELETE FROM runs
            WHERE package_id = ?
              AND status IN ('success', 'failed', 'cancelled', 'timed_out', 'interrupted')
              AND started_at < ?
              AND id NOT IN (
                SELECT id FROM runs
                WHERE package_id = ?
                  AND status IN ('success', 'failed', 'cancelled', 'timed_out', 'interrupted')
                ORDER BY started_at DESC
                LIMIT ?
              )
          `);
          const res = stmt.run(this.packageId, cutoff, this.packageId, minRetainRuns);
          totalDeleted += res.changes;
        } else {
          const stmt = this.getStatement(`
            DELETE FROM runs
            WHERE package_id = ?
              AND status IN ('success', 'failed', 'cancelled', 'timed_out', 'interrupted')
              AND started_at < ?
          `);
          const res = stmt.run(this.packageId, cutoff);
          totalDeleted += res.changes;
        }
      }

      if (maxRuns > 0) {
        const stmt = this.getStatement(`
          DELETE FROM runs
          WHERE package_id = ?
            AND status IN ('success', 'failed', 'cancelled', 'timed_out', 'interrupted')
            AND id NOT IN (
              SELECT id FROM runs
              WHERE package_id = ?
                AND status IN ('success', 'failed', 'cancelled', 'timed_out', 'interrupted')
              ORDER BY started_at DESC
              LIMIT ?
            )
        `);
        const res = stmt.run(this.packageId, this.packageId, maxRuns);
        totalDeleted += res.changes;
      }

      if (totalDeleted > 0) {
        try {
          this.getStatement(
            "DELETE FROM idempotency_keys WHERE run_id NOT IN (SELECT id FROM runs)"
          ).run();
        } catch (err) {
          this.logWarn(
            `[actiondock] orphaned idempotency keys cleanup failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      return totalDeleted;
    } catch (err) {
      this.logWarn(
        `[actiondock] cleanExpiredRuns failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }

  private resolveRetentionPolicy(policy?: RunsRetentionPolicy): Required<RunsRetentionPolicy> {
    let configDays: number | undefined;
    let configMaxRuns: number | undefined;
    let configMinRetain: number | undefined;

    if (this.getConfigFn) {
      try {
        configDays = this.getConfigFn<number>("runs.retentionDays");
        configMaxRuns = this.getConfigFn<number>("runs.maxRuns");
        configMinRetain = this.getConfigFn<number>("runs.minRetainRuns");
      } catch {}
    }

    const envDays = process.env.ACTIONDOCK_RUNS_RETENTION_DAYS
      ? parseInt(process.env.ACTIONDOCK_RUNS_RETENTION_DAYS, 10)
      : undefined;
    const envMaxRuns = process.env.ACTIONDOCK_RUNS_MAX_COUNT
      ? parseInt(process.env.ACTIONDOCK_RUNS_MAX_COUNT, 10)
      : undefined;
    const envMinRetain = process.env.ACTIONDOCK_RUNS_MIN_RETAIN
      ? parseInt(process.env.ACTIONDOCK_RUNS_MIN_RETAIN, 10)
      : undefined;

    const maxAgeMs =
      policy?.maxAgeMs ??
      this.retentionPolicy?.maxAgeMs ??
      (typeof configDays === "number" && configDays > 0 ? configDays * 86_400_000 : undefined) ??
      (typeof envDays === "number" && !isNaN(envDays) && envDays > 0 ? envDays * 86_400_000 : undefined) ??
      DEFAULT_RUNS_RETENTION_MS;

    const maxRuns =
      policy?.maxRuns ??
      this.retentionPolicy?.maxRuns ??
      (typeof configMaxRuns === "number" && configMaxRuns > 0 ? configMaxRuns : undefined) ??
      (typeof envMaxRuns === "number" && !isNaN(envMaxRuns) && envMaxRuns > 0 ? envMaxRuns : undefined) ??
      DEFAULT_MAX_RUNS_PER_PACKAGE;

    const minRetainRuns =
      policy?.minRetainRuns ??
      this.retentionPolicy?.minRetainRuns ??
      (typeof configMinRetain === "number" && configMinRetain >= 0 ? configMinRetain : undefined) ??
      (typeof envMinRetain === "number" && !isNaN(envMinRetain) && envMinRetain >= 0 ? envMinRetain : undefined) ??
      DEFAULT_MIN_RETAIN_RUNS;

    return { maxAgeMs, maxRuns, minRetainRuns };
  }

  checkAndRecordIdempotency(isClosed: boolean, record: IdempotencyRecord): IdempotencyCheckResult {
    if (isClosed) {
      throw new ActionDockError(STORAGE_CLOSED, "SqliteRuntimeStorage is closed");
    }

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
      const runStmt = this.getStatement("SELECT id FROM runs WHERE id = ?");
      const runExists = runStmt.get<{ id: string }>(existing.run_id);
      if (!runExists) {
        this.driver.transaction(() => {
          const delStmt = this.getStatement(`
            DELETE FROM idempotency_keys
            WHERE owner_id = ? AND action_ref = ? AND request_id = ?
          `);
          delStmt.run(record.ownerId, record.actionRef, record.requestId);

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
        });
        return { outcome: "new" };
      }

      if (existing.input_digest !== record.inputDigest) {
        return { outcome: "conflict", existingDigest: existing.input_digest };
      }
      return { outcome: "duplicate", runId: existing.run_id };
    }

    this.driver.transaction(() => {
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
    });

    return { outcome: "new" };
  }

  getIdempotencyRecord(isClosed: boolean, ownerId: string, actionRef: string, requestId: string): IdempotencyRecord | undefined {
    if (isClosed) return undefined;
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
    const input = safeParseStoredJson<JsonValue>(
      row.input_json || undefined,
      `runs.input db=${this.dbPath} package=${this.packageId} run=${row.id}`
    );
    const output = safeParseStoredJson<JsonValue>(
      row.output_json || undefined,
      `runs.output db=${this.dbPath} package=${this.packageId} run=${row.id}`
    );
    const error = safeParseStoredJson<RuntimeError>(
      row.error_json || undefined,
      `runs.error db=${this.dbPath} package=${this.packageId} run=${row.id}`
    );
    const normalizedError: RuntimeError | undefined =
      error !== undefined
        ? typeof error === "object" && error !== null && typeof (error as any).message === "string"
          ? error
          : { code: STORED_ERROR_DECODE_FAILED, message: String(error) }
        : undefined;

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
      error: normalizedError,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
      durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    };
  }

  close(): void {
    this.statementCache.clear();
  }
}
