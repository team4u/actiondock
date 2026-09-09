import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import {
  createActionDockTarget,
  LocalActionDockTarget,
  RemoteActionDockTarget,
} from "../src/target";
import { startActionDockServer } from "../src/server";

describe("ActionDockTarget 统一调用门面", () => {
  describe("LocalActionDockTarget 本地门面适配", () => {
    it("包装 ActionDockApp 并透明转发全部操作", async () => {
      let cancelled = false;
      const echoAction = defineAction({
        id: "echo",
        description: "回声动作",
        tags: ["util"],
        run: (input: { msg: string }) => ({ echo: input.msg }),
      });

      const slowAction = defineAction({
        id: "slow",
        run: async (_input: unknown, ctx: ActionContext) => {
          ctx.signal.addEventListener("abort", () => {
            cancelled = true;
          });
          for (let i = 0; i < 20; i++) {
            if (ctx.signal.aborted) {
              cancelled = true;
              throw new Error("aborted");
            }
            await new Promise((r) => setTimeout(r, 20));
          }
          return { done: true };
        },
      });

      const app = await createActionDockApp({
        projectConfig: {
          id: "pkg.local-app",
          name: "本地应用包",
          version: "1.0.0",
        },
        actions: [echoAction, slowAction],
        inMemory: true,
      });

      const target = new LocalActionDockTarget(app);

      // 1. info()
      const info = (await target.info()) as any;
      expect(info.id).toBe("pkg.local-app");

      // 2. listActions()
      const actions = await target.listActions();
      expect(actions.length).toBe(2);
      expect(actions.map((a) => a.id).sort()).toEqual(["echo", "slow"]);

      // 3. describeAction()
      const spec = await target.describeAction("echo");
      expect(spec.id).toBe("echo");
      expect(spec.description).toBe("回声动作");

      // 4. runAction()
      const syncRes = await target.runAction("echo", { msg: "hello target" });
      expect(syncRes.ok).toBe(true);
      if (syncRes.ok) {
        expect(syncRes.data).toEqual({ echo: "hello target" });
      }

      // 5. startAction(), cancelRun() 与 events()
      const ticket = await target.startAction("slow", {});
      expect(ticket.runId).toBeDefined();

      const receivedEvents: any[] = [];
      const eventPromise = (async () => {
        for await (const evt of target.events(ticket.runId)) {
          receivedEvents.push(evt);
          if (evt.type === "finish") break;
        }
      })();

      await new Promise((r) => setTimeout(r, 30));
      const cancelRes = await target.cancelRun(ticket.runId, "测试取消");
      expect(cancelRes.outcome).toBe("requested");

      const asyncRes = await ticket.result!;
      expect(asyncRes.ok).toBe(false);
      expect(cancelled).toBe(true);

      await eventPromise;
      expect(receivedEvents.some((e) => e.type === "status")).toBe(true);
      expect(receivedEvents.some((e) => e.type === "finish")).toBe(true);

      // 6. getRun()
      const runRecord = await target.getRun(ticket.runId);
      expect(runRecord).toBeDefined();
      expect(runRecord?.id).toBe(ticket.runId);
      expect(runRecord?.status).toBe("cancelled");

      // 7. close()
      await target.close();
    });

    it("包装 ActionDockHost 并提供多包统一路由", async () => {
      const mathAction = defineAction({
        id: "square",
        run: (input: { n: number }) => ({ val: input.n * input.n }),
      });

      const host = await createActionDockHost({
        packages: [
          {
            projectConfig: { id: "pkg.math", name: "数学包", version: "1.0.0" },
            actions: [mathAction],
            inMemory: true,
          },
          {
            projectConfig: { id: "pkg.extra", name: "扩展包", version: "1.0.0" },
            inMemory: true,
          },
        ],
        autoLoadCurrentProject: false,
      });

      const target = new LocalActionDockTarget(host);

      // 1. info() 返回多包数组
      const infoList = (await target.info()) as any[];
      expect(Array.isArray(infoList)).toBe(true);
      expect(infoList.length).toBe(2);

      // 2. describeAction()
      const spec = await target.describeAction("pkg.math/square");
      expect(spec.id).toBe("square");

      // 3. runAction() 跨包执行
      const res = await target.runAction("pkg.math/square", { n: 9 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({ val: 81 });
      }

      await target.close();
    });
  });

  describe("createActionDockTarget 工厂函数决策分支", () => {
    it("自动识别 host / app / appOptions / hostOptions 及 remote 参数生成相应 Target", async () => {
      // 1. 传入现成 host
      const host = await createActionDockHost({ autoLoadCurrentProject: false });
      const targetHost = await createActionDockTarget({ host });
      expect(targetHost).toBeInstanceOf(LocalActionDockTarget);
      await targetHost.close();

      // 2. 传入现成 app
      const app = await createActionDockApp({ inMemory: true });
      const targetApp = await createActionDockTarget({ app });
      expect(targetApp).toBeInstanceOf(LocalActionDockTarget);
      await targetApp.close();

      // 3. 传入 appOptions
      const targetFromAppOpts = await createActionDockTarget({
        appOptions: { inMemory: true, projectConfig: { id: "pkg.from-opts", name: "Opts", version: "1.0.0" } },
      });
      expect(targetFromAppOpts).toBeInstanceOf(LocalActionDockTarget);
      await targetFromAppOpts.close();

      // 4. 传入 remote serverUrl
      const targetRemote = await createActionDockTarget({
        serverUrl: "http://127.0.0.1:8888",
        token: "tok-123",
      });
      expect(targetRemote).toBeInstanceOf(RemoteActionDockTarget);
      await targetRemote.close();
    });
  });

  describe("RemoteActionDockTarget 远程服务桥接与网络调用", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-remote-target-test-"));
    const projectDir = join(tempDir, "remote-project");
    let serverInstance: any;
    let serverUrl: string;
    const AUTH_TOKEN = "secret-token-remote-target";

    beforeAll(async () => {
      // 1. 脚手架测试工程与 Action 动作文件
      mkdirSync(join(projectDir, "actions"), { recursive: true });

      writeFileSync(
        join(projectDir, "actiondock.json"),
        JSON.stringify(
          {
            id: "remote.service",
            name: "远程服务测试包",
            version: "2.0.0",
            actionsDir: "actions",
          },
          null,
          2
        )
      );

      // 加法计算动作
      writeFileSync(
        join(projectDir, "actions", "add.ts"),
        `import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "add",
  description: "远程加法",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  run: (input: any) => ({ sum: input.a + input.b }),
});
`
      );

      // 软链接根 node_modules 保证 SDK 解析
      const rootNodeModules = resolve(__dirname, "../../../node_modules");
      if (existsSync(rootNodeModules)) {
        symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "dir");
      }

      // 2. 启动 ActionDock 服务端实例
      serverInstance = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        token: AUTH_TOKEN,
        projectRoot: projectDir,
        customHome: tempDir,
      });

      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    afterAll(async () => {
      if (serverInstance) {
        serverInstance.stop();
      }
      if (existsSync(tempDir)) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it("通过 RemoteActionDockTarget 查询元数据、检索动作与执行远程任务", async () => {
      const target = await createActionDockTarget({
        type: "remote",
        serverUrl,
        token: AUTH_TOKEN,
      });

      expect(target).toBeInstanceOf(RemoteActionDockTarget);

      // 1. info() 远程查询
      const info = await target.info();
      expect(info).toBeDefined();

      // 2. listActions() 远程列出动作
      const actions = await target.listActions();
      expect(actions.length).toBeGreaterThan(0);
      const addAct = actions.find((a) => a.id.endsWith("add"));
      expect(addAct).toBeDefined();

      // 3. describeAction() 远程查询动作规范
      const spec = await target.describeAction("remote.service/add");
      expect(spec.id).toBe("add");
      expect(spec.description).toBe("远程加法");

      // 4. runAction() 同步远程调用
      const syncRes = await target.runAction("remote.service/add", { a: 12, b: 30 });
      expect(syncRes.ok).toBe(true);
      if (syncRes.ok) {
        expect(syncRes.data).toEqual({ sum: 42 });
      }

      // 5. startAction() 异步远程调用并等待终态票据
      const ticket = await target.startAction("remote.service/add", { a: 100, b: 200 });
      expect(ticket.runId).toBeDefined();

      const asyncRes = await ticket.result!;
      expect(asyncRes.ok).toBe(true);
      if (asyncRes.ok) {
        expect(asyncRes.data).toEqual({ sum: 300 });
      }

      // 6. getRun() 检索远程运行记录
      const run = await target.getRun(ticket.runId);
      expect(run).toBeDefined();
      expect(run?.id).toBe(ticket.runId);
      expect(run?.status).toBe("success");

      // 7. cancelRun() 远程任务取消
      const cancelRes = await target.cancelRun(ticket.runId);
      expect(cancelRes.outcome).toBe("already_terminal");

      const notFoundCancel = await target.cancelRun("missing-run-id");
      expect(notFoundCancel.outcome).toBe("not_found");

      await target.close();
    });
  });
});
