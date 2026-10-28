import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { NodeSqliteDriver } from "../../src/storage/sqlite-driver";

/**
 * 真实 V2 数据库测试夹具：以原生 SQL 构造旧版程序产出的磁盘库。
 *
 * 结构事实源为旧版（schema 版本 2）初始化代码：
 * - 新建库直接落 user_version = 2；
 * - 历史演进前的旧库形态可选缺少 runs 的 origin_json / host_session_id /
 *   host_pid / heartbeat_at 列与 events 表（旧版打开时以 ALTER / CREATE 补齐）。
 *
 * 严禁用「新建当前版本库再改版本号」伪装 V2：列形态与表集合本身就是
 * 迁移必须处理的历史事实。
 */
export interface V2FixtureOptions {
  /** 数据库文件绝对路径 */
  dbPath: string;
  /** 采用历史更早的 runs 表形态（缺新增列与 events 表），验证迁移补齐能力 */
  legacyRunsShape?: boolean;
}

/** 写入一条 V2 形态的明文配置行（与旧版程序一致的 JSON 序列化）。 */
export function insertV2ConfigRow(
  dbPath: string,
  packageId: string,
  key: string,
  value: unknown,
  updatedAt = "2024-01-01T00:00:00.000Z"
): void {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    driver
      .prepare("INSERT INTO config (package_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)")
      .run(packageId, key, JSON.stringify(value), updatedAt);
  } finally {
    driver.close();
  }
}

/** 构造真实 V2 数据库（含全部历史表结构）。 */
export function createV2Database(options: V2FixtureOptions): void {
  const { dbPath, legacyRunsShape = false } = options;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const runsDdl = `
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      root_run_id TEXT NOT NULL,
      parent_run_id TEXT,${legacyRunsShape ? "" : "\n      origin_json TEXT,"}
      package_id TEXT NOT NULL,
      package_instance_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,${legacyRunsShape ? "" : "\n      host_session_id TEXT,\n      host_pid INTEGER,\n      heartbeat_at TEXT,"}
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error_json TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER
    );`;

  const eventsDdl = legacyRunsShape
    ? ""
    : `
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_type ON events(package_id, event_type);`;

  const driver = new NodeSqliteDriver(dbPath);
  try {
    driver.exec("PRAGMA journal_mode = WAL;");
    driver.exec(`
      CREATE TABLE config (
        package_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (package_id, key)
      );

      CREATE TABLE state (
        package_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (package_id, namespace, key)
      );
      CREATE INDEX idx_state_expires ON state(expires_at);
      ${runsDdl}
      CREATE INDEX idx_runs_action ON runs(package_id, action_id);
      CREATE INDEX idx_runs_root ON runs(root_run_id);
      CREATE INDEX idx_runs_started ON runs(started_at DESC);

      CREATE TABLE idempotency_keys (
        owner_id TEXT NOT NULL,
        action_ref TEXT NOT NULL,
        request_id TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, action_ref, request_id)
      );
      CREATE INDEX idx_idemp_run ON idempotency_keys(run_id);
      ${eventsDdl}

      PRAGMA user_version = 2;
    `);
  } finally {
    driver.close();
  }
}

/** 写入一条 V2 形态的状态行。 */
export function insertV2StateRow(
  dbPath: string,
  packageId: string,
  namespace: string,
  key: string,
  value: unknown
): void {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    driver
      .prepare(
        "INSERT INTO state (package_id, namespace, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(packageId, namespace, key, JSON.stringify(value), "2024-01-01T00:00:02.000Z");
  } finally {
    driver.close();
  }
}

/** 写入一条 V2 形态的幂等去重记录行。 */
export function insertV2IdempotencyRow(
  dbPath: string,
  record: { ownerId: string; actionRef: string; requestId: string; runId: string }
): void {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    driver
      .prepare(
        `INSERT INTO idempotency_keys (owner_id, action_ref, request_id, input_digest, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.ownerId,
        record.actionRef,
        record.requestId,
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        record.runId,
        "2024-01-01T00:00:03.000Z"
      );
  } finally {
    driver.close();
  }
}

/** 写入一条 V2 形态的运行记录行（两种 runs 形态共用列集合）。 */
export function insertV2RunRow(
  dbPath: string,
  run: {
    id: string;
    packageId: string;
    actionId: string;
    status?: string;
    startedAt?: string;
  }
): void {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    driver
      .prepare(
        `INSERT INTO runs (id, root_run_id, package_id, package_instance_id, action_id,
           generation_id, owner_id, status, input_json, output_json, started_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.id,
        run.packageId,
        `${run.packageId}#default`,
        run.actionId,
        "gen-1",
        "owner-1",
        run.status ?? "success",
        JSON.stringify({}),
        JSON.stringify({ ok: true }),
        run.startedAt ?? "2024-01-01T00:00:01.000Z",
        12
      );
  } finally {
    driver.close();
  }
}
