import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";

describe("运行记录查询过滤下推与多维筛选", () => {
  let storage: SqliteRuntimeStorage;
  let runtime: any;
  let host: any;

  before(async () => {
    storage = new SqliteRuntimeStorage({
      packageId: "pkg.filters",
      dbPath: ":memory:",
    });

    // 预置多样化测试运行记录
    // r1: http, viewName: default, success, startedAt: 10:00, root: root-alpha, parent: undefined, action: search
    storage.createRun({
      id: "run-001",
      rootRunId: "root-alpha",
      packageId: "pkg.filters",
      actionId: "search",
      status: "success",
      origin: { channel: "http", viewName: "default", authenticated: true },
      startedAt: "2026-10-14T10:00:00.000Z",
      finishedAt: "2026-10-14T10:00:01.000Z",
    });

    // r2: http, viewName: admin, failed, startedAt: 11:00, root: root-alpha, parent: run-001, action: export
    storage.createRun({
      id: "run-002",
      rootRunId: "root-alpha",
      parentRunId: "run-001",
      packageId: "pkg.filters",
      actionId: "export",
      status: "failed",
      origin: { channel: "http", viewName: "admin", authenticated: true },
      startedAt: "2026-10-14T11:00:00.000Z",
      finishedAt: "2026-10-14T11:00:02.000Z",
    });

    // r3: mcp, viewName: default, success, startedAt: 12:00, root: root-beta, parent: undefined, action: search
    storage.createRun({
      id: "run-003",
      rootRunId: "root-beta",
      packageId: "pkg.filters",
      actionId: "search",
      status: "success",
      origin: { channel: "mcp", viewName: "default", authenticated: false },
      startedAt: "2026-10-14T12:00:00.000Z",
      finishedAt: "2026-10-14T12:00:01.000Z",
    });

    // r4: mcp, viewName: tools, cancelled, startedAt: 13:00, root: root-beta, parent: run-003, action: sync
    storage.createRun({
      id: "run-004",
      rootRunId: "root-beta",
      parentRunId: "run-003",
      packageId: "pkg.filters",
      actionId: "sync",
      status: "cancelled",
      origin: { channel: "mcp", viewName: "tools", authenticated: false },
      startedAt: "2026-10-14T13:00:00.000Z",
      finishedAt: "2026-10-14T13:00:01.000Z",
    });

    // r5: no origin, timed_out, startedAt: 14:00, root: root-gamma, parent: undefined, action: backup
    storage.createRun({
      id: "run-005",
      rootRunId: "root-gamma",
      packageId: "pkg.filters",
      actionId: "backup",
      status: "timed_out",
      startedAt: "2026-10-14T14:00:00.000Z",
      finishedAt: "2026-10-14T14:00:05.000Z",
    });

    // 为 r1 ~ r4 登记幂等键，用于反查测试
    storage.checkAndRecordIdempotency({
      ownerId: "user-1",
      actionRef: "search",
      requestId: "req-001",
      inputDigest: "digest-001",
      runId: "run-001",
    });
    storage.checkAndRecordIdempotency({
      ownerId: "user-1",
      actionRef: "export",
      requestId: "req-002",
      inputDigest: "digest-002",
      runId: "run-002",
    });
    storage.checkAndRecordIdempotency({
      ownerId: "user-1",
      actionRef: "search",
      requestId: "req-003",
      inputDigest: "digest-003",
      runId: "run-003",
    });
    storage.checkAndRecordIdempotency({
      ownerId: "user-1",
      actionRef: "sync",
      requestId: "req-004",
      inputDigest: "digest-004",
      runId: "run-004",
    });

    const searchAction = defineAction({ run: async () => ({ res: "ok" }) });
    const exportAction = defineAction({ run: async () => ({ res: "ok" }) });
    const syncAction = defineAction({ run: async () => ({ res: "ok" }) });
    const backupAction = defineAction({ run: async () => ({ res: "ok" }) });

    runtime = await createPackageRuntime({
      projectConfig: {
        id: "pkg.filters",
        name: "Filters Test Package",
        version: "1.0.0",
        actions: {
          search: { entry: "", description: "搜索操作" },
          export: { entry: "", description: "导出操作" },
          sync: { entry: "", description: "同步操作" },
          backup: { entry: "", description: "备份操作" },
        },
      },
      actions: {
        search: searchAction,
        export: exportAction,
        sync: syncAction,
        backup: backupAction,
      },
      storage,
    } as any);

    host = await createActionDockHost({
      packages: [runtime],
      autoLoadCurrentProject: false,
      inMemory: true,
    });
  });

  after(async () => {
    if (host) await host.close();
    if (storage) await storage.close();
  });

  describe("存储层 SqliteRunsStore 条件下推与统计", () => {
    it("按 channel 过滤（http 与 mcp）", () => {
      const httpRuns = storage.listRuns({ channel: "http" });
      assert.strictEqual(httpRuns.length, 2);
      const httpIds = httpRuns.map((r) => r.id).sort();
      assert.deepStrictEqual(httpIds, ["run-001", "run-002"]);
      assert.strictEqual(storage.countRuns({ channel: "http" }), 2);

      const mcpRuns = storage.listRuns({ channel: "mcp" });
      assert.strictEqual(mcpRuns.length, 2);
      const mcpIds = mcpRuns.map((r) => r.id).sort();
      assert.deepStrictEqual(mcpIds, ["run-003", "run-004"]);
      assert.strictEqual(storage.countRuns({ channel: "mcp" }), 2);

      assert.strictEqual(storage.countRuns({ channel: "cli" }), 0);
      assert.strictEqual(storage.listRuns({ channel: "cli" }).length, 0);
    });

    it("按 status 过滤", () => {
      const successRuns = storage.listRuns({ status: "success" });
      assert.strictEqual(successRuns.length, 2);
      assert.deepStrictEqual(successRuns.map((r) => r.id).sort(), ["run-001", "run-003"]);
      assert.strictEqual(storage.countRuns({ status: "success" }), 2);

      const failedRuns = storage.listRuns({ status: "failed" });
      assert.strictEqual(failedRuns.length, 1);
      assert.strictEqual(failedRuns[0].id, "run-002");
      assert.strictEqual(storage.countRuns({ status: "failed" }), 1);

      const cancelledRuns = storage.listRuns({ status: "cancelled" });
      assert.strictEqual(cancelledRuns.length, 1);
      assert.strictEqual(cancelledRuns[0].id, "run-004");
      assert.strictEqual(storage.countRuns({ status: "cancelled" }), 1);

      const timeoutRuns = storage.listRuns({ status: "timed_out" });
      assert.strictEqual(timeoutRuns.length, 1);
      assert.strictEqual(timeoutRuns[0].id, "run-005");
      assert.strictEqual(storage.countRuns({ status: "timed_out" }), 1);
    });

    it("按 view 过滤", () => {
      const defaultRuns = storage.listRuns({ view: "default" });
      assert.strictEqual(defaultRuns.length, 2);
      assert.deepStrictEqual(defaultRuns.map((r) => r.id).sort(), ["run-001", "run-003"]);
      assert.strictEqual(storage.countRuns({ view: "default" }), 2);

      const adminRuns = storage.listRuns({ view: "admin" });
      assert.strictEqual(adminRuns.length, 1);
      assert.strictEqual(adminRuns[0].id, "run-002");
      assert.strictEqual(storage.countRuns({ view: "admin" }), 1);

      const toolsRuns = storage.listRuns({ view: "tools" });
      assert.strictEqual(toolsRuns.length, 1);
      assert.strictEqual(toolsRuns[0].id, "run-004");
      assert.strictEqual(storage.countRuns({ view: "tools" }), 1);
    });

    it("按 since 与 until 时间范围过滤", () => {
      // since: started_at >= 12:00 (run-003, run-004, run-005)
      const sinceRuns = storage.listRuns({ since: "2026-10-14T12:00:00.000Z" });
      assert.strictEqual(sinceRuns.length, 3);
      assert.deepStrictEqual(sinceRuns.map((r) => r.id).sort(), ["run-003", "run-004", "run-005"]);
      assert.strictEqual(storage.countRuns({ since: "2026-10-14T12:00:00.000Z" }), 3);

      // until: started_at <= 11:00 (run-001, run-002)
      const untilRuns = storage.listRuns({ until: "2026-10-14T11:00:00.000Z" });
      assert.strictEqual(untilRuns.length, 2);
      assert.deepStrictEqual(untilRuns.map((r) => r.id).sort(), ["run-001", "run-002"]);
      assert.strictEqual(storage.countRuns({ until: "2026-10-14T11:00:00.000Z" }), 2);

      // 区间: 11:00 <= started_at <= 13:00 (run-002, run-003, run-004)
      const rangeRuns = storage.listRuns({
        since: "2026-10-14T11:00:00.000Z",
        until: "2026-10-14T13:00:00.000Z",
      });
      assert.strictEqual(rangeRuns.length, 3);
      assert.deepStrictEqual(rangeRuns.map((r) => r.id).sort(), ["run-002", "run-003", "run-004"]);
      assert.strictEqual(
        storage.countRuns({
          since: "2026-10-14T11:00:00.000Z",
          until: "2026-10-14T13:00:00.000Z",
        }),
        3
      );
    });

    it("按 rootRunId 与 parentRunId 过滤", () => {
      const rootAlphaRuns = storage.listRuns({ rootRunId: "root-alpha" });
      assert.strictEqual(rootAlphaRuns.length, 2);
      assert.deepStrictEqual(rootAlphaRuns.map((r) => r.id).sort(), ["run-001", "run-002"]);
      assert.strictEqual(storage.countRuns({ rootRunId: "root-alpha" }), 2);

      const rootBetaRuns = storage.listRuns({ rootRunId: "root-beta" });
      assert.strictEqual(rootBetaRuns.length, 2);
      assert.deepStrictEqual(rootBetaRuns.map((r) => r.id).sort(), ["run-003", "run-004"]);
      assert.strictEqual(storage.countRuns({ rootRunId: "root-beta" }), 2);

      const parentRuns1 = storage.listRuns({ parentRunId: "run-001" });
      assert.strictEqual(parentRuns1.length, 1);
      assert.strictEqual(parentRuns1[0].id, "run-002");
      assert.strictEqual(storage.countRuns({ parentRunId: "run-001" }), 1);

      const parentRuns3 = storage.listRuns({ parentRunId: "run-003" });
      assert.strictEqual(parentRuns3.length, 1);
      assert.strictEqual(parentRuns3[0].id, "run-004");
      assert.strictEqual(storage.countRuns({ parentRunId: "run-003" }), 1);
    });

    it("多条件复合组合过滤", () => {
      // channel: http 且 status: success -> run-001
      const res1 = storage.listRuns({ channel: "http", status: "success" });
      assert.strictEqual(res1.length, 1);
      assert.strictEqual(res1[0].id, "run-001");
      assert.strictEqual(storage.countRuns({ channel: "http", status: "success" }), 1);

      // channel: mcp 且 view: tools 且 rootRunId: root-beta -> run-004
      const res2 = storage.listRuns({
        channel: "mcp",
        view: "tools",
        rootRunId: "root-beta",
      });
      assert.strictEqual(res2.length, 1);
      assert.strictEqual(res2[0].id, "run-004");
      assert.strictEqual(
        storage.countRuns({ channel: "mcp", view: "tools", rootRunId: "root-beta" }),
        1
      );
    });

    it("requestIds 联查路径下推与过滤", () => {
      const allReqIds = ["req-001", "req-002", "req-003", "req-004"];

      // 联查 + channel 过滤
      const httpByReq = storage.listRunsByRequestIds(allReqIds, { channel: "http" });
      assert.strictEqual(httpByReq.length, 2);
      assert.deepStrictEqual(httpByReq.map((r) => r.id).sort(), ["run-001", "run-002"]);
      assert.strictEqual(
        storage.countRuns({ requestIds: allReqIds, channel: "http" }),
        2
      );

      // 联查 + view 过滤
      const adminByReq = storage.listRunsByRequestIds(allReqIds, { view: "admin" });
      assert.strictEqual(adminByReq.length, 1);
      assert.strictEqual(adminByReq[0].id, "run-002");
      assert.strictEqual(
        storage.countRuns({ requestIds: allReqIds, view: "admin" }),
        1
      );

      // 联查 + status 过滤
      const successByReq = storage.listRunsByRequestIds(allReqIds, { status: "success" });
      assert.strictEqual(successByReq.length, 2);
      assert.deepStrictEqual(successByReq.map((r) => r.id).sort(), ["run-001", "run-003"]);
      assert.strictEqual(
        storage.countRuns({ requestIds: allReqIds, status: "success" }),
        2
      );

      // 联查 + since 过滤
      const sinceByReq = storage.listRunsByRequestIds(allReqIds, {
        since: "2026-10-14T12:00:00.000Z",
      });
      assert.strictEqual(sinceByReq.length, 2);
      assert.deepStrictEqual(sinceByReq.map((r) => r.id).sort(), ["run-003", "run-004"]);
      assert.strictEqual(
        storage.countRuns({ requestIds: allReqIds, since: "2026-10-14T12:00:00.000Z" }),
        2
      );

      // 联查 + rootRunId 过滤
      const rootByReq = storage.listRunsByRequestIds(allReqIds, { rootRunId: "root-alpha" });
      assert.strictEqual(rootByReq.length, 2);
      assert.deepStrictEqual(rootByReq.map((r) => r.id).sort(), ["run-001", "run-002"]);
      assert.strictEqual(
        storage.countRuns({ requestIds: allReqIds, rootRunId: "root-alpha" }),
        2
      );

      // 联查 + parentRunId 过滤
      const parentByReq = storage.listRunsByRequestIds(allReqIds, { parentRunId: "run-001" });
      assert.strictEqual(parentByReq.length, 1);
      assert.strictEqual(parentByReq[0].id, "run-002");
      assert.strictEqual(
        storage.countRuns({ requestIds: allReqIds, parentRunId: "run-001" }),
        1
      );
    });
  });

  describe("包运行时 PackageRuntime 透传与内存回退过滤", () => {
    it("listRuns 与 countRuns 完整透传过滤项", async () => {
      const httpRuns = await runtime.listRuns({ channel: "http" });
      assert.strictEqual(httpRuns.length, 2);
      assert.strictEqual(await runtime.countRuns({ channel: "http" }), 2);

      const mcpRuns = await runtime.listRuns({ channel: "mcp" });
      assert.strictEqual(mcpRuns.length, 2);
      assert.strictEqual(await runtime.countRuns({ channel: "mcp" }), 2);

      const viewRuns = await runtime.listRuns({ view: "admin" });
      assert.strictEqual(viewRuns.length, 1);
      assert.strictEqual(viewRuns[0].id, "run-002");
      assert.strictEqual(await runtime.countRuns({ view: "admin" }), 1);

      const sinceRuns = await runtime.listRuns({ since: "2026-10-14T12:00:00.000Z" });
      assert.strictEqual(sinceRuns.length, 3);
      assert.strictEqual(await runtime.countRuns({ since: "2026-10-14T12:00:00.000Z" }), 3);

      const untilRuns = await runtime.listRuns({ until: "2026-10-14T11:00:00.000Z" });
      assert.strictEqual(untilRuns.length, 2);
      assert.strictEqual(await runtime.countRuns({ until: "2026-10-14T11:00:00.000Z" }), 2);

      const rootRuns = await runtime.listRuns({ rootRunId: "root-alpha" });
      assert.strictEqual(rootRuns.length, 2);
      assert.strictEqual(await runtime.countRuns({ rootRunId: "root-alpha" }), 2);

      const parentRuns = await runtime.listRuns({ parentRunId: "run-003" });
      assert.strictEqual(parentRuns.length, 1);
      assert.strictEqual(parentRuns[0].id, "run-004");
      assert.strictEqual(await runtime.countRuns({ parentRunId: "run-003" }), 1);
    });

    it("requestIds 路径下支持全量过滤项与内存补齐", async () => {
      const reqList = ["req-001", "req-002", "req-003", "req-004"];
      const runs = await runtime.listRuns({
        requestIds: reqList,
        channel: "http",
        status: "success",
      });
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0].id, "run-001");
      assert.strictEqual(runs[0].requestId, "req-001");

      const count = await runtime.countRuns({
        requestIds: reqList,
        channel: "http",
        status: "success",
      });
      assert.strictEqual(count, 1);
    });
  });

  describe("宿主层 ActionDockHost 透传与 intent 内存过滤", () => {
    it("host.runs.list 与 count 透传 channel, view, since, until, rootRunId", async () => {
      const httpRuns = await host.runs.list({ channel: "http" });
      assert.strictEqual(httpRuns.length, 2);
      assert.strictEqual(await host.runs.count({ channel: "http" }), 2);

      const mcpRuns = await host.runs.list({ channel: "mcp" });
      assert.strictEqual(mcpRuns.length, 2);
      assert.strictEqual(await host.runs.count({ channel: "mcp" }), 2);

      const rootBetaRuns = await host.runs.list({ rootRunId: "root-beta" });
      assert.strictEqual(rootBetaRuns.length, 2);
      assert.strictEqual(await host.runs.count({ rootRunId: "root-beta" }), 2);
    });

    it("intent 意图过滤分支中同时对 channel, view, since, until, rootRunId 生效", async () => {
      // 意图为 search（匹配 actionId search），同时限定 channel 为 http -> 仅 run-001
      const intentHttp = await host.runs.list({ intent: "search", channel: "http" });
      assert.strictEqual(intentHttp.length, 1);
      assert.strictEqual(intentHttp[0].id, "run-001");
      assert.strictEqual(await host.runs.count({ intent: "search", channel: "http" }), 1);

      // 意图为 search，同时限定 channel 为 mcp -> 仅 run-003
      const intentMcp = await host.runs.list({ intent: "search", channel: "mcp" });
      assert.strictEqual(intentMcp.length, 1);
      assert.strictEqual(intentMcp[0].id, "run-003");
      assert.strictEqual(await host.runs.count({ intent: "search", channel: "mcp" }), 1);

      // 意图匹配全集（如 pkg），限定 view 为 admin -> 仅 run-002
      const intentView = await host.runs.list({ intent: "filters", view: "admin" });
      assert.strictEqual(intentView.length, 1);
      assert.strictEqual(intentView[0].id, "run-002");
      assert.strictEqual(await host.runs.count({ intent: "filters", view: "admin" }), 1);

      // 意图匹配全集，限定 since >= 13:00 -> run-004, run-005
      const intentSince = await host.runs.list({
        intent: "filters",
        since: "2026-10-14T13:00:00.000Z",
      });
      assert.strictEqual(intentSince.length, 2);
      assert.deepStrictEqual(intentSince.map((r: any) => r.id).sort(), ["run-004", "run-005"]);
      assert.strictEqual(
        await host.runs.count({
          intent: "filters",
          since: "2026-10-14T13:00:00.000Z",
        }),
        2
      );

      // 意图匹配全集，限定 until <= 11:00 -> run-001, run-002
      const intentUntil = await host.runs.list({
        intent: "filters",
        until: "2026-10-14T11:00:00.000Z",
      });
      assert.strictEqual(intentUntil.length, 2);
      assert.deepStrictEqual(intentUntil.map((r: any) => r.id).sort(), ["run-001", "run-002"]);
      assert.strictEqual(
        await host.runs.count({
          intent: "filters",
          until: "2026-10-14T11:00:00.000Z",
        }),
        2
      );

      // 意图匹配，限定 rootRunId 为 root-alpha -> run-001, run-002
      const intentRoot = await host.runs.list({ intent: "filters", rootRunId: "root-alpha" });
      assert.strictEqual(intentRoot.length, 2);
      assert.deepStrictEqual(intentRoot.map((r: any) => r.id).sort(), ["run-001", "run-002"]);
      assert.strictEqual(await host.runs.count({ intent: "filters", rootRunId: "root-alpha" }), 2);

      // 意图匹配，限定 parentRunId 为 run-001 -> run-002
      const intentParent = await host.runs.list({ intent: "filters", parentRunId: "run-001" });
      assert.strictEqual(intentParent.length, 1);
      assert.strictEqual(intentParent[0].id, "run-002");
      assert.strictEqual(await host.runs.count({ intent: "filters", parentRunId: "run-001" }), 1);
    });
  });
});
