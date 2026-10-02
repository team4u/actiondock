import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import { createActionDock } from "../src/service";
import { formatHostForUrl, startActionDockServer } from "../src/server";

describe("ActionDock HTTP Server v2 架构重构验证", () => {
  const AUTH_TOKEN = "v2-server-secret-token";
  let serverInstance: any;
  let serverUrl: string;
  let host: any;
  let service: any;
  let target: any;

  before(async () => {
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

    const appA = await createPackageRuntime({
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

    const appB = await createPackageRuntime({
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

    service = host;
    target = service;

    serverInstance = await startActionDockServer({
      port: 0,
      hostname: "127.0.0.1",
      token: AUTH_TOKEN,
      service,
      enableManagement: false,
    });

    serverUrl = `http://127.0.0.1:${serverInstance.port}`;
  });

  after(async () => {
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
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.status, "healthy");
        assert.strictEqual(typeof data.timestamp, "string");
        assert.notStrictEqual(data.version, undefined);
      }
    });
  });

  describe("自省与多包查询端点委托", () => {
    it("GET /api/v2/info 与 GET /info 委托 target.info()", async () => {
      for (const endpoint of ["/info", "/api/v2/info"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.ok, true);
        assert.notStrictEqual(data.packages, undefined);
        assert.strictEqual(data.packages.length, 2);
      }
    });

    it("GET /api/v2/packages 与 GET /packages 委托 host.info()", async () => {
      for (const endpoint of ["/packages", "/api/v2/packages"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.ok, true);
        assert.strictEqual(Array.isArray(data.packages), true);
        assert.strictEqual(data.packages.length, 2);
      }
    });
  });

  describe("动作检索与执行端点委托", () => {
    it("GET /api/v2/actions 与 GET /actions 委托 target.listActions()", async () => {
      for (const endpoint of ["/actions", "/api/v2/actions"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(Array.isArray(data), true);
        assert.strictEqual(data.some((a: any) => a.id.endsWith("calc")), true);
      }
    });

    it("GET /api/v2/actions/:id 委托 target.describeAction()", async () => {
      const res = await fetch(`${serverUrl}/api/v2/actions/pkg.math/calc`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.id, "calc");
      assert.strictEqual(data.description, "算术计算动作");
      assert.notStrictEqual(data.inputSchema, undefined);
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
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.deepStrictEqual(data.data, { result: 42 });
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
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.deepStrictEqual(data.data, { result: 300 });
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
      assert.strictEqual(res.status, 202);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.notStrictEqual(data.runId, undefined);

      const runId = data.runId;

      // GET /api/v2/runs/:id 查询运行记录
      const runRes = await fetch(`${serverUrl}/api/v2/runs/${runId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(runRes.status, 200);
      const runData = await runRes.json();
      assert.strictEqual(runData.id, runId);

      // POST /api/v2/runs/:id/cancel 取消任务
      const cancelRes = await fetch(`${serverUrl}/api/v2/runs/${runId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ reason: "测试取消" }),
      });
      assert.strictEqual(cancelRes.status, 200);
      const cancelData = await cancelRes.json();
      assert.strictEqual(cancelData.ok, true);
      assert.strictEqual(cancelData.status, "cancelled");
    });
  });

  describe("Playbook 规程端点委托", () => {
    it("GET /api/v2/playbooks 与 GET /playbooks 委托 target.listPlaybooks()", async () => {
      for (const endpoint of ["/playbooks", "/api/v2/playbooks"]) {
        const res = await fetch(`${serverUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(Array.isArray(data), true);
        assert.strictEqual(data.some((p: any) => p.id.endsWith("calc-sop")), true);
      }
    });

    it("GET /api/v2/playbooks/:id 委托 target.describePlaybook()", async () => {
      const res = await fetch(`${serverUrl}/api/v2/playbooks/pkg.math/calc-sop`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.id, "calc-sop");
      assert.strictEqual(data.description, "计算规程");
      assert.ok((data.content).includes("# Calc SOP"));
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
      assert.strictEqual(sseRes.status, 200);
      assert.ok((sseRes.headers.get("content-type")).includes("text/event-stream"));

      const reader = sseRes.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        assert.ok((text).includes("event:"));
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
        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.ok, false);
        assert.strictEqual(data.error.code, "CAPABILITY_UNAVAILABLE");
      }
    });

    it("开启 enableManagement 时，请求配置与状态管理接口正常放行", async () => {
      const mgmtApp = await createPackageRuntime({
        projectConfig: { id: "pkg.mgmt", name: "Mgmt App", version: "1.0.0" },
        inMemory: true,
      });
      const mgmtHost = await createActionDockHost({
        packages: [mgmtApp],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const mgmtService = mgmtHost;

      const mgmtServer = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service: mgmtService,
        enableManagement: true,
      });

      const url = `http://127.0.0.1:${mgmtServer.port}`;
      try {
        const stateRes = await fetch(`${url}/api/v2/state`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(stateRes.status, 200);
        const stateData = await stateRes.json();
        assert.strictEqual(stateData.ok, true);

        const configRes = await fetch(`${url}/api/v2/config`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(configRes.status, 200);
        const configData = await configRes.json();
        assert.strictEqual(configData.ok, true);
      } finally {
        await mgmtServer.stop();
      }
    });
  });

  describe("packageAllowlist 服务权限边界拦截验证", () => {
    let allowlistServer: any;
    let allowlistUrl: string;

    before(async () => {
      allowlistServer = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        enableManagement: true,
        packageAllowlist: ["pkg.math"],
      });
      allowlistUrl = `http://127.0.0.1:${allowlistServer.port}`;
    });

    after(async () => {
      if (allowlistServer) {
        await allowlistServer.stop();
      }
    });

    it("Playbook 路由对非白名单包返回 403 并在列表中过滤", async () => {
      // 列表接口仅返回白名单包内的规程
      const listRes = await fetch(`${allowlistUrl}/api/v2/playbooks`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(listRes.status, 200);
      const listData = await listRes.json();
      assert.strictEqual(Array.isArray(listData), true);
      assert.strictEqual(listData.every((p: any) => p.packageId === "pkg.math"), true);

      // 显式查询非白名单包的规程列表返回 403
      const forbiddenListRes = await fetch(`${allowlistUrl}/api/v2/playbooks?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(forbiddenListRes.status, 403);
      const forbiddenListData = await forbiddenListRes.json();
      assert.strictEqual(forbiddenListData.ok, false);
      assert.strictEqual(forbiddenListData.error.code, "PACKAGE_NOT_ALLOWED");

      // 多包路径查询非白名单包返回 403
      const pkgPbRes = await fetch(`${allowlistUrl}/api/v2/packages/pkg.extra/playbooks/calc-sop`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(pkgPbRes.status, 403);
      const pkgPbData = await pkgPbRes.json();
      assert.strictEqual(pkgPbData.ok, false);
      assert.strictEqual(pkgPbData.error.code, "PACKAGE_NOT_ALLOWED");

      // 短路径带包前缀查询非白名单包返回 403
      const shortPbRes = await fetch(`${allowlistUrl}/api/v2/playbooks/pkg.extra/calc-sop`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(shortPbRes.status, 403);
      const shortPbData = await shortPbRes.json();
      assert.strictEqual(shortPbData.ok, false);
      assert.strictEqual(shortPbData.error.code, "PACKAGE_NOT_ALLOWED");

      // 白名单包内的规程正常访问
      const allowedPbRes = await fetch(`${allowlistUrl}/api/v2/playbooks/pkg.math/calc-sop`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(allowedPbRes.status, 200);
    });

    it("单 PackageRuntime 启动服务并配置白名单，请求短规程路由验证严格受到 packageAllowlist 拦截", async () => {
      const singleService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.standalone",
            name: "Standalone Package",
            version: "1.0.0",
            playbooks: {
              "sop-single": {
                description: "单包规程",
                content: "# SOP",
              },
            } as any,
          },
          inMemory: true,
        },
      });
      const targetOnlyServer = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        token: AUTH_TOKEN,
        service: singleService,
        packageAllowlist: ["pkg.other"],
      });
      const targetOnlyUrl = `http://127.0.0.1:${targetOnlyServer.port}`;

      try {
        const res = await fetch(`${targetOnlyUrl}/api/v2/playbooks/sop-single`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.ok, false);
        assert.strictEqual(data.error.code, "PACKAGE_NOT_ALLOWED");

        const legacyRes = await fetch(`${targetOnlyUrl}/playbooks/sop-single`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(legacyRes.status, 403);
        const legacyData = await legacyRes.json();
        assert.strictEqual(legacyData.ok, false);
        assert.strictEqual(legacyData.error.code, "PACKAGE_NOT_ALLOWED");
      } finally {
        await targetOnlyServer.stop();
        await singleService.close();
      }
    });

    it("Info 路由仅返回白名单包且下钻非白名单包返回 403", async () => {
      // GET /packages 仅返回白名单包
      const pkgsRes = await fetch(`${allowlistUrl}/api/v2/packages`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(pkgsRes.status, 200);
      const pkgsData = await pkgsRes.json();
      assert.strictEqual(pkgsData.packages.length, 1);
      assert.strictEqual(pkgsData.packages[0].id, "pkg.math");

      // GET /info 仅返回白名单包
      const infoRes = await fetch(`${allowlistUrl}/api/v2/info`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(infoRes.status, 200);
      const infoData = await infoRes.json();
      assert.strictEqual(infoData.packages.length, 1);
      assert.strictEqual(infoData.packages[0].id, "pkg.math");

      // GET /info 下钻非白名单包返回 403
      const extraInfoRes = await fetch(`${allowlistUrl}/api/v2/info?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(extraInfoRes.status, 403);
      const extraInfoData = await extraInfoRes.json();
      assert.strictEqual(extraInfoData.ok, false);
      assert.strictEqual(extraInfoData.error.code, "PACKAGE_NOT_ALLOWED");

      // GET /info 下钻白名单包正常响应
      const mathInfoRes = await fetch(`${allowlistUrl}/api/v2/info?package=pkg.math`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(mathInfoRes.status, 200);
      const mathInfoData = await mathInfoRes.json();
      assert.strictEqual(mathInfoData.id, "pkg.math");
    });

    it("Doctor 路由对非白名单包返回 403", async () => {
      const forbiddenDocRes = await fetch(`${allowlistUrl}/api/v2/doctor?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(forbiddenDocRes.status, 403);
      const forbiddenDocData = await forbiddenDocRes.json();
      assert.strictEqual(forbiddenDocData.ok, false);
      assert.strictEqual(forbiddenDocData.error.code, "PACKAGE_NOT_ALLOWED");

      const allowedDocRes = await fetch(`${allowlistUrl}/api/v2/doctor?package=pkg.math`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(allowedDocRes.status, 200);
      const allowedDocData = await allowedDocRes.json();
      assert.strictEqual(allowedDocData.ok, true);
    });

    it("Doctor 路由通过 target-only App 解析目标包的真实根目录并执行诊断", async () => {
      const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const tempDir = mkdtempSync(join(tmpdir(), "doctor-target-"));
      try {
        writeFileSync(
          join(tempDir, "actiondock.json"),
          JSON.stringify({
            id: "pkg.doctor-target",
            name: "Doctor Target Pkg",
            version: "1.0.0",
          })
        );
        const docService = await createActionDock({
          runtimeOptions: {
            packageRoot: tempDir,
            inMemory: true,
          },
        });
        const docServer = await startActionDockServer({
          port: 0,
          host: "127.0.0.1",
          token: AUTH_TOKEN,
          service: docService,
          packageAllowlist: ["pkg.doctor-target"],
        });
        const docUrl = `http://127.0.0.1:${docServer.port}`;
        try {
          const res = await fetch(`${docUrl}/api/v2/doctor?package=pkg.doctor-target`, {
            headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
          });
          assert.strictEqual(res.status, 200);
          const data = await res.json();
          assert.strictEqual(data.ok, true);
          assert.strictEqual(data.report.hasProject, true);
          assert.strictEqual(data.report.packageId, "pkg.doctor-target");
          assert.strictEqual(data.report.projectRoot, tempDir);
        } finally {
          await docServer.stop();
          await docService.close();
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("State 路由对非白名单包操作返回 403", async () => {
      // 列表查询非白名单包
      const listRes = await fetch(`${allowlistUrl}/api/v2/state?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(listRes.status, 403);
      const listData = await listRes.json();
      assert.strictEqual(listData.error.code, "PACKAGE_NOT_ALLOWED");

      // 单键查询非白名单包
      const keyRes = await fetch(`${allowlistUrl}/api/v2/state/any_key?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(keyRes.status, 403);
      const keyData = await keyRes.json();
      assert.strictEqual(keyData.error.code, "PACKAGE_NOT_ALLOWED");

      // 清空操作非白名单包
      const clearRes = await fetch(`${allowlistUrl}/api/v2/state/clear?package=pkg.extra`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({}),
      });
      assert.strictEqual(clearRes.status, 403);
      const clearData = await clearRes.json();
      assert.strictEqual(clearData.error.code, "PACKAGE_NOT_ALLOWED");

      // 默认解析白名单内的包正常放行
      const defaultRes = await fetch(`${allowlistUrl}/api/v2/state`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(defaultRes.status, 200);
      const defaultData = await defaultRes.json();
      assert.strictEqual(defaultData.packageId, "pkg.math");
    });

    it("Config 路由对非白名单包操作返回 403", async () => {
      // 查询配置非白名单包
      const queryRes = await fetch(`${allowlistUrl}/api/v2/config?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(queryRes.status, 403);
      const queryData = await queryRes.json();
      assert.strictEqual(queryData.error.code, "PACKAGE_NOT_ALLOWED");

      // 环境检查非白名单包
      const envRes = await fetch(`${allowlistUrl}/api/v2/config/env?package=pkg.extra`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(envRes.status, 403);
      const envData = await envRes.json();
      assert.strictEqual(envData.error.code, "PACKAGE_NOT_ALLOWED");

      // 设置配置非白名单包
      const setRes = await fetch(`${allowlistUrl}/api/v2/config?package=pkg.extra`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ key: "k", value: "v" }),
      });
      assert.strictEqual(setRes.status, 403);
      const setData = await setRes.json();
      assert.strictEqual(setData.error.code, "PACKAGE_NOT_ALLOWED");

      // 删除配置非白名单包
      const delRes = await fetch(`${allowlistUrl}/api/v2/config/some_key?package=pkg.extra`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(delRes.status, 403);
      const delData = await delRes.json();
      assert.strictEqual(delData.error.code, "PACKAGE_NOT_ALLOWED");

      // 白名单包正常放行
      const allowedRes = await fetch(`${allowlistUrl}/api/v2/config?package=pkg.math`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(allowedRes.status, 200);
    });

    it("默认解析包若均不在 packageAllowlist 中时返回 403", async () => {
      const emptyAllowedServer = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        enableManagement: true,
        packageAllowlist: ["pkg.unregistered"],
      });
      const emptyUrl = `http://127.0.0.1:${emptyAllowedServer.port}`;

      try {
        const stateRes = await fetch(`${emptyUrl}/api/v2/state`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(stateRes.status, 403);
        const stateData = await stateRes.json();
        assert.strictEqual(stateData.error.code, "PACKAGE_NOT_ALLOWED");

        const configRes = await fetch(`${emptyUrl}/api/v2/config`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(configRes.status, 403);
        const configData = await configRes.json();
        assert.strictEqual(configData.error.code, "PACKAGE_NOT_ALLOWED");
      } finally {
        await emptyAllowedServer.stop();
      }
    });

    it("开启 packageAllowlist 时未指定包的全局 doctor 请求返回 403", async () => {
      const globalDocRes = await fetch(`${allowlistUrl}/api/v2/doctor`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(globalDocRes.status, 403);
      const globalDocData = await globalDocRes.json();
      assert.strictEqual(globalDocData.ok, false);
      assert.strictEqual(globalDocData.error.code, "PACKAGE_NOT_ALLOWED");
    });
  });

  describe("packageAllowlist: [] 空数组白名单放行契约验证", () => {
    let emptyListServer: any;
    let emptyListUrl: string;

    before(async () => {
      const calcAction = defineAction({
        run: (input: { x: number; y: number }) => ({ result: input.x + input.y }),
      });

      const emptyAppA = await createPackageRuntime({
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
        },
        inMemory: true,
      });

      const emptyAppB = await createPackageRuntime({
        projectConfig: {
          id: "pkg.extra",
          name: "Extra Package",
          version: "1.0.0",
          description: "Extra utilities package",
        },
        inMemory: true,
      });

      const emptyHost = await createActionDockHost({
        packages: [emptyAppA, emptyAppB],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      const emptyService = emptyHost;

      emptyListServer = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service: emptyService,
        enableManagement: true,
        packageAllowlist: [],
      });
      emptyListUrl = `http://127.0.0.1:${emptyListServer.port}`;
    });

    after(async () => {
      if (emptyListServer) {
        await emptyListServer.stop();
      }
    });

    it("空数组白名单时不拦截任何包，所有包的 /packages、/info、/playbooks、Action 运行与全局 doctor 均可正常访问", async () => {
      // 1. GET /packages 返回所有包
      const pkgsRes = await fetch(`${emptyListUrl}/api/v2/packages`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(pkgsRes.status, 200);
      const pkgsData = await pkgsRes.json();
      assert.strictEqual(pkgsData.packages.length, 2);

      // 2. GET /info 返回所有包
      const infoRes = await fetch(`${emptyListUrl}/api/v2/info`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(infoRes.status, 200);
      const infoData = await infoRes.json();
      assert.strictEqual(infoData.packages.length, 2);

      // 3. GET /playbooks 正常返回规程
      const pbsRes = await fetch(`${emptyListUrl}/api/v2/playbooks`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(pbsRes.status, 200);
      const pbsData = await pbsRes.json();
      assert.strictEqual(Array.isArray(pbsData), true);
      assert.strictEqual(pbsData.some((p: any) => p.id.endsWith("calc-sop")), true);

      // 4. Action 运行正常放行
      const runRes = await fetch(`${emptyListUrl}/api/v2/actions/pkg.math/calc/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ input: { x: 2, y: 3 } }),
      });
      assert.strictEqual(runRes.status, 200);
      const runData = await runRes.json();
      assert.strictEqual(runData.ok, true);
      assert.deepStrictEqual(runData.data, { result: 5 });

      // 5. 全局 doctor 正常放行
      const docRes = await fetch(`${emptyListUrl}/api/v2/doctor`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      assert.strictEqual(docRes.status, 200);
      const docData = await docRes.json();
      assert.strictEqual(docData.ok, true);
    });
  });

  describe("exposeDebugInfo 调试与物理路径信息安全收敛验证", () => {
    it("DefaultPackageRuntime.info() 契约在 exposeDebugInfo 为 false 时不暴露 packageRoot", async () => {
      const debugApp = await createPackageRuntime({
        packageRoot: "/root/code/test-pkg",
        projectConfig: {
          id: "pkg.debug-test",
          name: "Debug Test App",
          version: "1.0.0",
        },
        exposeDebugInfo: false,
        inMemory: true,
      });

      const infoWithoutDebug = await debugApp.info();
      assert.strictEqual(infoWithoutDebug.packageRoot, undefined);

      // 运行时动态传入覆盖
      const infoWithOverride = await debugApp.info({ exposeDebugInfo: true });
      assert.strictEqual(infoWithOverride.packageRoot, "/root/code/test-pkg");

      const defaultApp = await createPackageRuntime({
        packageRoot: "/root/code/test-pkg-default",
        projectConfig: {
          id: "pkg.debug-default",
          name: "Debug Default App",
          version: "1.0.0",
        },
        inMemory: true,
      });
      const defaultInfo = await defaultApp.info();
      assert.strictEqual(defaultInfo.packageRoot, "/root/code/test-pkg-default");

      const infoExplicitFalse = await defaultApp.info({ exposeDebugInfo: false });
      assert.strictEqual(infoExplicitFalse.packageRoot, undefined);
    });

    it("HTTP Server 在 exposeDebugInfo: false 时彻底脱敏 packageRoot 与 path", async () => {
      const noDebugServer = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        enableManagement: false,
        exposeDebugInfo: false,
      });
      const noDebugUrl = `http://127.0.0.1:${noDebugServer.port}`;

      try {
        // GET /api/v2/packages
        const pkgsRes = await fetch(`${noDebugUrl}/api/v2/packages`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(pkgsRes.status, 200);
        const pkgsData = await pkgsRes.json();
        for (const pkg of pkgsData.packages) {
          assert.strictEqual(pkg.packageRoot, undefined);
          assert.strictEqual(pkg.path, undefined);
        }

        // GET /api/v2/info
        const infoRes = await fetch(`${noDebugUrl}/api/v2/info`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        });
        assert.strictEqual(infoRes.status, 200);
        const infoData = await infoRes.json();
        assert.strictEqual(infoData.projectRoot, undefined);
        for (const pkg of infoData.packages) {
          assert.strictEqual(pkg.packageRoot, undefined);
          assert.strictEqual(pkg.path, undefined);
        }
      } finally {
        await noDebugServer.stop();
      }
    });
  });

  describe("CORS 支持 PUT 与 DELETE 预检测试", () => {
    let corsServer: any;
    let corsUrl: string;

    before(async () => {
      corsServer = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        enableManagement: true,
        corsOrigins: ["http://localhost:3000", "https://app.actiondock.com"],
      });
      corsUrl = `http://127.0.0.1:${corsServer.port}`;
    });

    after(async () => {
      if (corsServer) {
        await corsServer.stop();
      }
    });

    it("OPTIONS 预检请求针对 PUT 方法返回允许方法头", async () => {
      const res = await fetch(`${corsUrl}/api/v2/state/test_key`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "Content-Type, Authorization",
        },
      });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
      const allowMethods = res.headers.get("access-control-allow-methods");
      assert.notStrictEqual(allowMethods, undefined);
      assert.ok((allowMethods).includes("PUT"));
      assert.strictEqual(allowMethods, "GET, POST, PUT, DELETE, OPTIONS");
    });

    it("OPTIONS 预检请求针对 DELETE 方法返回允许方法头", async () => {
      const res = await fetch(`${corsUrl}/api/v2/config/test_key`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.actiondock.com",
          "Access-Control-Request-Method": "DELETE",
          "Access-Control-Request-Headers": "Authorization",
        },
      });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get("access-control-allow-origin"), "https://app.actiondock.com");
      const allowMethods = res.headers.get("access-control-allow-methods");
      assert.notStrictEqual(allowMethods, undefined);
      assert.ok((allowMethods).includes("DELETE"));
      assert.strictEqual(allowMethods, "GET, POST, PUT, DELETE, OPTIONS");
    });

    it("OPTIONS 预检请求针对 Idempotency-Key、X-Request-Id 与 Last-Event-ID 返回允许请求头", async () => {
      const res = await fetch(`${corsUrl}/api/v2/runs`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "Content-Type, Authorization, Idempotency-Key, X-Request-Id, Last-Event-ID",
        },
      });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
      const allowHeaders = res.headers.get("access-control-allow-headers");
      assert.notStrictEqual(allowHeaders, undefined);
      assert.ok((allowHeaders).includes("Idempotency-Key"));
      assert.ok((allowHeaders).includes("X-Request-Id"));
      assert.ok((allowHeaders).includes("Last-Event-ID"));
      assert.strictEqual(allowHeaders, 
        "Content-Type, Authorization, Idempotency-Key, X-Request-Id, Last-Event-ID"
      );
    });
  });

  describe("ServerOptions.service 显式注入与 hostname/host 对齐验证", () => {
    it("优先读取 options.service 初始化服务门面", async () => {
      const customService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.service-instance",
            name: "Service Instance Test",
            version: "1.0.0",
            actions: {
              ping: { entry: "", description: "Ping action" },
            },
          },
          actions: {
            ping: defineAction({ run: () => ({ pong: true }) }),
          },
          inMemory: true,
        },
      });

      const server = await startActionDockServer({
        port: 0,
        service: customService,
        token: "test-token",
      });

      try {
        assert.strictEqual(server.service, customService);

        const res = await fetch(`${server.url}/api/v2/actions`, {
          headers: { Authorization: "Bearer test-token" },
        });
        assert.strictEqual(res.status, 200);
        const actions = await res.json();
        assert.strictEqual(actions.some((a: any) => a.id === "ping" || a.id.endsWith("ping")), true);
      } finally {
        await server.stop();
        await customService.close();
      }
    });

    it("当同时提供 host 字符串与 hostname 时，正确对齐至 hostname", async () => {
      const customService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.both",
            name: "Both Options Test",
            version: "1.0.0",
            actions: {
              echo: { entry: "", description: "Echo action" },
            },
          },
          actions: {
            echo: defineAction({ run: (input: any) => input }),
          },
          inMemory: true,
        },
      });

      const server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        service: customService,
        token: "test-token",
      });

      try {
        assert.strictEqual(server.service, customService);
        assert.ok((server.url).includes("127.0.0.1"));
      } finally {
        await server.stop();
        await customService.close();
      }
    });
  });

  describe("IPv6 服务 URL 拼接与 formatHostForUrl 验证", () => {
    it("formatHostForUrl 正确为未包裹的 IPv6 地址添加中括号", () => {
      assert.strictEqual(formatHostForUrl("::1"), "[::1]");
      assert.strictEqual(formatHostForUrl("::"), "[::]");
      assert.strictEqual(formatHostForUrl("2001:db8::1"), "[2001:db8::1]");
      assert.strictEqual(formatHostForUrl("[::1]"), "[::1]");
      assert.strictEqual(formatHostForUrl("[2001:db8::1]"), "[2001:db8::1]");
      assert.strictEqual(formatHostForUrl("127.0.0.1"), "127.0.0.1");
      assert.strictEqual(formatHostForUrl("localhost"), "localhost");
      assert.strictEqual(formatHostForUrl("0.0.0.0"), "0.0.0.0");
    });

    it("服务端绑定 IPv6 回环地址 ::1 时生成合法 URL", async () => {
      const server = await startActionDockServer({
        port: 0,
        hostname: "::1",
        token: "test-token",
        service,
      });

      try {
        assert.ok(/^http:\/\/\[::1\]:\d+$/.test(server.url));
        assert.doesNotThrow(() => new URL(server.url));

        const res = await fetch(`${server.url}/api/v2/health`, {
          headers: { Authorization: "Bearer test-token" },
        });
        assert.strictEqual(res.status, 200);
      } finally {
        await server.stop();
      }
    });
  });

  describe("HTTP 客户端断开触发 signal abort 验证", () => {
    it("当客户端在同步 Action 执行期间断开连接时，正确通过 req.signal 触发 abort 事件并终止执行", async () => {
      let aborted = false;
      let actionStarted = false;

      const abortApp = await createPackageRuntime({
        projectConfig: {
          id: "pkg.abortable",
          name: "Abortable Package",
          version: "1.0.0",
          actions: {
            "slow-action": { entry: "", description: "可中断耗时任务" },
          },
        },
        actions: {
          "slow-action": defineAction({
            run: async (_input: unknown, ctx: ActionContext) => {
              actionStarted = true;
              ctx.signal.addEventListener("abort", () => {
                aborted = true;
              });

              for (let i = 0; i < 50; i++) {
                if (ctx.signal.aborted) {
                  aborted = true;
                  break;
                }
                await new Promise((r) => setTimeout(r, 20));
              }
              return { done: true };
            },
          }),
        },
        inMemory: true,
      });

      const abortHost = await createActionDockHost({
        packages: [abortApp],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const abortService = abortHost;

      const server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "test-token",
        service: abortService,
      });

      try {
        const clientReq = http.request(
          {
            hostname: "127.0.0.1",
            port: server.port,
            path: "/api/v2/actions/pkg.abortable/slow-action/run",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer test-token",
            },
          },
          () => {}
        );

        clientReq.on("error", () => {});
        clientReq.write(JSON.stringify({ input: {} }));
        clientReq.end();

        // 等待动作开始执行
        while (!actionStarted) {
          await new Promise((r) => setTimeout(r, 10));
        }

        // 客户端提前关闭断开连接
        clientReq.destroy();

        // 等待服务端处理关闭事件并触发 abort
        for (let i = 0; i < 50; i++) {
          if (aborted) break;
          await new Promise((r) => setTimeout(r, 20));
        }

        assert.strictEqual(aborted, true);
      } finally {
        await server.stop();
      }
    });

    it("服务端 stop 方法按时序先拒绝新连接/排空在途请求，再关闭 service", async () => {
      const order: string[] = [];
      const mockService = {
        close: async () => {
          order.push("service.close");
        },
      } as any;

      const server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        service: mockService,
      });

      await server.stop();

      // service.close 必须在 server 停止之后执行
      assert.deepStrictEqual(order, ["service.close"]);
    });
  });
});
