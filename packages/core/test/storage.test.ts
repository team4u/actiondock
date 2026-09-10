import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import * as sdk from "@actiondock/sdk";
import * as coreStorage from "../src/storage";
import { resolveDatabasePath } from "../src/storage";
import { createDefaultSqliteDriver } from "../src/storage/driver";
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
      expect(storage.getConfig("API_KEY")).toBeUndefined();

      storage.setConfig("API_KEY", "secret-123");
      expect(storage.getConfig<string>("API_KEY")).toBe("secret-123");

      storage.setConfig("PORT", 8080);
      expect(storage.getConfig<number>("PORT")).toBe(8080);

      storage.setConfig("FLAGS", { enabled: true, debug: false });
      expect(storage.getConfig<{ enabled: boolean; debug: boolean }>("FLAGS")).toEqual({ enabled: true, debug: false });

      const all = storage.listConfig();
      expect(all).toEqual({
        API_KEY: "secret-123",
        PORT: 8080,
        FLAGS: { enabled: true, debug: false },
      });

      const deleted = storage.deleteConfig("API_KEY");
      expect(deleted).toBe(true);
      expect(storage.getConfig("API_KEY")).toBeUndefined();
    });
  });

  describe("State", () => {
    it("should set, get, list, and delete state values with namespaces", async () => {
      expect(await storage.getState("", "cursor")).toBeUndefined();

      await storage.setState("", "cursor", "001");
      expect(await storage.getState<string>("", "cursor")).toBe("001");

      await storage.setState("ns1", "counter", 42);
      expect(await storage.getState<number>("ns1", "counter")).toBe(42);

      const rootKeys = await storage.listStateKeys("");
      expect(rootKeys).toEqual(["cursor"]);

      const nsKeys = await storage.listStateKeys("ns1");
      expect(nsKeys).toEqual(["counter"]);

      // Global scan (namespace = null/undefined)
      const allKeys = await storage.listStateKeys();
      expect(allKeys).toEqual(["cursor", "ns1:counter"]);

      // Smart find
      const foundRoot = await storage.findState("cursor");
      expect(foundRoot?.value).toBe("001");
      expect(foundRoot?.namespace).toBe("");

      const foundComposite = await storage.findState("ns1:counter");
      expect(foundComposite?.value).toBe(42);
      expect(foundComposite?.namespace).toBe("ns1");
      expect(foundComposite?.key).toBe("counter");

      // Smart delete with boolean check
      const deletedRoot = await storage.deleteState("", "cursor");
      expect(deletedRoot).toBe(true);
      expect(await storage.getState("", "cursor")).toBeUndefined();

      const notFoundDeleted = await storage.deleteState("", "cursor");
      expect(notFoundDeleted).toBe(false);

      // Smart delete by composite key
      const deletedComposite = await storage.deleteStateSmart("ns1:counter");
      expect(deletedComposite).toBe(true);
      expect(await storage.getState("ns1", "counter")).toBeUndefined();

      const notFoundSmart = await storage.deleteStateSmart("ns1:counter");
      expect(notFoundSmart).toBe(false);
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
      expect(val1).toEqual({ name: "Bob" });

      // findState 支持多层冒号全名查找
      const found = await storage.findState("app:sub:config");
      expect(found).toBeDefined();
      expect(found?.namespace).toBe("app:sub");
      expect(found?.key).toBe("config");
      expect(found?.value).toBe("nested-value");

      // deleteStateSmart 依据多层冒号全名删除
      const deleted = await storage.deleteStateSmart("app:sub:config");
      expect(deleted).toBe(true);
      expect(await storage.getState("app:sub", "config")).toBeUndefined();

      // 验证未被误删的嵌套条目
      expect(await storage.getState<{ name: string }>("app:sub:cache", "user:123")).toEqual({ name: "Bob" });
      const del2 = await storage.deleteStateSmart("app:sub:cache:user:123");
      expect(del2).toBe(true);
      expect(await storage.getState("app:sub:cache", "user:123")).toBeUndefined();
    });

    it("should clear state by namespace, prefix, or all", async () => {
      await storage.setState("", "k1", "v1");
      await storage.setState("", "k2", "v2");
      await storage.setState("auth", "token", "abc");
      await storage.setState("auth", "session", "123");
      await storage.setState("cache", "item1", "foo");

      expect((await storage.listStateKeys()).length).toBe(5);

      // Clear by namespace
      const clearedAuth = await storage.clearState({ namespace: "auth" });
      expect(clearedAuth).toBe(2);
      expect(await storage.listStateKeys("auth")).toEqual([]);
      expect(await storage.getState("auth", "token")).toBeUndefined();

      // Clear all
      const clearedAll = await storage.clearState({ all: true });
      expect(clearedAll).toBe(3); // k1, k2, cache:item1
      expect(await storage.listStateKeys()).toEqual([]);
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
        expect(await ttlStorage.getState<string>("", "temp1")).toBe("val1");

        // 2. TTL in namespace
        await ttlStorage.setState("ns1", "temp2", { a: 1 }, 10);
        expect(await ttlStorage.getState<{ a: number }>("ns1", "temp2")).toEqual({ a: 1 });

        // 3. Permanent key
        await ttlStorage.setState("", "perm", "stay");

        expect((await ttlStorage.listStateKeys("")).sort()).toEqual(["perm", "temp1"]);
        expect(await ttlStorage.listStateKeys("ns1")).toEqual(["temp2"]);

        // Advance clock by 11 seconds (11000ms)
        currentTime += 11000;

        expect(await ttlStorage.getState("", "temp1")).toBeUndefined();
        expect(await ttlStorage.getState("ns1", "temp2")).toBeUndefined();
        expect(await ttlStorage.getState<string>("", "perm")).toBe("stay");

        expect(await ttlStorage.listStateKeys("")).toEqual(["perm"]);
        expect(await ttlStorage.listStateKeys("ns1")).toEqual([]);
      } finally {
        ttlStorage.close();
      }
    });

    it("打开旧版本（例如版本 1）Schema 数据库时直接抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动", () => {
      const tempDbPath = `/tmp/test-old-version-${Date.now()}.db`;

      // 创建版本 1 旧结构数据库
      const rawDb = createDefaultSqliteDriver(tempDbPath);
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
      expect(() => {
        new SqliteRuntimeStorage({
          packageId: "old-pkg",
          dbPath: tempDbPath,
        });
      }).toThrow(/UNSUPPORTED_STORAGE_SCHEMA/);

      // 验证原数据库未被修改且保留原版本号
      const checkDb = createDefaultSqliteDriver(tempDbPath);
      const row = checkDb.prepare("PRAGMA user_version;").get() as any;
      expect(row.user_version).toBe(1);
      checkDb.close();

      try {
        unlinkSync(tempDbPath);
      } catch {}
    });

    it("打开未来不兼容版本 Schema 数据库时抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动", () => {
      const tempDbPath = `/tmp/test-incompatible-${Date.now()}.db`;

      // 手动创建未来不兼容版本数据库
      const rawDb = createDefaultSqliteDriver(tempDbPath);
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
      expect(() => {
        new SqliteRuntimeStorage({
          packageId: "incompatible-pkg",
          dbPath: tempDbPath,
        });
      }).toThrow(/UNSUPPORTED_STORAGE_SCHEMA/);

      // 验证原数据库文件与 user_version 保持未修改
      const checkDb = createDefaultSqliteDriver(tempDbPath);
      const row = checkDb.prepare("PRAGMA user_version;").get() as any;
      expect(row.user_version).toBe(999);
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
        expect(encodeStateKey("a:b", "c")).toBe("a\\:b:c");
        expect(encodeStateKey("a", "b:c")).toBe("a:b\\:c");
        expect(decodeStateKey("a\\:b:c")).toEqual({ namespace: "a:b", key: "c" });
        expect(decodeStateKey("a:b\\:c")).toEqual({ namespace: "a", key: "b:c" });
        expect(() => decodeStateKey("a:b:c")).toThrow("Ambiguous state key");

        // Insert conflicting rows: namespace "a:b", key "c" and namespace "a", key "b:c"
        await memStorage.setState("a:b", "c", { source: "a:b / c" });
        await memStorage.setState("a", "b:c", { source: "a / b:c" });

        // Unambiguous query using encoded fullKey
        const res1 = await memStorage.findState("a\\:b:c");
        expect(res1?.value).toEqual({ source: "a:b / c" });
        expect(res1?.fullKey).toBe("a\\:b:c");

        const res2 = await memStorage.findState("a:b\\:c");
        expect(res2?.value).toEqual({ source: "a / b:c" });
        expect(res2?.fullKey).toBe("a:b\\:c");

        // Ambiguous query with unescaped composite key throws error
        await expect(memStorage.findState("a:b:c")).rejects.toThrow("Ambiguous state key 'a:b:c': matches 2 entries");
        await expect(memStorage.deleteStateSmart("a:b:c")).rejects.toThrow("Ambiguous state key 'a:b:c': matches 2 entries for deletion");

        // Delete unambiguously
        const deleted = await memStorage.deleteStateSmart("a\\:b:c");
        expect(deleted).toBe(true);

        // Now only 1 entry remains, so legacy query "a:b:c" resolves without error
        const remaining = await memStorage.findState("a:b:c");
        expect(remaining?.value).toEqual({ source: "a / b:c" });
      } finally {
        memStorage.close();
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
      expect(fetched).not.toBeNull();
      expect(fetched?.status).toBe("running");
      expect(fetched?.input).toEqual({ x: 1 });

      storage.updateRun("run-1", "success", { y: 2 });
      const updated = storage.getRun("run-1");
      expect(updated?.status).toBe("success");
      expect(updated?.output).toEqual({ y: 2 });
      expect(typeof updated?.durationMs).toBe("number");
      expect(updated?.durationMs).toBeGreaterThanOrEqual(0);

      const list = storage.listRuns();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("run-1");
    });
  });

  describe("Database Path Security", () => {
    it("严格拦截包含路径遍历与非法字符的 packageId", () => {
      expect(() => resolveDatabasePath("../malicious")).toThrow();
      expect(() => resolveDatabasePath("../../etc/passwd")).toThrow();
      expect(() => resolveDatabasePath("pkg/../../../outside")).toThrow();
      expect(() => resolveDatabasePath("pkg:invalid")).toThrow();
      expect(() => resolveDatabasePath("pkg$hack")).toThrow();
      expect(() => resolveDatabasePath("")).toThrow();
    });

    it("支持合法普通标识符与带 scope 标识符并保持在目标目录下", () => {
      const dataDir = "/tmp/actiondock-test";
      const p1 = resolveDatabasePath("my-pkg", { dataDir });
      expect(p1).toBe(join(dataDir, "my-pkg", "runtime.db"));

      const p2 = resolveDatabasePath("@my-org/my-pkg", { dataDir });
      expect(p2).toBe(join(dataDir, "my-org/my-pkg", "runtime.db"));
    });

    it("统一存储路径规则：项目根目录不再改变路径，统一存放于全局数据目录", () => {
      const customHome = "/tmp/actiondock-custom-home";

      // 默认路径
      const p1 = resolveDatabasePath("sample-pkg", { customHome });
      expect(p1).toBe(join(customHome, ".actiondock", "data", "sample-pkg", "runtime.db"));

      // 即使传入 projectRoot，亦统一返回二进制模式全局数据路径
      const p2 = resolveDatabasePath("sample-pkg", { projectRoot: "/workspace/project", customHome });
      expect(p2).toBe(join(customHome, ".actiondock", "data", "sample-pkg", "runtime.db"));

      // 带 scope 的包标识符
      const p3 = resolveDatabasePath("@team/my-pkg", { projectRoot: "/workspace/project", customHome });
      expect(p3).toBe(join(customHome, ".actiondock", "data", "team/my-pkg", "runtime.db"));

      // inMemory 模式始终最高优先级返回 :memory:
      expect(resolveDatabasePath("sample-pkg", { inMemory: true })).toBe(":memory:");
    });
  });

  describe("State Key Single Source of Truth", () => {
    it("shares identical state key codec implementation with @actiondock/sdk", () => {
      expect(coreStorage.encodeStateKey).toBe(sdk.encodeStateKey);
      expect(coreStorage.decodeStateKey).toBe(sdk.decodeStateKey);
      expect(coreStorage.escapeStateSegment).toBe(sdk.escapeStateSegment);
      expect(coreStorage.unescapeStateSegment).toBe(sdk.unescapeStateSegment);

      const encoded = coreStorage.encodeStateKey("ns:sub", "k:1");
      expect(encoded).toBe("ns\\:sub:k\\:1");
      expect(coreStorage.decodeStateKey(encoded)).toEqual({ namespace: "ns:sub", key: "k:1" });
    });
  });
});

