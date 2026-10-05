import type { JsonValue, Logger, RuntimeError, RunRecord } from "@actiondock/sdk";
import type { SqliteDriver, SqliteStatement, TerminalRunStatus, RunsRetentionPolicy, IdempotencyRecord, IdempotencyCheckResult } from "./types";
import { isTerminalRunStatus, DEFAULT_MAX_RUNS_PER_PACKAGE, DEFAULT_MIN_RETAIN_RUNS, DEFAULT_RUNS_RETENTION_MS } from "./types";
import type { Clock } from "./clock";
import { safeParseStoredJson } from "./utils";
import { isRunHostDead, type ProcessLivenessProbe } from "./run-liveness";
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

  /**
   * 收敛死亡宿主遗留的非终态运行记录（保守收割）。
   *
   * 判定依据是宿主存活而不是会话归属：会话归属只区分「不是当前会话」，
   * 无法区分「持有进程已死」与「另一活跃进程仍在执行」。
   * 先选取非当前会话的非终态候选，再逐条做存活校验，仅收割确认死亡的记录：
   * - 携带宿主进程标识的记录：进程探测失败（明确不存在）才收割；
   * - 遗留记录（无进程标识）：心跳（缺省回退开始时间）超过宽限期才收割。
   *
   * 无法确认死亡时一律保留，宁司不动也不误杀活跃任务。
   */
  recoverDeadSessionRuns(
    isClosed: boolean,
    currentHostSessionId?: string,
    options?: { probe?: ProcessLivenessProbe }
  ): number {
    if (isClosed) return 0;
    try {
      const candidates = this.selectOrphanCandidates(currentHostSessionId);
      if (candidates.length === 0) return 0;

      const deadIds: string[] = [];
      for (const candidate of candidates) {
        if (isRunHostDead(candidate, { clock: this.clock, ...options })) {
          deadIds.push(candidate.id);
        }
      }
      if (deadIds.length === 0) return 0;

      return this.interruptRunsByIds(deadIds);
    } catch (err) {
      this.logWarn(
        `[actiondock] recoverDeadSessionRuns failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }

  /** 选取非当前会话的非终态候选记录（仅判定所需列） */
  private selectOrphanCandidates(currentHostSessionId?: string): Array<{
    id: string;
    hostPid: number | null;
    heartbeatAt: string | null;
    startedAt: string | null;
  }> {
    let sql = `
      SELECT id, host_pid, heartbeat_at, started_at
      FROM runs
      WHERE status IN ('running', 'pending')
    `;
    const params: any[] = [];
    if (currentHostSessionId) {
      sql += " AND (host_session_id IS NULL OR host_session_id != ?)";
      params.push(currentHostSessionId);
    }
    const stmt = this.getStatement(sql);
    return stmt.all<any>(...params).map((row) => ({
      id: row.id as string,
      hostPid: typeof row.host_pid === "number" ? row.host_pid : null,
      heartbeatAt: typeof row.heartbeat_at === "string" ? row.heartbeat_at : null,
      startedAt: typeof row.started_at === "string" ? row.started_at : null,
    }));
  }

  /** 将确认死亡的记录收敛为 interrupted（单条 SQL 批量执行，不误伤其他在途记录） */
  private interruptRunsByIds(ids: string[]): number {
    if (ids.length === 0) return 0;
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return 0;
    const updateStmt = this.getStatement(`
      UPDATE runs
      SET status = 'interrupted',
          finished_at = ?,
          error_json = '{"code":"RUN_INTERRUPTED","message":"Execution interrupted by system shutdown or restart"}'
      WHERE id IN (${SqliteRunsStore.placeholders(uniqueIds.length)})
        AND status IN ('running', 'pending')
    `);
    const res = updateStmt.run(this.clock.now().toISOString(), ...uniqueIds);
    return res.changes;
  }

  /**
   * 刷新在途运行记录的心跳时间戳。
   *
   * 执行宿主周期性调用，使无进程标识判定路径（遗留记录兜底）以及其他
   * 协作方能够区分「在途执行中」与「宿主崩溃后的遗留」。
   * 仅更新非终态记录，终态记录心跳无意义不更新。
   */
  touchRunHeartbeat(isClosed: boolean, runIds: string[]): number {
    if (isClosed || runIds.length === 0) return 0;
    try {
      const uniqueIds = Array.from(new Set(runIds));
      const now = this.clock.now().toISOString();
      const stmt = this.getStatement(`
        UPDATE runs
        SET heartbeat_at = ?
        WHERE id IN (${SqliteRunsStore.placeholders(uniqueIds.length)})
          AND status IN ('running', 'pending')
      `);
      const res = stmt.run(now, ...uniqueIds);
      return res.changes;
    } catch (err) {
      this.logWarn(
        `[actiondock] touchRunHeartbeat failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }

  createRun(record: RunRecord | any): void {
    const stmt = this.getStatement(`
      INSERT INTO runs (
        id, root_run_id, parent_run_id, package_id, package_instance_id,
        action_id, generation_id, owner_id, host_session_id, host_pid, heartbeat_at,
        status, input_json, output_json,
        error_json, started_at, finished_at, duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const rootRunId = record.rootRunId || record.id;
    const parentRunId = record.parentRunId || null;
    const packageInstanceId = record.packageInstanceId || record.packageId || this.packageId;
    const generationId = record.generationId || "1";
    const ownerId = record.ownerId || "local";
    const hostSessionId = record.hostSessionId || null;
    // 宿主进程标识与初始心跳：落库即登记存活判定依据（遗留调用方缺省时不写入）
    const hostPid = typeof record.hostPid === "number" ? record.hostPid : null;
    const startedIso = record.startedAt || this.clock.now().toISOString();
    const heartbeatAt =
      record.status === "running" || record.status === "pending" ? startedIso : null;
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
      hostPid,
      heartbeatAt,
      record.status,
      inputJson,
      outputJson,
      errorJson,
      startedIso,
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

  /**
   * 查询单条运行记录并补齐幂等请求标识关联（详情路径专用）。
   */
  getRunWithRequestId(id: string, isClosed: boolean): RunRecord | null {
    const record = this.getRun(id);
    if (!record || isClosed) return record;
    const mapping = this.getRunRequestIds(isClosed, [id]);
    const requestId = mapping[id];
    if (requestId) record.requestId = requestId;
    return record;
  }

  listRuns(options: { actionId?: string; status?: string; limit?: number; offset?: number } = {}): RunRecord[] {
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
    if (typeof options.offset === "number" && options.offset > 0) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }
    const stmt = this.getStatement(sql);
    const rows = stmt.all<any>(...params);
    return rows.map((r) => this.mapRunRecord(r));
  }

  /**
   * 统计符合过滤条件的真实运行记录总数。
   * 支持按 actionId、status 以及包含 requestIds 的反查场景统计总数。
   */
  countRuns(
    options: { actionId?: string; status?: string; requestIds?: string[] } = {},
    isClosed = false
  ): number {
    if (isClosed) return 0;
    if (options.requestIds && options.requestIds.length > 0) {
      const uniqueIds = Array.from(
        new Set(options.requestIds.filter((id) => typeof id === "string" && id.length > 0))
      );
      if (uniqueIds.length === 0) return 0;
      let sql = `
        SELECT COUNT(DISTINCT runs.id) as count
        FROM runs
        INNER JOIN idempotency_keys AS ik ON ik.run_id = runs.id
        WHERE runs.package_id = ?
          AND ik.request_id IN (${SqliteRunsStore.placeholders(uniqueIds.length)})
      `;
      const params: any[] = [this.packageId, ...uniqueIds];
      if (options.actionId) {
        sql += " AND runs.action_id = ?";
        params.push(options.actionId);
      }
      if (options.status) {
        sql += " AND runs.status = ?";
        params.push(options.status);
      }
      const stmt = this.getStatement(sql);
      const row = stmt.get<{ count: number }>(...params);
      return row?.count ?? 0;
    }

    let sql = "SELECT COUNT(*) as count FROM runs WHERE package_id = ?";
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
    const row = stmt.get<{ count: number }>(...params);
    return row?.count ?? 0;
  }

  /**
   * 按客户端幂等请求标识反查关联运行记录总数。
   */
  countRunsByRequestIds(
    isClosed: boolean,
    requestIds: string[],
    options: { actionId?: string; status?: string } = {}
  ): number {
    return this.countRuns({ ...options, requestIds }, isClosed);
  }

  /**
   * 构造 IN (…) 占位符列表。
   */
  private static placeholders(count: number): string {
    return Array.from({ length: count }, () => "?").join(", ");
  }

  /**
   * 批量反查当前包范围内、由指定幂等请求标识登记的运行记录。
   *
   * 关联链为 idempotency_keys.run_id -> runs.id，且强制 runs.package_id 等于
   * 当前包，保证多包共库（全局库）时不越界读取其他包的运行记录。
   * 不按 owner_id 过滤：写入方与查询方分属不同宿主进程，ownerId 必然不同。
   */
  listRunsByRequestIds(isClosed: boolean, requestIds: string[]): RunRecord[] {
    if (isClosed || requestIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(requestIds.filter((id) => typeof id === "string" && id.length > 0)));
    if (uniqueIds.length === 0) return [];

    const sql = `
      SELECT runs.*, ik.request_id AS request_id
      FROM runs
      INNER JOIN idempotency_keys AS ik ON ik.run_id = runs.id
      WHERE runs.package_id = ?
        AND ik.request_id IN (${SqliteRunsStore.placeholders(uniqueIds.length)})
      ORDER BY runs.started_at DESC
    `;
    const stmt = this.getStatement(sql);
    const rows = stmt.all<any>(this.packageId, ...uniqueIds);
    const records = rows.map((r) => this.mapRunRecord(r));
    // requestId 来自联查列，直接补齐（mapRunRecord 无法从 runs 行还原）
    const requestIdByRunId = new Map<string, string>();
    for (const row of rows) {
      if (row && typeof row.id === "string" && typeof row.request_id === "string") {
        requestIdByRunId.set(row.id, row.request_id);
      }
    }
    for (const record of records) {
      const requestId = requestIdByRunId.get(record.id);
      if (requestId) record.requestId = requestId;
    }
    return records;
  }

  /**
   * 反查当前包范围内运行记录关联的幂等请求标识。
   *
   * 仅返回存在关联的键值对；未登记幂等键的运行记录不产生对应键。
   */
  getRunRequestIds(isClosed: boolean, runIds: string[]): Record<string, string> {
    if (isClosed || runIds.length === 0) return {};
    const uniqueIds = Array.from(new Set(runIds.filter((id) => typeof id === "string" && id.length > 0)));
    if (uniqueIds.length === 0) return {};

    const sql = `
      SELECT ik.run_id, ik.request_id
      FROM idempotency_keys AS ik
      INNER JOIN runs ON runs.id = ik.run_id
      WHERE runs.package_id = ?
        AND ik.run_id IN (${SqliteRunsStore.placeholders(uniqueIds.length)})
    `;
    const stmt = this.getStatement(sql);
    const rows = stmt.all<any>(this.packageId, ...uniqueIds);
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row && typeof row.run_id === "string" && typeof row.request_id === "string") {
        result[row.run_id] = row.request_id;
      }
    }
    return result;
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
      hostPid: typeof row.host_pid === "number" ? row.host_pid : undefined,
      heartbeatAt: row.heartbeat_at || undefined,
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
