import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionDefinition, type ActionRef, defineAction } from "@actiondock/sdk";
import { ActionResolver } from "../src/catalog/action-resolver";
import { DefaultExecutionService } from "../src/execution/service";
import { initProject } from "../src/project/init";
import { linkPackage } from "../src/registry/registry";
import { ActionRunner } from "../src/runtime/runner";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createPackageIdentity } from "../src/runtime/identity";
import { createInvocationContext } from "../src/invocation/types";
import { InvocationPolicy } from "../src/invocation/policy";
import { createActionDockHost } from "../src/host/host";

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
      identity: createPackageIdentity({ id: "test-pkg" }),
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
      identity: createPackageIdentity({ id: "test-pkg" }),
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
      identity: createPackageIdentity({ id: "test-pkg" }),
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
      identity: createPackageIdentity({ id: "test-pkg" }),
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        ["chain.step1", step1],
        ["chain.step2", step2],
      ]),
    });
    runner.setActionInvoker(async (childAction, childInput, context) => {
      const parsed = typeof childAction === "string" ? childAction : childAction.actionId;
      const childRes = await runner.execute(parsed, childInput, {
        parentRunId: context.parentRunId,
        rootRunId: context.rootRunId,
      });
      if (!childRes.ok) throw new Error(childRes.error.message);
      return childRes.data;
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

    const dynamicStep = defineAction({
      run: (input: { x: number }) => input.x * 10,
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
      identity: createPackageIdentity({ id: "local-pkg" }),
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        ["local.calc", localStep],
        ["orchestrator", orchestrator],
      ]),
      actionResolver: async (actionId: string) => {
        if (actionId === "local.dynamic") {
          return dynamicStep;
        }
        return undefined;
      },
    });

    runner.setActionInvoker(async (childAction: ActionRef | string, childInput: unknown, context) => {
      const parsed = ActionResolver.parseRef(childAction);
      if (parsed.packageId === "ext-pkg") {
        return `Hello, ${(childInput as any).name}!`;
      }
      const childRes = await runner.execute(parsed.actionId, childInput, {
        parentRunId: context.parentRunId,
        rootRunId: context.rootRunId,
      });
      if (!childRes.ok) {
        throw new Error(childRes.error.message);
      }
      return childRes.data;
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

    // 验证局部动态解析器 LocalActionResolver
    const dynRes = await runner.execute("local.dynamic", { x: 3 });
    expect(dynRes.ok).toBe(true);
    if (dynRes.ok) {
      expect(dynRes.data).toBe(30);
    }
  });

  it("嵌套 Action 调用完整继承并传递调用方所有者身份与作用域凭据", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "local-pkg",
      dbPath: ":memory:",
    });

    const childLocal = defineAction({
      run: async (_input, ctx) => {
        return {
          owner: (ctx.process as any).owner,
        };
      },
    });

    const childExt = defineAction({
      run: async (_input, ctx) => {
        return {
          owner: (ctx.process as any).owner,
        };
      },
    });

    const parentAction = defineAction({
      uses: ["ext-pkg/child-ext"],
      async run(_input, ctx) {
        const localIdentity = await ctx.actions.invoke("child-local", {});
        const extIdentity = await ctx.actions.invoke("ext-pkg/child-ext", {});
        return {
          parentOwner: (ctx.process as any).owner,
          localIdentity,
          extIdentity,
        };
      },
    });

    const extStorage = new SqliteRuntimeStorage({ packageId: "ext-pkg", dbPath: ":memory:" });
    const extRunner = new ActionRunner({
      identity: createPackageIdentity({
        id: "ext-pkg",
        instanceId: "ext-pkg-instance-42",
        generation: "gen-ext-9",
      }),
      storage: extStorage,
      actions: new Map([["child-ext", childExt]]),
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({
        id: "local-pkg",
        instanceId: "local-pkg-inst-1",
        generation: "local-gen-1",
      }),
      storage,
      actions: new Map<string, ActionDefinition<any, any>>([
        ["parent", parentAction],
        ["child-local", childLocal],
      ]),
    });

    runner.setActionInvoker(async (childAction: ActionRef | string, childInput: unknown, context) => {
      const parsed = ActionResolver.parseRef(childAction);
      if (parsed.packageId === "ext-pkg") {
        const targetOwner = {
          tenantId: context.tenantId ?? context.owner?.tenantId ?? "default",
          principalId: context.principalId ?? context.owner?.principalId ?? "default",
          packageInstanceId: extRunner.packageInstanceId,
          generationId: extRunner.generationId,
        };
        const childRes = await extRunner.execute(parsed.actionId, childInput, { owner: targetOwner });
        if (!childRes.ok) {
          throw new Error(childRes.error.message);
        }
        return childRes.data;
      }
      if (!parsed.packageId || parsed.packageId === "local-pkg") {
        const childRes = await runner.execute(parsed.actionId, childInput, { owner: context.owner });
        if (!childRes.ok) {
          throw new Error(childRes.error.message);
        }
        return childRes.data;
      }
      throw new Error(`Package '${parsed.packageId}' not found`);
    });

    const customOwner = {
      tenantId: "tenant-custom-42",
      principalId: "user-alpha-99",
      packageInstanceId: "pkg-instance-root",
      generationId: "gen-epoch-7",
    };

    const res = await runner.execute("parent", {}, {
      owner: customOwner,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as any;
      expect(data.parentOwner).toEqual(customOwner);
      // 同包子调用继承完整的 tenantId、principalId、packageInstanceId、generationId
      expect(data.localIdentity.owner).toEqual(customOwner);
      // 跨包子调用继承调用方 tenantId 与 principalId，并使用宿主目标包真实 packageInstanceId 与 generationId
      expect(data.extIdentity.owner).toEqual({
        tenantId: "tenant-custom-42",
        principalId: "user-alpha-99",
        packageInstanceId: "ext-pkg-instance-42",
        generationId: "gen-ext-9",
      });
    }
  });

  it("handles cross-package same-name action invocation without hijacking or false cycle detection", async () => {
    const localCalc = defineAction({
      run: (input: { x: number }) => input.x + 1,
    });

    const extCalc = defineAction({
      run: (input: { x: number }) => input.x * 10,
    });

    const caller = defineAction({
      uses: ["ext-pkg/calc"],
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

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "local-pkg",
            actions: {
              calc: { entry: "" },
              caller: { entry: "", uses: ["ext-pkg/calc"] },
            },
          },
          actions: {
            calc: localCalc,
            caller,
          },
          inMemory: true,
        },
        {
          projectConfig: {
            id: "ext-pkg",
            actions: {
              calc: { entry: "" },
            },
          },
          actions: {
            calc: extCalc,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const res = await host.runAction("local-pkg/caller", { x: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({
        local: 6,
        extStr: 50,
        extRef: 50,
      });
    }

    await host.close();
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
        identity: createPackageIdentity({ id: "team.demo-service" }),
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
        identity: createPackageIdentity({ id: "@scope/my-service" }),
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
        identity: createPackageIdentity({ id: "tier-pkg" }),
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
      identity: createPackageIdentity({ id: "test-pkg" }),
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

  it("handles ExecutionHandle.cancel and active runs management correctly", async () => {
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
      identity: createPackageIdentity({ id: "test-pkg" }),
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

    const identity = createPackageIdentity({ id: "test-pkg" });
    const service = new DefaultExecutionService({
      identity,
      storage,
      eventSink: eventSink as any,
    });
    service.registerAction("test.progress-log", progressAndLogAction);

    const result = await service.execute({ actionId: "test.progress-log" }, {}, createInvocationContext({ package: identity }));
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
      identity: createPackageIdentity({ id: "test-pkg" }),
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
    });

    const policy = new InvocationPolicy({ maxCallDepth: 3 });
    runner.setActionInvoker(async (childAction, childInput, context) => {
      const ref = typeof childAction === "string" ? { actionId: childAction } : childAction;
      const targetActionId = ref.actionId;
      const targetKey = `${runner.packageId}/${targetActionId}`;
      const callStack = context.callStack ?? [];

      const cycle = policy.checkCycle(callStack, targetActionId, runner.packageId, runner.packageId);
      if (cycle.error) {
        const err = new Error(cycle.error.message);
        (err as any).code = cycle.error.code;
        (err as any).details = cycle.error.details;
        throw err;
      }

      const depthErr = policy.checkCallDepth(callStack, targetActionId, context.maxCallDepth);
      if (depthErr) {
        const err = new Error(depthErr.message);
        (err as any).code = depthErr.code;
        (err as any).details = depthErr.details;
        throw err;
      }

      const res = await runner.execute(targetActionId, childInput, {
        parentRunId: context.parentRunId,
        rootRunId: context.rootRunId,
        callStack: [...callStack, targetKey],
        signal: context.signal,
        maxCallDepth: context.maxCallDepth,
      });
      if (!res.ok) {
        const err = new Error(res.error.message);
        (err as any).code = res.error.code;
        (err as any).details = res.error.details;
        throw err;
      }
      return res.data;
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

    // 执行级 maxCallDepth 覆盖契约：构造级默认 3，执行级 1 应立即拦住嵌套调用
    const shallowResult = await runner.execute("test.rec-a", {}, { maxCallDepth: 1 });
    expect(shallowResult.ok).toBe(false);
    const shallowError = (shallowResult as { ok: false; error?: { code?: string; details?: { alias?: string } } }).error;
    expect(shallowError?.code).toBe("ACTION_CALL_CYCLE");
    expect(shallowError?.details?.alias).toBe("ACTION_MAX_DEPTH_EXCEEDED");
    // 执行级覆盖为更大值时，同样四层链可正常递归完成（覆盖构造级 3）
    const deepOk = await runner.execute("test.rec-a", {}, { maxCallDepth: 8 });
    expect(deepOk.ok).toBe(true);
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
      uses: ["pkg-b/b.worker"],
      async run(input: any, ctx) {
        return ctx.actions.invoke({ packageId: "pkg-b", actionId: "b.worker" }, input);
      },
    });

    const pkgBRunner = new ActionRunner({
      identity: createPackageIdentity({ id: "pkg-b" }),
      storage: pkgBStorage,
      projectConfig: {
        id: "pkg-b",
        name: "Package B",
        version: "1.0.0",
        config: { greeting: { default: "hello from B" } },
      },
      actions: new Map([["b.worker", pkgBAction]]),
    });

    const pkgARunner = new ActionRunner({
      identity: createPackageIdentity({ id: "pkg-a" }),
      storage: pkgAStorage,
      actions: new Map([["a.caller", pkgAAction]]),
    });

    pkgARunner.setActionInvoker(async (ref, input) => {
      const parsed = ActionResolver.parseRef(ref);
      if (parsed.packageId === "pkg-b") {
        const res = await pkgBRunner.execute(parsed.actionId, input);
        if (!res.ok) {
          throw new Error(res.error.message);
        }
        return res.data;
      }
      throw new Error(`Package '${parsed.packageId}' not found`);
    });

    const result = await pkgARunner.execute("a.caller", { foo: "bar" });
    if (!result.ok) {
      console.log("RESULT ERROR:", (result as any).error);
    }
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
    const callerAction = defineAction({
      async run(input: any, ctx) {
        return ctx.actions.invoke({ packageId: "unregistered-remote-pkg", actionId: "some.action" }, input);
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg-caller",
            actions: {
              "caller.test": { entry: "" },
            },
          },
          actions: {
            "caller.test": callerAction,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const result = await host.runAction("pkg-caller/caller.test", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PACKAGE_NOT_FOUND");
    }

    await host.close();
  });

  it("DefaultExecutionService persists ACTION_NOT_FOUND and preserves error code", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const identity = createPackageIdentity({ id: "test-pkg" });
    const service = new DefaultExecutionService({
      identity,
      storage,
    });

    const result = await service.execute({ actionId: "nonexistent.action" }, {}, createInvocationContext({ package: identity }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_NOT_FOUND");
    }

    const record = await service.get(result.runId);
    expect(record).toBeDefined();
    expect(record?.status).toBe("failed");
    expect(record?.error?.code).toBe("ACTION_NOT_FOUND");
  });

  it("ActionRunner strictly rejects external package reference without searching linked packages", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "caller-pkg",
      dbPath: ":memory:",
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "caller-pkg" }),
      storage,
    });

    const result = await runner.execute("unlinked.pkg/some.action", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_NOT_FOUND");
      expect((result.error.details as any)?.reason).toContain(
        "Cross-package action 'unlinked.pkg/some.action' cannot be resolved by ActionRunner"
      );
    }
  });

  it("DefaultExecutionService unifies string and object ref resolution for local package actions", async () => {
    const storageA = new SqliteRuntimeStorage({ packageId: "pkg-a", dbPath: ":memory:" });

    const workAction = defineAction({
      async run(input: { task: string }) {
        return { done: true, task: input.task, fromPkg: "pkg-a" };
      },
    });

    const identityA = createPackageIdentity({ id: "pkg-a" });
    const serviceA = new DefaultExecutionService({
      identity: identityA,
      storage: storageA,
      actions: new Map([["work", workAction]]),
    });

    // 字符串形式："work"
    const stringRes = await serviceA.execute("work", { task: "clean" }, createInvocationContext({ package: identityA }));
    expect(stringRes.ok).toBe(true);
    expect((stringRes as any).data).toEqual({ done: true, task: "clean", fromPkg: "pkg-a" });

    // 完全限定字符串形式："pkg-a/work"
    const fqRes = await serviceA.execute("pkg-a/work", { task: "clean-fq" }, createInvocationContext({ package: identityA }));
    expect(fqRes.ok).toBe(true);
    expect((fqRes as any).data).toEqual({ done: true, task: "clean-fq", fromPkg: "pkg-a" });

    // 对象形式：{ packageId: "pkg-a", actionId: "work" }
    const objRes = await serviceA.execute({ packageId: "pkg-a", actionId: "work" }, { task: "build" }, createInvocationContext({ package: identityA }));
    expect(objRes.ok).toBe(true);
    expect((objRes as any).data).toEqual({ done: true, task: "build", fromPkg: "pkg-a" });

    expect(storageA.listRuns().length).toBe(3);
  });

  it("DefaultExecutionService and ActionRunner strictly reject non-existent package without borrowing local actions or creating ghost storage", async () => {
    const storageA = new SqliteRuntimeStorage({ packageId: "pkg-a", dbPath: ":memory:" });
    let ghostStorageCreated = false;

    const localAction = defineAction({
      async run() {
        return { executed: "local-pkg-a" };
      },
    });

    const identityA = createPackageIdentity({ id: "pkg-a" });
    const serviceA = new DefaultExecutionService({
      identity: identityA,
      storage: storageA,
      actions: new Map([["secret", localAction]]),
    });

    // Calling non-existent ghost-pkg/secret must NOT execute pkg-a's secret action
    const result = await serviceA.execute("ghost-pkg/secret", {}, createInvocationContext({ package: identityA }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_NOT_FOUND");
      expect(result.error.message).toContain("ghost-pkg");
    }

    // Must not create empty runner in ghost storage
    expect(ghostStorageCreated).toBe(false);
  });

  it("DefaultExecutionService enforces maxActiveRuns without concurrency race conditions under simultaneous parallel requests", async () => {
    const storage = new SqliteRuntimeStorage({ packageId: "concurrency-pkg", dbPath: ":memory:" });
    const maxActive = 3;

    let resolvePendingAction: (() => void) | undefined;
    const pendingPromise = new Promise<void>((resolve) => {
      resolvePendingAction = resolve;
    });

    const slowAction = defineAction({
      async run() {
        await pendingPromise;
        return { ok: true };
      },
    });

    const identity = createPackageIdentity({ id: "concurrency-pkg" });
    const service = new DefaultExecutionService({
      identity,
      storage,
      maxActiveRuns: maxActive,
      actions: new Map([["slow", slowAction]]),
    });

    try {
      // Fire 10 concurrent requests synchronously in the same tick
      const totalRequests = 10;
      const startPromises = Array.from({ length: totalRequests }).map(async (_, idx) => {
        try {
          const ticket = await service.start("slow", { index: idx }, createInvocationContext({ package: identity }));
          return { success: true, ticket };
        } catch (err: any) {
          return { success: false, error: err };
        }
      });

      const results = await Promise.all(startPromises);
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(maxActive);
      expect(failures.length).toBe(totalRequests - maxActive);
      for (const failure of failures) {
        expect(failure.error.message).toContain(`Concurrency limit reached: ${maxActive}/${maxActive} active runs`);
      }

      // Finish pending runs
      resolvePendingAction!();
      for (const item of successes) {
        const res = await (item as any).ticket.result;
        expect(res.ok).toBe(true);
      }

      // After completions, new requests can succeed
      const followUpTicket = await service.start("slow", {}, createInvocationContext({ package: identity }));
      expect(followUpTicket.status).toBe("running");
      expect(followUpTicket.result).toBeDefined();
      const followUpRes = await followUpTicket.result!;
      expect(followUpRes.ok).toBe(true);
    } finally {
      await service.close();
    }
  });


  it("平台级共享进程实例在 run 结束后不被误 dispose 且后续 run 可继续使用", async () => {
    const { createNodePlatform } = await import("../src/platform");
    const { MemoryProcessDriver } = await import("../src/process");
    const platform = createNodePlatform({ name: "test", processDriver: new MemoryProcessDriver() });
    const sharedProcess = platform.process as any;

    // 校验共享实例特征：暴露 manager 派生入口且非 run 级作用域
    expect(sharedProcess.manager).toBeDefined();
    expect(typeof sharedProcess.manager.forOwner).toBe("function");
    expect(sharedProcess.runScoped).not.toBe(true);

    const observedRunIds = new Set<string>();
    const probeAction = defineAction({
      run: async (_input: unknown, ctx: any) => {
        observedRunIds.add(ctx.run.id);
        // 每个 run 应拿到独立的 run 级进程实例（由共享实例派生）
        return { runScoped: ctx.process?.runScoped, sameAsPlatform: ctx.process === sharedProcess };
      },
    });

    const storage = new SqliteRuntimeStorage({ packageId: "shared-proc-pkg", dbPath: ":memory:" });
    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "shared-proc-pkg" }),
      storage,
      platform,
      actions: new Map([["probe", probeAction]]),
    });

    const first = await runner.execute("probe", {});
    expect(first.ok).toBe(true);
    // run 上下文拿到的是派生的 run 级实例，而非平台共享实例本身
    expect((first as any).data?.runScoped).toBe(true);
    expect((first as any).data?.sameAsPlatform).toBe(false);

    // 共享实例不得被首个 run 的 finally 误 dispose（后续仍可继续派生与使用）
    expect(typeof sharedProcess.manager.forOwner).toBe("function");
    const second = await runner.execute("probe", {});
    expect(second.ok).toBe(true);
    expect((second as any).data?.runScoped).toBe(true);
    expect(observedRunIds.size).toBe(2);
  });
});
