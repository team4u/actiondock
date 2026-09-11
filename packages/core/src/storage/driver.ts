import { createRequire } from "node:module";
import { normalizeSqliteParams } from "./params";
import type { SqliteDriver } from "./types";

export type SqliteDriverFactory = (dbPath: string) => SqliteDriver;

export { normalizeSqliteParams };

/** ESM 环境下可用的 CommonJS require，用于动态加载 node:sqlite */
const cjsRequire = createRequire(import.meta.url);

/**
 * 创建默认 SQLite 驱动实例。
 * 基于 Node.js 原生 node:sqlite (DatabaseSync) 驱动实现，严格同步契约。
 */
export function createDefaultSqliteDriver(dbPath: string): SqliteDriver {
  try {
    const { DatabaseSync } = cjsRequire("node:sqlite");
    const db = new DatabaseSync(dbPath);

    return {
      exec(sql: string) {
        db.exec(sql);
      },
      prepare(sql: string) {
        const stmt = db.prepare(sql);
        return {
          run(...args: any[]) {
            const params = normalizeSqliteParams(args);
            const res = stmt.run(...params);
            return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
          },
          get<T>(...args: any[]): T | undefined {
            const params = normalizeSqliteParams(args);
            return stmt.get(...params) as T | undefined;
          },
          all<T>(...args: any[]): T[] {
            const params = normalizeSqliteParams(args);
            return stmt.all(...params) as T[];
          },
        };
      },
      transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
        db.exec("BEGIN");
        try {
          const res = fn();
          if (res !== null && (typeof res === "object" || typeof res === "function") && typeof (res as any).then === "function") {
            throw new Error("Async transactions are not allowed in SQLite");
          }
          db.exec("COMMIT");
          return res;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
      close() {
        db.close();
      },
    };
  } catch (err: any) {
    throw new Error(`Failed to initialize SQLite driver: ${err?.message || String(err)}`);
  }
}
