import { normalizeSqliteParams } from "./params";
import { NodeSqliteDriver } from "./sqlite-driver";
import type { SqliteDriver } from "./types";

export type SqliteDriverFactory = (dbPath: string) => SqliteDriver;

export { normalizeSqliteParams, NodeSqliteDriver };

/**
 * 创建默认 SQLite 驱动实例。
 * 基于 Node.js 原生 node:sqlite (DatabaseSync) 驱动实现，严格同步契约。
 */
export function createDefaultSqliteDriver(dbPath: string): SqliteDriver {
  return new NodeSqliteDriver(dbPath);
}
