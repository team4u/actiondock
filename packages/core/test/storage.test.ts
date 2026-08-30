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
