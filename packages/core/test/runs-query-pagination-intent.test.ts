import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { createActionDockHost } from "../src/host";
import { createPackageRuntime } from "../src/package";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { startActionDockServer } from "../src/server";
import { connectActionDock } from "../src";
import { DefaultExecutionService } from "../src/execution/service";
import { createPackageIdentity } from "../src/runtime/identity";
import { createInvocationContext } from "../src/invocation/types";
import { SystemClock } from "../src/storage/clock";
import { EventEmitter } from "node:events";
import { handleRunsRoutes } from "../src/server/routes/runs";
import { IpcActionDockService } from "../src/ipc/service";
import { serveParentIpc } from "../src/ipc/host";

describe("运行记录查询分页与意图过滤增强验证", () => {
  describe("真实 total 与 > 500 条数据全量分页翻页", () => {
    const AUTH_TOKEN = "pagination-test-token";
    let serverInstance: any;
    let serverUrl: string;
    let host: any;
    let storage: SqliteRuntimeStorage;
    const TOTAL_RUNS = 602;

    before(async () => {
      storage = new SqliteRuntimeStorage({
        packageId: "pkg.pagination",
        dbPath: ":memory:",
      });

      const baseTime = Date.now() - 1_000_000;
      for (let i = 0; i < TOTAL_RUNS; i++) {
        const runId = `run-page-${String(i).padStart(4, "0")}`;
        storage.createRun({
          id: runId,
          rootRunId: runId,
          packageId: "pkg.pagination",
          actionId: "noop",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
          finishedAt: new Date(baseTime + i * 1000 + 50).toISOString(),
        });
      }

      const noopAction = defineAction({
        run: async () => ({ ok: true }),
      });

      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.pagination",
          name: "Pagination Package",
          version: "1.0.0",
          actions: {
            noop: { entry: "", description: "空操作动作" },
          },
        },
        actions: { noop: noopAction },
        storage,
      } as any);

      host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      serverInstance = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service: host,
        enableManagement: false,
      });
      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    after(async () => {
      if (serverInstance) await serverInstance.stop();
      if (host) await host.close();
      if (storage) await storage.close();
    });

    it("HTTP 接口返回真实 total 602，下推 limit 与 offset 且支持按页拉取", async () => {
      const headers = {
        Authorization: `Bearer ${AUTH_TOKEN}`,
      };

      // 默认单页 limit 50，验证 total 为真实 602
      const res1 = await fetch(`${serverUrl}/api/v2/runs`, { headers });
      assert.strictEqual(res1.status, 200);
      const data1 = (await res1.json()) as any;
      assert.strictEqual(data1.ok, true);
      assert.strictEqual(data1.total, TOTAL_RUNS);
      assert.strictEqual(data1.items.length, 50);

      // 下推 offset=500, limit=500：获取最后 102 条，total 依然为 602
      const res2 = await fetch(`${serverUrl}/api/v2/runs?offset=500&limit=500`, { headers });
      assert.strictEqual(res2.status, 200);
      const data2 = (await res2.json()) as any;
      assert.strictEqual(data2.ok, true);
      assert.strictEqual(data2.total, TOTAL_RUNS);
      assert.strictEqual(data2.items.length, 102);

      // 边缘偏移量 offset=600, limit=50：获取最后 2 条
      const res3 = await fetch(`${serverUrl}/api/v2/runs?offset=600&limit=50`, { headers });
      assert.strictEqual(res3.status, 200);
      const data3 = (await res3.json()) as any;
      assert.strictEqual(data3.ok, true);
      assert.strictEqual(data3.total, TOTAL_RUNS);
      assert.strictEqual(data3.items.length, 2);
    });

    it("远端 client.runs.list 自动分页拉取完整 602 条记录不提前截断", async () => {
      const client = await connectActionDock({
        serverUrl,
        token: AUTH_TOKEN,
      });

      try {
        const allRuns = await client.runs.list();
        assert.strictEqual(allRuns.length, TOTAL_RUNS);
        const uniqueIds = new Set(allRuns.map((r) => r.id));
        assert.strictEqual(uniqueIds.size, TOTAL_RUNS);

        if (client.runs.count) {
          const totalCount = await client.runs.count();
          assert.strictEqual(totalCount, TOTAL_RUNS);
        }
      } finally {
        await client.close();
      }
    });

    it("非法 offset 校验拦截并返回 400 INVALID_ARGUMENT", async () => {
      const headers = {
        Authorization: `Bearer ${AUTH_TOKEN}`,
      };

      const invalidOffsets = ["-1", "abc", "1.5", "100001"];
      for (const off of invalidOffsets) {
        const res = await fetch(`${serverUrl}/api/v2/runs?offset=${off}`, { headers });
        assert.strictEqual(res.status, 400);
        const data = (await res.json()) as any;
        assert.strictEqual(data.ok, false);
        assert.strictEqual(data.error.code, "INVALID_ARGUMENT");
      }
    });
  });

  describe("intent 模糊匹配超过 50 条时的分批过滤", () => {
    let host: any;
    let storage: SqliteRuntimeStorage;

    before(async () => {
      storage = new SqliteRuntimeStorage({
        packageId: "pkg.intent",
        dbPath: ":memory:",
      });

      const baseTime = Date.now() - 2_000_000;
      // 写入 160 条记录：
      // 0..99 为常规任务 regular_job（不命中）
      for (let i = 0; i < 100; i++) {
        storage.createRun({
          id: `run-regular-${String(i).padStart(3, "0")}`,
          rootRunId: `run-regular-${String(i).padStart(3, "0")}`,
          packageId: "pkg.intent",
          actionId: "regular_job",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
        });
      }
      // 100..159 为命中意图的目标任务 backup_cluster（共 60 条，全部位于第 100 条之后）
      for (let i = 100; i < 160; i++) {
        storage.createRun({
          id: `run-backup-${String(i).padStart(3, "0")}`,
          rootRunId: `run-backup-${String(i).padStart(3, "0")}`,
          packageId: "pkg.intent",
          actionId: "backup_cluster",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
        });
      }

      const backupAction = defineAction({
        run: async () => ({ backup: true }),
      });
      const regularAction = defineAction({
        run: async () => ({ regular: true }),
      });

      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.intent",
          name: "Intent Package",
          version: "1.0.0",
          actions: {
            backup_cluster: { entry: "", description: "集群备份" },
            regular_job: { entry: "", description: "日常任务" },
          },
        },
        actions: {
          backup_cluster: backupAction,
          regular_job: regularAction,
        },
        storage,
      } as any);

      host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
    });

    after(async () => {
      if (host) await host.close();
      if (storage) await storage.close();
    });

    it("分批读取并累计命中记录，成功检索位于 50 条之后的全部 60 条匹配记录", async () => {
      // 不传 limit：分批读取全部数据后返回完整 60 条匹配记录
      const allMatches = await host.runs.list({ intent: "backup" });
      assert.strictEqual(allMatches.length, 60);
      for (const record of allMatches) {
        assert.strictEqual(record.actionId, "backup_cluster");
      }

      // 带 limit 与 offset 翻页：按意图先过滤后分页
      const page1 = await host.runs.list({ intent: "backup", offset: 0, limit: 25 });
      assert.strictEqual(page1.length, 25);

      const page2 = await host.runs.list({ intent: "backup", offset: 25, limit: 25 });
      assert.strictEqual(page2.length, 25);

      const page3 = await host.runs.list({ intent: "backup", offset: 50, limit: 25 });
      assert.strictEqual(page3.length, 10);

      // countRuns 准确返回 60 条
      const count = await host.countRuns({ intent: "backup" });
      assert.strictEqual(count, 60);
    });
  });

  describe("心跳异常 logger 告警可观测性", () => {
    it("心跳失败时捕获异常并通过 logger.warn 记录告警信息与堆栈", async () => {
      const warnings: Array<{ message: string; data: any }> = [];
      const mockLogger = {
        debug: () => {},
        info: () => {},
        warn: (message: string, data?: any) => {
          warnings.push({ message, data });
        },
        error: () => {},
      };

      const storage = new SqliteRuntimeStorage({
        packageId: "pkg.heartbeat",
        dbPath: ":memory:",
      });

      // 模拟底层心跳更新发生数据库异常
      const heartbeatError = new Error("Database disk I/O failure during heartbeat");
      storage.touchRunHeartbeat = () => {
        throw heartbeatError;
      };

      let timerCallback: (() => void) | undefined;
      const originalSetInterval = globalThis.setInterval;
      globalThis.setInterval = ((cb: any, ms: any) => {
        timerCallback = cb;
        return originalSetInterval(() => {}, ms);
      }) as any;

      const identity = createPackageIdentity({ id: "pkg.heartbeat" });
      const service = new DefaultExecutionService({
        identity,
        clock: new SystemClock(),
        storage,
        logger: mockLogger,
      });

      let resolveActionPromise: () => void;
      const actionPromise = new Promise<void>((resolve) => {
        resolveActionPromise = resolve;
      });

      service.registerAction({
        id: "long_running",
        run: async () => {
          await actionPromise;
          return { done: true };
        },
      });

      try {
        const ticket = await service.start(
          "long_running",
          {},
          createInvocationContext({ package: identity })
        );

        assert.ok(timerCallback, "心跳定时器回调应当被成功注册");

        // 手动触发一次心跳周期
        timerCallback();

        // 验证 logger.warn 记录了告警，包含错误信息与堆栈
        assert.strictEqual(warnings.length, 1);
        assert.ok(warnings[0].message.includes("Database disk I/O failure during heartbeat"));
        assert.ok(warnings[0].data?.stack?.includes("Database disk I/O failure"));

        // 验证执行主链路不受心跳异常影响，正常完成
        resolveActionPromise!();
        const finalResult = await ticket.result;
        assert.strictEqual(finalResult.ok, true);
      } finally {
        globalThis.setInterval = originalSetInterval;
        await service.close();
        await storage.close();
      }
    });
  });

  describe("白名单参与分页与真实总数统计", () => {
    const AUTH_TOKEN = "policy-pagination-token";
    let serverInstance: any;
    let serverUrl: string;
    let host: any;
    let storage: SqliteRuntimeStorage;
    const TOTAL_RECORDS = 602;
    const ALLOWED_COUNT = 100;

    before(async () => {
      storage = new SqliteRuntimeStorage({
        packageId: "pkg.policy_test",
        dbPath: ":memory:",
      });

      const baseTime = Date.now() - 3_000_000;
      // 写入 602 条记录：前 502 条为禁止动作，后 100 条为允许动作
      for (let i = 0; i < TOTAL_RECORDS - ALLOWED_COUNT; i++) {
        storage.createRun({
          id: `run-forbidden-${String(i).padStart(4, "0")}`,
          rootRunId: `run-forbidden-${String(i).padStart(4, "0")}`,
          packageId: "pkg.policy_test",
          actionId: "forbidden_action",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
        });
      }
      for (let i = TOTAL_RECORDS - ALLOWED_COUNT; i < TOTAL_RECORDS; i++) {
        storage.createRun({
          id: `run-allowed-${String(i).padStart(4, "0")}`,
          rootRunId: `run-allowed-${String(i).padStart(4, "0")}`,
          packageId: "pkg.policy_test",
          actionId: "allowed_action",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
        });
      }

      const allowedAction = defineAction({
        run: async () => ({ ok: true }),
      });
      const forbiddenAction = defineAction({
        run: async () => ({ ok: true }),
      });

      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.policy_test",
          name: "Policy Test Package",
          version: "1.0.0",
          actions: {
            allowed_action: { entry: "", description: "允许动作" },
            forbidden_action: { entry: "", description: "禁止动作" },
          },
        },
        actions: {
          allowed_action: allowedAction,
          forbidden_action: forbiddenAction,
        },
        storage,
      } as any);

      host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      serverInstance = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service: host,
        actionAllowlist: ["allowed_action"],
      });
      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    after(async () => {
      if (serverInstance) await serverInstance.stop();
      if (host) await host.close();
      if (storage) await storage.close();
    });

    it("602 条记录中仅 100 条允许访问时，返回 total 严格为 100 且首批返回允许访问的记录", async () => {
      const headers = { Authorization: `Bearer ${AUTH_TOKEN}` };

      // 首页拉取（limit=50, offset=0）：虽前 502 条均被禁止，但经过白名单分批过滤后首批获取到 50 条允许记录，total 为 100
      const res1 = await fetch(`${serverUrl}/api/v2/runs?limit=50&offset=0`, { headers });
      assert.strictEqual(res1.status, 200);
      const data1 = (await res1.json()) as any;
      assert.strictEqual(data1.ok, true);
      assert.strictEqual(data1.total, 100);
      assert.strictEqual(data1.items.length, 50);
      assert.ok(data1.items.every((item: any) => item.actionId === "allowed_action"));

      // 第二页拉取（limit=50, offset=50）：获取剩余 50 条允许记录，total 为 100
      const res2 = await fetch(`${serverUrl}/api/v2/runs?limit=50&offset=50`, { headers });
      assert.strictEqual(res2.status, 200);
      const data2 = (await res2.json()) as any;
      assert.strictEqual(data2.ok, true);
      assert.strictEqual(data2.total, 100);
      assert.strictEqual(data2.items.length, 50);
      assert.ok(data2.items.every((item: any) => item.actionId === "allowed_action"));

      // 第三页拉取（limit=50, offset=100）：已无更多允许记录，返回空集合，total 为 100
      const res3 = await fetch(`${serverUrl}/api/v2/runs?limit=50&offset=100`, { headers });
      assert.strictEqual(res3.status, 200);
      const data3 = (await res3.json()) as any;
      assert.strictEqual(data3.ok, true);
      assert.strictEqual(data3.total, 100);
      assert.strictEqual(data3.items.length, 0);
    });

    it("包白名单配置下 602 条记录中仅 100 条属于允许包，返回 total 严格为 100 且分页正确返回允许记录", async () => {
      const allowedStorage = new SqliteRuntimeStorage({
        packageId: "pkg.allowed_pkg",
        dbPath: ":memory:",
      });
      const forbiddenStorage = new SqliteRuntimeStorage({
        packageId: "pkg.forbidden_pkg",
        dbPath: ":memory:",
      });

      const baseTime = Date.now() - 4_000_000;
      // 写入允许包的 100 条记录
      for (let i = 0; i < 100; i++) {
        allowedStorage.createRun({
          id: `run-allow-${String(i).padStart(4, "0")}`,
          rootRunId: `run-allow-${String(i).padStart(4, "0")}`,
          packageId: "pkg.allowed_pkg",
          actionId: "noop",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
        });
      }
      // 写入禁止包的 502 条记录（时间戳更新，在降序排序中排在最前）
      for (let i = 0; i < 502; i++) {
        forbiddenStorage.createRun({
          id: `run-forbid-${String(i).padStart(4, "0")}`,
          rootRunId: `run-forbid-${String(i).padStart(4, "0")}`,
          packageId: "pkg.forbidden_pkg",
          actionId: "noop",
          status: "success",
          startedAt: new Date(baseTime + 200_000 + i * 1000).toISOString(),
        });
      }

      const noop = defineAction({ run: async () => ({ ok: true }) });
      const allowedApp = await createPackageRuntime({
        projectConfig: {
          id: "pkg.allowed_pkg",
          name: "Allowed Package",
          version: "1.0.0",
          actions: { noop: { entry: "", description: "允许动作" } },
        },
        actions: { noop },
        storage: allowedStorage,
      } as any);

      const forbiddenApp = await createPackageRuntime({
        projectConfig: {
          id: "pkg.forbidden_pkg",
          name: "Forbidden Package",
          version: "1.0.0",
          actions: { noop: { entry: "", description: "禁止动作" } },
        },
        actions: { noop },
        storage: forbiddenStorage,
      } as any);

      const multiHost = await createActionDockHost({
        packages: [allowedApp, forbiddenApp],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      const server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "pkg-allow-token",
        service: multiHost,
        packageAllowlist: ["pkg.allowed_pkg"],
      });
      const serverBase = `http://127.0.0.1:${server.port}`;
      const headers = { Authorization: "Bearer pkg-allow-token" };

      try {
        // 第一页（offset: 0, limit: 50）：即使禁止包记录排在前面，仍正确返回前 50 条允许记录，total 为 100
        const res1 = await fetch(`${serverBase}/api/v2/runs?limit=50&offset=0`, { headers });
        assert.strictEqual(res1.status, 200);
        const data1 = (await res1.json()) as any;
        assert.strictEqual(data1.ok, true);
        assert.strictEqual(data1.total, 100);
        assert.strictEqual(data1.items.length, 50);
        assert.ok(data1.items.every((item: any) => item.packageId === "pkg.allowed_pkg"));

        // 第二页（offset: 50, limit: 50）：返回剩余 50 条允许记录
        const res2 = await fetch(`${serverBase}/api/v2/runs?limit=50&offset=50`, { headers });
        assert.strictEqual(res2.status, 200);
        const data2 = (await res2.json()) as any;
        assert.strictEqual(data2.ok, true);
        assert.strictEqual(data2.total, 100);
        assert.strictEqual(data2.items.length, 50);
        assert.ok(data2.items.every((item: any) => item.packageId === "pkg.allowed_pkg"));

        // 第三页（offset: 100, limit: 50）：无更多允许记录，返回空集合
        const res3 = await fetch(`${serverBase}/api/v2/runs?limit=50&offset=100`, { headers });
        assert.strictEqual(res3.status, 200);
        const data3 = (await res3.json()) as any;
        assert.strictEqual(data3.ok, true);
        assert.strictEqual(data3.total, 100);
        assert.strictEqual(data3.items.length, 0);

        // 显式查询被禁止的包返回 403
        const resForbidden = await fetch(`${serverBase}/api/v2/runs?packageId=pkg.forbidden_pkg`, { headers });
        assert.strictEqual(resForbidden.status, 403);
      } finally {
        await server.stop();
        await multiHost.close();
        await allowedStorage.close();
        await forbiddenStorage.close();
      }
    });
  });

  describe("缺少统计能力时的可靠分页降级", () => {
    it("未提供 count 且当前页记录数小于 limit 时返回确切总数", async () => {
      const mockRuns = [
        { id: "run-1", packageId: "pkg.test", actionId: "act1" },
        { id: "run-2", packageId: "pkg.test", actionId: "act1" },
      ];
      const mockService: any = {
        runs: {
          list: async () => mockRuns,
        },
      };

      const ctx: any = {
        req: new Request("http://127.0.0.1/api/v2/runs?limit=10&offset=5"),
        url: new URL("http://127.0.0.1/api/v2/runs?limit=10&offset=5"),
        pathname: "/api/v2/runs",
        corsHeaders: {},
        options: {},
        service: mockService,
        activePolicy: {},
      };

      const res = await handleRunsRoutes(ctx);
      assert.ok(res);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.items.length, 2);
      assert.strictEqual(data.total, 7);
    });

    it("未提供 count 且当前页记录数等于 limit 时总数未知不伪造 total", async () => {
      const mockRuns = [
        { id: "run-1", packageId: "pkg.test", actionId: "act1" },
        { id: "run-2", packageId: "pkg.test", actionId: "act1" },
      ];
      const mockService: any = {
        runs: {
          list: async () => mockRuns,
        },
      };

      const ctx: any = {
        req: new Request("http://127.0.0.1/api/v2/runs?limit=2&offset=0"),
        url: new URL("http://127.0.0.1/api/v2/runs?limit=2&offset=0"),
        pathname: "/api/v2/runs",
        corsHeaders: {},
        options: {},
        service: mockService,
        activePolicy: {},
      };

      const res = await handleRunsRoutes(ctx);
      assert.ok(res);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.items.length, 2);
      assert.strictEqual("total" in data, false);
      assert.strictEqual(data.total, undefined);
    });

    it("未提供 count 且首页记录数为空时确切返回 total 为 0", async () => {
      const mockService: any = {
        runs: {
          list: async () => [],
        },
      };

      const ctx: any = {
        req: new Request("http://127.0.0.1/api/v2/runs?limit=10&offset=0"),
        url: new URL("http://127.0.0.1/api/v2/runs?limit=10&offset=0"),
        pathname: "/api/v2/runs",
        corsHeaders: {},
        options: {},
        service: mockService,
        activePolicy: {},
      };

      const res = await handleRunsRoutes(ctx);
      assert.ok(res);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.items.length, 0);
      assert.strictEqual(data.total, 0);
    });

    it("未提供 count 且非零 offset 查询返回空页时省略 total", async () => {
      const mockService: any = {
        runs: {
          list: async () => [],
        },
      };

      const ctx: any = {
        req: new Request("http://127.0.0.1/api/v2/runs?limit=50&offset=1000"),
        url: new URL("http://127.0.0.1/api/v2/runs?limit=50&offset=1000"),
        pathname: "/api/v2/runs",
        corsHeaders: {},
        options: {},
        service: mockService,
        activePolicy: {},
      };

      const res = await handleRunsRoutes(ctx);
      assert.ok(res);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.items.length, 0);
      assert.strictEqual("total" in data, false);
      assert.strictEqual(data.total, undefined);
    });

    it("服务缺少 runs.count 且包含 602 条记录时，HTTP 接口不伪造 total 且 client 能可靠翻页拉取全部 602 条记录", async () => {
      const storage = new SqliteRuntimeStorage({
        packageId: "pkg.no_count_test",
        dbPath: ":memory:",
      });

      const baseTime = Date.now() - 5_000_000;
      for (let i = 0; i < 602; i++) {
        storage.createRun({
          id: `run-nocount-${String(i).padStart(4, "0")}`,
          rootRunId: `run-nocount-${String(i).padStart(4, "0")}`,
          packageId: "pkg.no_count_test",
          actionId: "noop",
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
        });
      }

      const noop = defineAction({ run: async () => ({ ok: true }) });
      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.no_count_test",
          name: "No Count Test",
          version: "1.0.0",
          actions: { noop: { entry: "", description: "动作" } },
        },
        actions: { noop },
        storage,
      } as any);

      const host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      // 构造缺少 count 能力的只读服务
      const serviceWithoutCount: any = {
        ...host,
        close: async (opts?: any) => host.close(opts),
        runs: {
          ...host.runs,
          count: undefined,
        },
      };

      const serverToken = "no-count-token";
      const serverInstance = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: serverToken,
        service: serviceWithoutCount,
        enableManagement: false,
      });
      const serverUrl = `http://127.0.0.1:${serverInstance.port}`;

      try {
        // HTTP 接口单页拉取：当结果集达到 limit 500 时，不返回伪造的 total: 500
        const res = await fetch(`${serverUrl}/api/v2/runs?limit=500&offset=0`, {
          headers: { Authorization: `Bearer ${serverToken}` },
        });
        assert.strictEqual(res.status, 200);
        const data = (await res.json()) as any;
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.items.length, 500);
        assert.strictEqual("total" in data, false);
        assert.strictEqual(data.total, undefined);

        // 远端 client.runs.list 能够可靠继续翻页并拉取到全部 602 条记录，不提前在 500 退出
        const client = await connectActionDock({
          serverUrl,
          token: serverToken,
        });

        try {
          const allRuns = await client.runs.list();
          assert.strictEqual(allRuns.length, 602);
          const uniqueIds = new Set(allRuns.map((r) => r.id));
          assert.strictEqual(uniqueIds.size, 602);

          assert.ok(client.runs.count);
          const fallbackCount = await client.runs.count();
          assert.strictEqual(fallbackCount, 602);
          const countWithLimit = await client.runs.count({ limit: 20 });
          assert.strictEqual(countWithLimit, 602);
          const countWithOffset = await client.runs.count({ offset: 500 });
          assert.strictEqual(countWithOffset, 602);
          const countWithBoth = await client.runs.count({ limit: 20, offset: 500 });
          assert.strictEqual(countWithBoth, 602);
        } finally {
          await client.close();
        }
      } finally {
        await serverInstance.stop();
        await host.close();
        await storage.close();
      }
    });
  });

  describe("IPC 统计链路正常调用", () => {
    it("IpcActionDockService.runs.count 经 IPC 通道转发并获取底层 count 结果", async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.exitCode = 0;
      let recordedCall: any = null;

      mockChild.send = (msg: any, cb?: (err?: Error) => void) => {
        if (msg.type === "call") {
          recordedCall = msg;
          process.nextTick(() => {
            mockChild.emit("message", {
              type: "response",
              id: msg.id,
              ok: true,
              data: 100,
            });
          });
        }
        cb?.();
      };

      const ipcService = new IpcActionDockService({
        childProcess: mockChild,
        enableManagement: false,
      });

      mockChild.emit("message", { type: "ready" });
      await ipcService.waitReady();

      // 正向统计调用与参数透传
      const count = await ipcService.runs.count!({ status: "success", packageId: "pkg.ipc_test" });
      assert.strictEqual(count, 100);
      assert.strictEqual(recordedCall.method, "countRuns");
      assert.deepStrictEqual(recordedCall.args[0], { status: "success", packageId: "pkg.ipc_test" });

      // 取消信号测试：已中止的 signal 直接抛出 AbortError
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        async () => {
          await ipcService.runs.count!({}, { signal: controller.signal });
        },
        (err: any) => err.name === "AbortError"
      );

      await ipcService.close();
    });

    it("serveParentIpc 响应 countRuns 调用并透传底层 runs.count 结果", async () => {
      let hostCountQuery: any = null;
      const mockHostService: any = {
        runs: {
          count: async (query: any) => {
            hostCountQuery = query;
            return 88;
          },
        },
        close: async () => {},
      };

      const originalSend = process.send;
      const sentMessages: any[] = [];
      process.send = (msg: any) => {
        sentMessages.push(msg);
        return true;
      };

      const beforeListeners = process.listeners("message");
      try {
        await serveParentIpc(mockHostService);

        (process as any).emit("message", {
          id: "call-count-ipc",
          type: "call",
          method: "countRuns",
          args: [{ packageId: "pkg.host_test", status: "completed" }],
        });

        await new Promise((resolve) => setImmediate(resolve));

        assert.deepStrictEqual(hostCountQuery, { packageId: "pkg.host_test", status: "completed" });
        const resp = sentMessages.find((m) => m.id === "call-count-ipc");
        assert.ok(resp);
        assert.strictEqual(resp.ok, true);
        assert.strictEqual(resp.data, 88);
      } finally {
        process.send = originalSend;
        const afterListeners = process.listeners("message");
        for (const l of afterListeners) {
          if (!beforeListeners.includes(l)) {
            process.removeListener("message", l);
          }
        }
      }
    });
  });
});
