import { ActionDockError, UNSUPPORTED_STORAGE_SCHEMA } from "../../errors";
import type { ConfigItemDefinition } from "../../project/types";
import type { ConfigKeyProvider } from "../../security/config-cipher";
import type { Clock } from "../clock";
import { createCurrentSchema, validateCurrentSchema } from "../sqlite-schema";
import { STORAGE_SCHEMA_VERSION, type SqliteDriver } from "../types";
import { migrateV2ToV3 } from "./v2-to-v3";

/**
 * 版本迁移执行上下文：迁移所需的最小依赖集合。
 *
 * 由存储装配入口（SqliteRuntimeStorage）提供底层驱动、目标命名空间、
 * 配置声明集合与密钥提供器；主干层只装配数据，不做任何迁移判断。
 */
export interface SchemaMigrationContext {
  driver: SqliteDriver;
  dbPath: string;
  packageId: string;
  declarations: readonly Record<string, ConfigItemDefinition>[];
  keyProvider: ConfigKeyProvider;
  clock: Clock;
}

/** 单个版本迁移步骤：from → to 的原子转换。 */
export interface StorageMigration {
  from: number;
  to: number;
  run(context: SchemaMigrationContext): void;
}

/**
 * 已注册的版本迁移链。
 *
 * 每个历史版本的全部转换逻辑封装在各自迁移文件中；下线某旧版本支持时，
 * 删除对应迁移文件与注册项即可，当前版本读写代码不感知历史版本。
 */
const MIGRATIONS: readonly StorageMigration[] = [
  { from: 2, to: 3, run: migrateV2ToV3 },
];

/** 读取数据库当前 schema 版本号。 */
function readUserVersion(driver: SqliteDriver): number {
  const row = driver.prepare("PRAGMA user_version;").get<{ user_version: number }>();
  return Number(row?.user_version ?? 0);
}

/** 构造不支持版本的统一拒绝错误。 */
function unsupportedVersionError(version: number, dbPath: string): ActionDockError {
  return new ActionDockError(
    UNSUPPORTED_STORAGE_SCHEMA,
    `Database schema version ${version} of '${dbPath}' has no supported migration path to the current version ${STORAGE_SCHEMA_VERSION}; upgrade the database first with a build that still supports version ${version}.`,
    { dbPath, version, current: STORAGE_SCHEMA_VERSION }
  );
}

/**
 * 沿注册链推导从 from 到当前版本的迁移步骤序列。
 *
 * 返回 null 表示无支持路径：from 非法（<= 0）、不低于当前版本（未来版本
 * 一律拒绝，结构完整也不得当作当前版本打开），或链上存在缺口、注册步骤
 * 无法精确抵达当前版本。
 */
function buildMigrationChain(from: number): StorageMigration[] | null {
  if (from <= 0 || from >= STORAGE_SCHEMA_VERSION) {
    return null;
  }
  const chain: StorageMigration[] = [];
  let version = from;
  while (version < STORAGE_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((migration) => migration.from === version);
    if (!step) {
      return null;
    }
    chain.push(step);
    version = step.to;
  }
  if (version !== STORAGE_SCHEMA_VERSION) {
    return null;
  }
  return chain;
}

/**
 * 存储打开前的版本就绪入口：新库建库、旧库迁移、当前库校验。
 *
 * 调用时机：先于任何正常子存储构造（当前版本存储实现始终假定数据库
 * 已经是当前版本），也先于运行记录恢复（恢复依赖子存储）。
 *
 * - 版本等于当前：锁外只读校验核心表齐备，缺失即拒绝（半升级或损坏
 *   状态不得静默修补）；
 * - 其余版本（含全新库）：统一进入 BEGIN IMMEDIATE 写事务，锁内重读
 *   版本后决策——全新库执行当前版本 DDL，旧版本沿注册链迁移并逐步更新
 *   版本号，无支持路径（如版本 1 或未来版本）明确拒绝；
 * - 结构完整性校验在事务内、提交前执行：任何失败（含迁移步骤与最终
 *   校验）都会把数据、结构与版本号整体回滚，数据库保持进入前状态可重试；
 * - 并发连接已抢先完成同一升级时，锁内版本已是当前版本，校验后直接通过。
 */
export function ensureStorageSchema(context: SchemaMigrationContext): void {
  const { driver, dbPath } = context;

  // 跨进程写并发基线：优先设置 busy_timeout，确保后续 PRAGMA（如
  // journal_mode = WAL）与迁移事务在锁争用时能够重试等待
  driver.exec("PRAGMA busy_timeout = 5000;");
  driver.exec("PRAGMA journal_mode = WAL;");
  driver.exec("PRAGMA synchronous = NORMAL;");

  if (readUserVersion(driver) === STORAGE_SCHEMA_VERSION) {
    validateCurrentSchema(driver, dbPath);
    return;
  }

  driver.transaction(
    () => {
      const locked = readUserVersion(driver);
      if (locked === STORAGE_SCHEMA_VERSION) {
        validateCurrentSchema(driver, dbPath);
        return;
      }
      if (locked === 0) {
        createCurrentSchema(driver);
      } else {
        const chain = buildMigrationChain(locked);
        if (chain === null) {
          throw unsupportedVersionError(locked, dbPath);
        }
        for (const step of chain) {
          step.run(context);
          driver.exec(`PRAGMA user_version = ${step.to};`);
        }
      }
      validateCurrentSchema(driver, dbPath);
    },
    "immediate"
  );
}
