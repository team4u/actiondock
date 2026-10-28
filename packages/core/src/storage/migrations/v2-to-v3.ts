import { ActionDockError, CONFIG_ENCRYPTION_ERROR } from "../../errors";
import { resolveConfigDeclaration } from "../../project/config-declarations";
import type { ConfigItemDefinition } from "../../project/types";
import { isEncryptedConfigValue } from "../../security/config-cipher";
import { isSecretConfigKey } from "../mask";
import { CONFIG_ENCRYPTION_TABLE_DDL } from "../sqlite-schema";
import type { SqliteDriver } from "../types";
import { encryptConfigEnvelope, mergeProtectionDeclarations } from "../config-value";
import { safeParseStoredJson } from "../utils";
import type { SchemaMigrationContext } from "./index";

/**
 * V2 → V3 专用迁移：V2 数据库全部历史知识的唯一归属地。
 *
 * 在调用方维护事务（BEGIN IMMEDIATE）内完成：
 * - 结构补齐：runs 表新增列（origin_json / host_session_id / host_pid /
 *   heartbeat_at）、events 审计事件表、config_encryption 密钥元数据表；
 * - 敏感明文转密文：按声明集合（各字典内具体键优先于模板、跨字典取并集）
 *   判定当前命名空间的配置键，整键加密并保留业务值与 updated_at；
 * - 密钥管理：存在待加密行时才解析并持久化密钥（提供器在迁移事务内先落盘
 *   密钥与身份标记，再由本事务提交密文），同一事务内钉住密钥指纹。
 *
 * 直接操作底层 SQL，不构造也不调用当前版本存储对象：将来修改正常写入
 * 行为不会意外改变历史迁移语义。本文件与注册项在下线 V2 支持时整体删除。
 */
export function migrateV2ToV3(context: SchemaMigrationContext): void {
  upgradeRunsColumns(context.driver);
  ensureEventsTable(context.driver);
  context.driver.exec(CONFIG_ENCRYPTION_TABLE_DDL);
  encryptSensitivePlaintextConfigs(context);
}

/** 补齐 runs 表历史新增列（旧库形态可能全部缺失）。 */
function upgradeRunsColumns(driver: SqliteDriver): void {
  const columns = driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>();
  const present = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["origin_json", "TEXT"],
    ["host_session_id", "TEXT"],
    ["host_pid", "INTEGER"],
    ["heartbeat_at", "TEXT"],
  ];
  for (const [column, type] of additions) {
    if (!present.has(column)) {
      driver.exec(`ALTER TABLE runs ADD COLUMN ${column} ${type};`);
    }
  }
}

/** 补齐 events 审计事件表（V3 必备结构）。 */
function ensureEventsTable(driver: SqliteDriver): void {
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
}

/** 解析目标键在各声明字典下的有效声明并集（各字典内具体键优先于模板）。 */
function resolveDeclarations(
  declarations: readonly Record<string, ConfigItemDefinition>[],
  key: string
): ConfigItemDefinition[] {
  const items: ConfigItemDefinition[] = [];
  for (const dict of declarations) {
    const resolved = resolveConfigDeclaration(dict, key)?.item;
    if (resolved !== undefined) {
      items.push(resolved);
    }
  }
  return items;
}

/**
 * 按声明集合加密当前命名空间的敏感明文配置行。
 *
 * - 只处理非空明文行：普通明文与非敏感键保持原状（普通明文与密文在
 *   当前版本内合法共存）；空串与空值行留待正常写入路径处理；
 * - 先对全部目标行完成严格 JSON 解析，再解析密钥并钉住指纹，避免为
 *   注定失败的迁移提前创建密钥文件；任何一步失败由调用方事务整体回滚；
 * - 迁移只替换 value_json，业务原值与 updated_at 完整保留。
 */
function encryptSensitivePlaintextConfigs(context: SchemaMigrationContext): void {
  const { driver, packageId, declarations, keyProvider, clock, dbPath } = context;
  const rows = driver
    .prepare("SELECT key, value_json FROM config WHERE package_id = ?")
    .all<{ key: string; value_json: string | null }>(packageId);

  const targets: Array<{ key: string; value: unknown; items: ConfigItemDefinition[] }> = [];
  for (const row of rows) {
    const raw = row.value_json;
    if (typeof raw !== "string" || raw === "" || isEncryptedConfigValue(raw)) {
      continue;
    }
    const items = resolveDeclarations(declarations, row.key);
    if (!items.some((item) => isSecretConfigKey(row.key, item))) {
      continue;
    }
    const value = safeParseStoredJson(
      raw,
      `v2-migration config db=${dbPath} package=${packageId} key=${row.key}`,
      { strict: true }
    );
    targets.push({ key: row.key, value, items });
  }
  if (targets.length === 0) {
    return;
  }

  const material = keyProvider(true);
  const pinned = driver
    .prepare("SELECT key_id FROM config_encryption WHERE id = 1")
    .get<{ key_id: string } | undefined>();
  if (pinned === undefined) {
    driver
      .prepare("INSERT INTO config_encryption (id, key_id, created_at) VALUES (1, ?, ?)")
      .run(material.id, clock.now().toISOString());
  } else if (pinned.key_id !== material.id) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config encryption metadata exists with a different key identity in database '${dbPath}'`,
      { dbPath, pinnedKeyId: pinned.key_id }
    );
  }

  const update = driver.prepare(
    "UPDATE config SET value_json = ? WHERE package_id = ? AND key = ?"
  );
  for (const target of targets) {
    const protection = mergeProtectionDeclarations([], target.items, target.key);
    const ciphertext = encryptConfigEnvelope(
      target.value,
      protection,
      packageId,
      target.key,
      material
    );
    update.run(ciphertext, packageId, target.key);
  }
}
