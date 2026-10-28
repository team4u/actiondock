import type { DatabaseSync } from "node:sqlite";
import { normalizeSqliteParams } from "./params";
import type { SqliteDriver, SqliteStatement, SqliteTransactionMode } from "./types";
import { ActionDockError, ASYNC_TRANSACTION_UNSUPPORTED, STORAGE_CLOSED } from "../errors";

// 基于原生 ESM Top-Level Await 在模块评估期动态加载，确保警告静默拦截器优先就绪且保持纯正 ESM 架构
const { DatabaseSync: DatabaseSyncConstructor } = (await import("node:sqlite")) as {
  DatabaseSync: typeof DatabaseSync;
};

export { normalizeSqliteParams };

/**

 * 基于 Node.js 内置 node:sqlite 实现的 SQLite 驱动适配器。
 */
export class NodeSqliteDriver implements SqliteDriver {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string | DatabaseSync = ":memory:", options?: any) {
    if (typeof dbPath === "string") {
      this.db = options !== undefined ? new DatabaseSyncConstructor(dbPath, options) : new DatabaseSyncConstructor(dbPath);
    } else {
      this.db = dbPath;
    }
    try {
      this.db.exec("PRAGMA busy_timeout = 5000;");
    } catch {
      // 忽略已关闭或不支持的只读连接异常
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
        const params = normalizeSqliteParams(args);
        const res = stmt.run(...params);
        return {
          changes: Number(res.changes),
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get: <T>(...args: any[]): T | undefined => {
        this.assertOpen();
        const params = normalizeSqliteParams(args);
        return stmt.get(...params) as T | undefined;
      },
      all: <T>(...args: any[]): T[] => {
        this.assertOpen();
        const params = normalizeSqliteParams(args);
        return stmt.all(...params) as T[];
      },
    };
  }

  /**
   * 执行同步事务，严格拒绝并拦截异步 Promise。
   *
   * mode 缺省为 deferred（历史行为）；读后写升级场景应传 immediate，
   * 在事务开始即取得写保留锁，避免并发提交下快照升级失败。
   */
  transaction<T>(
    fn: () => T extends PromiseLike<unknown> ? never : T,
    mode?: SqliteTransactionMode
  ): T {
    this.assertOpen();
    const beginSql =
      mode === "immediate"
        ? "BEGIN IMMEDIATE"
        : mode === "exclusive"
          ? "BEGIN EXCLUSIVE"
          : "BEGIN";
    this.db.exec(beginSql);

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
      throw new ActionDockError(ASYNC_TRANSACTION_UNSUPPORTED, "Async transactions are not allowed in SQLite");
    }

    // 提交本身也可能失败（如锁竞争下的 EXCLUSIVE 升级被拒）：必须回滚释放
    // 事务后重抛原始错误，严禁让连接停留在未决事务内导致后续操作全部失败
    try {
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 忽略回滚阶段发生的级联异常
      }
      throw err;
    }
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
      throw new ActionDockError(STORAGE_CLOSED, "Database connection is closed");
    }
  }
}
