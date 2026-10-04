import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { UNSUPPORTED_STORAGE_SCHEMA } from "../errors";
import { STORAGE_SCHEMA_VERSION, type SqliteDriver } from "./types";

/**
 * 数据库 Schema 定义、初始化与版本校验。
 */
export function initSchema(
  driver: SqliteDriver,
  dbPath: string,
  recoverOrphans: boolean,
  recoverDeadSessionFn: () => void,
  cleanExpiredRunsFn: () => void
): void {
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

  driver.exec("PRAGMA journal_mode = WAL;");
  driver.exec("PRAGMA synchronous = NORMAL;");
  // 跨进程写并发基线
  driver.exec("PRAGMA busy_timeout = 5000;");

  const versionRes = driver.prepare("PRAGMA user_version;").get<{ user_version: number }>();
  const version = Number(versionRes?.user_version ?? 0);

  if (version === 0) {
    driver.transaction(() => {
      driver.exec(`
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

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          package_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(package_id, event_type);

        PRAGMA user_version = ${STORAGE_SCHEMA_VERSION};
      `);
    });
  } else if (version !== STORAGE_SCHEMA_VERSION) {
    const err: any = new Error(
      `UNSUPPORTED_STORAGE_SCHEMA: Database schema version ${version} is incompatible (expected ${STORAGE_SCHEMA_VERSION}). Silent upgrade and database overwriting are strictly prohibited.`
    );
    err.code = UNSUPPORTED_STORAGE_SCHEMA;
    throw err;
  }

  // 确保存量旧版本数据库补充新增的列或表
  if (version !== 0) {
    try {
      const columns = driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>();
      if (Array.isArray(columns) && !columns.some((c) => c.name === "host_session_id")) {
        driver.exec("ALTER TABLE runs ADD COLUMN host_session_id TEXT;");
      }
    } catch {
      // 忽略非结构化表或兼容驱动异常
    }
    
    // 确保 events 表存在以支持新增的审计事件仓储
    try {
      driver.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          package_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(package_id, event_type);
      `);
    } catch {
      // 忽略
    }
  }

  if (recoverOrphans) {
    recoverDeadSessionFn();
    cleanExpiredRunsFn();
  }
}
