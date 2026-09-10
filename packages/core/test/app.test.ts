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
    expect(host).toBe("localhost");

    // 2. 覆盖项优先于默认值
    const port = await app.getConfig("PORT");
    expect(port).toBe(9000);

    // 3. 通过 setConfig 写入持久化配置
    await app.setConfig("DB_NAME", "actiondock_test");
    const dbName = await app.getConfig("DB_NAME");
    expect(dbName).toBe("actiondock_test");

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

    // 1. 根命名空间状态读写
    await app.setState("counter", 42);
    const val = await app.getState<number>("counter");
    expect(val).toBe(42);

    // 2. 指定命名空间状态读写
    await app.setState("token", "secret-xyz", { namespace: "auth" });
    const authVal = await app.getState<string>("token", { namespace: "auth" });
    expect(authVal).toBe("secret-xyz");

    // 3. 命名空间智能检索 (auth:token)
    const smartVal = await app.getState<string>("auth:token");
    expect(smartVal).toBe("secret-xyz");

    // 4. 删除状态
    const deletedAuth = await app.deleteState("token", { namespace: "auth" });
    expect(deletedAuth).toBe(true);
    const checkDeleted = await app.getState("token", { namespace: "auth" });
    expect(checkDeleted).toBeUndefined();

    // 5. 智能删除
    const deletedRoot = await app.deleteState("counter");
    expect(deletedRoot).toBe(true);
    const checkRoot = await app.getState("counter");
    expect(checkRoot).toBeUndefined();

    await app.close();
  });

  it("优雅关机 close() 协调执行服务关机与底层存储安全关闭", async () => {
    let customStorageClosed = false;
    const storage = new SqliteRuntimeStorage({
      packageId: "test.shutdown",
      dbPath: ":memory:",
    });

    const originalClose = storage.close.bind(storage);
    storage.close = () => {
      customStorageClosed = true;
      originalClose();
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
