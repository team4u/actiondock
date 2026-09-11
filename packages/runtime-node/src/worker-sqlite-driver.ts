import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { normalizeSqliteParams } from "@actiondock/core";
import { STORAGE_BUSY, STORAGE_WORKER_EXITED } from "@actiondock/core";

/**
 * 编译后的工作线程异步参数化语句接口。
 */
export interface WorkerSqliteStatement {
  run(...params: any[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  get<T = any>(...params: any[]): Promise<T | undefined>;
  all<T = any>(...params: any[]): Promise<T[]>;
}

/**
 * WorkerSqliteDriver 构造选项。
 */
export interface WorkerSqliteDriverOptions {
  /** 数据库文件物理绝对路径，或 ":memory:" 内存数据库 */
  dbPath?: string;
  /** 传给底层 node:sqlite DatabaseSync 的选项 */
  options?: any;
}

interface WorkerRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

interface RecordedStatement {
  type: "exec" | "run";
  sql: string;
  params?: any[];
}

/**
 * 存储工作线程内联脚本。
 * 同步 SQLite 调用全部在专用 worker_threads 线程中运行，
 * 绝不阻塞主事件循环与取消信号分发。
 */
/*
 * 参数规范化函数从 core 的共享常量模块生成：worker 内联脚本无法直接 import，
 * 因此通过 Function.prototype.toString 将同一份实现序列化注入，
 * 保证主线程与工作线程的参数规范化逻辑永远同源，杜绝三份拷贝漂移。
 */
const WORKER_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
// 错误码常量自主线程同源插值注入：worker 以 eval 模式执行，无模块系统可 import
const STORAGE_BUSY = ${JSON.stringify(STORAGE_BUSY)};
const { DatabaseSync } = require("node:sqlite");
const { existsSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

if (workerData.dbPath && workerData.dbPath !== ":memory:") {
  const dir = dirname(workerData.dbPath);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (_) {}
  }
}

const db = workerData.options !== undefined
  ? new DatabaseSync(workerData.dbPath || ":memory:", workerData.options)
  : new DatabaseSync(workerData.dbPath || ":memory:");

try {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
} catch (_) {}

const normalizeSqliteParams = ${normalizeSqliteParams.toString()};

const statementCache = new Map();

function getCachedStatement(sql) {
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statementCache.set(sql, stmt);
  }
  return stmt;
}

parentPort.on("message", (msg) => {
  const { id, type, sql, params, statements } = msg;

  if (type === "crash") {
    process.exit(1);
    return;
  }

  try {
    if (type === "exec") {
      db.exec(sql);
      parentPort.postMessage({ id, success: true });
    } else if (type === "run") {
      const stmt = getCachedStatement(sql);
      const res = stmt.run(...normalizeSqliteParams(params));
      parentPort.postMessage({
        id,
        success: true,
        result: {
          changes: Number(res.changes),
          lastInsertRowid: res.lastInsertRowid,
        },
      });
    } else if (type === "get") {
      const stmt = getCachedStatement(sql);
      const res = stmt.get(...normalizeSqliteParams(params));
      parentPort.postMessage({ id, success: true, result: res });
    } else if (type === "all") {
      const stmt = getCachedStatement(sql);
      const res = stmt.all(...normalizeSqliteParams(params));
      parentPort.postMessage({ id, success: true, result: res });
    } else if (type === "transaction") {
      db.exec("BEGIN");
      const results = [];
      try {
        for (const item of (statements || [])) {
          if (item.type === "exec" || (!item.type && !item.params)) {
            db.exec(item.sql);
            results.push(null);
          } else {
            const stmt = getCachedStatement(item.sql);
            const res = stmt.run(...normalizeSqliteParams(item.params));
            results.push({
              changes: Number(res.changes),
              lastInsertRowid: res.lastInsertRowid,
            });
          }
        }
        db.exec("COMMIT");
        parentPort.postMessage({ id, success: true, result: results });
      } catch (tErr) {
        try {
          db.exec("ROLLBACK");
        } catch (_) {}
        throw tErr;
      }
    } else if (type === "close") {
      statementCache.clear();
      db.close();
      parentPort.postMessage({ id, success: true });
    }
  } catch (err) {
    let code = err && err.code;
    const msgLower = (err?.message || "").toLowerCase();
    if (msgLower.includes("busy") || msgLower.includes("locked")) {
      code = STORAGE_BUSY;
    }
    parentPort.postMessage({
      id,
      success: false,
      error: {
        message: err?.message || String(err),
        code,
      },
    });
  }
});
`;

/**
 * 基于 node:worker_threads 工作线程实现的异步非阻塞 SQLite 驱动。
 * 遵循架构规范：
 * - 同步 SQLite 操作完全在工作线程执行，不阻塞主事件循环的取消信号与事件分发。
 * - 监听工作线程异常退出（error 与 exit），未决请求以 STORAGE_WORKER_EXITED 失败拒绝，后续请求直接拒绝。
 * - 事务在工作线程内原子执行，杜绝跨消息悬挂。
 */
export class WorkerSqliteDriver {
  private worker: Worker;
  private pendingRequests = new Map<string, WorkerRequest>();
  private closed = false;
  private exited = false;
  private activeRecorder: RecordedStatement[] | null = null;

  constructor(dbPathOrOptions: string | WorkerSqliteDriverOptions = ":memory:", options?: any) {
    let dbPath = ":memory:";
    let extraOpts: any;

    if (typeof dbPathOrOptions === "string") {
      dbPath = dbPathOrOptions;
      extraOpts = options;
    } else if (typeof dbPathOrOptions === "object" && dbPathOrOptions !== null) {
      dbPath = dbPathOrOptions.dbPath || ":memory:";
      extraOpts = dbPathOrOptions.options;
    }

    this.worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { dbPath, options: extraOpts },
    });

    this.worker.on("message", (msg) => {
      const { id, success, result, error } = msg;
      const pending = this.pendingRequests.get(id);
      if (!pending) return;
      this.pendingRequests.delete(id);

      if (success) {
        pending.resolve(result);
      } else {
        const err: any = new Error(error?.message || "Storage worker operation failed");
        if (error?.code) {
          err.code = error.code;
        }
        pending.reject(err);
      }
    });

    this.worker.on("error", (err) => {
      this.handleWorkerExit(undefined, err);
    });

    this.worker.on("exit", (code) => {
      if (!this.closed) {
        this.handleWorkerExit(code);
      }
    });
  }

  /**
   * 检查底层工作线程连接是否处于正常开启状态。
   */
  get isOpen(): boolean {
    return !this.closed && !this.exited;
  }

  /**
   * 检查底层工作线程是否异常退出。
   */
  get isExited(): boolean {
    return this.exited;
  }

  /**
   * 统一向工作线程发送消息请求并等待响应。
   */
  private request<T>(type: string, payload: any): Promise<T> {
    if (this.exited) {
      const failureError: any = new Error(
        `${STORAGE_WORKER_EXITED}: Storage worker thread has exited and cannot process requests`
      );
      failureError.code = STORAGE_WORKER_EXITED;
      return Promise.reject(failureError);
    }
    if (this.closed) {
      return Promise.reject(new Error("Database connection is closed"));
    }

    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  /**
   * 处理工作线程异常退出事件。
   * 将所有未决请求以 STORAGE_WORKER_EXITED 失败拒绝，并设置驱动不可用状态。
   */
  private handleWorkerExit(exitCode?: number, err?: Error): void {
    if (this.exited) return;
    this.exited = true;

    const failureError: any = new Error(
      `${STORAGE_WORKER_EXITED}: Storage worker thread exited unexpectedly (${
        err ? err.message : `exit code: ${exitCode}`
      })`
    );
    failureError.code = STORAGE_WORKER_EXITED;

    for (const [_, pending] of this.pendingRequests) {
      pending.reject(failureError);
    }
    this.pendingRequests.clear();
  }

  /**
   * 异步执行 SQL 脚本语句。
   */
  exec(sql: string): Promise<void> {
    if (this.activeRecorder) {
      this.activeRecorder.push({ type: "exec", sql });
      return Promise.resolve();
    }
    return this.request<void>("exec", { sql });
  }

  /**
   * 异步执行增删改语句并返回受影响行数与最后插入行标识。
   */
  run(
    sql: string,
    ...params: any[]
  ): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    if (this.activeRecorder) {
      this.activeRecorder.push({ type: "run", sql, params });
      return Promise.resolve({ changes: 1 });
    }
    return this.request("run", { sql, params });
  }

  /**
   * 异步执行单行查询。
   * 函数式事务录制期内调用会直接抛错：录制器仅拦截 exec 与 run，
   * 读操作无法参与事务原子性，静默绕过会产生悬挂 Promise 与脏读，
   * 属于严格禁止的用法。
   */
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    if (this.activeRecorder) {
      return Promise.reject(
        new Error(
          "WORKER_TRANSACTION_READ_FORBIDDEN: reads are not allowed inside a functional transaction on WorkerSqliteDriver; " +
            "pre-read outside the transaction instead, or use explicit BEGIN/COMMIT statements, " +
            "or use the statements-array transaction form"
        )
      );
    }
    return this.request<T | undefined>("get", { sql, params });
  }

  /**
   * 异步执行全量结果集查询。
   * 函数式事务录制期内调用会直接抛错，理由同 get。
   */
  all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    if (this.activeRecorder) {
      return Promise.reject(
        new Error(
          "WORKER_TRANSACTION_READ_FORBIDDEN: reads are not allowed inside a functional transaction on WorkerSqliteDriver; " +
            "pre-read outside the transaction instead, or use explicit BEGIN/COMMIT statements, " +
            "or use the statements-array transaction form"
        )
      );
    }
    return this.request<T[]>("all", { sql, params });
  }

  /**
   * 封装预编译语句，返回对齐 SqliteStatement 契约的语句代理。
   */
  prepare(sql: string): WorkerSqliteStatement {
    return {
      run: (...params: any[]) => this.run(sql, ...params),
      get: <T>(...params: any[]) => this.get<T>(sql, ...params),
      all: <T>(...params: any[]) => this.all<T>(sql, ...params),
    };
  }

  /**
   * 执行事务。
   * 支持通过函数式或语句清单方式执行，整体在工作线程内原子提交，
   * 失败时回滚，杜绝跨消息连接悬挂。
   */
  async transaction<T>(
    fnOrStatements: (() => T) | Array<{ sql: string; params?: any[]; type?: "exec" | "run" } | string>
  ): Promise<any> {
    if (Array.isArray(fnOrStatements)) {
      const stmts = fnOrStatements.map((item) =>
        typeof item === "string" ? { type: "exec" as const, sql: item } : item
      );
      return this.request("transaction", { statements: stmts });
    }

    if (typeof fnOrStatements === "function") {
      const recorded: RecordedStatement[] = [];
      const prevRecorder = this.activeRecorder;
      this.activeRecorder = recorded;
      let fnResult: T;
      try {
        fnResult = fnOrStatements();
      } finally {
        this.activeRecorder = prevRecorder;
      }

      await this.request("transaction", { statements: recorded });
      return fnResult;
    }

    throw new Error("Invalid transaction parameter: expected function or statements array");
  }

  /**
   * 正常关闭数据库连接并终止工作线程。
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (!this.exited) {
      try {
        await this.request("close", {});
      } catch {
        // 忽略关闭请求响应异常
      }
      try {
        await this.worker.terminate();
      } catch {
        // 忽略终止工作线程异常
      }
    }
  }

  /**
   * 测试辅助：模拟工作线程异常崩溃退出。
   */
  crashForTest(): void {
    if (this.exited || this.closed) return;
    this.worker.postMessage({ id: "crash", type: "crash" });
  }

  /**
   * 显式终止工作线程。
   */
  async terminate(): Promise<number> {
    const code = await this.worker.terminate();
    this.handleWorkerExit(code);
    return code;
  }
}
