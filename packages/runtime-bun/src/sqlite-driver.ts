import { createRequire } from "node:module";
import type { Database } from "bun:sqlite";
import type { SqliteDriver, SqliteStatement } from "@actiondock/core";

/**
 * 规范化 SQL 参数，支持展开参数、数组参数或命名参数对象。
 */
function normalizeParams(args: any[]): any[] {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

export interface BunSqliteDriverOptions {
  readonly?: boolean;
  create?: boolean;
  readwrite?: boolean;
  strict?: boolean;
  safeintegers?: boolean;
}

let BunDatabaseClass: any;

function getBunDatabaseClass(): any {
  if (!BunDatabaseClass) {
    if (typeof (globalThis as any).Bun === "undefined") {
      throw new Error(
        "BunSqliteDriver requires Bun runtime environment. It cannot be instantiated directly in Node.js."
      );
    }
    try {
      const require = createRequire(import.meta.url);
      const bunSqlite = require("bun:sqlite");
      BunDatabaseClass = bunSqlite.Database || bunSqlite.default;
      if (!BunDatabaseClass) {
        throw new Error("Cannot find Database constructor in 'bun:sqlite'");
      }
    } catch (err: any) {
      throw new Error(`Failed to load 'bun:sqlite': ${err.message}`);
    }
  }
  return BunDatabaseClass;
}

/**
 * 基于 bun:sqlite 的 SQLite 驱动实现。
 */
export class BunSqliteDriver implements SqliteDriver {
  private db: Database;
  private isClosed = false;
  /** 未释放的 prepared statement 集合，close() 时统一 finalize */
  private openStatements = new Set<any>();

  constructor(
    dbOrPath: string | Database = ":memory:",
    options?: BunSqliteDriverOptions
  ) {
    if (typeof dbOrPath === "string") {
      const DB = getBunDatabaseClass();
      this.db = new DB(dbOrPath, options);
    } else {
      this.db = dbOrPath;
    }
  }

  /**
   * 获取底层 Database 实例。
   */
  get database(): Database {
    return this.db;
  }

  /**
   * 检查连接是否已关闭。
   */
  get closed(): boolean {
    return this.isClosed;
  }

  /**
   * 直接执行 SQL 语句。
   */
  exec(sql: string): void {
    if (this.isClosed) {
      throw new Error("Database is closed");
    }
    this.db.exec(sql);
  }

  /**
   * 预编译 SQL 语句，统一处理参数映射。
   *
   * bun:sqlite 的 statement 未 finalize 时会一直持有数据库文件句柄，
   * Windows 下导致 close() 后文件仍被锁（EBUSY 无法删除）。
   * statement 均登记至待释放集合，close() 时统一 finalize 释放句柄。
   */
  prepare(sql: string): SqliteStatement {
    if (this.isClosed) {
      throw new Error("Database is closed");
    }
    const stmt = this.db.prepare(sql);
    this.openStatements.add(stmt);
    return {
      run: (...args: any[]) => {
        const params = normalizeParams(args);
        const res = stmt.run(...params);
        return {
          changes: res.changes,
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get: <T>(...args: any[]): T | undefined => {
        const params = normalizeParams(args);
        const row = stmt.get(...params);
        return (row ?? undefined) as T | undefined;
      },
      all: <T>(...args: any[]): T[] => {
        const params = normalizeParams(args);
        return stmt.all(...params) as T[];
      },
    };
  }

  /**
   * 执行同步事务，发生异常时自动回滚。
   */
  transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
    if (this.isClosed) {
      throw new Error("Database is closed");
    }
    const tx = this.db.transaction(() => {
      const res = fn();
      if (res && typeof (res as any).then === "function") {
        throw new Error("Async transactions are not allowed in SQLite");
      }
      return res;
    });
    return tx() as T;
  }

  /**
   * 妥善关闭数据库连接。
   *
   * 关库前统一 finalize 全部 prepared statement，
   * 释放 Windows 平台残留的数据库文件句柄锁。
   */
  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    for (const stmt of this.openStatements) {
      try {
        stmt.finalize();
      } catch {
        // 已 finalize 或重复释放时忽略
      }
    }
    this.openStatements.clear();
    try {
      this.db.close();
    } catch {
      // 忽略重复关闭异常
    }
  }
}

/**
 * 工厂函数：创建 BunSqliteDriver 实例。
 */
export function createBunSqliteDriver(
  dbOrPath: string | Database = ":memory:",
  options?: BunSqliteDriverOptions
): BunSqliteDriver {
  return new BunSqliteDriver(dbOrPath, options);
}
