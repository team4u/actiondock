import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionDefinition, defineAction } from "@actiondock/sdk";
import { ActionResolver } from "../src/catalog/action-resolver";
import { DefaultExecutionService } from "../src/execution/service";
import { initProject } from "../src/project/init";
import { linkPackage } from "../src/registry/registry";
import { ActionRunner } from "../src/runtime/runner";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("ActionRunner", () => {
  it("executes an action successfully and validates schema", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const addAction = defineAction({
      run(input: { a: number; b: number }) {
        return { sum: input.a + input.b };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      projectConfig: {
        id: "test-pkg",
        actions: {
          "math.add": {
            entry: "",
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
          },
        },
      },
      actions: new Map([["math.add", addAction]]),
    });

    const res = await runner.execute("math.add", { a: 10, b: 20 });
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
      run(input: any) {
        return { ok: true };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      projectConfig: {
        id: "test-pkg",
        actions: {
          "test.strict": {
            entry: "",
            inputSchema: {
              type: "object",
              properties: {
                email: { type: "string" },
              },
              required: ["email"],
            },
          },
        },
      },
      actions: new Map([["test.strict", strictAction]]),
    });

    const res = await runner.execute("test.strict", { wrong: "field" });
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
      actions: new Map([["test.config", action]]),
    });

    const res = await runner.execute("test.config", {});
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
      run: (input: { n: number }) => input.n * 2,
    });

    const step2 = defineAction({
      async run(input: { n: number }, ctx) {
        const doubled = (await ctx.actions.invoke("chain.step1", { n: input.n })) as number;
        return { final: doubled + 10 };
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        ["chain.step1", step1],
        ["chain.step2", step2],
      ]),
    });

    const res = await runner.execute("chain.step2", { n: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ final: 20 });
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(2);
  });

  it("handles action invocation by string ID, ActionRef, and dynamic actionResolver", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "local-pkg",
      dbPath: ":memory:",
    });

    const localStep = defineAction({
      run: (input: { x: number }) => input.x * 2,
    });

    const extAction = defineAction({
      run: (input: { name: string }) => `Hello, ${input.name}!`,
    });

    const orchestrator = defineAction({
      async run(input: { val: number }, ctx) {
        // 1. 调用本地动作（通过字符串 ID）
        const calcRes = await ctx.actions.invoke<any, number>("local.calc", { x: input.val });
        // 2. 调用本地动作（通过 ActionRef）
        const refRes = await ctx.actions.invoke<any, number>({ actionId: "local.calc" }, { x: calcRes });
        // 3. 跨包显式调用外部动作（通过 package/action 字符串）
        const extRes = await ctx.actions.invoke<any, string>("ext-pkg/greet", { name: "ActionDock" });
        return { calcRes, refRes, extRes };
      },
    });

    const runner = new ActionRunner({
      packageId: "local-pkg",
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        ["local.calc", localStep],
        ["orchestrator", orchestrator],
      ]),
      actionResolver: async (ref) => {
        const id = typeof ref === "string" ? ref : ref.actionId;
        if (id === "ext-pkg/greet" || id === "greet") {
          return extAction;
        }
        return undefined;
      },
    });

    const res = await runner.execute("orchestrator", { val: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({
        calcRes: 10,
        refRes: 20,
        extRes: "Hello, ActionDock!",
      });
    }
  });

  it("handles cross-package same-name action invocation without hijacking or false cycle detection", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "local-pkg",
      dbPath: ":memory:",
    });

    const localCalc = defineAction({
      run: (input: { x: number }) => input.x + 1,
    });

    const extCalc = defineAction({
      run: (input: { x: number }) => input.x * 10,
    });

    const caller = defineAction({
      async run(input: { x: number }, ctx) {
        // 1. 调用本地动作
        const local = await ctx.actions.invoke<any, number>("calc", { x: input.x });
        // 2. 跨包调用同名外部动作（字符串限定标识符），严禁被本地动作截断抢占
        const extStr = await ctx.actions.invoke<any, number>("ext-pkg/calc", { x: input.x });
        // 3. 跨包调用同名外部动作（结构化 ActionRef 对象）
        const extRef = await ctx.actions.invoke<any, number>({ packageId: "ext-pkg", actionId: "calc" }, { x: input.x });
        return { local, extStr, extRef };
      },
    });

    const runner = new ActionRunner({
      packageId: "local-pkg",
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        ["calc", localCalc],
        ["caller", caller],
      ]),
      actionResolver: async (ref) => {
        const id = typeof ref === "string" ? ref : `${ref.packageId}/${ref.actionId}`;
        if (id === "ext-pkg/calc") {
          return extCalc;
        }
        return undefined;
      },
    });

    const res = await runner.execute("caller", { x: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({
        local: 6,
        extStr: 50,
        extRef: 50,
      });
    }
  });

  it("resolves scoped package action references (@scope/pkg/action)", () => {
    const parsed = ActionResolver.parseRef("@team/tools/add");
    expect(parsed.packageId).toBe("@team/tools");
    expect(parsed.actionId).toBe("add");
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
        actions: new Map([["demo.env-test", action]]),
      });

      const res = await runner.execute("demo.env-test", {});
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

  it("handles scoped package environment variables and double underscore conventions", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "@scope/my-service",
      dbPath: ":memory:",
    });

    const projectConfig = {
      id: "@scope/my-service",
      name: "My Service",
      version: "0.1.0",
      config: {
        apiKey: { description: "API Key" },
        dbHost: { description: "DB Host" },
        slugKey: { description: "Slug prefixed key" },
      },
    };

    // 1. ACTIONDOCK_<CLEAN_PKG>_<KEY> (stripping @ and replacing / with _)
    process.env.ACTIONDOCK_SCOPE_MY_SERVICE_API_KEY = "scope_key_val";
    // 2. <CLEAN_PKG>__<KEY> (double underscore notation)
    process.env.SCOPE_MY_SERVICE__DB_HOST = "db.internal";
    // 3. Slug prefix: <SLUG>__<KEY>
    process.env.MY_SERVICE__SLUG_KEY = "slug_val";

    try {
      const action = defineAction({
        run(_input, ctx) {
          return {
            apiKey: ctx.config.get("apiKey"),
            dbHost: ctx.config.get("dbHost"),
            slugKey: ctx.config.get("slugKey"),
          };
        },
      });

      const runner = new ActionRunner({
        packageId: "@scope/my-service",
        storage,
        projectConfig,
        actions: new Map([["env-test", action]]),
      });

      const res = await runner.execute("env-test", {});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({
          apiKey: "scope_key_val",
          dbHost: "db.internal",
          slugKey: "slug_val",
        });
      }
    } finally {
      delete process.env.ACTIONDOCK_SCOPE_MY_SERVICE_API_KEY;
      delete process.env.SCOPE_MY_SERVICE__DB_HOST;
      delete process.env.MY_SERVICE__SLUG_KEY;
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
        actions: new Map([["tier.check", action]]),
      });

      const res = await runner.execute("tier.check", {});
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

  it("handles timeout correctly and finalizes run with ACTION_TIMEOUT", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const sleepAction = defineAction({
      async run(_input, ctx) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ done: true }), 1000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      actions: new Map([["test.sleep", sleepAction]]),
    });

    const result = await runner.execute("test.sleep", {}, { timeoutMs: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TIMEOUT");
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("timed_out");
    expect(runs[0].error?.code).toBe("ACTION_TIMEOUT");
  });

  it("handles ExecutionHandle.cancel and ExecutionManager correctly", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const cancellableAction = defineAction({
      async run(_input, ctx) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ completed: true }), 2000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted by signal"));
          });
        });
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      actions: new Map([["test.cancellable", cancellableAction]]),
    });

    const handle = runner.start("test.cancellable", {});
    expect(handle.runId).toBeDefined();

    // Cancel execution after 30ms
    setTimeout(() => {
      handle.cancel("user requested cancel");
    }, 30);

    const result = await handle.result;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_CANCELLED");
      expect(result.error.details).toEqual({ reason: "user requested cancel" });
    }

    const runRecord = storage.getRun(handle.runId);
    expect(runRecord).toBeDefined();
    expect(runRecord?.status).toBe("cancelled");
    expect(runRecord?.error?.code).toBe("ACTION_CANCELLED");
  });

  it("DefaultExecutionService correctly passes progressReporter and captures logs as events", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const progressAndLogAction = defineAction({
      async run(_input, ctx) {
        ctx.log.info("Starting task", { step: 1 });
        ctx.progress.report(50, 100, "halfway done");
        ctx.log.warn("Caution on step 2");
        ctx.progress.report(100, 100, "all done");
        return { done: true };
      },
    });

    const emittedEvents: any[] = [];
    const eventSink = {
      emit(event: any) {
        emittedEvents.push(event);
      },
      subscribe() {
        return { [Symbol.asyncIterator]: async function* () {} };
      },
    };

    const service = new DefaultExecutionService({
      packageId: "test-pkg",
      storage,
      eventSink: eventSink as any,
    });
    service.registerAction("test.progress-log", progressAndLogAction);

    const result = await service.execute({ actionId: "test.progress-log" }, {});
    expect(result.ok).toBe(true);

    const logEvents = emittedEvents.filter((e) => e.type === "log");
    expect(logEvents.length).toBe(2);
    expect(logEvents[0].level).toBe("info");
    expect(logEvents[0].message).toBe("Starting task");
    expect(logEvents[0].data).toEqual({ step: 1 });
    expect(logEvents[1].level).toBe("warn");
    expect(logEvents[1].message).toBe("Caution on step 2");

    const progressEvents = emittedEvents.filter((e) => e.type === "progress");
    expect(progressEvents.length).toBe(2);
    expect(progressEvents[0].current).toBe(50);
    expect(progressEvents[0].total).toBe(100);
    expect(progressEvents[0].message).toBe("halfway done");
    expect(progressEvents[1].current).toBe(100);
  });

  it("persists runs in storage even when validation, cycle, or max depth fails", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const schemaAction = defineAction({
      run() {
        return "ok";
      },
    });

    const runner = new ActionRunner({
      packageId: "test-pkg",
      storage,
      projectConfig: {
        id: "test-pkg",
        actions: {
          "test.schema-action": {
            entry: "",
            inputSchema: {
              type: "object",
              required: ["username"],
              properties: { username: { type: "string" } },
            },
          },
        },
      },
      actions: new Map([["test.schema-action", schemaAction]]),
      maxCallDepth: 3,
    });

    // 1. Validation failure should be persisted
    const valResult = await runner.execute("test.schema-action", { username: 123 as any });
    expect(valResult.ok).toBe(false);
    const valRun = storage.getRun(valResult.runId);
    expect(valRun).toBeDefined();
    expect(valRun?.status).toBe("failed");
    expect(valRun?.error?.code).toBe("INPUT_VALIDATION_FAILED");

    // 2. Cycle detection failure should be persisted
    const cycleAction = defineAction({
      async run(_, ctx) {
        return ctx.actions.invoke("test.cycle-action");
      },
    });
    runner.registerAction("test.cycle-action", cycleAction);

    const cycleResult = await runner.execute("test.cycle-action", {});
    expect(cycleResult.ok).toBe(false);
    const runs = storage.listRuns();
    const cycleRun = runs.find((r) => r.error?.code === "ACTION_CALL_CYCLE" || r.error?.code === "ACTION_CYCLE_DETECTED");
    expect(cycleRun).toBeDefined();
    expect(cycleRun?.status).toBe("failed");

    // 3. Max call depth failure should be persisted
    const recursiveActionA = defineAction({
      async run(_, ctx) {
        return ctx.actions.invoke("test.rec-b");
      },
    });
    const recursiveActionB = defineAction({
      async run(_, ctx) {
        return ctx.actions.invoke("test.rec-c");
      },
    });
    const recursiveActionC = defineAction({
      async run(_, ctx) {
        return ctx.actions.invoke("test.rec-d");
      },
    });
    const recursiveActionD = defineAction({
      async run() {
        return "done";
      },
    });

    runner.registerAction("test.rec-a", recursiveActionA);
    runner.registerAction("test.rec-b", recursiveActionB);
    runner.registerAction("test.rec-c", recursiveActionC);
    runner.registerAction("test.rec-d", recursiveActionD);

    const depthResult = await runner.execute("test.rec-a", {}, { maxCallDepth: 3 });
    expect(depthResult.ok).toBe(false);
    const depthRun = storage.listRuns().find((r) => r.error?.code === "ACTION_CALL_CYCLE" || r.error?.code === "ACTION_MAX_DEPTH_EXCEEDED");
    expect(depthRun).toBeDefined();
    expect(depthRun?.status).toBe("failed");
  });

  it("handles cross-package execution switching to target package storage and context", async () => {
    const pkgAStorage = new SqliteRuntimeStorage({
      packageId: "pkg-a",
      dbPath: ":memory:",
    });
    const pkgBStorage = new SqliteRuntimeStorage({
      packageId: "pkg-b",
      dbPath: ":memory:",
    });

    // pkg-b has an action that writes to its state and reads its config
    const pkgBAction = defineAction({
      async run(input: any, ctx) {
        await ctx.state.set("from_worker", "worker_val");
        const greeting = ctx.config.get("greeting", "default_greet");
        return { greeting, echoed: input };
      },
    });


    // pkg-a has a caller action that invokes pkg-b/b.worker
    const pkgAAction = defineAction({
      async run(input: any, ctx) {
        return ctx.actions.invoke({ packageId: "pkg-b", actionId: "b.worker" }, input);
      },
    });

    const pkgARunner = new ActionRunner({
      packageId: "pkg-a",
      storage: pkgAStorage,
      actions: new Map([["a.caller", pkgAAction]]),
      packageContextResolver: async (packageId) => {
        if (packageId === "pkg-b") {
          return {
            storage: pkgBStorage,
            projectConfig: {
              id: "pkg-b",
              name: "Package B",
              version: "1.0.0",
              config: { greeting: { default: "hello from B" } },
            },
            actions: new Map([["b.worker", pkgBAction]]),
          };
        }
        return undefined;
      },
    });

    const result = await pkgARunner.execute("a.caller", { foo: "bar" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ greeting: "hello from B", echoed: { foo: "bar" } });
    }

    // Verify pkg-b storage has the child run!
    const pkgBRuns = pkgBStorage.listRuns();
    expect(pkgBRuns.length).toBe(1);
    expect(pkgBRuns[0].packageId).toBe("pkg-b");
    expect(pkgBRuns[0].actionId).toBe("b.worker");
    expect(pkgBRuns[0].status).toBe("success");

    // Verify pkg-b state was written in pkg-b storage!
    const stateVal = await pkgBStorage.getState("", "from_worker");
    expect(stateVal).toBe("worker_val");
  });

  it("handles unregistered or unresolvable cross-package invocation with clear error", async () => {
    const pkgStorage = new SqliteRuntimeStorage({
      packageId: "pkg-caller",
      dbPath: ":memory:",
    });

    const callerAction = defineAction({
      async run(input: any, ctx) {
        return ctx.actions.invoke({ packageId: "unregistered-remote-pkg", actionId: "some.action" }, input);
      },
    });

    const runner = new ActionRunner({
      packageId: "pkg-caller",
      storage: pkgStorage,
      actions: new Map([["caller.test", callerAction]]),
      packageContextResolver: async () => undefined,
    });

    const result = await runner.execute("caller.test", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PACKAGE_NOT_FOUND");
    }
  });

  it("DefaultExecutionService persists ACTION_NOT_FOUND and preserves error code", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const service = new DefaultExecutionService({
      packageId: "test-pkg",
      storage,
    });

    const result = await service.execute({ actionId: "nonexistent.action" }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_NOT_FOUND");
    }

    const record = await service.get(result.runId);
    expect(record).toBeDefined();
    expect(record?.status).toBe("failed");
    expect(record?.error?.code).toBe("ACTION_NOT_FOUND");
  });

  it("returns ACTION_LOAD_FAILED when action source import fails in linked package", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "runner-home-"));
    const pkgDir = mkdtempSync(join(tmpdir(), "runner-pkg-"));
    try {
      initProject(pkgDir, {
        id: "team.broken-pkg",
        name: "Broken Package",
      });
      linkPackage(pkgDir, fakeHome);

      const brokenActionCode = `
import { nonexistentModule } from "completely-nonexistent-package-123456";
export default {
  id: "broken.act",
  run() { return { ok: true }; }
};
`;
      writeFileSync(join(pkgDir, "actions", "broken.act.ts"), brokenActionCode);

      const manifestPath = join(pkgDir, "actiondock.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.actions["broken.act"] = {
        entry: "actions/broken.act.ts",
        description: "Broken action",
      };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const storage = new SqliteRuntimeStorage({
        packageId: "caller-pkg",
        dbPath: ":memory:",
      });

      const runner = new ActionRunner({
        packageId: "caller-pkg",
        storage,
        customHome: fakeHome,
      });

      const result = await runner.execute("team.broken-pkg/broken.act", {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ACTION_LOAD_FAILED");
        expect(result.error.message).toContain("broken.act");
        expect(result.error.message).toContain("team.broken-pkg");
        expect(result.error.details).toBeDefined();
        const details = result.error.details as any;
        expect(details.packageId).toBe("team.broken-pkg");
        expect(details.projectRoot).toBe(pkgDir);
        expect(details.rootCause).toMatch(/Cannot find package|Cannot find module|Could not resolve/);
        expect(details.hint).toContain("依赖未安装");
      }
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(pkgDir, { recursive: true, force: true });
    }
  });

  it("returns ACTION_NOT_FOUND with resolver reason when package is not linked", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "runner-home-"));
    try {
      const storage = new SqliteRuntimeStorage({
        packageId: "caller-pkg",
        dbPath: ":memory:",
      });

      const runner = new ActionRunner({
        packageId: "caller-pkg",
        storage,
        customHome: fakeHome,
      });

      const result = await runner.execute("unlinked.pkg/some.action", {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ACTION_NOT_FOUND");
        expect((result.error.details as any)?.reason).toMatch(/Linked package 'unlinked\.pkg' not found|ad link/);
      }
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("DefaultExecutionService unifies cross-package string and object ref resolution and storage attribution", async () => {
    const storageA = new SqliteRuntimeStorage({ packageId: "pkg-a", dbPath: ":memory:" });
    const storageB = new SqliteRuntimeStorage({ packageId: "pkg-b", dbPath: ":memory:" });

    const workAction = defineAction({
      async run(input: { task: string }) {
        return { done: true, task: input.task, fromPkg: "pkg-b" };
      },
    });


    const serviceA = new DefaultExecutionService({
      packageId: "pkg-a",
      storage: storageA,
      packageContextResolver: (targetPkgId) => {
        if (targetPkgId === "pkg-b") {
          return {
            storage: storageB,
            actions: new Map([["work", workAction]]),
          };
        }
        return undefined;
      },
    });

    // 字符串形式："pkg-b/work"
    const stringRes = await serviceA.execute("pkg-b/work", { task: "clean" });
    expect(stringRes.ok).toBe(true);
    expect((stringRes as any).data).toEqual({ done: true, task: "clean", fromPkg: "pkg-b" });

    // 校验运行记录归属：写入目标包存储（storageB），而非源包（storageA）
    expect(storageB.listRuns().length).toBe(1);
    expect(storageB.listRuns()[0].actionId).toBe("work");
    expect(storageB.listRuns()[0].packageId).toBe("pkg-b");
    expect(storageA.listRuns().length).toBe(0);

    // 对象形式：{ packageId: "pkg-b", actionId: "work" }
    const objRes = await serviceA.execute({ packageId: "pkg-b", actionId: "work" }, { task: "build" });
    expect(objRes.ok).toBe(true);
    expect((objRes as any).data).toEqual({ done: true, task: "build", fromPkg: "pkg-b" });
    expect(storageB.listRuns().length).toBe(2);
    expect(storageA.listRuns().length).toBe(0);
  });

  it("DefaultExecutionService and ActionRunner strictly reject non-existent package without borrowing local actions or creating ghost storage", async () => {
    const storageA = new SqliteRuntimeStorage({ packageId: "pkg-a", dbPath: ":memory:" });
    let ghostStorageCreated = false;

    const localAction = defineAction({
      async run() {
        return { executed: "local-pkg-a" };
      },
    });

    const serviceA = new DefaultExecutionService({
      packageId: "pkg-a",
      storage: storageA,
      actions: new Map([["secret", localAction]]),
      getStorageForPackage: (pkgId) => {
        if (pkgId === "ghost-pkg") {
          ghostStorageCreated = true;
        }
        return new SqliteRuntimeStorage({ packageId: pkgId, dbPath: ":memory:" });
      },
    });

    // Calling non-existent ghost-pkg/secret must NOT execute pkg-a's secret action
    const result = await serviceA.execute("ghost-pkg/secret", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_NOT_FOUND");
      expect(result.error.message).toContain("ghost-pkg");
    }

    // Must not create empty runner in ghost storage
    expect(ghostStorageCreated).toBe(false);
  });
});
