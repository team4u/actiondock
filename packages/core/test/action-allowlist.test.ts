import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import { LocalActionDockService } from "../src/service";
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

  return new LocalActionDockService(host);
}

describe("Action 级别白名单 actionAllowlist 路由拦截与隔离验证", () => {
  const AUTH_TOKEN = "action-allowlist-test-token";

  describe("全限定动作白名单测试", () => {
    let service: any;
    let server: any;
    let serverUrl: string;
    let allowedRunId: string;
    let forbiddenRunId: string;

    beforeAll(async () => {
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

    afterAll(async () => {
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
      expect(res.status).toBe(200);
      const items = await res.json();
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBe(1);
      expect(items[0].packageId).toBe("pkg.math");
      expect(items[0].id).toContain("calc");
    });

    it("GET /api/v2/packages/:packageId/actions/:actionId 拦截非白名单动作", async () => {
      // 白名单动作放行
      const allowedRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(allowedRes.status).toBe(200);
      const allowedData = await allowedRes.json();
      expect(allowedData.id).toBe("calc");

      // 同包非白名单动作阻断
      const forbiddenSamePkgRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/long-task`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(forbiddenSamePkgRes.status).toBe(403);
      const forbiddenSamePkgData = await forbiddenSamePkgRes.json();
      expect(forbiddenSamePkgData.ok).toBe(false);
      expect(forbiddenSamePkgData.error.code).toBe(ACTION_FORBIDDEN);

      // 其他包同名动作阻断
      const forbiddenOtherPkgRes = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(forbiddenOtherPkgRes.status).toBe(403);
      const forbiddenOtherPkgData = await forbiddenOtherPkgRes.json();
      expect(forbiddenOtherPkgData.ok).toBe(false);
      expect(forbiddenOtherPkgData.error.code).toBe(ACTION_FORBIDDEN);
    });

    it("GET /api/v2/actions/:actionId 短路由与全限定路由拦截未授权动作", async () => {
      // 全限定允许路径
      const allowedFullRes = await fetch(`${serverUrl}/api/v2/actions/pkg.math/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(allowedFullRes.status).toBe(200);

      // 全限定未允许路径
      const forbiddenFullRes = await fetch(`${serverUrl}/api/v2/actions/pkg.extra/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(forbiddenFullRes.status).toBe(403);
      const forbiddenFullData = await forbiddenFullRes.json();
      expect(forbiddenFullData.error.code).toBe(ACTION_FORBIDDEN);

      // 短名路径未在白名单中的动作
      const forbiddenShortRes = await fetch(`${serverUrl}/api/v2/actions/long-task`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(forbiddenShortRes.status).toBe(403);
      const forbiddenShortData = await forbiddenShortRes.json();
      expect(forbiddenShortData.error.code).toBe(ACTION_FORBIDDEN);
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
      expect(allowedRunRes.status).toBe(200);
      const allowedRunData = await allowedRunRes.json();
      expect(allowedRunData.ok).toBe(true);
      expect(allowedRunData.data.result).toBe(30);

      // 未授权动作同步执行被拦截（403）
      const forbiddenRunRes = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/calc/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { x: 10, y: 20 } }),
      });
      expect(forbiddenRunRes.status).toBe(403);
      const forbiddenRunData = await forbiddenRunRes.json();
      expect(forbiddenRunData.ok).toBe(false);
      expect(forbiddenRunData.error.code).toBe(ACTION_FORBIDDEN);

      // 短路由执行未授权动作被拦截
      const forbiddenShortRunRes = await fetch(`${serverUrl}/api/v2/actions/greet/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { name: "test" } }),
      });
      expect(forbiddenShortRunRes.status).toBe(403);
      const forbiddenShortRunData = await forbiddenShortRunRes.json();
      expect(forbiddenShortRunData.ok).toBe(false);
      expect(forbiddenShortRunData.error.code).toBe(ACTION_FORBIDDEN);
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
      expect(allowedStartRes.status).toBe(202);
      const allowedStartData = await allowedStartRes.json();
      expect(allowedStartData.ok).toBe(true);
      expect(allowedStartData.runId).toBeDefined();

      // 未授权动作异步启动被拦截
      const forbiddenStartRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/long-task/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: {} }),
      });
      expect(forbiddenStartRes.status).toBe(403);
      const forbiddenStartData = await forbiddenStartRes.json();
      expect(forbiddenStartData.ok).toBe(false);
      expect(forbiddenStartData.error.code).toBe(ACTION_FORBIDDEN);
    });

    it("历史运行记录 runs 列表、查询、事件流与取消受限于 Action 白名单", async () => {
      // GET /runs 列表仅包含白名单内动作记录
      const listRunsRes = await fetch(`${serverUrl}/api/v2/runs`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(listRunsRes.status).toBe(200);
      const listRunsData = await listRunsRes.json();
      expect(listRunsData.ok).toBe(true);
      const runs = listRunsData.items;
      expect(runs.some((r: any) => r.id === allowedRunId)).toBe(true);
      expect(runs.some((r: any) => r.id === forbiddenRunId)).toBe(false);

      // GET /runs?actionId=long-task 显式查询未授权动作返回 403
      const queryForbiddenActionRes = await fetch(`${serverUrl}/api/v2/runs?actionId=long-task`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(queryForbiddenActionRes.status).toBe(403);
      const queryForbiddenActionData = await queryForbiddenActionRes.json();
      expect(queryForbiddenActionData.ok).toBe(false);
      expect(queryForbiddenActionData.error.code).toBe(ACTION_FORBIDDEN);

      // GET /runs/:runId 单次查询未授权动作记录返回 403
      const showForbiddenRunRes = await fetch(`${serverUrl}/api/v2/runs/${forbiddenRunId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(showForbiddenRunRes.status).toBe(403);
      const showForbiddenRunData = await showForbiddenRunRes.json();
      expect(showForbiddenRunData.ok).toBe(false);
      expect(showForbiddenRunData.error.code).toBe(ACTION_FORBIDDEN);

      // GET /runs/:runId 单次查询白名单动作记录返回 200
      const showAllowedRunRes = await fetch(`${serverUrl}/api/v2/runs/${allowedRunId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(showAllowedRunRes.status).toBe(200);

      // GET /runs/:runId/events 事件流访问未授权动作记录返回 403
      const eventsForbiddenRes = await fetch(`${serverUrl}/api/v2/runs/${forbiddenRunId}/events`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(eventsForbiddenRes.status).toBe(403);
      const eventsForbiddenData = await eventsForbiddenRes.json();
      expect(eventsForbiddenData.ok).toBe(false);
      expect(eventsForbiddenData.error.code).toBe(ACTION_FORBIDDEN);

      // POST /runs/:runId/cancel 取消未授权动作记录返回 403
      const cancelForbiddenRes = await fetch(`${serverUrl}/api/v2/runs/${forbiddenRunId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(cancelForbiddenRes.status).toBe(403);
      const cancelForbiddenData = await cancelForbiddenRes.json();
      expect(cancelForbiddenData.ok).toBe(false);
      expect(cancelForbiddenData.error.code).toBe(ACTION_FORBIDDEN);
    });

    it("规程 Playbook 列表不被隐藏，调用时执行拦截", async () => {
      // 规程列表保留
      const pbListRes = await fetch(`${serverUrl}/api/v2/playbooks`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(pbListRes.status).toBe(200);
      const pbList = await pbListRes.json();
      expect(pbList.some((p: any) => p.id.includes("task-sop"))).toBe(true);

      // 调用未授权动作时被阻断
      const runBlockedRes = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/long-task/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(runBlockedRes.status).toBe(403);
      const runBlockedData = await runBlockedRes.json();
      expect(runBlockedData.error.code).toBe(ACTION_FORBIDDEN);
    });
  });

  describe("短名动作白名单测试", () => {
    let service: any;
    let server: any;
    let serverUrl: string;

    beforeAll(async () => {
      service = await createTestService();
      server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        // 短名放行所有包下的 calc
        actionAllowlist: ["calc"],
      });
      serverUrl = `http://127.0.0.1:${server.port}`;
    });

    afterAll(async () => {
      if (server) {
        await server.stop();
      }
    });

    it("短名白名单放行所有包中的同名动作", async () => {
      // pkg.math/calc 允许
      const resA = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(resA.status).toBe(200);

      // pkg.extra/calc 允许
      const resB = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(resB.status).toBe(200);

      // greet 不被允许
      const resC = await fetch(`${serverUrl}/api/v2/packages/pkg.extra/actions/greet`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(resC.status).toBe(403);
      const dataC = await resC.json();
      expect(dataC.error.code).toBe(ACTION_FORBIDDEN);
    });
  });
});
