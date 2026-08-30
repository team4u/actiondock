import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("SqliteRuntimeStorage", () => {
  let storage: SqliteRuntimeStorage;

  beforeEach(() => {
    storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });
  });

  afterEach(() => {
    storage.close();
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

      await storage.deleteState("", "cursor");
      expect(await storage.getState("", "cursor")).toBeUndefined();
    });

    it("should expire state keys based on TTL", async () => {
      // 1. TTL in seconds (0.05s = 50ms)
      await storage.setState("", "temp1", "val1", 0.05);
      expect(await storage.getState<string>("", "temp1")).toBe("val1");

      // 2. TTL in namespace
      await storage.setState("ns1", "temp2", { a: 1 }, 0.05);
      expect(await storage.getState<{ a: number }>("ns1", "temp2")).toEqual({ a: 1 });

      // 3. Permanent key
      await storage.setState("", "perm", "stay");

      expect((await storage.listStateKeys("")).sort()).toEqual(["perm", "temp1"]);
      expect(await storage.listStateKeys("ns1")).toEqual(["temp2"]);

      // Wait 70ms for expiration
      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(await storage.getState("", "temp1")).toBeUndefined();
      expect(await storage.getState("ns1", "temp2")).toBeUndefined();
      expect(await storage.getState<string>("", "perm")).toBe("stay");

      expect(await storage.listStateKeys("")).toEqual(["perm"]);
      expect(await storage.listStateKeys("ns1")).toEqual([]);
    });

    it("should migrate database from version 1 schema and support expires_at", () => {
      const { Database } = require("bun:sqlite");
      const tempDbPath = `/tmp/test-migration-${Date.now()}.db`;
      
      // Manually create v1 schema
      const rawDb = new Database(tempDbPath);
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS config (
          package_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (package_id, key)
        );
        CREATE TABLE IF NOT EXISTS state (
          package_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (package_id, namespace, key)
        );
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          package_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          parent_run_id TEXT,
          status TEXT NOT NULL,
          input_json TEXT,
          output_json TEXT,
          error_json TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );
        PRAGMA user_version = 1;
      `);
      rawDb.close();

      // Open with SqliteRuntimeStorage (should trigger migration to v2)
      const migratedStorage = new SqliteRuntimeStorage({
        packageId: "migrated-pkg",
        dbPath: tempDbPath,
      });

      // Verify setting and getting state with TTL works after migration
      migratedStorage.setState("", "migrated-key", "ok", 100);
      expect(migratedStorage.getState("", "migrated-key")).resolves.toBe("ok");

      migratedStorage.close();
      try {
        unlinkSync(tempDbPath);
      } catch {}
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

      const list = storage.listRuns();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("run-1");
    });
  });
});
