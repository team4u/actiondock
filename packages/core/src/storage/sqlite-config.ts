import { ActionDockError, CONFIG_DECRYPT_FAILED, CONFIG_ENCRYPTION_ERROR } from "../errors";
import type { ConfigItemDefinition } from "../project/types";
import type { ConfigEncryptionKey, ConfigKeyProvider } from "../security/config-cipher";
import { isEncryptedConfigValue } from "../security/config-cipher";
import type { Clock } from "./clock";
import { decryptConfigEnvelope, encryptConfigEnvelope, mergeProtectionDeclarations } from "./config-value";
import { isSecretConfigKey } from "./mask";
import {
  type ConfigSnapshot,
  type SqliteDriver,
  type SqliteStatement,
} from "./types";
import { safeParseStoredJson } from "./utils";

/**
 * 当前版本（3）配置子存储。
 *
 * 前置约定：数据库在存储构造前已由 migrations/ 版本调度确保为当前版本
 * （含 config_encryption 元数据表）。本类不读取或写入 user_version、
 * 不做 CREATE TABLE、不持有任何历史版本兼容逻辑。
 *
 * 行格式：普通值为 JSON 明文，敏感值为 adenc: 密文信封（业务值与历史
 * 保护声明一同加密）。密文行一经写入永不降级明文；敏感判定命中时存量
 * 明文由正常写入直接升级为密文。
 */
export class SqliteConfigStore {
  private statementCache = new Map<string, SqliteStatement>();
  private driver: SqliteDriver;
  private packageId: string;
  private dbPath: string;
  private clock: Clock;
  private keyProvider: ConfigKeyProvider;

  constructor(
    driver: SqliteDriver,
    packageId: string,
    dbPath: string,
    clock: Clock,
    keyProvider: ConfigKeyProvider
  ) {
    this.driver = driver;
    this.packageId = packageId;
    this.dbPath = dbPath;
    this.clock = clock;
    this.keyProvider = keyProvider;
  }

  private getStatement(sql: string): SqliteStatement {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.driver.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  // --- 加密基础设施 ---

  /** 读取数据库钉住的加密密钥指纹；无行视为元数据缺失。 */
  private readPinnedKeyId(): string | undefined {
    try {
      const row = this.getStatement(
        "SELECT key_id FROM config_encryption WHERE id = 1"
      ).get<{ key_id: string }>();
      return row?.key_id;
    } catch (err) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Config encryption metadata is unreadable for database '${this.dbPath}'`,
        { dbPath: this.dbPath, reason: err instanceof Error ? err.message : String(err) }
      );
    }
  }

  /**
   * 读取路径解析密钥：绝不创建密钥，并校验与数据库钉住的指纹一致。
   *
   * 密钥缺失、身份不符均抛 CONFIG_ENCRYPTION_ERROR，严禁回退为明文处理。
   */
  private resolveKeyForRead(): ConfigEncryptionKey {
    const pinned = this.readPinnedKeyId();
    if (pinned === undefined) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Encrypted config value found in database '${this.dbPath}' but config_encryption metadata is missing`,
        { dbPath: this.dbPath }
      );
    }
    const material = this.keyProvider(false);
    if (material.id !== pinned) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Config encryption key does not match the key pinned by database '${this.dbPath}'`,
        { dbPath: this.dbPath, pinnedKeyId: pinned }
      );
    }
    return material;
  }

  /** 库内是否已存在任何密文行（区分「从未加密」与「元数据被删的损坏态」）。 */
  private hasAnyEncryptedRow(): boolean {
    const row = this.getStatement(
      "SELECT key FROM config WHERE value_json LIKE 'adenc:%' LIMIT 1"
    ).get<{ key: string }>();
    return row !== undefined;
  }

  /**
   * 敏感写入路径解析密钥（必须在调用方事务内执行）。
   *
   * - 已钉住指纹：provider(false) 读取并校验身份一致，确认匹配后再
   *   provider(true) 确保存储域身份标记已持久化；跨目录导入（恢复/移动
   *   dataDir 后经 env 密钥继续写入）也会因此留下域身份标记。严禁在校验
   *   前先 provider(true) 生成新密钥；
   * - 未钉住指纹：库内存在密文行属损坏状态（元数据被删），拒绝生成替代
   *   密钥重新钉住；确无密文行则为首次加密，provider(true) 允许创建本地
   *   密钥并在同一事务内钉住指纹。
   */
  private prepareEncryptionMaterial(): ConfigEncryptionKey {
    const pinned = this.readPinnedKeyId();
    if (pinned === undefined) {
      if (this.hasAnyEncryptedRow()) {
        throw new ActionDockError(
          CONFIG_ENCRYPTION_ERROR,
          `Encrypted config values exist in database '${this.dbPath}' but config_encryption metadata is missing; refusing to pin a replacement key`,
          { dbPath: this.dbPath }
        );
      }
      const material = this.keyProvider(true);
      this.getStatement(
        "INSERT INTO config_encryption (id, key_id, created_at) VALUES (1, ?, ?)"
      ).run(material.id, this.clock.now().toISOString());
      return material;
    }
    const material = this.resolveKeyForRead();
    const pinnedAgain = this.keyProvider(true);
    if (pinnedAgain.id !== material.id) {
      // 防御：提供器在 create 调用中解析出与已校验身份不同的密钥
      // （如 env 与本地文件不一致），拒绝继续避免写出混合密钥状态
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Config encryption key provider resolved inconsistent key identities for database '${this.dbPath}'`,
        { dbPath: this.dbPath, pinnedKeyId: material.id }
      );
    }
    return material;
  }

  private decryptEnvelope(raw: string, key: string): { value: unknown; protection: ConfigItemDefinition[] } {
    try {
      return decryptConfigEnvelope(raw, this.packageId, key, this.resolveKeyForRead());
    } catch (err) {
      // 解密异常（认证失败、格式非法、密钥不符）保持原错误码透传，
      // 仅补充数据库上下文，绝不降级为返回原文。
      if (err instanceof ActionDockError) {
        throw err;
      }
      throw new ActionDockError(
        CONFIG_DECRYPT_FAILED,
        `Decryption of config key '${key}' in package '${this.packageId}' failed unexpectedly`,
        { dbPath: this.dbPath, key, reason: err instanceof Error ? err.message : String(err) }
      );
    }
  }

  // --- Config 读取 ---

  private readRow(key: string): { value_json: string | null } | undefined {
    return this.getStatement(
      "SELECT value_json FROM config WHERE package_id = ? AND key = ?"
    ).get<{ value_json: string | null }>(this.packageId, key);
  }

  /**
   * 单次 SELECT 原子解出业务值与历史保护声明。
   *
   * - 键不存在或值为空：返回 undefined（与既有 getConfig 语义一致）；
   * - 明文行：常规 JSON 解析，快照仅含 value；
   * - 密文行：严格解密验证后返回 value 与 protection，任何失败均抛错，
   *   绝不把密文当作普通字符串降级返回。
   */
  getConfigSnapshot(key: string): ConfigSnapshot | undefined {
    const row = this.readRow(key);
    const raw = row?.value_json;
    if (row === undefined || raw === null || raw === undefined) {
      return undefined;
    }
    if (isEncryptedConfigValue(raw)) {
      const envelope = this.decryptEnvelope(raw, key);
      return { value: envelope.value, protection: envelope.protection };
    }
    return {
      value: safeParseStoredJson(
        raw,
        `config db=${this.dbPath} package=${this.packageId} key=${key}`
      ),
    };
  }

  getConfig<T = unknown>(key: string): T | undefined {
    const snapshot = this.getConfigSnapshot(key);
    return snapshot?.value as T | undefined;
  }

  getConfigProtection(key: string): readonly ConfigItemDefinition[] | undefined {
    return this.getConfigSnapshot(key)?.protection;
  }

  listConfig(): Record<string, unknown> {
    const stmt = this.getStatement(
      "SELECT key, value_json FROM config WHERE package_id = ?"
    );
    const rows = stmt.all<{ key: string; value_json: string }>(this.packageId);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.value_json !== null && row.value_json !== undefined && isEncryptedConfigValue(row.value_json)) {
        const envelope = this.decryptEnvelope(row.value_json, row.key);
        result[row.key] = envelope.value;
      } else {
        result[row.key] = safeParseStoredJson(
          row.value_json,
          `config db=${this.dbPath} package=${this.packageId} key=${row.key}`
        );
      }
    }
    return result;
  }

  // --- Config 写入 ---

  setConfig(key: string, value: unknown, options?: { declarations?: readonly ConfigItemDefinition[] }): void {
    // 读后写升级场景：事务开始即取得写保留锁，避免并发提交下快照升级 SQLITE_BUSY
    this.driver.transaction(
      () => {
        this.applyConfigWrite(key, value, options?.declarations ?? []);
      },
      "immediate"
    );
  }

  /**
   * 写入单个配置键（必须在调用方事务内执行）。
   *
   * 加密判定：当前声明判定敏感，或既有行已是密文（一经加密永不降级明文）。
   * 敏感写入把业务值与合并后的历史保护声明封入同一信封整体加密；声明
   * 变敏感时存量明文由本次写入直接升级为密文。普通值仍以 JSON 明文存储。
   */
  private applyConfigWrite(
    key: string,
    value: unknown,
    declarations: readonly ConfigItemDefinition[]
  ): void {
    const currentSensitive = declarations.some((item) => isSecretConfigKey(key, item));
    const existingRow = this.readRow(key);
    const existingRaw = existingRow?.value_json;
    const existingEncrypted =
      typeof existingRaw === "string" && isEncryptedConfigValue(existingRaw);

    if (currentSensitive || existingEncrypted) {
      // 事务内重读既有密文行，合并历史保护声明，防止并发写弱化保护
      const storedProtection = existingEncrypted
        ? this.decryptEnvelope(existingRaw, key).protection
        : [];
      const protection = mergeProtectionDeclarations(storedProtection, declarations, key);

      const material = this.prepareEncryptionMaterial();
      const ciphertext = encryptConfigEnvelope(value, protection, this.packageId, key, material);
      this.upsertRow(key, ciphertext);
      return;
    }

    this.upsertRow(key, JSON.stringify(value));
  }

  private upsertRow(key: string, valJson: string): void {
    const stmt = this.getStatement(`
      INSERT INTO config (package_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(package_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
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
