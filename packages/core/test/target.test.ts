import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import {
  createActionDockTarget,
  LocalActionDockTarget,
  RemoteActionDockTarget,
  TargetError,
  CloseTimeoutError,
  TARGET_PROTOCOL_UNSUPPORTED,
  TARGET_CAPABILITY_UNAVAILABLE,
} from "../src/target";
import { startActionDockServer } from "../src/server";

describe("ActionDockTarget 统一调用门面", () => {
  describe("LocalActionDockTarget 本地门面适配", () => {
    it("包装 ActionDockApp 并透明转发全部操作", async () => {
      let cancelled = false;
      const echoAction = defineAction({
        run: (input: { msg: string }) => ({ echo: input.msg }),
      });

      const slowAction = defineAction({
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
        actions: [
          { id: "echo", action: echoAction },
          { id: "slow", action: slowAction },
        ],
        inMemory: true,
      });

      const target = new LocalActionDockTarget(app);

      // 1. info() 返回 TargetInfo 对象
      const info = await target.info();
      expect(info.id).toBe("pkg.local-app");
      expect(info.protocolVersion).toBeDefined();

      // 2. listPackages() 返回 PackageInfo 数组
      const pkgs = await target.listPackages();
      expect(pkgs.length).toBe(1);
      expect(pkgs[0].id).toBe("pkg.local-app");

      // 3. listActions()
      const actions = await target.listActions();
      expect(actions.length).toBe(2);
      expect(actions.map((a) => a.id).sort()).toEqual(["echo", "slow"]);

      // 4. describeAction()
      const spec = await target.describeAction("echo");
      expect(spec.id).toBe("echo");

      // 5. runAction()
      const syncRes = await target.runAction("echo", { msg: "hello target" });
      expect(syncRes.ok).toBe(true);
      if (syncRes.ok) {
        expect(syncRes.data).toEqual({ echo: "hello target" });
      }

      // 6. startAction(), cancelRun() 与 events()
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

      // 7. getRun()
      const runRecord = await target.getRun(ticket.runId);
      expect(runRecord).toBeDefined();
      expect(runRecord?.id).toBe(ticket.runId);
      expect(runRecord?.status).toBe("cancelled");

      // 8. close()
      await target.close();
    });

    it("LocalActionDockTarget 提供完整的配置、状态与运行历史管理能力", async () => {
      const pingAction = defineAction({
        run: () => ({ pong: true }),
      });

      const app = await createActionDockApp({
        projectConfig: {
          id: "pkg.mgmt-test",
          name: "管理测试包",
          version: "1.0.0",
        },
        actions: [{ id: "ping", action: pingAction }],
        inMemory: true,
      });

      const target = new LocalActionDockTarget(app);

      // 1. Config 管理能力
      await target.setConfig("pkg.mgmt-test", "DB_HOST", "localhost");
      const hostVal = await target.getConfig("pkg.mgmt-test", "DB_HOST");
      expect(hostVal.value).toBe("localhost");
      expect(hostVal.configured).toBe(true);

      const pkgConfig = await target.listConfig("pkg.mgmt-test");
      expect(pkgConfig.find((c) => c.key === "DB_HOST")?.value).toBe("localhost");

      const deletedConf = await target.deleteConfig("pkg.mgmt-test", "DB_HOST");
      expect(deletedConf).toBe(true);
      const confAfterDel = await target.getConfig("pkg.mgmt-test", "DB_HOST");
      expect(confAfterDel.configured).toBe(false);

      // 全局配置测试
      await target.setConfig("global", "GLOBAL_SETTING", 999);
      const globalVal = await target.getConfig("global", "GLOBAL_SETTING");
      expect(globalVal.value).toBe(999);
      const globalList = await target.listConfig("global");
      expect(globalList.find((c) => c.key === "GLOBAL_SETTING")?.value).toBe(999);
      await target.deleteConfig("global", "GLOBAL_SETTING");

      // 2. State 管理能力（增加 actionId 级作用域）
      await target.setState("pkg.mgmt-test", "ping", "counter", 10);
      const countVal = await target.getState<number>("pkg.mgmt-test", "ping", "counter");
      expect(countVal).toBe(10);

      const countDetail = await target.getState<any>("pkg.mgmt-test", "ping", "counter", { detail: true });
      expect(countDetail).toBeDefined();
      expect(countDetail.value).toBe(10);
      expect(countDetail.key).toBe("counter");

      // 命名空间状态写入与读取
      await target.setState("pkg.mgmt-test", "ping", "auth:token", "tok_secret");
      const authDetail = await target.getState<any>("pkg.mgmt-test", "ping", "auth:token", { detail: true });
      expect(authDetail.value).toBe("tok_secret");

      const keys = await target.listStateKeys("pkg.mgmt-test", "ping");
      expect(keys).toContain("counter");

      const deletedState = await target.deleteState("pkg.mgmt-test", "ping", "counter");
      expect(deletedState).toBe(true);

      const clearedCount = await target.clearState("pkg.mgmt-test", "ping", { all: true });
      expect(clearedCount).toBeGreaterThanOrEqual(1);

      // 3. Runs 运行管理能力
      await target.runAction("ping", {});
      await target.runAction("ping", {});
      const runs = await target.listRuns({ packageId: "pkg.mgmt-test" });
      expect(runs.length).toBe(2);

      const clearedRuns = await target.clearRuns!({ packageId: "pkg.mgmt-test" });
      expect(clearedRuns).toBe(2);

      const runsAfterClear = await target.listRuns({ packageId: "pkg.mgmt-test" });
      expect(runsAfterClear.length).toBe(0);

      await target.close();
    });

    it("包装 ActionDockHost 并提供多包统一路由", async () => {
      const mathAction = defineAction({
        run: (input: { n: number }) => ({ val: input.n * input.n }),
      });

      const host = await createActionDockHost({
        packages: [
          {
            projectConfig: { id: "pkg.math", name: "数学包", version: "1.0.0" },
            actions: [{ id: "square", action: mathAction }],
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

      // 1. info() 返回 TargetInfo 对象，packages 包含多包
      const info = await target.info();
      expect(info.packages).toBeDefined();
      expect(info.packages.length).toBe(2);

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
            actions: {
              add: {
                entry: "actions/add.ts",
                description: "远程加法",
                inputSchema: {
                  type: "object",
                  properties: { a: { type: "number" }, b: { type: "number" } },
                  required: ["a", "b"],
                },
              },
            },
          },
          null,
          2
        )
      );

      writeFileSync(
        join(projectDir, "actions", "add.ts"),
        `export default async function(input: { a: number; b: number }) {
  return { sum: input.a + input.b };
};
`
      );

      // 2. 启动标准 HTTP 服务（启用 Token 鉴权，未开启管理能力）
      serverInstance = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        token: AUTH_TOKEN,
        projectRoot: projectDir,
        customHome: tempDir,
        enableManagement: false,
      });
      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    afterAll(async () => {
      if (serverInstance) {
        serverInstance.stop();
      }
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it("通过 RemoteActionDockTarget 正常调用执行与自省能力", async () => {
      const target = await createActionDockTarget({
        type: "remote",
        serverUrl,
        token: AUTH_TOKEN,
      });

      // 1. info() 远程查询返回 TargetInfo
      const info = await target.info();
      expect(info.protocolVersion).toBeDefined();
      expect(info.packages.length).toBeGreaterThan(0);

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

    it("服务端未开启管理能力时调用管理方法抛出规范 TARGET_CAPABILITY_UNAVAILABLE 错误", async () => {
      const target = await createActionDockTarget({
        type: "remote",
        serverUrl,
        token: AUTH_TOKEN,
      });

      // 1. setConfig / getConfig 抛出 TARGET_CAPABILITY_UNAVAILABLE
      try {
        await target.setConfig("remote.service", "FOO", "BAR");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("TARGET_CAPABILITY_UNAVAILABLE");
      }

      try {
        await target.getConfig("remote.service", "FOO");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("TARGET_CAPABILITY_UNAVAILABLE");
      }

      // 2. setState / listStateKeys 抛出 TARGET_CAPABILITY_UNAVAILABLE
      try {
        await target.setState("remote.service", "add", "KEY", "VAL");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("TARGET_CAPABILITY_UNAVAILABLE");
      }

      try {
        await target.listStateKeys("remote.service", "add");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("TARGET_CAPABILITY_UNAVAILABLE");
      }

      await target.close();
    });

    it("服务端开启管理能力时通过 RemoteActionDockTarget 正常调用配置、状态与记录管理方法", async () => {
      const mgmtServer = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        token: AUTH_TOKEN,
        projectRoot: projectDir,
        customHome: tempDir,
        enableManagement: true,
      });

      const mgmtUrl = `http://127.0.0.1:${mgmtServer.port}`;
      const target = await createActionDockTarget({
        type: "remote",
        serverUrl: mgmtUrl,
        token: AUTH_TOKEN,
      });

      try {
        // 1. 远程配置管理
        await target.setConfig("remote.service", "REMOTE_CONF", "val123");
        const confVal = await target.getConfig("remote.service", "REMOTE_CONF");
        expect(confVal.value).toBe("val123");
        expect(confVal.configured).toBe(true);

        const allConf = await target.listConfig("remote.service");
        expect(allConf.find((c) => c.key === "REMOTE_CONF")?.value).toBe("val123");

        const deletedConf = await target.deleteConfig("remote.service", "REMOTE_CONF");
        expect(deletedConf).toBe(true);

        // 2. 远程状态管理（增加 actionId 级作用域）
        await target.setState("remote.service", "add", "remote_count", 99);
        const stateVal = await target.getState("remote.service", "add", "remote_count");
        expect(stateVal).toBe(99);

        const stateDetail = await target.getState<any>("remote.service", "add", "remote_count", { detail: true });
        expect(stateDetail).toBeDefined();
        expect(stateDetail.value).toBe(99);

        const keys = await target.listStateKeys("remote.service", "add");
        expect(keys).toContain("remote_count");

        const deletedState = await target.deleteState("remote.service", "add", "remote_count");
        expect(deletedState).toBe(true);

        // 3. 远程运行记录管理
        await target.runAction("remote.service/add", { a: 1, b: 2 });
        const runs = await target.listRuns({ packageId: "remote.service" });
        expect(runs.length).toBeGreaterThan(0);

        const cleared = await target.clearRuns!({ packageId: "remote.service" });
        expect(cleared).toBeGreaterThan(0);
      } finally {
        await target.close();
        mgmtServer.stop();
      }
    });
  });

  describe("RemoteActionDockTarget 轮询退避与超时对齐", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-remote-poll-test-"));
    const projectDir = join(tempDir, "poll-project");
    let serverInstance: any;
    let serverUrl: string;

    beforeAll(async () => {
      mkdirSync(join(projectDir, "actions"), { recursive: true });
      writeFileSync(
        join(projectDir, "actiondock.json"),
        JSON.stringify({
          id: "remote.poll",
          name: "轮询退避测试包",
          version: "2.0.0",
          actionsDir: "actions",
          actions: {
            echo: {
              entry: "actions/echo.ts",
              description: "立即返回",
              inputSchema: { type: "object" },
            },
          },
        })
      );
      writeFileSync(
        join(projectDir, "actions/echo.ts"),
        `export default async function () {
  return { done: true };
};
`
      );
      serverInstance = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        projectRoot: projectDir,
        customHome: tempDir,
        enableManagement: false,
      });
      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    afterAll(async () => {
      if (serverInstance) {
        serverInstance.stop();
      }
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it("startAction 对不存在的运行等待超时后返回含等待时长的 TIMEOUT 错误", async () => {
      const target = await createActionDockTarget({
        type: "remote",
        serverUrl,
      });

      // 直接对不存在的 runId 走 waitForRunCompletion 兜底路径（经 startAction 票据）
      const ticket = await target.startAction("remote.poll/echo", {});
      // 篡改票据结果为等待一个永不存在的运行，验证超时报文结构
      const resultPromise = (target as any).waitForRunCompletion(
        "nonexistent-run-id",
        undefined,
        undefined
      ) as Promise<{ ok: boolean; error?: { code: string; message: string } }>;
      const res = await resultPromise;
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("TIMEOUT");
      // 超时报文必须携带 runId 与已等待毫秒数（锁定行为增强契约）
      expect(res.error?.message).toContain("nonexistent-run-id");
      expect(res.error?.message).toMatch(/after \d+ms/);
      await ticket.result;
      await target.close();
    }, 90000);

    it("timeoutMs 传入较小值时等待上限仍不小于 60000ms 基准", async () => {
      const target = await createActionDockTarget({
        type: "remote",
        serverUrl,
      });
      const startedAt = Date.now();
      const res = await (target as any).waitForRunCompletion(
        "nonexistent-run-id-2",
        undefined,
        1
      );
      const elapsed = Date.now() - startedAt;
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("TIMEOUT");
      // 等待上限取 max(60000, timeoutMs)，传入 1ms 也不应提前超时
      expect(elapsed).toBeGreaterThanOrEqual(59000);
      await target.close();
    }, 90000);
  });

  describe("TargetError, CloseTimeoutError, TARGET_PROTOCOL_UNSUPPORTED 场景覆盖", () => {
    it("LocalActionDockTarget.close 发生超时时抛出 CloseTimeoutError", async () => {
      const slowApp = {
        close: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
      } as any;
      const target = new LocalActionDockTarget(slowApp);
      try {
        await target.close({ timeoutMs: 20 });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(CloseTimeoutError);
        expect(err.name).toBe("CloseTimeoutError");
        expect(err.message).toContain("timed out");
      }
    });

    it("RemoteActionDockTarget.info 遇到不兼容的协议版本时抛出 TargetError 且 code 为 TARGET_PROTOCOL_UNSUPPORTED", async () => {
      const server = createServer((req, res) => {
        if (req.url === "/api/v2/info") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "incompatible-remote",
            protocolVersion: "99.0",
            packages: [],
          }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      try {
        const target = new RemoteActionDockTarget({
          serverUrl: `http://127.0.0.1:${port}`,
        });
        try {
          await target.info();
          expect(true).toBe(false);
        } catch (err: any) {
          expect(err).toBeInstanceOf(TargetError);
          expect(err.name).toBe("TargetError");
          expect(err.code).toBe(TARGET_PROTOCOL_UNSUPPORTED);
          expect(err.message).toContain("TARGET_PROTOCOL_UNSUPPORTED");
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("RemoteActionDockTarget 调用 listStateEntries 抛出 TargetError 且 code 为 TARGET_CAPABILITY_UNAVAILABLE", async () => {
      const target = new RemoteActionDockTarget({
        serverUrl: "http://127.0.0.1:9999",
      });
      try {
        await target.listStateEntries("test.pkg");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TargetError);
        expect(err.code).toBe(TARGET_CAPABILITY_UNAVAILABLE);
      }
    });

    it("LocalActionDockTarget.listStateEntries 针对未知包抛出 TargetError 且 code 为 TARGET_CAPABILITY_UNAVAILABLE", async () => {
      const app = await createActionDockApp({
        projectConfig: { id: "pkg.test" },
        actions: [],
        inMemory: true,
      });
      const target = new LocalActionDockTarget(app);
      try {
        await target.listStateEntries("pkg.unknown");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TargetError);
        expect(err.code).toBe(TARGET_CAPABILITY_UNAVAILABLE);
      }
      await target.close();
    });
  });
});
