import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import { createActionDockTarget } from "../src/target";
import { startActionDockServer } from "../src/server";

describe("ActionDock HTTP Server v2 架构重构验证", () => {
  const AUTH_TOKEN = "v2-server-secret-token";
  let serverInstance: any;
  let serverUrl: string;
  let host: any;
  let target: any;

  beforeAll(async () => {
    const calcAction = defineAction({
      run: (input: { x: number; y: number }) => ({ result: input.x + input.y }),
    });

    const longTaskAction = defineAction({
      run: async (_input: unknown, ctx: ActionContext) => {
        for (let i = 0; i < 20; i++) {
          if (ctx.signal.aborted) {
            throw new Error("aborted");
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        return { done: true };
      },
    });

    const appA = await createActionDockApp({
      projectConfig: {
        id: "pkg.math",
        name: "Math Package",
        version: "2.0.0",
        description: "Math utilities package",
        actions: {
          calc: {
            entry: "",
            description: "算术计算动作",
            tags: ["math", "core"],
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
          "long-task": {
            entry: "",
            description: "异步长时间任务",
            tags: ["task"],
          },
        },
        playbooks: {
          "calc-sop": {
            description: "计算规程",
            actions: ["calc"],
            content: "# Calc SOP\nStep 1: calculate numbers",
          },
        } as any,
      },
      actions: {
        calc: calcAction,
        "long-task": longTaskAction,
      },
      inMemory: true,
    });

    const appB = await createActionDockApp({
      projectConfig: {
        id: "pkg.extra",
        name: "Extra Package",
        version: "1.0.0",
        description: "Extra utilities package",
      },
      inMemory: true,
    });

    host = await createActionDockHost({
      packages: [appA, appB],
      autoLoadCurrentProject: false,
      inMemory: true,
    });

    target = await createActionDockTarget({ host });

    serverInstance = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: AUTH_TOKEN,
      target,
      hostInstance: host,
      enableManagement: false,
    });

    serverUrl = `http://127.0.0.1:${serverInstance.port}`;
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
  });

  describe("健康检查端点规范化", () => {
    it("GET /health 与 GET /api/v2/health 均返回 healthy 状态与时间戳", async () => {
      for (const endpoint of ["/health", "/api/v2/health"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.status).toBe("healthy");
        expect(typeof data.timestamp).toBe("string");
        expect(data.version).toBeDefined();
      }
    });
  });

  describe("自省与多包查询端点委托", () => {
    it("GET /api/v2/info 与 GET /info 委托 target.info()", async () => {
      for (const endpoint of ["/info", "/api/v2/info"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.packages).toBeDefined();
        expect(data.packages.length).toBe(2);
      }
    });

    it("GET /api/v2/packages 与 GET /packages 委托 host.info()", async () => {
      for (const endpoint of ["/packages", "/api/v2/packages"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(Array.isArray(data.packages)).toBe(true);
        expect(data.packages.length).toBe(2);
      }
    });
  });

  describe("动作检索与执行端点委托", () => {
    it("GET /api/v2/actions 与 GET /actions 委托 target.listActions()", async () => {
      for (const endpoint of ["/actions", "/api/v2/actions"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data.some((a: any) => a.id.endsWith("calc"))).toBe(true);
      }
    });

    it("GET /api/v2/actions/:id 委托 target.describeAction()", async () => {
      const res = await fetch(`${serverUrl}/api/v2/actions/pkg.math/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("calc");
      expect(data.description).toBe("算术计算动作");
      expect(data.inputSchema).toBeDefined();
    });

    it("POST /api/v2/actions/:id/run 同步委托 target.runAction()", async () => {
      const res = await fetch(`${serverUrl}/api/v2/actions/pkg.math/calc/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          input: { x: 15, y: 27 },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data).toEqual({ result: 42 });
    });

    it("POST /api/v2/packages/:packageId/actions/:actionId/run 多包前缀路由支持", async () => {
      const res = await fetch(`${serverUrl}/api/v2/packages/pkg.math/actions/calc/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          input: { x: 100, y: 200 },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data).toEqual({ result: 300 });
    });

    it("POST /api/v2/actions/:id/start 异步任务派发", async () => {
      const res = await fetch(`${serverUrl}/api/v2/actions/pkg.math/long-task/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.runId).toBeDefined();

      const runId = data.runId;

      // GET /api/v2/runs/:id 查询运行记录
      const runRes = await fetch(`${serverUrl}/api/v2/runs/${runId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(runRes.status).toBe(200);
      const runData = await runRes.json();
      expect(runData.id).toBe(runId);

      // POST /api/v2/runs/:id/cancel 取消任务
      const cancelRes = await fetch(`${serverUrl}/api/v2/runs/${runId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ reason: "测试取消" }),
      });
      expect(cancelRes.status).toBe(200);
      const cancelData = await cancelRes.json();
      expect(cancelData.ok).toBe(true);
      expect(cancelData.status).toBe("cancelled");
    });
  });

  describe("Playbook 规程端点委托", () => {
    it("GET /api/v2/playbooks 与 GET /playbooks 委托 target.listPlaybooks()", async () => {
      for (const endpoint of ["/playbooks", "/api/v2/playbooks"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data.some((p: any) => p.id.endsWith("calc-sop"))).toBe(true);
      }
    });

    it("GET /api/v2/playbooks/:id 委托 target.describePlaybook()", async () => {
      const res = await fetch(`${serverUrl}/api/v2/playbooks/pkg.math/calc-sop`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("calc-sop");
      expect(data.description).toBe("计算规程");
      expect(data.content).toContain("# Calc SOP");
    });
  });

  describe("SSE 事件流端点 /api/v2/runs/:id/events", () => {
    it("连接 SSE 端点并接收状态事件", async () => {
      const startRes = await fetch(`${serverUrl}/api/v2/actions/pkg.math/long-task/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({}),
      });
      const startData = await startRes.json();
      const runId = startData.runId;

      const sseRes = await fetch(`${serverUrl}/api/v2/runs/${runId}/events`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

      const reader = sseRes.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        expect(text).toContain("event:");
        await reader.cancel();
      }

      await fetch(`${serverUrl}/api/v2/runs/${runId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ reason: "清理" }),
      });
    });
  });

  describe("配置与状态管理路由 403 拦截", () => {
    it("未显式开启 enableManagement 时，请求配置与状态管理接口返回 403", async () => {
      const endpoints = [
        { path: "/api/v2/config", method: "GET" },
        { path: "/api/v2/config", method: "POST", body: { key: "foo", value: "bar" } },
        { path: "/api/v2/state", method: "GET" },
        { path: "/api/v2/state/test_key", method: "GET" },
      ];

      for (const ep of endpoints) {
        const res = await fetch(`${serverUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AUTH_TOKEN}`,
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.ok).toBe(false);
        expect(data.error.code).toBe("CAPABILITY_UNAVAILABLE");
      }
    });

    it("开启 enableManagement 时，请求配置与状态管理接口正常放行", async () => {
      const mgmtApp = await createActionDockApp({
        projectConfig: { id: "pkg.mgmt", name: "Mgmt App", version: "1.0.0" },
        inMemory: true,
      });
      const mgmtHost = await createActionDockHost({
        packages: [mgmtApp],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const mgmtTarget = await createActionDockTarget({ host: mgmtHost });

      const mgmtServer = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        token: AUTH_TOKEN,
        target: mgmtTarget,
        hostInstance: mgmtHost,
        enableManagement: true,
      });

      const url = `http://127.0.0.1:${mgmtServer.port}`;
      try {
        const stateRes = await fetch(`${url}/api/v2/state`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(stateRes.status).toBe(200);
        const stateData = await stateRes.json();
        expect(stateData.ok).toBe(true);

        const configRes = await fetch(`${url}/api/v2/config`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        expect(configRes.status).toBe(200);
        const configData = await configRes.json();
        expect(configData.ok).toBe(true);
      } finally {
        await mgmtServer.stop();
      }
    });
  });
});
