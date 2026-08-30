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

  it("handles environment variables: explicit env, package prefix, snake case, and type coercion", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "team.demo-service",
      dbPath: ":memory:",
    });

    const projectConfig = {
      id: "team.demo-service",
      name: "Demo",
      version: "0.1.0",
      config: {
        apiToken: {
          description: "Custom token",
          env: "CUSTOM_SECRET_TOKEN",
          secret: true,
        },
        timeoutMs: {
          description: "Timeout in ms",
          type: "number" as const,
          env: ["PRIMARY_TIMEOUT", "FALLBACK_TIMEOUT"],
          default: 1000,
        },
        enableDebug: {
          description: "Debug switch",
          type: "boolean" as const,
          default: false,
        },
        clusterConfig: {
          description: "Cluster configuration JSON",
          type: "object" as const,
        },
        namespacedKey: {
          description: "Package-prefixed key",
        },
        snakeKey: {
          description: "Snake case auto key",
        },
      },
    };

    // Inject various environment variables
    process.env.CUSTOM_SECRET_TOKEN = "token_xyz_123";
    process.env.PRIMARY_TIMEOUT = "5500";
    process.env.ENABLE_DEBUG = "true";
    process.env.CLUSTER_CONFIG = '{"region": "us-west-1", "nodes": 3}';
    process.env.ACTIONDOCK_TEAM_DEMO_SERVICE_NAMESPACED_KEY = "namespaced_val";
    process.env.SNAKE_KEY = "snake_cased_val";

    try {
      const action = defineAction({
        id: "demo.env-test",
        run(_input, ctx) {
          return {
            token: ctx.config.get("apiToken"),
            timeout: ctx.config.get("timeoutMs"),
            debug: ctx.config.get("enableDebug"),
            cluster: ctx.config.get("clusterConfig"),
            namespaced: ctx.config.get("namespacedKey"),
            snake: ctx.config.get("snakeKey"),
          };
        },
      });

      const runner = new ActionRunner({
        packageId: "team.demo-service",
        storage,
        projectConfig,
        actions: new Map([[action.id, action]]),
      });

      const res = await runner.execute(action, {});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({
          token: "token_xyz_123",
          timeout: 5500, // Coerced to number
          debug: true, // Coerced to boolean
          cluster: { region: "us-west-1", nodes: 3 }, // Coerced to object
          namespaced: "namespaced_val",
          snake: "snake_cased_val",
        });
      }
    } finally {
      delete process.env.CUSTOM_SECRET_TOKEN;
      delete process.env.PRIMARY_TIMEOUT;
      delete process.env.ENABLE_DEBUG;
      delete process.env.CLUSTER_CONFIG;
      delete process.env.ACTIONDOCK_TEAM_DEMO_SERVICE_NAMESPACED_KEY;
      delete process.env.SNAKE_KEY;
    }
  });

  it("strictly respects 5-tier config precedence: override > storage > env > default > fallback", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "tier-pkg",
      dbPath: ":memory:",
    });

    // Tier 2: Storage has TIER_STORAGE and TIER_ENV
    storage.setConfig("KEY_STORAGE", "val_storage");
    storage.setConfig("KEY_STORAGE_VS_ENV", "val_storage_wins");

    // Tier 4: Default in actiondock.json
    const projectConfig = {
      id: "tier-pkg",
      name: "Tier",
      version: "0.1.0",
      config: {
        KEY_OVERRIDE: { default: "def" },
        KEY_STORAGE: { default: "def" },
        KEY_STORAGE_VS_ENV: { default: "def" },
        KEY_ENV: { default: "def" },
        KEY_DEFAULT: { default: "val_default" },
      },
    };

    // Tier 3: Environment variables
    process.env.KEY_STORAGE_VS_ENV = "val_env_loses";
    process.env.KEY_ENV = "val_env";

    try {
      const action = defineAction({
        id: "tier.check",
        run(_input, ctx) {
          return {
            override: ctx.config.get("KEY_OVERRIDE"),
            storage: ctx.config.get("KEY_STORAGE"),
            storageVsEnv: ctx.config.get("KEY_STORAGE_VS_ENV"),
            env: ctx.config.get("KEY_ENV"),
            default: ctx.config.get("KEY_DEFAULT"),
            fallback: ctx.config.get("KEY_NONE", "val_fallback"),
          };
        },
      });

      const runner = new ActionRunner({
        packageId: "tier-pkg",
        storage,
        projectConfig,
        configOverrides: {
          KEY_OVERRIDE: "val_override",
        },
        actions: new Map([[action.id, action]]),
      });

      const res = await runner.execute(action, {});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({
          override: "val_override",
          storage: "val_storage",
          storageVsEnv: "val_storage_wins",
          env: "val_env",
          default: "val_default",
          fallback: "val_fallback",
        });
      }
    } finally {
      delete process.env.KEY_STORAGE_VS_ENV;
      delete process.env.KEY_ENV;
    }
  });
});
