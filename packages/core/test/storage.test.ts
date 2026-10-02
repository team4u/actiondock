import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as sdk from "@actiondock/sdk";
import * as coreStorage from "../src/storage";
import { resolveDatabasePath } from "../src/storage";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("SqliteRuntimeStorage", () => {
  let storage: SqliteRuntimeStorage;

  beforeEach(() => {
    storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });
  });

  afterEach(async () => {
    await storage.close();
  });

  describe("Config", () => {
    it("should set, get, list, and delete config values", () => {
      assert.strictEqual(storage.getConfig("API_KEY"), undefined);

      storage.setConfig("API_KEY", "secret-123");
      assert.strictEqual(storage.getConfig<string>("API_KEY"), "secret-123");

      storage.setConfig("PORT", 8080);
      assert.strictEqual(storage.getConfig<number>("PORT"), 8080);

      storage.setConfig("FLAGS", { enabled: true, debug: false });
      assert.deepStrictEqual(storage.getConfig<{ enabled: boolean; debug: boolean }>("FLAGS"), { enabled: true, debug: false });

      const all = storage.listConfig();
      assert.deepStrictEqual(all, {
        API_KEY: "secret-123",
        PORT: 8080,
        FLAGS: { enabled: true, debug: false },
      });

      const deleted = storage.deleteConfig("API_KEY");
      assert.strictEqual(deleted, true);
      assert.strictEqual(storage.getConfig("API_KEY"), undefined);
    });
  });

  describe("State", () => {
    it("should set, get, list, and delete state values with namespaces", async () => {
      assert.strictEqual(await storage.getState("", "cursor"), undefined);

      await storage.setState("", "cursor", "001");
      assert.strictEqual(await storage.getState<string>("", "cursor"), "001");

      await storage.setState("ns1", "counter", 42);
      assert.strictEqual(await storage.getState<number>("ns1", "counter"), 42);

      const rootKeys = await storage.listStateKeys("");
      assert.deepStrictEqual(rootKeys, ["cursor"]);

      const nsKeys = await storage.listStateKeys("ns1");
      assert.deepStrictEqual(nsKeys, ["counter"]);

      // Global scan (namespace = null/undefined)
      const allKeys = await storage.listStateKeys();
      assert.deepStrictEqual(allKeys, ["cursor", "ns1:counter"]);

      // Smart find
      const foundRoot = await storage.findState("cursor");
      assert.strictEqual(foundRoot?.value, "001");
      assert.strictEqual(foundRoot?.namespace, "");

      const foundComposite = await storage.findState("ns1:counter");
      assert.strictEqual(foundComposite?.value, 42);
      assert.strictEqual(foundComposite?.namespace, "ns1");
      assert.strictEqual(foundComposite?.key, "counter");

      // Smart delete with boolean check
      const deletedRoot = await storage.deleteState("", "cursor");
      assert.strictEqual(deletedRoot, true);
      assert.strictEqual(await storage.getState("", "cursor"), undefined);

      const notFoundDeleted = await storage.deleteState("", "cursor");
      assert.strictEqual(notFoundDeleted, false);

      // Smart delete by composite key
      const deletedComposite = await storage.deleteStateSmart("ns1:counter");
      assert.strictEqual(deletedComposite, true);
      assert.strictEqual(await storage.getState("ns1", "counter"), undefined);

      const notFoundSmart = await storage.deleteStateSmart("ns1:counter");
      assert.strictEqual(notFoundSmart, false);
    });

    it("正确支持多段嵌套命名空间（a:b:c:key）的精确匹配与删除", async () => {
      // 场景：namespace 自身包含多层冒号，如 'app:sub:cache'，key 为 'user:123'
      // 组合全名是 'app:sub:cache:user:123'
      await storage.setState("app:sub:cache", "user:123", { name: "Bob" });

      // 另一条 namespace 为 'app'，key 为 'sub:cache:user:123'
      // 其组合全名也是 'app:sub:cache:user:123'，但两者在此处属于不同条目
      await storage.setState("app:sub", "config", "nested-value");

      // 精确 getState
      const val1 = await storage.getState<{ name: string }>("app:sub:cache", "user:123");
      assert.deepStrictEqual(val1, { name: "Bob" });

      // findState 支持多层冒号全名查找
      const found = await storage.findState("app:sub:config");
      assert.notStrictEqual(found, undefined);
      assert.strictEqual(found?.namespace, "app:sub");
      assert.strictEqual(found?.key, "config");
      assert.strictEqual(found?.value, "nested-value");

      // deleteStateSmart 依据多层冒号全名删除
      const deleted = await storage.deleteStateSmart("app:sub:config");
      assert.strictEqual(deleted, true);
      assert.strictEqual(await storage.getState("app:sub", "config"), undefined);

      // 验证未被误删的嵌套条目
      assert.deepStrictEqual(await storage.getState<{ name: string }>("app:sub:cache", "user:123"), { name: "Bob" });
      const del2 = await storage.deleteStateSmart("app:sub:cache:user:123");
      assert.strictEqual(del2, true);
      assert.strictEqual(await storage.getState("app:sub:cache", "user:123"), undefined);
    });

    it("should clear state by namespace, prefix, or all", async () => {
      await storage.setState("", "k1", "v1");
      await storage.setState("", "k2", "v2");
      await storage.setState("auth", "token", "abc");
      await storage.setState("auth", "session", "123");
      await storage.setState("cache", "item1", "foo");

      assert.strictEqual((await storage.listStateKeys()).length, 5);

      // Clear by namespace
      const clearedAuth = await storage.clearState({ namespace: "auth" });
      assert.strictEqual(clearedAuth, 2);
      assert.deepStrictEqual(await storage.listStateKeys("auth"), []);
      assert.strictEqual(await storage.getState("auth", "token"), undefined);

      // Clear all
      const clearedAll = await storage.clearState({ all: true });
      assert.strictEqual(clearedAll, 3); // k1, k2, cache:item1
      assert.deepStrictEqual(await storage.listStateKeys(), []);
    });

    it("过期条目惰性删除失败时输出可观测告警而非静默吞没", async () => {
      let currentTime = 1000000;
      const testClock = {
        now: () => new Date(currentTime),
        monotonic: () => currentTime,
        sleep: async (ms: number) => {
          currentTime += ms;
        },
      };
      const innerDriver = new NodeSqliteDriver(":memory:");
      // 包装驱动：仅拦截 DELETE FROM state 使其抛错，其余透传，
      // 保证读取路径正常而惰性删除路径可注入失败
      const failingDeleteDriver = {
        exec: (sql: string) => innerDriver.exec(sql),
        prepare: (sql: string) => {
          const stmt = innerDriver.prepare(sql);
          if (sql.trimStart().toUpperCase().startsWith("DELETE FROM STATE")) {
            return {
              run: () => {
                throw new Error("injected delete failure");
              },
              get: () => undefined,
              all: () => [],
            };
          }
          return stmt;
        },
        transaction: (fn: any) => innerDriver.transaction(fn),
        close: () => innerDriver.close(),
        isOpen: true,
      } as any;

      const ttlStorage = new SqliteRuntimeStorage({
        packageId: "test-pkg",
        dbPath: ":memory:",
        clock: testClock,
        driver: failingDeleteDriver,
      });

      const originalWarn = console.warn;
      const warnCalls: string[] = [];
      console.warn = ((msg: any) => {
        warnCalls.push(String(msg));
      }) as any;

      try {
        await ttlStorage.setState("ns-warn", "stale-key", "val", 1);
        currentTime += 2000;

        // 读取路径正常返回 undefined（过期），后台惰性删除失败仅告警
        assert.strictEqual(await ttlStorage.getState("ns-warn", "stale-key"), undefined);

        // 惰性删除在后台 Promise 中执行，等待微任务周期后断言告警已产出
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(warnCalls.some(
            (m) =>
              m.includes("expired state lazy delete failed") &&
              m.includes("ns-warn") &&
              m.includes("stale-key")
          ), true);
      } finally {
        console.warn = originalWarn;
        ttlStorage.close();
      }
    });

    it("should expire state keys based on TTL", async () => {
      let currentTime = 1000000;
      const testClock = {
        now: () => new Date(currentTime),
        monotonic: () => currentTime,
        sleep: async (ms: number) => {
          currentTime += ms;
        },
      };
      const ttlStorage = new SqliteRuntimeStorage({
        packageId: "test-pkg",
        dbPath: ":memory:",
        clock: testClock,
      });

      try {
        // 1. TTL in seconds (10s)
        await ttlStorage.setState("", "temp1", "val1", 10);
        assert.strictEqual(await ttlStorage.getState<string>("", "temp1"), "val1");

        // 2. TTL in namespace
        await ttlStorage.setState("ns1", "temp2", { a: 1 }, 10);
        assert.deepStrictEqual(await ttlStorage.getState<{ a: number }>("ns1", "temp2"), { a: 1 });

        // 3. Permanent key
        await ttlStorage.setState("", "perm", "stay");

        assert.deepStrictEqual((await ttlStorage.listStateKeys("")).sort(), ["perm", "temp1"]);
        assert.deepStrictEqual(await ttlStorage.listStateKeys("ns1"), ["temp2"]);

        // Advance clock by 11 seconds (11000ms)
        currentTime += 11000;

        assert.strictEqual(await ttlStorage.getState("", "temp1"), undefined);
        assert.strictEqual(await ttlStorage.getState("ns1", "temp2"), undefined);
        assert.strictEqual(await ttlStorage.getState<string>("", "perm"), "stay");

        assert.deepStrictEqual(await ttlStorage.listStateKeys(""), ["perm"]);
        assert.deepStrictEqual(await ttlStorage.listStateKeys("ns1"), []);
      } finally {
        ttlStorage.close();
      }
    });

    it("打开旧版本（例如版本 1）Schema 数据库时直接抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动", () => {
      const tempDbPath = join(tmpdir(), `test-old-version-${Date.now()}.db`);

      // 创建版本 1 旧结构数据库
      const rawDb = new NodeSqliteDriver(tempDbPath);
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS config (
          package_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (package_id, key)
        );
        PRAGMA user_version = 1;
      `);
      rawDb.close();

      // 打开旧版本数据库，验证在写事务前直接抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动
      assert.throws(() => {
        new SqliteRuntimeStorage({
          packageId: "old-pkg",
          dbPath: tempDbPath,
        });
      }, /UNSUPPORTED_STORAGE_SCHEMA/);

      // 验证原数据库未被修改且保留原版本号
      const checkDb = new NodeSqliteDriver(tempDbPath);
      const row = checkDb.prepare("PRAGMA user_version;").get() as any;
      assert.strictEqual(row.user_version, 1);
      checkDb.close();

      try {
        unlinkSync(tempDbPath);
      } catch {}
    });

    it("打开未来不兼容版本 Schema 数据库时抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动", () => {
      const tempDbPath = join(tmpdir(), `test-incompatible-${Date.now()}.db`);

      // 手动创建未来不兼容版本数据库
      const rawDb = new NodeSqliteDriver(tempDbPath);
      rawDb.exec(`
        CREATE TABLE config (
          package_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (package_id, key)
        );
        PRAGMA user_version = 999;
      `);
      rawDb.close();

      // 打开未来版本数据库，验证直接抛出不支持异常并拒绝启动
      assert.throws(() => {
        new SqliteRuntimeStorage({
          packageId: "incompatible-pkg",
          dbPath: tempDbPath,
        });
      }, /UNSUPPORTED_STORAGE_SCHEMA/);

      // 验证原数据库文件与 user_version 保持未修改
      const checkDb = new NodeSqliteDriver(tempDbPath);
      const row = checkDb.prepare("PRAGMA user_version;").get() as any;
      assert.strictEqual(row.user_version, 999);
      checkDb.close();

      try {
        unlinkSync(tempDbPath);
      } catch {}
    });

    it("unambiguous colon key encoding and ambiguity detection", async () => {
      const memStorage = new SqliteRuntimeStorage({ packageId: "colon-test-pkg" });
      try {
        // Encode and decode tests
        const { encodeStateKey, decodeStateKey } = await import("../src/storage/sqlite");
        assert.strictEqual(encodeStateKey("a:b", "c"), "a\\:b:c");
        assert.strictEqual(encodeStateKey("a", "b:c"), "a:b\\:c");
        assert.deepStrictEqual(decodeStateKey("a\\:b:c"), { namespace: "a:b", key: "c" });
        assert.deepStrictEqual(decodeStateKey("a:b\\:c"), { namespace: "a", key: "b:c" });
        assert.throws(() => decodeStateKey("a:b:c"), /Ambiguous state key/);

        // Insert conflicting rows: namespace "a:b", key "c" and namespace "a", key "b:c"
        await memStorage.setState("a:b", "c", { source: "a:b / c" });
        await memStorage.setState("a", "b:c", { source: "a / b:c" });

        // Unambiguous query using encoded fullKey
        const res1 = await memStorage.findState("a\\:b:c");
        assert.deepStrictEqual(res1?.value, { source: "a:b / c" });
        assert.strictEqual(res1?.fullKey, "a\\:b:c");

        const res2 = await memStorage.findState("a:b\\:c");
        assert.deepStrictEqual(res2?.value, { source: "a / b:c" });
        assert.strictEqual(res2?.fullKey, "a:b\\:c");

        // Ambiguous query with unescaped composite key throws error
        await assert.rejects(memStorage.findState("a:b:c"), /Ambiguous state key 'a:b:c': matches 2 entries/);
        await assert.rejects(memStorage.deleteStateSmart("a:b:c"), /Ambiguous state key 'a:b:c': matches 2 entries for deletion/);

        // Delete unambiguously
        const deleted = await memStorage.deleteStateSmart("a\\:b:c");
        assert.strictEqual(deleted, true);

        // Now only 1 entry remains, so legacy query "a:b:c" resolves without error
        const remaining = await memStorage.findState("a:b:c");
        assert.deepStrictEqual(remaining?.value, { source: "a / b:c" });
      } finally {
        memStorage.close();
      }
    });
  });

  describe("跨进程并发基线", () => {
    it("init 时统一设置 busy_timeout 为 5000ms（与 worker 驱动行为基线一致）", () => {
      const s = new SqliteRuntimeStorage({
        packageId: "test-pkg",
        dbPath: ":memory:",
      });
      try {
        const row = (s as any).driver.prepare("PRAGMA busy_timeout;").get() as {
          timeout?: number;
        } | undefined;
        assert.strictEqual(Number(row?.timeout), 5000);
      } finally {
        s.close();
      }
    });
  });

  describe("Runs", () => {
    it("should record and query execution runs", () => {
      const run1 = {
        id: "run-1",
        packageId: "test-pkg",
        actionId: "act-1",
        status: "running" as const,
        input: { x: 1 },
        startedAt: new Date().toISOString(),
      };

      storage.createRun(run1);
      const fetched = storage.getRun("run-1");
      assert.notStrictEqual(fetched, null);
      assert.strictEqual(fetched?.status, "running");
      assert.deepStrictEqual(fetched?.input, { x: 1 });

      storage.updateRun("run-1", "success", { y: 2 });
      const updated = storage.getRun("run-1");
      assert.strictEqual(updated?.status, "success");
      assert.deepStrictEqual(updated?.output, { y: 2 });
      assert.strictEqual(typeof updated?.durationMs, "number");
      assert.ok(updated!.durationMs! >= 0);

      const list = storage.listRuns();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, "run-1");
    });
  });

  describe("跨进程收割隔离（持有者显式声明，旁观者不动）", () => {
    it("旁观实例打开同一库时 running 记录保持 running，持有者显式开启恢复开关后才收割", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const tempDir = mkdtempSync(join(tmpdir(), "ad-recover-race-test-"));
      const dbPath = join(tempDir, "race-pkg", "runtime.db");

      try {
        // 模拟 serve 持有者进程打开库并写入在途 running 记录
        const owner = new SqliteRuntimeStorage({
          packageId: "race-pkg",
          dbPath,
          recoverOrphans: true,
        });
        const now = new Date().toISOString();
        owner.createRun({
          id: "run-in-flight",
          packageId: "race-pkg",
          actionId: "job",
          status: "running" as const,
          startedAt: now,
        });

        // 旁观查询进程（CLI state/runs/config 类命令）打开同一库文件：缺省不收割
        const observer = new SqliteRuntimeStorage({
          packageId: "race-pkg",
          dbPath,
        });
        assert.strictEqual(observer.isOpen, true);

        // 旁观者打开后，持有者的在途记录仍为 running（未被误收割为 interrupted）
        const observed = observer.getRun("run-in-flight");
        assert.notStrictEqual(observed, null);
        assert.strictEqual(observed?.status, "running");
        await observer.close();

        // 持有者侧终态结算正常写入，不因旁观者打开而丢失
        owner.updateRun("run-in-flight", "success", { done: true });
        const settled = owner.getRun("run-in-flight");
        assert.strictEqual(settled?.status, "success");
        assert.deepStrictEqual(settled?.output, { done: true });
        await owner.close();

        // 显式开启恢复开关的持有者打开后，遗留 running 记录才被收割为 interrupted
        const nextOwner = new SqliteRuntimeStorage({
          packageId: "race-pkg",
          dbPath,
          recoverOrphans: true,
        });
        const nextOwnerRun = nextOwner.createRun({
          id: "run-orphan",
          packageId: "race-pkg",
          actionId: "job",
          status: "running" as const,
          startedAt: new Date().toISOString(),
        });
        assert.strictEqual(nextOwnerRun, undefined); // createRun 无返回值，仅确认不抛错
        await nextOwner.close();

        const reclaimer = new SqliteRuntimeStorage({
          packageId: "race-pkg",
          dbPath,
          recoverOrphans: true,
        });
        const reclaimed = reclaimer.getRun("run-orphan");
        assert.strictEqual(reclaimed?.status, "interrupted");
        assert.strictEqual(reclaimed?.error?.code, "RUN_INTERRUPTED");
        await reclaimer.close();
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    });
  });

  describe("Database Path Security", () => {
    it("严格拦截包含路径遍历与非法字符的 packageId", () => {
      assert.throws(() => resolveDatabasePath("../malicious"));
      assert.throws(() => resolveDatabasePath("../../etc/passwd"));
      assert.throws(() => resolveDatabasePath("pkg/../../../outside"));
      assert.throws(() => resolveDatabasePath("pkg:invalid"));
      assert.throws(() => resolveDatabasePath("pkg$hack"));
      assert.throws(() => resolveDatabasePath(""));
    });

    it("支持合法普通标识符与带 scope 标识符并保持在目标目录下", () => {
      const dataDir = "/tmp/actiondock-test";
      const p1 = resolveDatabasePath("my-pkg", { dataDir });
      assert.strictEqual(p1, resolve(dataDir, "my-pkg", "runtime.db"));

      const p2 = resolveDatabasePath("@my-org/my-pkg", { dataDir });
      assert.strictEqual(p2, resolve(dataDir, "my-org/my-pkg", "runtime.db"));
    });

    it("统一存储路径规则：项目根目录不再改变路径，统一存放于全局数据目录", () => {
      const customHome = "/tmp/actiondock-custom-home";

      // 默认路径
      const p1 = resolveDatabasePath("sample-pkg", { customHome });
      assert.strictEqual(p1, resolve(customHome, ".actiondock", "data", "sample-pkg", "runtime.db"));

      // 即使传入 projectRoot，亦统一返回二进制模式全局数据路径
      const p2 = resolveDatabasePath("sample-pkg", { projectRoot: "/workspace/project", customHome });
      assert.strictEqual(p2, resolve(customHome, ".actiondock", "data", "sample-pkg", "runtime.db"));

      // 带 scope 的包标识符
      const p3 = resolveDatabasePath("@team/my-pkg", { projectRoot: "/workspace/project", customHome });
      assert.strictEqual(p3, resolve(customHome, ".actiondock", "data", "team/my-pkg", "runtime.db"));

      // inMemory 模式始终最高优先级返回 :memory:
      assert.strictEqual(resolveDatabasePath("sample-pkg", { inMemory: true }), ":memory:");
    });
  });

  describe("State Key Single Source of Truth", () => {
    it("shares identical state key codec implementation with @actiondock/sdk", () => {
      assert.strictEqual(coreStorage.encodeStateKey, sdk.encodeStateKey);
      assert.strictEqual(coreStorage.decodeStateKey, sdk.decodeStateKey);
      assert.strictEqual(coreStorage.escapeStateSegment, sdk.escapeStateSegment);
      assert.strictEqual(coreStorage.unescapeStateSegment, sdk.unescapeStateSegment);

      const encoded = coreStorage.encodeStateKey("ns:sub", "k:1");
      assert.strictEqual(encoded, "ns\\:sub:k\\:1");
      assert.deepStrictEqual(coreStorage.decodeStateKey(encoded), { namespace: "ns:sub", key: "k:1" });
    });
  });


  describe("Symlink support in resolveDatabasePath", () => {
    it("allows dataDir or customHome with symlinked ancestor without throwing boundary escape error", async () => {
      const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const tempBase = mkdtempSync(join(tmpdir(), "ad-symlink-storage-test-"));
      try {
        const realTarget = join(tempBase, "openclaw", ".actiondock");
        mkdirSync(realTarget, { recursive: true });

        const fakeHome = join(tempBase, "fakehome");
        mkdirSync(fakeHome, { recursive: true });
        const symlinkHome = join(fakeHome, ".actiondock");
        symlinkSync(realTarget, symlinkHome);

        // Note: data directory does not exist yet!
        const resolved = resolveDatabasePath("my-pkg", { customHome: fakeHome });
        assert.strictEqual(resolved, join(fakeHome, ".actiondock", "data", "my-pkg", "runtime.db"));
      } finally {
        rmSync(tempBase, { recursive: true, force: true });
      }
    });

    it("allows dataDir with double-dot prefix like ..cache without throwing boundary escape error", async () => {
      const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const tempBase = mkdtempSync(join(tmpdir(), "ad-cache-storage-test-"));
      try {
        const cacheDataDir = join(tempBase, "..cache-data");
        mkdirSync(cacheDataDir, { recursive: true });

        const resolved = resolveDatabasePath("my-pkg", { dataDir: cacheDataDir });
        assert.strictEqual(resolved, join(cacheDataDir, "my-pkg", "runtime.db"));
      } finally {
        rmSync(tempBase, { recursive: true, force: true });
      }
    });
  });

  describe("Runs Retention Policy & Filtered Clear", () => {
    it("基于时间策略清理过期终态记录，保留在途记录并遵守 minRetainRuns 保底", async () => {
      const createTestClock = (date: Date) => ({
        now: () => date,
        monotonic: () => date.getTime(),
        sleep: async () => {},
      });
      let currentTime = new Date("2026-06-01T12:00:00.000Z");
      const fakeClock = createTestClock(currentTime);

      const storage = new SqliteRuntimeStorage({
        packageId: "retention-pkg",
        dbPath: ":memory:",
        clock: fakeClock,
      });

      // 插入 5 条旧记录（15 天前）
      const oldTime = new Date("2026-05-15T00:00:00.000Z").toISOString();
      for (let i = 1; i <= 5; i++) {
        storage.createRun({
          id: `run-old-${i}`,
          packageId: "retention-pkg",
          actionId: "act",
          status: "success",
          startedAt: oldTime,
        });
      }

      // 插入 1 条 15 天前但状态为 running 的记录（非终态）
      storage.createRun({
        id: "run-old-running",
        packageId: "retention-pkg",
        actionId: "act",
        status: "running",
        startedAt: oldTime,
      });

      // 插入 2 条新记录（2 天前）
      const newTime = new Date("2026-05-30T00:00:00.000Z").toISOString();
      for (let i = 1; i <= 2; i++) {
        storage.createRun({
          id: `run-new-${i}`,
          packageId: "retention-pkg",
          actionId: "act",
          status: "success",
          startedAt: newTime,
        });
      }

      // 执行基于时间的清理，保留 14 天（14 * 86_400_000），保底保留 2 条
      const cleaned = storage.cleanExpiredRuns({
        maxAgeMs: 14 * 86_400_000,
        maxRuns: 100,
        minRetainRuns: 2,
      });

      assert.strictEqual(cleaned, 5);

      // 旧的 running 记录严禁被删除
      assert.notStrictEqual(storage.getRun("run-old-running"), null);
      // 新记录依然存在
      assert.notStrictEqual(storage.getRun("run-new-1"), null);
      assert.notStrictEqual(storage.getRun("run-new-2"), null);
      // 旧记录已被删除
      assert.strictEqual(storage.getRun("run-old-1"), null);

      await storage.close();
    });

    it("当所有记录均过期时，minRetainRuns 确保保底保留最近的记录", async () => {
      let currentTime = new Date("2026-06-01T12:00:00.000Z");
      const fakeClock = {
        now: () => currentTime,
        monotonic: () => currentTime.getTime(),
        sleep: async () => {},
      };

      const storage = new SqliteRuntimeStorage({
        packageId: "retention-pkg-min",
        dbPath: ":memory:",
        clock: fakeClock,
      });

      // 插入 10 条旧记录（各不同时间）
      for (let i = 1; i <= 10; i++) {
        storage.createRun({
          id: `run-old-${i}`,
          packageId: "retention-pkg-min",
          actionId: "act",
          status: "success",
          startedAt: new Date(new Date("2026-05-01T00:00:00.000Z").getTime() + i * 3600000).toISOString(),
        });
      }

      // 全部 10 条都超过 14 天，但 minRetainRuns=3
      const cleaned = storage.cleanExpiredRuns({
        maxAgeMs: 14 * 86_400_000,
        maxRuns: 100,
        minRetainRuns: 3,
      });

      // 应清理 10 - 3 = 7 条
      assert.strictEqual(cleaned, 7);
      // 最近的 3 条（8, 9, 10）必须保留
      assert.notStrictEqual(storage.getRun("run-old-10"), null);
      assert.notStrictEqual(storage.getRun("run-old-9"), null);
      assert.notStrictEqual(storage.getRun("run-old-8"), null);
      assert.strictEqual(storage.getRun("run-old-7"), null);

      await storage.close();
    });

    it("基于数量策略：当记录总数超过 maxRuns 时按最旧先淘汰", async () => {
      const storage = new SqliteRuntimeStorage({
        packageId: "retention-pkg-count",
        dbPath: ":memory:",
      });

      for (let i = 1; i <= 20; i++) {
        storage.createRun({
          id: `run-seq-${i}`,
          packageId: "retention-pkg-count",
          actionId: "act",
          status: "success",
          startedAt: new Date(1700000000000 + i * 1000).toISOString(),
        });
      }

      // maxRuns=5，不限制时间（maxAgeMs=0）
      const cleaned = storage.cleanExpiredRuns({
        maxAgeMs: 0,
        maxRuns: 5,
        minRetainRuns: 0,
      });

      assert.strictEqual(cleaned, 15);
      // 保留最新的 5 条（16 到 20）
      for (let i = 16; i <= 20; i++) {
        assert.notStrictEqual(storage.getRun(`run-seq-${i}`), null);
      }
      // 前 15 条被删除
      for (let i = 1; i <= 15; i++) {
        assert.strictEqual(storage.getRun(`run-seq-${i}`), null);
      }

      await storage.close();
    });

    it("clearRuns 支持 olderThanMs 和 keep 筛选清理", async () => {
      let currentTime = new Date("2026-06-01T12:00:00.000Z");
      const fakeClock = {
        now: () => currentTime,
        monotonic: () => currentTime.getTime(),
        sleep: async () => {},
      };

      const storage = new SqliteRuntimeStorage({
        packageId: "clear-filter-pkg",
        dbPath: ":memory:",
        clock: fakeClock,
      });

      for (let i = 1; i <= 10; i++) {
        storage.createRun({
          id: `run-f-${i}`,
          packageId: "clear-filter-pkg",
          actionId: "act",
          status: "success",
          startedAt: new Date(new Date("2026-05-20T00:00:00.000Z").getTime() + i * 3600000).toISOString(),
        });
      }

      // 清理超过 7 天（7 * 86_400_000）的数据，但保留最新 2 条
      const cleared = storage.clearRuns({
        olderThanMs: 7 * 86_400_000,
        keep: 2,
      });

      // 10 条均早于 7 天前，keep 2，所以删除了 8 条
      assert.strictEqual(cleared, 8);
      assert.notStrictEqual(storage.getRun("run-f-10"), null);
      assert.notStrictEqual(storage.getRun("run-f-9"), null);
      assert.strictEqual(storage.getRun("run-f-8"), null);

      await storage.close();
    });

    it("支持通过配置 runs.retentionDays 动态解析保留时长", async () => {
      let currentTime = new Date("2026-06-01T12:00:00.000Z");
      const fakeClock = {
        now: () => currentTime,
        monotonic: () => currentTime.getTime(),
        sleep: async () => {},
      };

      const storage = new SqliteRuntimeStorage({
        packageId: "config-retention-pkg",
        dbPath: ":memory:",
        clock: fakeClock,
      });

      storage.setConfig("runs.retentionDays", 5);
      storage.setConfig("runs.maxRuns", 3);
      storage.setConfig("runs.minRetainRuns", 1);

      for (let i = 1; i <= 6; i++) {
        storage.createRun({
          id: `run-c-${i}`,
          packageId: "config-retention-pkg",
          actionId: "act",
          status: "success",
          startedAt: new Date(new Date("2026-05-20T00:00:00.000Z").getTime() + i * 3600000).toISOString(),
        });
      }

      // 不传参数，自动从 config 解析 retentionDays=5, maxRuns=3, minRetainRuns=1
      const cleaned = storage.cleanExpiredRuns();
      assert.strictEqual(cleaned, 5);
      assert.notStrictEqual(storage.getRun("run-c-6"), null);
      assert.strictEqual(storage.getRun("run-c-5"), null);

      await storage.close();
    });
  });
});

