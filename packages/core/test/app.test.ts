import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createActionDockApp, DefaultActionDockApp } from "../src/app";
import { createDefaultPlatform } from "../src/platform";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("ActionDockApp", () => {
  it("工厂函数 createActionDockApp 与 DefaultActionDockApp 初始化并正确返回 PackageInfo", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "demo.service",
        name: "Demo Service",
        version: "2.1.0",
        description: "A test demo service",
        actionsDir: "actions",
        playbooksDir: "playbooks",
        config: {
          API_URL: {
            description: "Service API URL",
            default: "https://api.example.com",
          },
        },
      },
      inMemory: true,
    });

    expect(app).toBeInstanceOf(DefaultActionDockApp);
    const info = await app.info();
    expect(info.id).toBe("demo.service");
    expect(info.name).toBe("Demo Service");
    expect(info.version).toBe("2.1.0");
    expect(info.description).toBe("A test demo service");
    expect(info.actionsDir).toBe("actions");
    expect(info.playbooksDir).toBe("playbooks");
    expect(info.config?.API_URL.default).toBe("https://api.example.com");

    await app.close();
  });

  it("静态读取 Actions 摘要与规范，不产生模块导入执行副作用，并支持条件筛选", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-app-test-"));

    try {
      // 准备 actiondock.json (Manifest v2 唯一事实源)
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify(
          {
            id: "pkg.tools",
            name: "Tools Package",
            version: "1.0.0",
            schemaVersion: 2,
            actions: {
              "calc.add": {
                entry: "actions/calc-add.ts",
                description: "Add two numbers together",
                inputSchema: {
                  type: "object",
                  properties: { a: { type: "number" }, b: { type: "number" } },
                  required: ["a", "b"],
                },
                outputSchema: {
                  type: "object",
                  properties: { sum: { type: "number" } },
                },
                tags: ["math", "calculator"],
                uses: [],
              },
              "calc.multiply": {
                entry: "actions/calc-multiply.ts",
                description: "Multiply two numbers",
                tags: ["math"],
              },
              "util.echo": {
                entry: "actions/util-echo.ts",
                description: "Echo message back",
                tags: ["utility"],
              },
            },
          },
          null,
          2
        )
      );

      const app = await createActionDockApp({
        packageRoot: tempDir,
        inMemory: true,
      });

      // 1. 全量静态列表
      const allActions = await app.listActions();
      expect(allActions.length).toBe(3);
      const actionIds = allActions.map((a) => a.id).sort();
      expect(actionIds).toEqual(["calc.add", "calc.multiply", "util.echo"]);

      // 2. 标签过滤
      const mathActions = await app.listActions({ tags: ["math"] });
      expect(mathActions.length).toBe(2);
      expect(mathActions.map((a) => a.id).sort()).toEqual(["calc.add", "calc.multiply"]);

      const multiTagActions = await app.listActions({ tags: ["math", "calculator"] });
      expect(multiTagActions.length).toBe(1);
      expect(multiTagActions[0].id).toBe("calc.add");

      // 3. 关键词查询过滤
      const queryActions = await app.listActions({ query: "multiply" });
      expect(queryActions.length).toBe(1);
      expect(queryActions[0].id).toBe("calc.multiply");

      // 4. 前缀过滤
      const prefixActions = await app.listActions({ prefix: "calc." });
      expect(prefixActions.length).toBe(2);

      // 5. 详细规范 describeAction
      const spec = await app.describeAction("calc.add");
      expect(spec.id).toBe("calc.add");
      expect(spec.description).toBe("Add two numbers together");
      expect(spec.entry).toBe("actions/calc-add.ts");
      expect(spec.filePath).toBe(join(tempDir, "actions/calc-add.ts"));
      expect(spec.inputSchema).toBeDefined();

      // 支持完全限定标识
      const fqSpec = await app.describeAction("pkg.tools/calc.add");
      expect(fqSpec.id).toBe("calc.add");

      // 不存在的 Action 抛出异常
      expect(app.describeAction("nonexistent")).rejects.toThrow(
        "Action 'nonexistent' not found in package 'pkg.tools'"
      );

      await app.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("静态读取 Playbook 规程文档，支持列表与详细规范查询", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-app-pb-"));

    try {
      const playbooksDir = join(tempDir, "playbooks");
      mkdirSync(playbooksDir, { recursive: true });

      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify(
          {
            id: "pkg.sop",
            name: "SOP Package",
            version: "1.0.0",
            playbooksDir: "playbooks",
            playbooks: {
              deploy: {
                entry: "playbooks/deploy.md",
                description: "Deploy application to staging or production",
                actions: ["build-binary", "upload-artifact"],
              },
            },
          },
          null,
          2
        )
      );

      writeFileSync(
        join(playbooksDir, "deploy.md"),
        `# Deploy Procedure

Execute build and then deploy artifact.
`
      );

      const app = await createActionDockApp({
        packageRoot: tempDir,
        inMemory: true,
      });

      const playbooks = await app.listPlaybooks();
      expect(playbooks.length).toBe(1);
      expect(playbooks[0].id).toBe("deploy");
      expect(playbooks[0].description).toBe("Deploy application to staging or production");
      expect(playbooks[0].actions).toEqual(["build-binary", "upload-artifact"]);

      // 详细内容获取
      const spec = await app.describePlaybook("deploy");
      expect(spec.id).toBe("deploy");
      expect(spec.content).toContain("# Deploy Procedure");
      expect(spec.filePath).toBe(join(playbooksDir, "deploy.md"));

      // 支持 .md 后缀
      const specWithExt = await app.describePlaybook("deploy.md");
      expect(specWithExt.id).toBe("deploy");

      // 不存在的 Playbook 抛出异常
      expect(app.describePlaybook("unknown")).rejects.toThrow(
        "Playbook 'unknown' not found in package 'pkg.sop'"
      );

      await app.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("支持 runAction 同步执行与 startAction 异步执行及任务票据", async () => {
    const sumAction = defineAction({
      run(input: { x: number; y: number }) {
        return { result: input.x + input.y };
      },
    });

    const app = await createActionDockApp({
      projectConfig: {
        id: "test.app",
        name: "Test App",
        version: "1.0.0",
        actions: {
          "math.sum": {
            entry: "",
            description: "Sum numbers",
            inputSchema: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
            },
            outputSchema: {
              type: "object",
              properties: {
                result: { type: "number" },
              },
            },
          },
        },
      },
      actions: {
        "math.sum": sumAction,
      },
      inMemory: true,
    });

    // 1. 同步执行 runAction
    const syncRes = await app.runAction("math.sum", { x: 15, y: 25 });
    expect(syncRes.ok).toBe(true);
    if (syncRes.ok) {
      expect(syncRes.data).toEqual({ result: 40 });
    }

    // 2. 异步执行 startAction 并返回票据
    const ticket = await app.startAction("math.sum", { x: 100, y: 200 });
    expect(ticket.runId).toBeDefined();
    expect(ticket.status).toBe("running");
    expect(ticket.result).toBeDefined();

    const asyncRes = await ticket.result!;
    expect(asyncRes.ok).toBe(true);
    if (asyncRes.ok) {
      expect(asyncRes.data).toEqual({ result: 300 });
    }

    // 3. 通过 getRun 检索运行记录
    const runRecord = await app.getRun(ticket.runId);
    expect(runRecord).toBeDefined();
    expect(runRecord?.id).toBe(ticket.runId);
    expect(runRecord?.status).toBe("success");
    expect(runRecord?.actionId).toBe("math.sum");
    expect(runRecord?.output).toEqual({ result: 300 });

    // 4. 输入校验失败分支
    const failRes = await app.runAction("math.sum", { x: "invalid" as any, y: 10 });
    expect(failRes.ok).toBe(false);
    if (!failRes.ok) {
      expect(failRes.error?.code).toBe("INPUT_VALIDATION_FAILED");
    }

    await app.close();
  });

  it("支持 cancelRun 取消执行与 events 事件流订阅", async () => {
    let cancelled = false;
    const longRunningAction = defineAction({
      async run(_input: unknown, ctx: ActionContext) {
        ctx.log.info("task starting");
        ctx.signal.addEventListener("abort", () => {
          cancelled = true;
        });
        for (let i = 0; i < 20; i++) {
          if (ctx.signal.aborted) {
            cancelled = true;
            throw new Error("aborted");
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { done: true };
      },
    });

    const app = await createActionDockApp({
      projectConfig: {
        id: "test.cancel",
        name: "Cancel App",
        version: "1.0.0",
      },
      actions: {
        "test.long": longRunningAction,
      },
      inMemory: true,
    });

    // 异步启动任务
    const ticket = await app.startAction("test.long", {});
    expect(ticket.runId).toBeDefined();

    // 订阅事件流
    const capturedEvents: any[] = [];
    const eventPromise = (async () => {
      for await (const evt of app.events(ticket.runId)) {
        capturedEvents.push(evt);
        if (evt.type === "finish") {
          break;
        }
      }
    })();

    // 等待启动后触发取消
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cancelRes = await app.cancelRun(ticket.runId, "user cancelled");
    expect(cancelRes.outcome).toBe("requested");

    const result = await ticket.result!;
    expect(result.ok).toBe(false);
    expect(cancelled).toBe(true);

    await eventPromise;
    expect(capturedEvents.some((e) => e.type === "status")).toBe(true);
    expect(capturedEvents.some((e) => e.type === "finish")).toBe(true);

    // 对已终态的运行执行取消返回 already_terminal
    const secondCancel = await app.cancelRun(ticket.runId);
    expect(secondCancel.outcome).toBe("already_terminal");

    // 对不存在的任务取消返回 not_found
    const missingCancel = await app.cancelRun("missing-run-id");
    expect(missingCancel.outcome).toBe("not_found");

    await app.close();
  });

  it("支持配置的读写与五层优先级链解析", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "test.config",
        name: "Config App",
        version: "1.0.0",
        config: {
          HOST: {
            default: "localhost",
          },
          PORT: {
            default: 8080,
          },
        },
      },
      configOverrides: {
        PORT: 9000,
      },
      inMemory: true,
    });

    // 1. 读取默认配置
    const host = await app.getConfig("HOST");
    expect(host.value).toBe("localhost");
    expect(host.configured).toBe(false);
    expect(host.source).toBe("default");

    // 2. 覆盖项优先于默认值
    const port = await app.getConfig("PORT");
    expect(port.value).toBe(9000);
    expect(port.configured).toBe(true);
    expect(port.source).toBe("package");

    // 3. 通过 setConfig 写入持久化配置
    await app.setConfig("DB_NAME", "actiondock_test");
    const dbName = await app.getConfig("DB_NAME");
    expect(dbName.value).toBe("actiondock_test");
    expect(dbName.configured).toBe(true);
    expect(dbName.source).toBe("package");

    await app.close();
  });

  it("支持状态管理：getState, setState, deleteState 及命名空间隔离", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "test.state",
        name: "State App",
        version: "1.0.0",
      },
      inMemory: true,
    });

    // 1. Action 命名空间状态读写
    await app.setActionState("test-action", "counter", 42);
    const val = await app.getActionState<number>("test-action", "counter");
    expect(val).toBe(42);

    // 2. 指定子命名空间状态读写
    await app.setState("test-action", "token", "secret-xyz", { namespace: "auth" });
    const authVal = await app.getState<string>("test-action", "token", { namespace: "auth" });
    expect(authVal).toBe("secret-xyz");

    // 3. 删除子命名空间状态
    const deletedAuth = await app.deleteState("test-action", "token", { namespace: "auth" });
    expect(deletedAuth).toBe(true);
    const checkDeleted = await app.getState("test-action", "token", { namespace: "auth" });
    expect(checkDeleted).toBeUndefined();

    // 4. 删除 Action 根状态
    const deletedRoot = await app.deleteState("test-action", "counter");
    expect(deletedRoot).toBe(true);
    const checkRoot = await app.getState("test-action", "counter");
    expect(checkRoot).toBeUndefined();

    await app.close();
  });

  it("setState/getState/deleteState 支持 StateScopeOptions 中 actionId 参数并消歧三参数调用", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "test.state.scope",
        name: "State Scope App",
        version: "1.0.0",
      },
      inMemory: true,
    });

    // 1. 通过 options 显式传入 actionId 写入状态
    await app.setState("cache_key", "cached_data", { actionId: "dynamic_worker" });
    const cached = await app.getState<string>("cache_key", { actionId: "dynamic_worker" });
    expect(cached).toBe("cached_data");

    // 2. 动态未注册 actionId，value 恰好是类似 StateScopeOptions 的对象：通过 4 参数调用消除歧义
    const stateObj = { ttl: 60, namespace: "meta" };
    await app.setState("unregistered_action", "item_key", stateObj, {});
    const retrievedObj = await app.getState<any>("unregistered_action", "item_key");
    expect(retrievedObj).toEqual({ ttl: 60, namespace: "meta" });

    // 3. deleteState 与 listStateKeys 支持 opts.actionId
    const keys = await app.listStateKeys({ actionId: "dynamic_worker" });
    expect(keys).toContain("cache_key");

    const deleted = await app.deleteState("cache_key", { actionId: "dynamic_worker" });
    expect(deleted).toBe(true);

    const check = await app.getState("cache_key", { actionId: "dynamic_worker" });
    expect(check).toBeUndefined();

    await app.close();
  });

  it("setState 四参数与 options.actionId 冲突时抛出异常，并校验各状态方法冲突异常", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "test.state.conflict",
        name: "State Conflict App",
        version: "1.0.0",
      },
      inMemory: true,
    });

    // 1. setState 显式位置参数与 options.actionId 冲突报错
    await expect(
      app.setState("action-a", "key1", "val1", { actionId: "action-b" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'action-a' vs options.actionId 'action-b'"
    );

    // 2. 正常四参数调用（options.actionId 一致或未指定）成功
    await app.setState("action-a", "key1", "val1", { actionId: "action-a" });
    const val1 = await app.getState<string>("action-a", "key1");
    expect(val1).toBe("val1");

    // 3. getState 位置参数与 options.actionId 冲突报错
    await expect(
      app.getState("action-a", "key1", { actionId: "action-b" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'action-a' vs options.actionId 'action-b'"
    );

    // 4. deleteState 位置参数与 options.actionId 冲突报错
    await expect(
      app.deleteState("action-a", "key1", { actionId: "action-b" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'action-a' vs options.actionId 'action-b'"
    );

    // 5. listStateKeys 位置参数与 options.actionId 冲突报错
    await expect(
      app.listStateKeys("action-a", { actionId: "action-b" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'action-a' vs options.actionId 'action-b'"
    );

    // 6. clearState 位置参数与 options.actionId 冲突报错
    await expect(
      app.clearState("action-a", { actionId: "action-b" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'action-a' vs options.actionId 'action-b'"
    );

    await app.close();
  });

  it("支持 setActionState, getActionState, deleteActionState 显式无歧义 API", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "test.action.state",
        name: "Action State App",
        version: "1.0.0",
      },
      inMemory: true,
    });

    // 1. setActionState 写入状态并读取
    await app.setActionState("calc-worker", "counter", 100);
    const counter = await app.getActionState<number>("calc-worker", "counter");
    expect(counter).toBe(100);

    // 2. setActionState 支持子命名空间与 options.detail 读取
    await app.setActionState("calc-worker", "token", "tok_123", { namespace: "auth" });
    const authVal = await app.getActionState<string>("calc-worker", "token", { namespace: "auth" });
    expect(authVal).toBe("tok_123");

    const detailEntry = await app.getActionState<any>("calc-worker", "token", {
      namespace: "auth",
      detail: true,
    });
    expect(detailEntry).toBeDefined();
    expect(detailEntry.value).toBe("tok_123");

    // 3. deleteActionState 删除状态
    const deleted = await app.deleteActionState("calc-worker", "counter");
    expect(deleted).toBe(true);
    const afterDelete = await app.getActionState("calc-worker", "counter");
    expect(afterDelete).toBeUndefined();

    // 4. setActionState / getActionState / deleteActionState 在 options.actionId 冲突时校验报错
    await expect(
      app.setActionState("calc-worker", "k", "v", { actionId: "other-worker" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'calc-worker' vs options.actionId 'other-worker'"
    );
    await expect(
      app.getActionState("calc-worker", "k", { actionId: "other-worker" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'calc-worker' vs options.actionId 'other-worker'"
    );
    await expect(
      app.deleteActionState("calc-worker", "k", { actionId: "other-worker" })
    ).rejects.toThrow(
      "Conflicting actionId specified: positional 'calc-worker' vs options.actionId 'other-worker'"
    );

    await app.close();
  });

  it("3 参数 setState 确定性作为扁平包级状态写入，杜绝启发式误判为 Action 状态", async () => {
    const app = await createActionDockApp({
      projectConfig: {
        id: "test.state.disambiguate",
        name: "Disambiguate App",
        version: "1.0.0",
      },
      inMemory: true,
    });

    // 1. 三参数 setState(key, value, options) 确定性写入包级扁平状态，value 为普通字符串
    await app.setState("theme", "dark", { ttl: 60 });
    const themeVal = await app.getState("theme");
    expect(themeVal).toBe("dark");

    // 绝不可被误当作 Action 状态写入
    const actionVal = await app.getActionState("theme", "dark");
    expect(actionVal).toBeUndefined();

    // 2. Action 命名空间状态显式通过 setActionState 或四参数 setState 写入
    const arbitraryValue = { ttl: 300, namespace: "custom" };
    await app.setActionState("unregistered_act", "config_meta", arbitraryValue);
    const result = await app.getActionState<typeof arbitraryValue>(
      "unregistered_act",
      "config_meta"
    );
    expect(result).toEqual({ ttl: 300, namespace: "custom" });

    await app.setState("unregistered_act_2", "config_meta_2", arbitraryValue, {});
    const result2 = await app.getActionState<typeof arbitraryValue>(
      "unregistered_act_2",
      "config_meta_2"
    );
    expect(result2).toEqual({ ttl: 300, namespace: "custom" });

    // 3. 非法三参数调用（第三参数传入非对象基元或数组）必须被显式拦截，杜绝静默写错数据
    await expect(
      (app as any).setState("worker", "counter", 42)
    ).rejects.toThrow("Invalid options provided to setState");

    await expect(
      (app as any).setState("worker", "counter", "unexpected-value")
    ).rejects.toThrow("Invalid options provided to setState");

    await expect(
      (app as any).setState("worker", "counter", [1, 2, 3])
    ).rejects.toThrow("Invalid options provided to setState");

    await app.close();

    // 4. DefaultActionDockApp 实体类拥有与 ActionDockApp 相同的重载契约
    const concreteApp = new DefaultActionDockApp({ inMemory: true });
    await concreteApp.setState("theme", "light");
    expect(await concreteApp.getState("theme")).toBe("light");
    await concreteApp.setState("worker", "counter", 42, {});
    expect(await concreteApp.getActionState("worker", "counter")).toBe(42);
    await expect(
      (concreteApp as any).setState("worker", "counter", 42)
    ).rejects.toThrow("Invalid options provided to setState");
    await concreteApp.close();
  });

  it("优雅关机 close() 协调执行服务关机与底层存储安全关闭", async () => {
    let customStorageClosed = false;
    const storage = new SqliteRuntimeStorage({
      packageId: "test.shutdown",
      dbPath: ":memory:",
    });

    const originalClose = storage.close.bind(storage);
    storage.close = async () => {
      customStorageClosed = true;
      await originalClose();
    };

    const dummyAction = defineAction({
      run: async () => ({ success: true }),
    });

    const app = await createActionDockApp({
      projectConfig: {
        id: "test.shutdown",
        name: "Shutdown App",
        version: "1.0.0",
      },
      storage,
      actions: { dummy: dummyAction },
      inMemory: true,
    });

    const res = await app.runAction("dummy", {});
    expect(res.ok).toBe(true);

    // 优雅关机
    await app.close();
    expect(customStorageClosed).toBe(true);

    // 关机后拒绝接收新任务
    expect(app.runAction("dummy", {})).rejects.toThrow(
      "ExecutionService is closing: new tasks rejected"
    );

    // 重复 close 不报错
    await app.close();
  });

  it("支持显式平台注入与默认平台回退", async () => {
    const defaultPlatform = createDefaultPlatform();
    expect(defaultPlatform.name).toBeDefined();
    expect(defaultPlatform.storage).toBeDefined();

    const app = await createActionDockApp({
      projectConfig: {
        id: "test.platform",
        name: "Platform App",
        version: "1.0.0",
      },
      platform: defaultPlatform,
      inMemory: true,
    });

    expect(app.platform).toBe(defaultPlatform);
    await app.close();
  });
});
