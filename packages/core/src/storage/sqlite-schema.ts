import { UNSUPPORTED_STORAGE_SCHEMA } from "../errors";
import { STORAGE_SCHEMA_VERSION, type SqliteDriver } from "./types";

/**
 * config_encryption 密钥元数据表 DDL 单一事实源。
 *
 * 单行约束（id = 1）钉住数据库的加密密钥指纹。当前版本（3）数据库
 * 总是携带该表：新库建库时创建，V2 迁移时补齐；无敏感写入时表保持
 * 空置（不加载或创建任何密钥），首次敏感写入时在同一事务内钉住指纹。
 */
export const CONFIG_ENCRYPTION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS config_encryption (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    key_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

/** 当前版本数据库必须存在的核心表集合（缺任一即视为损坏状态）。 */
const REQUIRED_TABLES: readonly string[] = [
  "config",
  "state",
  "runs",
  "idempotency_keys",
  "events",
  "config_encryption",
];

/**
 * 当前版本（3）完整结构 DDL。
 *
 * 仅描述当前版本形态：新库一次性创建全部表与索引并落 user_version。
 * 历史版本的结构差异（如旧 runs 列形态、缺失 events 表）一律由
 * migrations/v2-to-v3 负责，本模块不保留任何旧版本补齐分支。
 */
const CURRENT_SCHEMA_DDL = `
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
    origin_json TEXT,
    package_id TEXT NOT NULL,
    package_instance_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    host_session_id TEXT,
    host_pid INTEGER,
    heartbeat_at TEXT,
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

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(package_id, event_type);

  ${CONFIG_ENCRYPTION_TABLE_DDL}

  PRAGMA user_version = ${STORAGE_SCHEMA_VERSION};
`;

/**
 * 在调用方写事务内创建当前版本完整结构并钉版本号。
 *
 * 事务所有权归版本调度器（migrations/index.ts）：锁内重读版本后调用，
 * 本函数不自建嵌套事务。
 */
export function createCurrentSchema(driver: SqliteDriver): void {
  driver.exec(CURRENT_SCHEMA_DDL);
}

/** 当前版本 runs 表必须存在的迁移新增列（缺失即半升级或损坏状态）。 */
const REQUIRED_RUNS_COLUMNS: readonly string[] = [
  "origin_json",
  "host_session_id",
  "host_pid",
  "heartbeat_at",
];

/**
 * 校验当前版本数据库结构完整性：核心表与 runs 关键列必须齐备。
 *
 * 声明为当前版本的库缺失关键表或关键列属于损坏（或半升级）状态，
 * 必须明确拒绝，严禁在打开路径上静默 ALTER / CREATE 修补。
 */
export function validateCurrentSchema(driver: SqliteDriver, dbPath: string): void {
  const rows = driver
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>();
  const present = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    const err: any = new Error(
      `UNSUPPORTED_STORAGE_SCHEMA: Database '${dbPath}' declares schema version ${STORAGE_SCHEMA_VERSION} but is missing required tables: ${missing.join(", ")}. The database is in a corrupted or half-upgraded state and silent repair is prohibited.`
    );
    err.code = UNSUPPORTED_STORAGE_SCHEMA;
    throw err;
  }
  const runColumns = new Set(
    driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>().map((column) => column.name)
  );
  const missingColumns = REQUIRED_RUNS_COLUMNS.filter((column) => !runColumns.has(column));
  if (missingColumns.length > 0) {
    const err: any = new Error(
      `UNSUPPORTED_STORAGE_SCHEMA: Database '${dbPath}' declares schema version ${STORAGE_SCHEMA_VERSION} but table 'runs' is missing required columns: ${missingColumns.join(", ")}. The database is in a corrupted or half-upgraded state and silent repair is prohibited.`
    );
    err.code = UNSUPPORTED_STORAGE_SCHEMA;
    throw err;
  }
}
