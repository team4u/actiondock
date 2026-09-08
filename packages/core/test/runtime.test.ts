import { describe, expect, it } from "bun:test";
import { type ActionDefinition, defineAction } from "@actiondock/sdk";
import { ActionResolver } from "../src/catalog/action-resolver";
import { DefaultExecutionService } from "../src/execution/service";
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

  it("handles action invocation by string ID, ActionRef, and dynamic actionResolver", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "local-pkg",
      dbPath: ":memory:",
    });

    const localStep = defineAction({
      id: "local.calc",
      run: (input: { x: number }) => input.x * 2,
    });

    const extAction = defineAction({
      id: "greet",
      run: (input: { name: string }) => `Hello, ${input.name}!`,
    });

    const orchestrator = defineAction({
      id: "orchestrator",
      async run(input: { val: number }, ctx) {
        // 1. 调用本地动作（通过字符串 ID）
        const calcRes = await ctx.actions.invoke("local.calc", { x: input.val });
        // 2. 调用本地动作（通过 ActionRef）
        const refRes = await ctx.actions.invoke({ actionId: "local.calc" }, { x: calcRes });
        // 3. 跨包显式调用外部动作（通过 package/action 字符串）
        const extRes = await ctx.actions.invoke("ext-pkg/greet", { name: "ActionDock" });
        return { calcRes, refRes, extRes };
      },
    });

    const runner = new ActionRunner({
      packageId: "local-pkg",
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        [localStep.id, localStep],
        [orchestrator.id, orchestrator],
      ]),
      actionResolver: async (ref) => {
        const id = typeof ref === "string" ? ref : ref.actionId;
        if (id === "ext-pkg/greet" || id === "greet") {
          return extAction;
        }
        return undefined;
      },
    });

    const res = await runner.execute(orchestrator, { val: 5 });
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
      id: "calc",
      run: (input: { x: number }) => input.x + 1,
    });

    const extCalc = defineAction({
      id: "calc",
      run: (input: { x: number }) => input.x * 10,
    });

    const caller = defineAction({
      id: "caller",
      async run(input: { x: number }, ctx) {
        // 1. 调用本地动作
        const local = await ctx.actions.invoke("calc", { x: input.x });
        // 2. 跨包调用同名外部动作（字符串限定标识符），严禁被本地动作截断抢占
        const extStr = await ctx.actions.invoke("ext-pkg/calc", { x: input.x });
        // 3. 跨包调用同名外部动作（结构化 ActionRef 对象）
        const extRef = await ctx.actions.invoke({ packageId: "ext-pkg", actionId: "calc" }, { x: input.x });
        return { local, extStr, extRef };
      },
    });

    const runner = new ActionRunner({
      packageId: "local-pkg",
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        [localCalc.id, localCalc],
        [caller.id, caller],
      ]),
      actionResolver: async (ref) => {
        const id = typeof ref === "string" ? ref : `${ref.packageId}/${ref.actionId}`;
        if (id === "ext-pkg/calc") {
          return extCalc;
        }
        return undefined;
      },
    });

    const res = await runner.execute(caller, { x: 5 });
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

  it("handles timeout correctly and finalizes run with ACTION_TIMEOUT", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const sleepAction = defineAction({
      id: "test.sleep",
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
      actions: new Map([[sleepAction.id, sleepAction]]),
    });

    const result = await runner.execute(sleepAction, {}, { timeoutMs: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TIMEOUT");
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error?.code).toBe("ACTION_TIMEOUT");
  });

  it("handles ExecutionHandle.cancel and ExecutionManager correctly", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const cancellableAction = defineAction({
      id: "test.cancellable",
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
      actions: new Map([[cancellableAction.id, cancellableAction]]),
    });

    const handle = runner.start(cancellableAction, {});
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
      id: "test.progress-log",
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
    service.registerAction(progressAndLogAction);

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
});
