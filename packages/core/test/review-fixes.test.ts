import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { ActionDockError } from "../src/errors.ts";
import { markIpcSignal } from "../src/ipc/service.ts";
import { createActionDockHost } from "../src/host/index.ts";
import { RemoteActionDockService } from "../src/service/remote.ts";
import { handleRunsRoutes } from "../src/server/routes/runs.ts";

describe("问题修复综合验证", () => {
  describe("1. IPC 重复引用与循环引用校验", () => {
    it("正确保留同一配置对象的多次合法引用，不将重复引用误判为循环引用", () => {
      const sharedConfig = { endpoint: "https://api.example.com", key: "secret123" };
      const options = {
        config: {
          primary: sharedConfig,
          backup: sharedConfig,
        },
        filters: [sharedConfig, sharedConfig],
      };

      const result = markIpcSignal(options);
      assert.deepStrictEqual(result, {
        config: {
          primary: { endpoint: "https://api.example.com", key: "secret123" },
          backup: { endpoint: "https://api.example.com", key: "secret123" },
        },
        filters: [
          { endpoint: "https://api.example.com", key: "secret123" },
          { endpoint: "https://api.example.com", key: "secret123" },
        ],
      });
    });

    it("检测到真实循环引用时阻断环路并剪除循环引用属性，安全返回合法属性", () => {
      const circularObj: any = { name: "loop" };
      circularObj.self = circularObj;

      const res = markIpcSignal({ config: circularObj });
      assert.deepStrictEqual(res, { config: { name: "loop" } });
    });

    it("根选项对象自身存在循环引用时安全阻断环路", () => {
      const circularRoot: any = { timeoutMs: 5000 };
      circularRoot.child = circularRoot;

      const res = markIpcSignal(circularRoot);
      assert.deepStrictEqual(res, { timeoutMs: 5000 });
    });
  });

  describe("2. 取消链路闭合与查询停止验证", () => {
    it("Host listRuns 收到取消信号后停止内部后续批次查询，且不取消被观察的任务", async () => {
      let batchCount = 0;
      let cancelCalled = false;
      const controller = new AbortController();

      const fakeRuntime: any = {
        packageId: "test-pkg",
        identity: { id: "test-pkg", instanceId: "inst-1", generation: "gen-1" },
        projectConfig: { id: "test-pkg", name: "test-pkg", version: "1.0.0" },
        isOpen: () => true,
        isClosed: false,
        open: async () => {},
        close: async () => {},
        info: async () => ({ id: "test-pkg", name: "test-pkg", version: "1.0.0" }),
        runAction: async () => ({ ok: true, runId: "test-run" }),
        listActions: async () => [],
        describeAction: async () => ({}),
        listPlaybooks: async () => [],
        describePlaybook: async () => ({}),
        listRuns: async (opts: any) => {
          batchCount++;
          if (batchCount === 1) {
            // 在第 1 批次读取完毕后立即中止信号
            controller.abort(new Error("Query aborted"));
          }
          return Array.from({ length: 100 }, (_, i) => ({
            id: `run-${batchCount}-${i}`,
            actionId: "demo.action",
            packageId: "test-pkg",
            status: "running",
            startedAt: new Date().toISOString(),
          }));
        },
        getRun: async (runId: string) => ({
          id: runId,
          actionId: "demo.action",
          packageId: "test-pkg",
          status: "running",
          startedAt: new Date().toISOString(),
        }),
        cancelRun: async () => {
          cancelCalled = true;
          return { ok: true };
        },
      };

      const host = await createActionDockHost({
        packages: [fakeRuntime],
        autoLoadCurrentProject: false,
        scanLinkedPackages: false,
        inMemory: true,
      });

      await assert.rejects(
        host.runs.list({ intent: "demo" }, { signal: controller.signal }),
        (err: any) => err.name === "AbortError"
      );

      // 等待异步任务微任务队列稳定
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 仅读取了 1 个批次便停止，未在后台继续循环读取第 2 批次
      assert.strictEqual(batchCount, 1);
      // 未误调用 cancelRun 取消被观察的运行任务
      assert.strictEqual(cancelCalled, false);

      await host.close();
    });

    it("Server GET /runs 路由传递取消信号并在中止后停止继续读取多个批次", async () => {
      let batchCount = 0;
      const controller = new AbortController();

      const mockService: any = {
        runs: {
          list: async (_query: any, opts: any) => {
            batchCount++;
            if (batchCount === 1) {
              controller.abort(new Error("Request aborted by client"));
            }
            return Array.from({ length: 100 }, (_, i) => ({
              id: `run-${batchCount}-${i}`,
              actionId: "demo.action",
              packageId: "allowed-pkg",
              status: "running",
              startedAt: new Date().toISOString(),
            }));
          },
        },
      };

      const req = new Request("http://127.0.0.1:5177/api/v2/runs", {
        signal: controller.signal,
      });

      const ctx: any = {
        req,
        url: new URL(req.url),
        pathname: "/api/v2/runs",
        corsHeaders: {},
        projectRoot: null,
        service: mockService,
        options: {},
        activePolicy: {
          packageAllowlist: ["allowed-pkg"],
        },
      };

      await assert.rejects(
        handleRunsRoutes(ctx),
        (err: any) => err.name === "AbortError" || controller.signal.aborted
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      // 只读取了 1 个批次即中止，不再继续读取后续批次
      assert.strictEqual(batchCount, 1);
    });
  });

  describe("3. 远端分页边界一致性验证", () => {
    it("请求 limit: 1000 时，单页上限 500 的服务端通过自动分批完整返回 602 条记录", async () => {
      const totalRecords = 602;
      const allRecords = Array.from({ length: totalRecords }, (_, i) => ({
        id: `run-${i}`,
        actionId: "test.action",
        packageId: "test-pkg",
        status: "success",
        startedAt: new Date(Date.now() - i * 1000).toISOString(),
      }));

      const requestLogs: Array<{ limit: number; offset: number }> = [];

      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === "/api/v2/runs") {
          const rawLimit = Number(url.searchParams.get("limit") || 50);
          const rawOffset = Number(url.searchParams.get("offset") || 0);
          // 模拟服务端行为：上限 500
          const serverClampedLimit = Math.min(Math.max(rawLimit, 1), 500);
          requestLogs.push({ limit: serverClampedLimit, offset: rawOffset });

          const items = allRecords.slice(rawOffset, rawOffset + serverClampedLimit);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, items, total: totalRecords }));
          return;
        }
        res.writeHead(404).end();
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const remote = new RemoteActionDockService({
          serverUrl,
          allowInsecureHttp: true,
        });

        const runs = await remote.runs.list({ limit: 1000 });
        // 完整返回 602 条记录
        assert.strictEqual(runs.length, 602);
        // 发起 2 次请求：第 1 次 limit: 500 offset: 0，第 2 次 limit: 500 offset: 500
        assert.strictEqual(requestLogs.length, 2);
        assert.deepStrictEqual(requestLogs[0], { limit: 500, offset: 0 });
        assert.deepStrictEqual(requestLogs[1], { limit: 500, offset: 500 });
      } finally {
        server.close();
      }
    });

    it("自动遍历超过 100000 偏移量的数据集时明确报超限异常，严禁静默截断返回不完整结果", async () => {
      const requestLogs: Array<{ limit: number; offset: number }> = [];

      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === "/api/v2/runs") {
          const rawLimit = Number(url.searchParams.get("limit") || 50);
          const rawOffset = Number(url.searchParams.get("offset") || 0);

          if (rawOffset > 100_000) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: false,
              error: {
                code: "INVALID_ARGUMENT",
                message: `Invalid offset '${rawOffset}': must be a non-negative safe integer <= 100000`,
              },
            }));
            return;
          }

          requestLogs.push({ limit: rawLimit, offset: rawOffset });

          // 每次返回 500 条数据
          const items = Array.from({ length: rawLimit }, (_, i) => ({
            id: `run-${rawOffset + i}`,
            actionId: "test.action",
            packageId: "test-pkg",
            status: "success",
            startedAt: new Date().toISOString(),
          }));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, items, total: 100_501 }));
          return;
        }
        res.writeHead(404).end();
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const remote = new RemoteActionDockService({
          serverUrl,
          allowInsecureHttp: true,
        });

        // 模拟从 99000 开始自动遍历，共 100501 条，跨越 100000 边界且未完成全量数据拉取时抛出 INVALID_ARGUMENT 异常
        await assert.rejects(
          async () => {
            await remote.runs.list({ offset: 99000 });
          },
          (err: any) => {
            assert(err instanceof ActionDockError);
            assert.strictEqual(err.code, "INVALID_ARGUMENT");
            assert(err.message.includes("100500") || err.message.includes("100000"));
            return true;
          }
        );

        // 最后一个发出的请求 offset 为 100000，不会向服务端发出 offset 100500 的非法请求
        const lastRequest = requestLogs[requestLogs.length - 1];
        assert.strictEqual(lastRequest.offset, 100_000);
      } finally {
        server.close();
      }
    });

    it("远端遍历指定 limit 并在 100000 偏移量上限内恰好完成时正常返回结果", async () => {
      const requestLogs: Array<{ limit: number; offset: number }> = [];

      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === "/api/v2/runs") {
          const rawLimit = Number(url.searchParams.get("limit") || 50);
          const rawOffset = Number(url.searchParams.get("offset") || 0);

          if (rawOffset > 100_000) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: false,
              error: {
                code: "INVALID_ARGUMENT",
                message: `Invalid offset '${rawOffset}': must be a non-negative safe integer <= 100000`,
              },
            }));
            return;
          }

          requestLogs.push({ limit: rawLimit, offset: rawOffset });

          const items = Array.from({ length: rawLimit }, (_, i) => ({
            id: `run-${rawOffset + i}`,
            actionId: "test.action",
            packageId: "test-pkg",
            status: "success",
            startedAt: new Date().toISOString(),
          }));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, items, total: 100_501 }));
          return;
        }
        res.writeHead(404).end();
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const remote = new RemoteActionDockService({
          serverUrl,
          allowInsecureHttp: true,
        });

        // 明确请求 1500 条记录：在 offset 100000 处恰好完成 1500 条目标，不需要后续请求
        const runs = await remote.runs.list({ offset: 99000, limit: 1500 });
        assert.strictEqual(runs.length, 1500);
        assert.strictEqual(requestLogs.length, 3);
        assert.strictEqual(requestLogs[2].offset, 100_000);
      } finally {
        server.close();
      }
    });

    it("远端遍历过程中收到取消信号时立即中止后续网络请求", async () => {
      let callCount = 0;
      const controller = new AbortController();

      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === "/api/v2/runs") {
          callCount++;
          if (callCount === 1) {
            controller.abort(new Error("Client aborted"));
          }
          const items = Array.from({ length: 500 }, (_, i) => ({
            id: `run-${i}`,
            actionId: "test.action",
            packageId: "test-pkg",
            status: "success",
            startedAt: new Date().toISOString(),
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, items, total: 2000 }));
          return;
        }
        res.writeHead(404).end();
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const remote = new RemoteActionDockService({
          serverUrl,
          allowInsecureHttp: true,
        });

        await assert.rejects(
          remote.runs.list({ limit: 1000 }, { signal: controller.signal }),
          (err: any) => err.name === "AbortError"
        );

        assert.strictEqual(callCount, 1);
      } finally {
        server.close();
      }
    });
  });
});
