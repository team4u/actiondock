import { describe, expect, it } from "bun:test";
import { type ActionDefinition, defineAction } from "@actiondock/sdk";
import { ActionRunner } from "../src/runtime/runner";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("ActionRunner", () => {
  it("executes an action successfully and validates schema", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const addAction = defineAction({
      id: "math.add",
      description: "Add two numbers",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sum: { type: "number" },
        },
        required: ["sum"],
      },
      run(input: { a: number; b: number }) {
        return { sum: input.a + input.b };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      actions: new Map([[addAction.id, addAction]]),
    });

    const res = await runner.execute(addAction, { a: 10, b: 20 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ sum: 30 });
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].output).toEqual({ sum: 30 });
  });

  it("handles input validation failures gracefully", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const strictAction = defineAction({
      id: "test.strict",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string" },
        },
        required: ["email"],
      },
      run(input: any) {
        return { ok: true };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      actions: new Map([[strictAction.id, strictAction]]),
    });

    const res = await runner.execute(strictAction, { wrong: "field" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INPUT_VALIDATION_FAILED");
      expect(res.error.details).toBeDefined();
    }
  });

  it("handles config priority: override > storage > project default", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });
    storage.setConfig("ENDPOINT", "http://stored.internal");
    storage.setConfig("STORED_ONLY", "from-storage");

    const projectConfig = {
      id: "test-pkg",
      name: "Test",
      version: "0.1.0",
      config: {
        ENDPOINT: { default: "http://default.internal" },
        DEFAULT_ONLY: { default: "from-default" },
      },
    };

    const action = defineAction({
      id: "test.config",
      run(_input, ctx) {
        return {
          endpoint: ctx.config.get("ENDPOINT"),
          stored: ctx.config.get("STORED_ONLY"),
          default: ctx.config.get("DEFAULT_ONLY"),
          override: ctx.config.get("OVERRIDE_ONLY"),
        };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      projectConfig,
      configOverrides: {
        ENDPOINT: "http://override.internal",
        OVERRIDE_ONLY: "from-override",
      },
      actions: new Map([[action.id, action]]),
    });

    const res = await runner.execute(action, {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({
        endpoint: "http://override.internal",
        stored: "from-storage",
        default: "from-default",
        override: "from-override",
      });
    }
  });

  it("handles nested action invocation and cycle detection", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const step1 = defineAction({
      id: "chain.step1",
      run: (input: { n: number }) => input.n * 2,
    });

    const step2 = defineAction({
      id: "chain.step2",
      async run(input: { n: number }, ctx) {
        const doubled = await ctx.actions.invoke(step1, { n: input.n });
        return { final: doubled + 10 };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        [step1.id, step1],
        [step2.id, step2],
      ]),
    });

    const res = await runner.execute(step2, { n: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ final: 20 });
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(2);
  });
});
