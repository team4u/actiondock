import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { DefaultPackageRuntime } from "../src/package/runtime";
import { createNodePlatform } from "../src/platform";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("PackageRuntime", () => {
  it("工厂函数 createPackageRuntime 与 DefaultPackageRuntime 初始化并正确返回 PackageInfo", async () => {
    const app = await createPackageRuntime({
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

    assert.ok(app instanceof DefaultPackageRuntime);
    const info = await app.info();
    assert.strictEqual(info.id, "demo.service");
    assert.strictEqual(info.name, "Demo Service");
    assert.strictEqual(info.version, "2.1.0");
    assert.strictEqual(info.description, "A test demo service");
    assert.strictEqual(info.actionsDir, "actions");
    assert.strictEqual(info.playbooksDir, "playbooks");
    assert.strictEqual(info.config?.API_URL.default, "https://api.example.com");

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

      const app = await createPackageRuntime({
        packageRoot: tempDir,
        inMemory: true,
      });

      // 1. 全量静态列表
      const allActions = await app.listActions();
      assert.strictEqual(allActions.length, 3);
      const actionIds = allActions.map((a) => a.id).sort();
      assert.deepStrictEqual(actionIds, ["calc.add", "calc.multiply", "util.echo"]);

      // 2. 标签过滤
      const mathActions = await app.listActions({ tags: ["math"] });
      assert.strictEqual(mathActions.length, 2);
      assert.deepStrictEqual(mathActions.map((a) => a.id).sort(), ["calc.add", "calc.multiply"]);

      const multiTagActions = await app.listActions({ tags: ["math", "calculator"] });
      assert.strictEqual(multiTagActions.length, 1);
      assert.strictEqual(multiTagActions[0].id, "calc.add");

      // 3. 关键词查询过滤
      const queryActions = await app.listActions({ query: "multiply" });
      assert.strictEqual(queryActions.length, 1);
      assert.strictEqual(queryActions[0].id, "calc.multiply");

      // 4. 前缀过滤
      const prefixActions = await app.listActions({ prefix: "calc." });
      assert.strictEqual(prefixActions.length, 2);

      // 5. 详细规范 describeAction
      const spec = await app.describeAction("calc.add");
      assert.strictEqual(spec.id, "calc.add");
      assert.strictEqual(spec.description, "Add two numbers together");
      assert.strictEqual(spec.entry, "actions/calc-add.ts");
      assert.strictEqual(spec.filePath, join(tempDir, "actions/calc-add.ts"));
      assert.notStrictEqual(spec.inputSchema, undefined);

      // 支持完全限定标识
      const fqSpec = await app.describeAction("pkg.tools/calc.add");
      assert.strictEqual(fqSpec.id, "calc.add");

      // 不存在的 Action 抛出异常
      await assert.rejects(app.describeAction("nonexistent"), 
        /Action 'nonexistent' not found in package 'pkg\.tools'/);

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

      const app = await createPackageRuntime({
        packageRoot: tempDir,
        inMemory: true,
      });

      const playbooks = await app.listPlaybooks();
      assert.strictEqual(playbooks.length, 1);
      assert.strictEqual(playbooks[0].id, "deploy");
      assert.strictEqual(playbooks[0].description, "Deploy application to staging or production");
      assert.deepStrictEqual(playbooks[0].actions, ["build-binary", "upload-artifact"]);

      // 详细内容获取
      const spec = await app.describePlaybook("deploy");
      assert.strictEqual(spec.id, "deploy");
      assert.ok((spec.content).includes("# Deploy Procedure"));
      assert.strictEqual(spec.filePath, join(playbooksDir, "deploy.md"));

      // 支持 .md 后缀
      const specWithExt = await app.describePlaybook("deploy.md");
      assert.strictEqual(specWithExt.id, "deploy");

      // 不存在的 Playbook 抛出异常
      await assert.rejects(app.describePlaybook("unknown"), 
        /Playbook 'unknown' not found in package 'pkg\.sop'/);

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

    const app = await createPackageRuntime({
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
    assert.strictEqual(syncRes.ok, true);
    if (syncRes.ok) {
      assert.deepStrictEqual(syncRes.data, { result: 40 });
    }

    // 2. 异步执行 startAction 并返回票据
    const ticket = await app.startAction("math.sum", { x: 100, y: 200 });
    assert.notStrictEqual(ticket.runId, undefined);
    assert.strictEqual(ticket.status, "running");
    assert.notStrictEqual(ticket.result, undefined);

    const asyncRes = await ticket.result!;
    assert.strictEqual(asyncRes.ok, true);
    if (asyncRes.ok) {
      assert.deepStrictEqual(asyncRes.data, { result: 300 });
    }

    // 3. 通过 getRun 检索运行记录
    const runRecord = await app.getRun(ticket.runId);
    assert.notStrictEqual(runRecord, undefined);
    assert.strictEqual(runRecord?.id, ticket.runId);
    assert.strictEqual(runRecord?.status, "success");
    assert.strictEqual(runRecord?.actionId, "math.sum");
    assert.deepStrictEqual(runRecord?.output, { result: 300 });

    // 4. 输入校验失败分支
    const failRes = await app.runAction("math.sum", { x: "invalid" as any, y: 10 });
    assert.strictEqual(failRes.ok, false);
    if (!failRes.ok) {
      assert.strictEqual(failRes.error?.code, "INPUT_VALIDATION_FAILED");
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

    const app = await createPackageRuntime({
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
    assert.notStrictEqual(ticket.runId, undefined);

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
    assert.strictEqual(cancelRes.outcome, "requested");

    const result = await ticket.result!;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(cancelled, true);

    await eventPromise;
    assert.strictEqual(capturedEvents.some((e) => e.type === "status"), true);
    assert.strictEqual(capturedEvents.some((e) => e.type === "finish"), true);

    // 对已终态的运行执行取消返回 already_terminal
    const secondCancel = await app.cancelRun(ticket.runId);
    assert.strictEqual(secondCancel.outcome, "already_terminal");

    // 对不存在的任务取消返回 not_found
    const missingCancel = await app.cancelRun("missing-run-id");
    assert.strictEqual(missingCancel.outcome, "not_found");

    await app.close();
  });

  it("支持配置的读写与五层优先级链解析", async () => {
    const app = await createPackageRuntime({
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
    assert.strictEqual(host.value, "localhost");
    assert.strictEqual(host.configured, false);
    assert.strictEqual(host.source, "default");

    // 2. 覆盖项优先于默认值
    const port = await app.getConfig("PORT");
    assert.strictEqual(port.value, 9000);
    assert.strictEqual(port.configured, true);
    assert.strictEqual(port.source, "package");

    // 3. 通过 setConfig 写入持久化配置
    await app.setConfig("DB_NAME", "actiondock_test");
    const dbName = await app.getConfig("DB_NAME");
    assert.strictEqual(dbName.value, "actiondock_test");
    assert.strictEqual(dbName.configured, true);
    assert.strictEqual(dbName.source, "package");

    await app.close();
  });

  it("支持状态管理：getState, setState, deleteState 及命名空间隔离", async () => {
    const app = await createPackageRuntime({
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
    assert.strictEqual(val, 42);

    // 2. 指定子命名空间状态读写
    await app.setState("test-action", "token", "secret-xyz", { namespace: "auth" });
    const authVal = await app.getState<string>("test-action", "token", { namespace: "auth" });
    assert.strictEqual(authVal, "secret-xyz");

    // 3. 删除子命名空间状态
    const deletedAuth = await app.deleteState("test-action", "token", { namespace: "auth" });
    assert.strictEqual(deletedAuth, true);
    const checkDeleted = await app.getState("test-action", "token", { namespace: "auth" });
    assert.strictEqual(checkDeleted, undefined);

    // 4. 删除 Action 根状态
    const deletedRoot = await app.deleteState("test-action", "counter");
    assert.strictEqual(deletedRoot, true);
    const checkRoot = await app.getState("test-action", "counter");
    assert.strictEqual(checkRoot, undefined);

    await app.close();
  });

  it("setState/getState/deleteState 支持 StateScopeOptions 中 actionId 参数并消歧三参数调用", async () => {
    const app = await createPackageRuntime({
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
    assert.strictEqual(cached, "cached_data");

    // 2. 动态未注册 actionId，value 恰好是类似 StateScopeOptions 的对象：通过 4 参数调用消除歧义
    const stateObj = { ttl: 60, namespace: "meta" };
    await app.setState("unregistered_action", "item_key", stateObj, {});
    const retrievedObj = await app.getState<any>("unregistered_action", "item_key");
    assert.deepStrictEqual(retrievedObj, { ttl: 60, namespace: "meta" });

    // 3. deleteState 与 listStateKeys 支持 opts.actionId
    const keys = await app.listStateKeys({ actionId: "dynamic_worker" });
    assert.ok((keys).includes("cache_key"));

    const deleted = await app.deleteState("cache_key", { actionId: "dynamic_worker" });
    assert.strictEqual(deleted, true);

    const check = await app.getState("cache_key", { actionId: "dynamic_worker" });
    assert.strictEqual(check, undefined);

    await app.close();
  });

  it("setState 四参数与 options.actionId 冲突时抛出异常，并校验各状态方法冲突异常", async () => {
    const app = await createPackageRuntime({
      projectConfig: {
        id: "test.state.conflict",
        name: "State Conflict App",
        version: "1.0.0",
      },
      inMemory: true,
    });

    // 1. setState 显式位置参数与 options.actionId 冲突报错
    await assert.rejects(
      app.setState("action-a", "key1", "val1", { actionId: "action-b" })
    , 
      /Conflicting actionId specified: positional 'action\-a' vs options\.actionId 'action\-b'/);

    // 2. 正常四参数调用（options.actionId 一致或未指定）成功
    await app.setState("action-a", "key1", "val1", { actionId: "action-a" });
    const val1 = await app.getState<string>("action-a", "key1");
    assert.strictEqual(val1, "val1");

    // 3. getState 位置参数与 options.actionId 冲突报错
    await assert.rejects(
      app.getState("action-a", "key1", { actionId: "action-b" })
    , 
      /Conflicting actionId specified: positional 'action\-a' vs options\.actionId 'action\-b'/);

    // 4. deleteState 位置参数与 options.actionId 冲突报错
    await assert.rejects(
      app.deleteState("action-a", "key1", { actionId: "action-b" })
    , 
      /Conflicting actionId specified: positional 'action\-a' vs options\.actionId 'action\-b'/);

    // 5. listStateKeys 位置参数与 options.actionId 冲突报错
    await assert.rejects(
      app.listStateKeys("action-a", { actionId: "action-b" })
    , 
      /Conflicting actionId specified: positional 'action\-a' vs options\.actionId 'action\-b'/);

    // 6. clearState 位置参数与 options.actionId 冲突报错
    await assert.rejects(
      app.clearState("action-a", { actionId: "action-b" })
    , 
      /Conflicting actionId specified: positional 'action\-a' vs options\.actionId 'action\-b'/);

    await app.close();
  });

  it("支持 setActionState, getActionState, deleteActionState 显式无歧义 API", async () => {
    const app = await createPackageRuntime({
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
    assert.strictEqual(counter, 100);

    // 2. setActionState 支持子命名空间与 options.detail 读取
    await app.setActionState("calc-worker", "token", "tok_123", { namespace: "auth" });
    const authVal = await app.getActionState<string>("calc-worker", "token", { namespace: "auth" });
    assert.strictEqual(authVal, "tok_123");

    const detailEntry = await app.getActionState<any>("calc-worker", "token", {
      namespace: "auth",
      detail: true,
    });
    assert.notStrictEqual(detailEntry, undefined);
    assert.strictEqual(detailEntry.value, "tok_123");

    // 3. deleteActionState 删除状态
    const deleted = await app.deleteActionState("calc-worker", "counter");
    assert.strictEqual(deleted, true);
    const afterDelete = await app.getActionState("calc-worker", "counter");
    assert.strictEqual(afterDelete, undefined);

    // 4. setActionState / getActionState / deleteActionState 在 options.actionId 冲突时校验报错
    await assert.rejects(
      app.setActionState("calc-worker", "k", "v", { actionId: "other-worker" })
    , 
      /Conflicting actionId specified: positional 'calc\-worker' vs options\.actionId 'other\-worker'/);
    await assert.rejects(
      app.getActionState("calc-worker", "k", { actionId: "other-worker" })
    , 
      /Conflicting actionId specified: positional 'calc\-worker' vs options\.actionId 'other\-worker'/);
    await assert.rejects(
      app.deleteActionState("calc-worker", "k", { actionId: "other-worker" })
    , 
      /Conflicting actionId specified: positional 'calc\-worker' vs options\.actionId 'other\-worker'/);

    await app.close();
  });

  it("3 参数 setState 确定性作为扁平包级状态写入，杜绝启发式误判为 Action 状态", async () => {
    const app = await createPackageRuntime({
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
    assert.strictEqual(themeVal, "dark");

    // 绝不可被误当作 Action 状态写入
    const actionVal = await app.getActionState("theme", "dark");
    assert.strictEqual(actionVal, undefined);

    // 2. Action 命名空间状态显式通过 setActionState 或四参数 setState 写入
    const arbitraryValue = { ttl: 300, namespace: "custom" };
    await app.setActionState("unregistered_act", "config_meta", arbitraryValue);
    const result = await app.getActionState<typeof arbitraryValue>(
      "unregistered_act",
      "config_meta"
    );
    assert.deepStrictEqual(result, { ttl: 300, namespace: "custom" });

    await app.setState("unregistered_act_2", "config_meta_2", arbitraryValue, {});
    const result2 = await app.getActionState<typeof arbitraryValue>(
      "unregistered_act_2",
      "config_meta_2"
    );
    assert.deepStrictEqual(result2, { ttl: 300, namespace: "custom" });

    // 3. 非法三参数调用（第三参数传入非对象基元或数组）必须被显式拦截，杜绝静默写错数据
    await assert.rejects(
      (app as any).setState("worker", "counter", 42)
    , /Invalid options provided to setState/);

    await assert.rejects(
      (app as any).setState("worker", "counter", "unexpected-value")
    , /Invalid options provided to setState/);

    await assert.rejects(
      (app as any).setState("worker", "counter", [1, 2, 3])
    , /Invalid options provided to setState/);

    await app.close();

    // 4. DefaultPackageRuntime 实体类拥有与 PackageRuntime 相同的重载契约
    const concreteApp = new DefaultPackageRuntime({ inMemory: true });
    await concreteApp.setState("theme", "light");
    assert.strictEqual(await concreteApp.getState("theme"), "light");
    await concreteApp.setState("worker", "counter", 42, {});
    assert.strictEqual(await concreteApp.getActionState("worker", "counter"), 42);
    await assert.rejects(
      (concreteApp as any).setState("worker", "counter", 42)
    , /Invalid options provided to setState/);
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

    const app = await createPackageRuntime({
      projectConfig: {
        id: "test.shutdown",
        name: "Shutdown App",
        version: "1.0.0",
      },
      storage,
      actions: { dummy: dummyAction },
      inMemory: true,
    } as any);

    const res = await app.runAction("dummy", {});
    assert.strictEqual(res.ok, true);

    // 优雅关机
    await app.close();
    assert.strictEqual(customStorageClosed, true);

    // 关机后拒绝接收新任务
    await assert.rejects(app.runAction("dummy", {}),
      /is closed/);

    // 重复 close 不报错
    await app.close();
  });

  it("支持显式平台注入与默认平台回退", async () => {
    const defaultPlatform = createNodePlatform();
    assert.notStrictEqual(defaultPlatform.name, undefined);
    assert.notStrictEqual(defaultPlatform.storage, undefined);

    const app = await createPackageRuntime({
      projectConfig: {
        id: "test.platform",
        name: "Platform App",
        version: "1.0.0",
      },
      platform: defaultPlatform,
      inMemory: true,
    });

    assert.strictEqual((app as any).platform, defaultPlatform);
    await app.close();
  });

  it("describeAction 仅只读查询静态快照与已注册实例，彻底剥离 resolveAction 动态解析与执行回退", async () => {
    let resolveActionCalled = false;
    const app = await createPackageRuntime({
      projectConfig: {
        id: "test.static.describe",
        name: "Static Describe App",
        version: "1.0.0",
        actions: {
          "static-act": {
            entry: "actions/dummy.ts",
            description: "Static action description",
          },
        },
      },
      inMemory: true,
    });

    const execService = (app as any).executionService;
    if (execService) {
      const origResolve = execService.resolveAction?.bind(execService);
      execService.resolveAction = async (...args: any[]) => {
        resolveActionCalled = true;
        return origResolve ? origResolve(...args) : undefined;
      };
    }

    // 查询已声明静态动作：成功返回元数据，且不触发 resolveAction
    const spec = await app.describeAction("static-act");
    assert.strictEqual(spec.id, "static-act");
    assert.strictEqual(spec.description, "Static action description");
    assert.strictEqual(resolveActionCalled, false);

    // 查询未声明动作：直接抛出 ACTION_NOT_FOUND，不触发 resolveAction 动态回退
    await assert.rejects(
      app.describeAction("dynamic-or-unregistered"),
      /Action 'dynamic-or-unregistered' not found in package 'test\.static\.describe'/
    );
    assert.strictEqual(resolveActionCalled, false);

    await app.close();
  });
});
