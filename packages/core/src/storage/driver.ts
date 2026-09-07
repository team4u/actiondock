import { createRequire } from "node:module";
import type { SqliteDriver } from "./types";

export type SqliteDriverFactory = (dbPath: string) => SqliteDriver;

/** ESM 环境下可用的 CommonJS require，用于动态加载 node:sqlite / bun:sqlite */
const cjsRequire = createRequire(import.meta.url);

let customDriverFactory: SqliteDriverFactory | undefined;

/**
 * 注册全局默认 SQLite 驱动工厂。
 */
export function setSqliteDriverFactory(factory: SqliteDriverFactory): void {
  customDriverFactory = factory;
}

/**
 * 创建默认 SQLite 驱动实例。
 * 优先使用外部注册的工厂，其次根据当前运行时环境自动适配。
 */
export function createDefaultSqliteDriver(dbPath: string): SqliteDriver {
  if (customDriverFactory) {
    return customDriverFactory(dbPath);
  }

  // 检查是否在 Bun 运行时环境
  if (typeof (globalThis as any).Bun !== "undefined") {
    try {
      const { Database } = (globalThis as any).Bun.sqlite || cjsRequire("bun:sqlite");
      const db = new Database(dbPath);
      // bun:sqlite 的 statement 未 finalize 时会一直持有数据库文件句柄，
      // Windows 下导致 db.close() 后文件仍被锁（EBUSY 无法删除）。
      // 跟踪全部 prepared statement，close() 时统一 finalize 释放句柄。
      const openStatements = new Set<any>();
      return {
        exec(sql: string) {
          db.exec(sql);
        },
        prepare(sql: string) {
          const stmt = db.prepare(sql);
          openStatements.add(stmt);
          return {
            run(...args: any[]) {
              const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
              const res = stmt.run(...params);
              return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
            },
            get<T>(...args: any[]): T | undefined {
              const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
              return stmt.get(...params) as T | undefined;
            },
            all<T>(...args: any[]): T[] {
              const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
              return stmt.all(...params) as T[];
            },
          };
        },
        transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
          return db.transaction(fn)() as T;
        },
        close() {
          for (const stmt of openStatements) {
            try {
              stmt.finalize();
            } catch {
              // 已 finalize 或重复释放时忽略
            }
          }
          openStatements.clear();
          db.close();
        },
      };
    } catch {
      // 若在 Bun 下获取 bun:sqlite 失败，回退到标准 Node 驱动尝试
    }
  }

  // 在 Node.js 环境下使用 node:sqlite
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
            const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
            const res = stmt.run(...params);
            return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
          },
          get<T>(...args: any[]): T | undefined {
            const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
            return stmt.get(...params) as T | undefined;
          },
          all<T>(...args: any[]): T[] {
            const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
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
