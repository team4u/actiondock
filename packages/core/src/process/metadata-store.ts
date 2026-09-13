import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDefaultSqliteDriver } from "../storage/driver";
import type { SqliteDriver, SqliteStatement } from "../storage/types";

/**
 * 受管进程运行状态。
 */
export type ProcessState =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "lost"
  | "killed"
  | "completed"
  | string;

/**
 * 受管进程控制通道状态。
 */
export type ProcessControlState = "open" | "closing" | "closed" | string;

/**
 * 进程终止原因。
 */
export type ProcessEndReason =
  | "exit"
  | "host-lost"
  | "timeout"
  | "signal"
  | "error"
  | "killed"
  | string;

/**
 * 进程输入输出配置。
 */
export interface ProcessIOConfig {
  [key: string]: unknown;
}

/**
 * 进程能力集定义。
 */
export interface ProcessCapabilities {
  [key: string]: unknown;
}

/**
 * 进程生效资源限制配置。
 */
export interface ProcessEffectiveLimits {
  [key: string]: unknown;
}

/**
 * 受管进程核心模型信息。
 */
export interface ProcessInfo {
  processId: string;
  hostEpoch: string;
  state: ProcessState;
  controlState?: ProcessControlState;
  control?: ProcessControlState;
  ioConfig?: ProcessIOConfig;
  capabilities?: ProcessCapabilities;
  createdAt?: string;
  exitCode?: number | null;
  exitSignal?: string | null;
  endReason?: ProcessEndReason | null;
  outputClosed?: boolean;
  outputEndReason?: string | null;
  /** 输入通道是否已发送 EOF 彻底关闭 */
  inputClosed?: boolean;
  effectiveLimits?: ProcessEffectiveLimits;
}

/**
 * 带有归属所有者与请求凭据的持久化进程记录。
 */
export type StoredProcessRecord = ProcessInfo & {
  tenantId: string;
  principalId: string;
  packageInstanceId: string;
  generationId: string;
  startRequestId?: string;
};

/**
 * 进程所有者过滤条件。
 */
export interface ProcessOwnerFilter {
  tenantId: string;
  principalId: string;
  packageInstanceId: string;
  generationId: string;
}

/**
 * 操作请求去重查询键。
 */
export interface ProcessRequestKey {
  hostEpoch: string;
  scope: string;
  processId?: string;
  requestId: string;
}

/**
 * 操作回执凭证。
 */
export interface OperationReceipt {
  status?: string;
  result?: unknown;
  error?: unknown;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * 操作请求记录项。
 */
export interface RequestRecord {
  receipt: OperationReceipt;
  payloadHash?: string;
  createdAt?: string;
}

/**
 * 受管进程元数据存储契约接口。
 */
export interface ProcessMetadataStore {
  /**
   * 保存或替换受管进程元数据。
   */
  saveProcess(process: StoredProcessRecord): Promise<void>;

  /**
   * 按进程标识获取受管进程元数据详情。
   */
  getProcess(processId: string): Promise<StoredProcessRecord | undefined>;

  /**
   * 分页列出指定所有者归属下的受管进程列表。
   */
  listProcesses(
    owner: ProcessOwnerFilter,
    pageToken?: string,
    limit?: number
  ): Promise<{ processes: ProcessInfo[]; nextPageToken?: string }>;

  /**
   * 局部更新受管进程状态字段。
   */
  updateProcessState(processId: string, patch: Partial<ProcessInfo>): Promise<void>;

  /**
   * 记录幂等请求与操作凭据。
   */
  recordRequest(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void>;

  /**
   * 获取幂等请求已记录的操作凭据。
   */
  getRequest(
    key: ProcessRequestKey
  ): Promise<{ receipt: OperationReceipt; payloadHash?: string } | undefined>;

  /**
   * 宿主生命周期初始化与故障收敛：
   * 将所有不属于当前 hostEpoch 且处于非终态（starting/running/stopping）的旧进程状态更新为 lost。
   */
  initializeHost(hostEpoch: string): Promise<number>;

  /**
   * 释放存储资源（如关闭数据库连接）。
   */
  close?(): Promise<void> | void;
}

/**
 * 解析分页游标偏移量。
 */
function parsePageToken(pageToken?: string): number {
  if (!pageToken) {
    return 0;
  }
  const parsed = parseInt(pageToken, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 0;
}

/**
 * 内存型受管进程元数据存储实现。
 * 适用于确定性测试与无持久化文件系统运行场景。
 */
export class MemoryProcessMetadataStore implements ProcessMetadataStore {
  private processes = new Map<string, StoredProcessRecord>();
  private requests = new Map<string, { receipt: OperationReceipt; payloadHash?: string; createdAt: string }>();

  private formatRequestKey(key: ProcessRequestKey): string {
    return `${key.hostEpoch}:${key.scope}:${key.processId ?? ""}:${key.requestId}`;
  }

  async saveProcess(process: StoredProcessRecord): Promise<void> {
    const createdAt = process.createdAt ?? new Date().toISOString();
    const ctrl = process.controlState ?? process.control;
    const cloned: StoredProcessRecord = {
      ...process,
      createdAt,
      controlState: ctrl,
      control: ctrl,
      outputClosed: Boolean(process.outputClosed),
      inputClosed: Boolean(process.inputClosed),
    };
    this.processes.set(process.processId, cloned);
  }

  async getProcess(processId: string): Promise<StoredProcessRecord | undefined> {
    const record = this.processes.get(processId);
    if (!record) {
      return undefined;
    }
    return { ...record };
  }

  async listProcesses(
    owner: ProcessOwnerFilter,
    pageToken?: string,
    limit?: number
  ): Promise<{ processes: ProcessInfo[]; nextPageToken?: string }> {
    const actualLimit = typeof limit === "number" && limit > 0 ? limit : 50;
    const offset = parsePageToken(pageToken);

    const matched = Array.from(this.processes.values()).filter(
      (p) =>
        p.tenantId === owner.tenantId &&
        p.principalId === owner.principalId &&
        p.packageInstanceId === owner.packageInstanceId &&
        p.generationId === owner.generationId
    );

    matched.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      return a.processId.localeCompare(b.processId);
    });

    const sliced = matched.slice(offset, offset + actualLimit + 1);
    const hasMore = sliced.length > actualLimit;
    const resultRows = hasMore ? sliced.slice(0, actualLimit) : sliced;
    const processes = resultRows.map((p) => ({ ...p }));
    const nextPageToken = hasMore ? String(offset + actualLimit) : undefined;

    return { processes, nextPageToken };
  }

  async updateProcessState(processId: string, patch: Partial<ProcessInfo>): Promise<void> {
    const target = this.processes.get(processId);
    if (!target) {
      throw new Error(`Process '${processId}' not found`);
    }

    const ctrl = patch.controlState !== undefined ? patch.controlState : patch.control;
    const updated: StoredProcessRecord = {
      ...target,
      ...patch,
      controlState: ctrl !== undefined ? ctrl : target.controlState,
      control: ctrl !== undefined ? ctrl : target.control,
    };
    this.processes.set(processId, updated);
  }

  async recordRequest(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void> {
    const k = this.formatRequestKey(key);
    this.requests.set(k, {
      receipt: JSON.parse(JSON.stringify(receipt)),
      payloadHash,
      createdAt: new Date().toISOString(),
    });
  }

  async getRequest(
    key: ProcessRequestKey
  ): Promise<{ receipt: OperationReceipt; payloadHash?: string } | undefined> {
    const k = this.formatRequestKey(key);
    const item = this.requests.get(k);
    if (!item) {
      return undefined;
    }
    return {
      receipt: JSON.parse(JSON.stringify(item.receipt)),
      payloadHash: item.payloadHash,
    };
  }

  async initializeHost(hostEpoch: string): Promise<number> {
    let recoveredCount = 0;
    for (const [id, proc] of Array.from(this.processes.entries())) {
      if (
        proc.hostEpoch !== hostEpoch &&
        (proc.state === "starting" || proc.state === "running" || proc.state === "stopping")
      ) {
        this.processes.set(id, {
          ...proc,
          state: "lost",
          controlState: "closed",
          control: "closed",
          endReason: "host-lost",
          outputClosed: true,
          outputEndReason: "host-lost",
        });
        recoveredCount += 1;
      }
    }
    return recoveredCount;
  }

  clear(): void {
    this.processes.clear();
    this.requests.clear();
  }
}

/**
 * SQLite 存储选项。
 */
export interface SqliteProcessMetadataStoreOptions {
  dbPath?: string;
  driver?: SqliteDriver;
}

/**
 * 将数据库行反序列化为进程模型。
 */
function mapRowToStoredProcess(row: any): StoredProcessRecord {
  return {
    processId: row.process_id,
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    packageInstanceId: row.package_instance_id,
    generationId: row.generation_id,
    hostEpoch: row.host_epoch,
    state: row.state,
    controlState: row.control_state ?? undefined,
    control: row.control_state ?? undefined,
    ioConfig: row.io_config_json ? JSON.parse(row.io_config_json) : undefined,
    capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : undefined,
    createdAt: row.created_at,
    exitCode: row.exit_code !== null && row.exit_code !== undefined ? Number(row.exit_code) : undefined,
    exitSignal: row.exit_signal ?? undefined,
    endReason: row.end_reason ?? undefined,
    outputClosed: Boolean(row.output_closed),
    outputEndReason: row.output_end_reason ?? undefined,
    inputClosed: Boolean(row.input_closed),
    effectiveLimits: row.effective_limits_json ? JSON.parse(row.effective_limits_json) : undefined,
    startRequestId: row.start_request_id ?? undefined,
  };
}

/**
 * 基于 SQLite 的受管进程元数据持久化存储实现。
 */
export class SqliteProcessMetadataStore implements ProcessMetadataStore {
  private driver: SqliteDriver;
  private statementCache = new Map<string, SqliteStatement>();
  private isClosed = false;

  constructor(options: SqliteProcessMetadataStoreOptions = {}) {
    const dbPath = options.dbPath || ":memory:";
    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          chmodSync(dir, 0o700);
        } catch {
          // 忽略系统权限配置失败
        }
      }
    }

    this.driver = options.driver ?? createDefaultSqliteDriver(dbPath);

    if (dbPath !== ":memory:" && existsSync(dbPath)) {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // 忽略文件权限配置异常
      }
    }

    this.initTables();
  }

  private initTables(): void {
    this.driver.exec("PRAGMA journal_mode = WAL;");
    this.driver.exec("PRAGMA synchronous = NORMAL;");

    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS managed_processes (
        process_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        package_instance_id TEXT NOT NULL,
        generation_id TEXT NOT NULL,
        host_epoch TEXT NOT NULL,
        state TEXT NOT NULL,
        control_state TEXT,
        io_config_json TEXT,
        capabilities_json TEXT,
        created_at TEXT NOT NULL,
        exit_code INTEGER,
        exit_signal TEXT,
        end_reason TEXT,
        output_closed INTEGER NOT NULL DEFAULT 0,
        output_end_reason TEXT,
        input_closed INTEGER NOT NULL DEFAULT 0,
        effective_limits_json TEXT,
        start_request_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_processes_owner_created
        ON managed_processes(tenant_id, principal_id, package_instance_id, generation_id, created_at DESC, process_id ASC);

      CREATE INDEX IF NOT EXISTS idx_processes_host_state
        ON managed_processes(host_epoch, state);

      CREATE INDEX IF NOT EXISTS idx_processes_start_req
        ON managed_processes(start_request_id);

      CREATE TABLE IF NOT EXISTS process_requests (
        host_epoch TEXT NOT NULL,
        scope TEXT NOT NULL,
        process_id TEXT NOT NULL DEFAULT '',
        request_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        payload_hash TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (host_epoch, scope, process_id, request_id)
      );
    `);

    this.migrateSchema();
  }

  /**
   * 旧库结构迁移：逐列探测并补充新增字段，重复执行安全（幂等）。
   */
  private migrateSchema(): void {
    const columns = new Set<string>();
    for (const row of this.listTableColumns("managed_processes")) {
      columns.add(String(row.name));
    }

    if (!columns.has("input_closed")) {
      this.driver.exec("ALTER TABLE managed_processes ADD COLUMN input_closed INTEGER NOT NULL DEFAULT 0;");
    }
  }

  /**
   * 枚举指定表的全部列定义。
   */
  private listTableColumns(tableName: string): any[] {
    try {
      const stmt = this.driver.prepare(`PRAGMA table_info(${tableName})`);
      return stmt.all<any>() ?? [];
    } catch {
      return [];
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

  async saveProcess(process: StoredProcessRecord): Promise<void> {
    if (this.isClosed) {
      throw new Error("SqliteProcessMetadataStore is closed");
    }

    const stmt = this.getStatement(`
      INSERT INTO managed_processes (
        process_id, tenant_id, principal_id, package_instance_id, generation_id,
        host_epoch, state, control_state, io_config_json, capabilities_json,
        created_at, exit_code, exit_signal, end_reason, output_closed,
        output_end_reason, input_closed, effective_limits_json, start_request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(process_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        principal_id = excluded.principal_id,
        package_instance_id = excluded.package_instance_id,
        generation_id = excluded.generation_id,
        host_epoch = excluded.host_epoch,
        state = excluded.state,
        control_state = excluded.control_state,
        io_config_json = excluded.io_config_json,
        capabilities_json = excluded.capabilities_json,
        created_at = excluded.created_at,
        exit_code = excluded.exit_code,
        exit_signal = excluded.exit_signal,
        end_reason = excluded.end_reason,
        output_closed = excluded.output_closed,
        output_end_reason = excluded.output_end_reason,
        input_closed = excluded.input_closed,
        effective_limits_json = excluded.effective_limits_json,
        start_request_id = excluded.start_request_id
    `);

    const createdAt = process.createdAt ?? new Date().toISOString();
    const ctrlState = process.controlState ?? process.control ?? null;
    const ioConfigJson = process.ioConfig !== undefined ? JSON.stringify(process.ioConfig) : null;
    const capabilitiesJson = process.capabilities !== undefined ? JSON.stringify(process.capabilities) : null;
    const effectiveLimitsJson = process.effectiveLimits !== undefined ? JSON.stringify(process.effectiveLimits) : null;
    const outputClosed = process.outputClosed ? 1 : 0;
    const inputClosed = process.inputClosed ? 1 : 0;

    stmt.run(
      process.processId,
      process.tenantId,
      process.principalId,
      process.packageInstanceId,
      process.generationId,
      process.hostEpoch,
      process.state,
      ctrlState,
      ioConfigJson,
      capabilitiesJson,
      createdAt,
      process.exitCode !== undefined && process.exitCode !== null ? process.exitCode : null,
      process.exitSignal !== undefined ? process.exitSignal : null,
      process.endReason !== undefined ? process.endReason : null,
      outputClosed,
      process.outputEndReason !== undefined ? process.outputEndReason : null,
      inputClosed,
      effectiveLimitsJson,
      process.startRequestId !== undefined ? process.startRequestId : null
    );
  }

  async getProcess(processId: string): Promise<StoredProcessRecord | undefined> {
    if (this.isClosed) {
      throw new Error("SqliteProcessMetadataStore is closed");
    }

    const stmt = this.getStatement("SELECT * FROM managed_processes WHERE process_id = ?");
    const row = stmt.get<any>(processId);
    if (!row) {
      return undefined;
    }
    return mapRowToStoredProcess(row);
  }

  async listProcesses(
    owner: ProcessOwnerFilter,
    pageToken?: string,
    limit?: number
  ): Promise<{ processes: ProcessInfo[]; nextPageToken?: string }> {
    if (this.isClosed) {
      throw new Error("SqliteProcessMetadataStore is closed");
    }

    const actualLimit = typeof limit === "number" && limit > 0 ? limit : 50;
    const offset = parsePageToken(pageToken);

    const stmt = this.getStatement(`
      SELECT * FROM managed_processes
      WHERE tenant_id = ? AND principal_id = ? AND package_instance_id = ? AND generation_id = ?
      ORDER BY created_at DESC, process_id ASC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all<any>(
      owner.tenantId,
      owner.principalId,
      owner.packageInstanceId,
      owner.generationId,
      actualLimit + 1,
      offset
    );

    const hasMore = rows.length > actualLimit;
    const resultRows = hasMore ? rows.slice(0, actualLimit) : rows;
    const processes = resultRows.map(mapRowToStoredProcess);
    const nextPageToken = hasMore ? String(offset + actualLimit) : undefined;

    return { processes, nextPageToken };
  }

  async updateProcessState(processId: string, patch: Partial<ProcessInfo>): Promise<void> {
    if (this.isClosed) {
      throw new Error("SqliteProcessMetadataStore is closed");
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (patch.state !== undefined) {
      sets.push("state = ?");
      params.push(patch.state);
    }
    const ctrl = patch.controlState !== undefined ? patch.controlState : patch.control;
    if (ctrl !== undefined) {
      sets.push("control_state = ?");
      params.push(ctrl);
    }
    if (patch.exitCode !== undefined) {
      sets.push("exit_code = ?");
      params.push(patch.exitCode !== null ? patch.exitCode : null);
    }
    if (patch.exitSignal !== undefined) {
      sets.push("exit_signal = ?");
      params.push(patch.exitSignal);
    }
    if (patch.endReason !== undefined) {
      sets.push("end_reason = ?");
      params.push(patch.endReason);
    }
    if (patch.outputClosed !== undefined) {
      sets.push("output_closed = ?");
      params.push(patch.outputClosed ? 1 : 0);
    }
    if (patch.outputEndReason !== undefined) {
      sets.push("output_end_reason = ?");
      params.push(patch.outputEndReason);
    }
    if (patch.inputClosed !== undefined) {
      sets.push("input_closed = ?");
      params.push(patch.inputClosed ? 1 : 0);
    }
    if (patch.effectiveLimits !== undefined) {
      sets.push("effective_limits_json = ?");
      params.push(patch.effectiveLimits !== null ? JSON.stringify(patch.effectiveLimits) : null);
    }
    if (patch.ioConfig !== undefined) {
      sets.push("io_config_json = ?");
      params.push(patch.ioConfig !== null ? JSON.stringify(patch.ioConfig) : null);
    }
    if (patch.capabilities !== undefined) {
      sets.push("capabilities_json = ?");
      params.push(patch.capabilities !== null ? JSON.stringify(patch.capabilities) : null);
    }
    if (patch.hostEpoch !== undefined) {
      sets.push("host_epoch = ?");
      params.push(patch.hostEpoch);
    }

    if (sets.length === 0) {
      return;
    }

    params.push(processId);
    const sql = `UPDATE managed_processes SET ${sets.join(", ")} WHERE process_id = ?`;
    const stmt = this.getStatement(sql);
    const res = stmt.run(...params);
    if (res.changes === 0) {
      throw new Error(`Process '${processId}' not found`);
    }
  }

  async recordRequest(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void> {
    if (this.isClosed) {
      throw new Error("SqliteProcessMetadataStore is closed");
    }

    const stmt = this.getStatement(`
      INSERT INTO process_requests (
        host_epoch, scope, process_id, request_id, receipt_json, payload_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_epoch, scope, process_id, request_id) DO UPDATE SET
        receipt_json = excluded.receipt_json,
        payload_hash = excluded.payload_hash,
        created_at = excluded.created_at
    `);

    const processId = key.processId ?? "";
    const receiptJson = JSON.stringify(receipt);
    const createdAt = new Date().toISOString();

    stmt.run(
      key.hostEpoch,
      key.scope,
      processId,
      key.requestId,
      receiptJson,
      payloadHash ?? null,
      createdAt
    );
  }

  async getRequest(
    key: ProcessRequestKey
  ): Promise<{ receipt: OperationReceipt; payloadHash?: string } | undefined> {
    if (this.isClosed) {
      throw new Error("SqliteProcessMetadataStore is closed");
    }

    const stmt = this.getStatement(`
      SELECT receipt_json, payload_hash FROM process_requests
      WHERE host_epoch = ? AND scope = ? AND process_id = ? AND request_id = ?
    `);

    const processId = key.processId ?? "";
    const row = stmt.get<{ receipt_json: string; payload_hash?: string | null }>(
      key.hostEpoch,
      key.scope,
      processId,
      key.requestId
    );

    if (!row) {
      return undefined;
    }

    return {
      receipt: JSON.parse(row.receipt_json) as OperationReceipt,
      payloadHash: row.payload_hash ?? undefined,
    };
  }

  async initializeHost(hostEpoch: string): Promise<number> {
    if (this.isClosed) {
      return 0;
    }

    const stmt = this.getStatement(`
      UPDATE managed_processes
      SET state = 'lost',
          control_state = 'closed',
          end_reason = 'host-lost',
          output_closed = 1,
          output_end_reason = 'host-lost'
      WHERE host_epoch != ?
        AND state IN ('starting', 'running', 'stopping')
    `);

    const res = stmt.run(hostEpoch);
    return res.changes;
  }

  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.statementCache.clear();
    this.driver.close();
  }
}
