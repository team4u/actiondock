import { DatabaseSync } from "node:sqlite";
import type { SqliteDriver, SqliteStatement } from "@actiondock/core";

/**
 * 参数规范化：若传入单个数组参数则自动展开，否则直接透传位置或具名参数。
 */
function normalizeParams(args: any[]): any[] {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

/**
 * 基于 Node.js 内置 node:sqlite 实现的 SQLite 驱动适配器。
 */
export class NodeSqliteDriver implements SqliteDriver {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string | DatabaseSync = ":memory:", options?: any) {
    if (typeof dbPath === "string") {
      this.db = options !== undefined ? new DatabaseSync(dbPath, options) : new DatabaseSync(dbPath);
    } else {
      this.db = dbPath;
    }
  }

  /**
   * 检查底层连接是否处于开启状态。
   */
  get isOpen(): boolean {
    return !this.closed;
  }

  /**
   * 获取底层原始 DatabaseSync 实例。
   */
  get rawDatabase(): DatabaseSync {
    return this.db;
  }

  /**
   * 执行单条或多条无需返回结果的 SQL 脚本语句。
   */
  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /**
   * 预编译 SQL 语句并封装为统一的 SqliteStatement 接口。
   */
  prepare(sql: string): SqliteStatement {
    this.assertOpen();
    const stmt = this.db.prepare(sql);

    return {
      run: (...args: any[]) => {
        this.assertOpen();
        const params = normalizeParams(args);
        const res = stmt.run(...params);
        return {
          changes: Number(res.changes),
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get: <T>(...args: any[]): T | undefined => {
        this.assertOpen();
        const params = normalizeParams(args);
        return stmt.get(...params) as T | undefined;
      },
      all: <T>(...args: any[]): T[] => {
        this.assertOpen();
        const params = normalizeParams(args);
        return stmt.all(...params) as T[];
      },
    };
  }

  /**
   * 执行同步事务，严格拒绝并拦截异步 Promise。
   */
  transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
    this.assertOpen();
    this.db.exec("BEGIN");

    let result: any;
    try {
      result = fn();
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 忽略回滚阶段发生的级联异常
      }
      throw err;
    }

    // 严格检查是否返回了异步 Promise 对象
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof (result as any).then === "function"
    ) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 忽略回滚阶段发生的级联异常
      }
      throw new Error("Async transactions are not allowed in SQLite");
    }

    this.db.exec("COMMIT");
    return result;
  }

  /**
   * 关闭底层数据库连接并释放资源。
   */
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  /**
   * 断言数据库连接未关闭。
   */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Database connection is closed");
    }
  }
}
