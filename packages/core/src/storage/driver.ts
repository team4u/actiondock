import { createRequire } from "node:module";
import type { SqliteDriver } from "./types";

export type SqliteDriverFactory = (dbPath: string) => SqliteDriver;

/** ESM 环境下可用的 CommonJS require，用于动态加载 node:sqlite */
const cjsRequire = createRequire(import.meta.url);

/**
 * 创建默认 SQLite 驱动实例。
 * 基于 Node.js 原生 node:sqlite (DatabaseSync) 驱动实现。
 */
export function createDefaultSqliteDriver(dbPath: string): SqliteDriver {
  try {
    const { DatabaseSync } = cjsRequire("node:sqlite");
    const db = new DatabaseSync(dbPath);
    const normalizeValue = (v: any) => (v === undefined ? null : v);
    const normalizeParams = (args: any[]) => {
      if (args.length === 1 && Array.isArray(args[0])) {
        return args[0].map(normalizeValue);
      }
      if (
        args.length === 1 &&
        typeof args[0] === "object" &&
        args[0] !== null &&
        !Buffer.isBuffer(args[0]) &&
        !(args[0] instanceof Uint8Array)
      ) {
        const cleaned: Record<string, any> = {};
        for (const [k, v] of Object.entries(args[0])) {
          cleaned[k] = normalizeValue(v);
        }
        return [cleaned];
      }
      return args.map(normalizeValue);
    };

    return {
      exec(sql: string) {
        db.exec(sql);
      },
      prepare(sql: string) {
        const stmt = db.prepare(sql);
        return {
          run(...args: any[]) {
            const params = normalizeParams(args);
            const res = stmt.run(...params);
            return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
          },
          get<T>(...args: any[]): T | undefined {
            const params = normalizeParams(args);
            return stmt.get(...params) as T | undefined;
          },
          all<T>(...args: any[]): T[] {
            const params = normalizeParams(args);
            return stmt.all(...params) as T[];
          },
        };
      },
      transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
        db.exec("BEGIN");
        try {
          const res = fn();
          if (res && typeof (res as any).then === "function") {
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
