import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import { startActionDockServer } from "../src/server";
import { ACTION_FORBIDDEN } from "../src/errors";

async function createTestService() {
  const calcAction = defineAction({
    id: "calc",
    description: "算术计算动作",
    run: (input: { x: number; y: number }) => ({ result: input.x + input.y }),
  });

  const longTaskAction = defineAction({
    id: "long-task",
    description: "长时间运行任务",
    run: async (_input: unknown, ctx: ActionContext) => {
      for (let i = 0; i < 50; i++) {
        if (ctx.signal.aborted) {
          throw new Error("aborted");
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      return { done: true };
    },
  });

  const greetAction = defineAction({
    id: "greet",
    description: "问候动作",
    run: (input: { name?: string }) => ({ message: `hello ${input.name || "world"}` }),
  });

  const appA = await createPackageRuntime({
    projectConfig: {
      id: "pkg.math",
      name: "Math Package",
      version: "1.0.0",
      actions: {
        calc: {
          entry: "",
          description: "算术计算动作",
          tags: ["math"],
        },
        "long-task": {
          entry: "",
          description: "长时间运行任务",
          tags: ["task"],
        },
      },
      playbooks: {
        "calc-sop": {
          description: "计算执行规程",
          actions: ["calc"],
          content: "# Calc SOP",
        },
        "task-sop": {
          description: "长任务规程",
          actions: ["long-task"],
          content: "# Task SOP",
        },
      } as any,
    },
    actions: {
      calc: calcAction,
      "long-task": longTaskAction,
    },
    inMemory: true,
  });

  const appB = await createPackageRuntime({
    projectConfig: {
      id: "pkg.extra",
      name: "Extra Package",
      version: "1.0.0",
      actions: {
        greet: {
          entry: "",
          description: "问候动作",
        },
        calc: {
          entry: "",
          description: "附加包计算动作",
        },
      },
    },
    actions: {
      greet: greetAction,
      calc: calcAction,
    },
    inMemory: true,
  });

  const host = await createActionDockHost({
    packages: [appA, appB],
    autoLoadCurrentProject: false,
    inMemory: true,
  });

  return host;
}

describe("Action 级别白名单 actionAllowlist 路由拦截与隔离验证", () => {
  const AUTH_TOKEN = "action-allowlist-test-token";

  describe("全限定动作白名单测试", () => {
    let service: any;
    let server: any;
    let serverUrl: string;
    let allowedRunId: string;
    let forbiddenRunId: string;

    before(async () => {
      service = await createTestService();

      // 预先运行生成历史运行记录
      const resAllowed = await service.execution.run({ packageId: "pkg.math", actionId: "calc" }, { x: 1, y: 2 });
      allowedRunId = resAllowed.runId;

      const ticketForbidden = await service.execution.start(
        { packageId: "pkg.math", actionId: "long-task" },
        {}
      );
      forbiddenRunId = ticketForbidden.runId;

      server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        // 仅允许 pkg.math/calc
        actionAllowlist: ["pkg.math/calc"],
      });
      serverUrl = `http://127.0.0.1:${server.port}`;
    });

    after(async () => {
      if (server) {
        await server.stop();
      }
      // 停止可能仍在运行的长任务
      if (forbiddenRunId && service) {
        await service.runs.cancel(forbiddenRunId, "test cleanup").catch(() => {});
      }
    });

    it("GET /api/v2/actions 动作列表仅返回白名单中的动作", async () => {
      const res = await fetch(`${serverUrl}/api/v2/actions`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(res.status, 200);
      const items = await res.json();
      assert.strictEqual(Array.isArray(items), true);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].packageId, "pkg.math");
      assert.ok((items[0].id).includes("calc"));
    });

    it("GET /api/v2/packages/:packageId/actions/:actionId 拦截非白名单动作", async () => {
      // 白名单动作放行
      const allowedRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(allowedRes.status, 200);
      const allowedData = await allowedRes.json();
      assert.strictEqual(allowedData.id, "calc");

      // 同包非白名单动作阻断：pkg.math 未整包授权，long-task 不在动作清单，返回 ACTION_FORBIDDEN
      const forbiddenSamePkgRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/long-task`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(forbiddenSamePkgRes.status, 403);
      const forbiddenSamePkgData = await forbiddenSamePkgRes.json();
      assert.strictEqual(forbiddenSamePkgData.ok, false);
      assert.strictEqual(forbiddenSamePkgData.error.code, ACTION_FORBIDDEN);

      // pkg.extra 没有包或动作授权，因此整个包不可见。
      const forbiddenOtherPkgRes = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/greet`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(forbiddenOtherPkgRes.status, 403);
      const forbiddenOtherPkgData = await forbiddenOtherPkgRes.json();
      assert.strictEqual(forbiddenOtherPkgData.ok, false);
      assert.strictEqual(forbiddenOtherPkgData.error.code, "PACKAGE_FORBIDDEN");
    });

    it("GET /api/v2/actions/:actionId 短路由与全限定路由拦截未授权动作", async () => {
      // 全限定允许路径
      const allowedFullRes = await fetch(`${serverUrl}/api/v2/actions/pkg.math/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(allowedFullRes.status, 200);

      // 未获任何授权的 pkg.extra 不能通过全限定动作路由访问。
      const forbiddenFullRes = await fetch(`${serverUrl}/api/v2/actions/pkg.extra/greet`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(forbiddenFullRes.status, 403);
      const forbiddenFullData = await forbiddenFullRes.json();
      assert.strictEqual(forbiddenFullData.error.code, "PACKAGE_FORBIDDEN");

      // 短名路径未在白名单中的动作：long-task 属于 pkg.math（整包未授权、动作未列）
      const forbiddenShortRes = await fetch(`${serverUrl}/api/v2/actions/long-task`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(forbiddenShortRes.status, 403);
      const forbiddenShortData = await forbiddenShortRes.json();
      assert.strictEqual(forbiddenShortData.error.code, ACTION_FORBIDDEN);
    });

    it("POST /api/v2/packages/:packageId/actions/:actionId/run 执行阻断与放行", async () => {
      // 允许动作同步执行成功
      const allowedRunRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { x: 10, y: 20 } }),
      });
      assert.strictEqual(allowedRunRes.status, 200);
      const allowedRunData = await allowedRunRes.json();
      assert.strictEqual(allowedRunData.ok, true);
      assert.strictEqual(allowedRunData.data.result, 30);

      // 未授权包 pkg.extra 的同步执行被包可见性门禁拒绝。
      const forbiddenRunRes = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/greet/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { name: "test" } }),
      });
      assert.strictEqual(forbiddenRunRes.status, 403);
      const forbiddenRunData = await forbiddenRunRes.json();
      assert.strictEqual(forbiddenRunData.ok, false);
      assert.strictEqual(forbiddenRunData.error.code, "PACKAGE_FORBIDDEN");

      // 短路由执行未授权动作被拦截
      const forbiddenShortRunRes = await fetch(`${serverUrl}/api/v2/actions/greet/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { name: "test" } }),
      });
      assert.strictEqual(forbiddenShortRunRes.status, 403);
      const forbiddenShortRunData = await forbiddenShortRunRes.json();
      assert.strictEqual(forbiddenShortRunData.ok, false);
      assert.strictEqual(forbiddenShortRunData.error.code, "PACKAGE_FORBIDDEN");
    });

    it("POST /api/v2/packages/:packageId/actions/:actionId/start 异步启动阻断与放行", async () => {
      // 允许动作异步启动成功
      const allowedStartRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { x: 5, y: 5 } }),
      });
      assert.strictEqual(allowedStartRes.status, 202);
      const allowedStartData = await allowedStartRes.json();
      assert.strictEqual(allowedStartData.ok, true);
      assert.notStrictEqual(allowedStartData.runId, undefined);

      // 未授权动作异步启动被拦截
      const forbiddenStartRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/long-task/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: {} }),
      });
      assert.strictEqual(forbiddenStartRes.status, 403);
      const forbiddenStartData = await forbiddenStartRes.json();
      assert.strictEqual(forbiddenStartData.ok, false);
      assert.strictEqual(forbiddenStartData.error.code, ACTION_FORBIDDEN);
    });

    it("历史运行记录 runs 列表、查询、事件流与取消受限于 Action 白名单", async () => {
      // GET /runs 列表仅包含白名单内动作记录
      const listRunsRes = await fetch(`${serverUrl}/api/v2/runs`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(listRunsRes.status, 200);
      const listRunsData = await listRunsRes.json();
      assert.strictEqual(listRunsData.ok, true);
      const runs = listRunsData.items;
      assert.strictEqual(runs.some((r: any) => r.id === allowedRunId), true);
      assert.strictEqual(runs.some((r: any) => r.id === forbiddenRunId), false);

      // 短名检索条件不增加授权，逐条过滤后不能出现 long-task 记录。
      const queryForbiddenActionRes = await fetch(`${serverUrl}/api/v2/runs?actionId=long-task`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(queryForbiddenActionRes.status, 200);
      assert.deepStrictEqual((await queryForbiddenActionRes.json()).items, []);

      // GET /runs/:runId 单次查询未授权动作记录返回 403
      const showForbiddenRunRes = await fetch(`${serverUrl}/api/v2/runs/${forbiddenRunId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(showForbiddenRunRes.status, 403);
      const showForbiddenRunData = await showForbiddenRunRes.json();
      assert.strictEqual(showForbiddenRunData.ok, false);
      assert.strictEqual(showForbiddenRunData.error.code, ACTION_FORBIDDEN);

      // GET /runs/:runId 单次查询白名单动作记录返回 200
      const showAllowedRunRes = await fetch(`${serverUrl}/api/v2/runs/${allowedRunId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(showAllowedRunRes.status, 200);

      // GET /runs/:runId/events 事件流访问未授权动作记录返回 403
      const eventsForbiddenRes = await fetch(`${serverUrl}/api/v2/runs/${forbiddenRunId}/events`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(eventsForbiddenRes.status, 403);
      const eventsForbiddenData = await eventsForbiddenRes.json();
      assert.strictEqual(eventsForbiddenData.ok, false);
      assert.strictEqual(eventsForbiddenData.error.code, ACTION_FORBIDDEN);

      // POST /runs/:runId/cancel 取消未授权动作记录返回 403
      const cancelForbiddenRes = await fetch(`${serverUrl}/api/v2/runs/${forbiddenRunId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(cancelForbiddenRes.status, 403);
      const cancelForbiddenData = await cancelForbiddenRes.json();
      assert.strictEqual(cancelForbiddenData.ok, false);
      assert.strictEqual(cancelForbiddenData.error.code, ACTION_FORBIDDEN);
    });

    it("规程 Playbook 列表仅整包授权可见，单动作授权不开放", async () => {
      // 仅动作白名单下无整包授权，规程列表收敛为空
      const pbListRes = await fetch(`${serverUrl}/api/v2/playbooks`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(pbListRes.status, 200);
      const pbList = await pbListRes.json();
      assert.deepStrictEqual(pbList, []);

      // 调用未授权动作时被阻断
      const runBlockedRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/long-task/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(runBlockedRes.status, 403);
      const runBlockedData = await runBlockedRes.json();
      assert.strictEqual(runBlockedData.error.code, ACTION_FORBIDDEN);
    });
  });

  describe("仅动作白名单契约验证", () => {
    let service: any;
    let server: any;
    let serverUrl: string;

    before(async () => {
      service = await createTestService();
      server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        // 仅授予两个包的 calc 精确动作，不授予任何整包能力
        actionAllowlist: ["pkg.math/calc", "pkg.extra/calc"],
      });
      serverUrl = `http://127.0.0.1:${server.port}`;
    });

    after(async () => {
      if (server) {
        await server.stop();
      }
    });

    it("精确动作白名单只放行清单内全限定动作", async () => {
      // pkg.math/calc 允许
      const resA = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(resA.status, 200);

      // pkg.extra/calc 允许
      const resB = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(resB.status, 200);

      // greet 不被允许
      const resC = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/greet`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(resC.status, 403);
      const dataC = await resC.json();
      assert.strictEqual(dataC.error.code, ACTION_FORBIDDEN);
    });

    it("短名动作白名单配置在启动时即拒绝", async () => {
      const shortNameService = await createTestService();
      try {
        await assert.rejects(
          startActionDockServer({
            port: 0,
            hostname: "127.0.0.1",
            token: AUTH_TOKEN,
            service: shortNameService,
            actionAllowlist: ["calc"],
          }),
          (err: any) => err instanceof Error && err.message.includes("actionAllowlist")
        );
      } finally {
        await shortNameService.close();
      }
    });
  });
});
