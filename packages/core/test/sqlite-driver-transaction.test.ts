import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";

/**
 * 驱动事务提交失败的连接状态契约。
 *
 * 真实场景：rollback journal 模式下另一连接持有读事务时，busy_timeout=0
 * 的 writer 在 COMMIT 取 EXCLUSIVE 锁失败。要求：提交失败必须回滚并释放
 * 事务，连接可继续开启新事务，且未提交的写入不落库（存储自动迁移的
 * 失败可重试承诺依赖这一保证）。
 */
describe("NodeSqliteDriver 事务提交失败处理", () => {
  it("COMMIT 被并发读事务阻塞时回滚事务：值未落库且连接可开启新事务", () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-driver-commit-"));
    const dbPath = join(dir, "t.db");
    const setup = new NodeSqliteDriver(dbPath);
    setup.exec("PRAGMA journal_mode = DELETE;");
    setup.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    setup.prepare("INSERT INTO t (v) VALUES ('original')").run();
    setup.close();

    const writer = new NodeSqliteDriver(dbPath);
    writer.exec("PRAGMA busy_timeout = 0;");
    const reader = new NodeSqliteDriver(dbPath);
    reader.exec("PRAGMA busy_timeout = 0;");
    try {
      // 读事务持有共享锁：阻塞 writer 的 COMMIT 升级到独占锁
      reader.exec("BEGIN;");
      reader.prepare("SELECT COUNT(*) FROM t").get();

      assert.throws(
        () =>
          writer.transaction(() => {
            writer.prepare("UPDATE t SET v = 'changed' WHERE id = 1").run();
          }, "immediate"),
        (err: unknown) => String((err as Error).message).includes("locked")
      );

      // 未提交的写入不得落库：释放读锁后由独立旁观连接验证
      reader.exec("ROLLBACK;");
      const observer = new NodeSqliteDriver(dbPath);
      try {
        const row = observer.prepare("SELECT v FROM t WHERE id = 1").get<{ v: string }>();
        assert.equal(row?.v, "original", "提交失败的写入必须被回滚，不得落库");
      } finally {
        observer.close();
      }

      // 提交失败后连接不得停留在事务内：新事务可正常开启并提交
      writer.transaction(() => {
        writer.prepare("UPDATE t SET v = 'retried' WHERE id = 1").run();
      }, "immediate");
      const after = writer.prepare("SELECT v FROM t WHERE id = 1").get<{ v: string }>();
      assert.equal(after?.v, "retried", "失败后的连接必须可继续正常事务");
    } finally {
      reader.close();
      writer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
