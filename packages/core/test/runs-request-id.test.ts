import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { createActionDockHost } from "../src/host";
import { createPackageRuntime } from "../src/package";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { startActionDockServer } from "../src/server";
import { connectActionDock } from "../src";
import { fetchRemoteRuns } from "../src/client/runs";

/**
 * requestId 幂等键反查运行记录契约验证。
 *
 * 覆盖存储层（SqliteRuntimeStorage）、服务层（RunsPort.list）与 HTTP 路由
 * （GET /runs?requestIds=）三级贯通：按 requestId 反查命中与未命中、
 * 跨包隔离、RunRecord 暴露 requestId 字段。
 */
describe("requestId 幂等键反查运行记录", () => {
  describe("存储层反查", () => {
    it("命中：按 requestId 反查返回关联运行记录并携带 requestId 字段", async () => {
      const storage = new SqliteRuntimeStorage({
        packageId: "pkg.reverse",
        dbPath: ":memory:",
      });

      storage.createRun({
        id: "run-hit-1",
        rootRunId: "run-hit-1",
        packageId: "pkg.reverse",
        actionId: "echo",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      storage.checkAndRecordIdempotency({
        ownerId: "host-aaaa",
        actionRef: "pkg.reverse/echo",
        requestId: "req-hit-1",
        inputDigest: "digest-a",
        runId: "run-hit-1",
      });

      const records = storage.listRunsByRequestIds?.(["req-hit-1"]) ?? [];
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].id, "run-hit-1");
      assert.strictEqual(records[0].requestId, "req-hit-1");

      // 常规列表路径由服务层（PackageRuntime.listRuns）统一补齐 requestId 关联，
      // 存储层原生 listRuns 保持纯表投影职责，不携带关联列

      // getRun 详情路径同样补齐
      const record = storage.getRunWithRequestId?.("run-hit-1") ?? null;
      assert.strictEqual(record?.requestId, "req-hit-1");

      // 反查映射辅助：getRunRequestIds 返回 runId -> requestId 映射
      const mapping = storage.getRunRequestIds?.(["run-hit-1"]) ?? {};
      assert.deepStrictEqual(mapping, { "run-hit-1": "req-hit-1" });

      await storage.close();
    });

    it("未命中：反查不存在的 requestId 返回空数组且不抛出异常", async () => {
      const storage = new SqliteRuntimeStorage({
        packageId: "pkg.miss",
        dbPath: ":memory:",
      });

      const records = storage.listRunsByRequestIds?.(["req-not-exist"]) ?? [];
      assert.strictEqual(records.length, 0);

      const mapping = storage.getRunRequestIds?.(["run-not-exist"]) ?? {};
      assert.deepStrictEqual(mapping, {});

      // 空入参防御
      assert.deepStrictEqual(storage.listRunsByRequestIds?.([]) ?? [], []);
      assert.deepStrictEqual(storage.getRunRequestIds?.([]) ?? {}, {});

      await storage.close();
    });

    it("跨包隔离：反查仅返回当前包范围的运行记录", async () => {
      const storageA = new SqliteRuntimeStorage({
        packageId: "pkg.alpha",
        dbPath: ":memory:",
      });
      const storageB = new SqliteRuntimeStorage({
        packageId: "pkg.beta",
        dbPath: ":memory:",
      });

      // 两个独立包各登记同 requestId 的运行记录
      for (const [storage, packageId, runId] of [
        [storageA, "pkg.alpha", "run-alpha"],
        [storageB, "pkg.beta", "run-beta"],
      ] as const) {
        storage.createRun({
          id: runId,
          rootRunId: runId,
          packageId,
          actionId: "echo",
          status: "success",
          startedAt: new Date().toISOString(),
        });
        storage.checkAndRecordIdempotency({
          ownerId: "host-shared",
          actionRef: `${packageId}/echo`,
          requestId: "req-cross-pkg",
          inputDigest: "digest-x",
          runId,
        });
      }

      const fromA = storageA.listRunsByRequestIds?.(["req-cross-pkg"]) ?? [];
      assert.strictEqual(fromA.length, 1);
      assert.strictEqual(fromA[0].id, "run-alpha");

      const fromB = storageB.listRunsByRequestIds?.(["req-cross-pkg"]) ?? [];
      assert.strictEqual(fromB.length, 1);
      assert.strictEqual(fromB[0].id, "run-beta");

      await storageA.close();
      await storageB.close();
    });

    it("ownerId 不参与反查：写入方与查询方宿主标识不同仍可命中", async () => {
      const storage = new SqliteRuntimeStorage({
        packageId: "pkg.owner-agnostic",
        dbPath: ":memory:",
      });

      storage.createRun({
        id: "run-owner-1",
        rootRunId: "run-owner-1",
        packageId: "pkg.owner-agnostic",
        actionId: "echo",
        ownerId: "host-writer",
        status: "success",
        startedAt: new Date().toISOString(),
      });
      storage.checkAndRecordIdempotency({
        ownerId: "host-writer",
        actionRef: "pkg.owner-agnostic/echo",
        requestId: "req-owner-1",
        inputDigest: "digest-o",
        runId: "run-owner-1",
      });

      // 查询方（当前存储实例）未显式声明 ownerId，反查不受写入方 ownerId 隔离
      const records = storage.listRunsByRequestIds?.(["req-owner-1"]) ?? [];
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].ownerId, "host-writer");

      await storage.close();
    });
  });

  describe("服务层 RunsPort 反查", () => {
    it("runs.list 按 requestIds 命中关联记录且未命中返回空", async () => {
      const echoAction = defineAction({
        run: async (input: { message: string }) => ({ echo: input.message }),
      });

      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.svc-reverse",
          name: "Service Reverse Package",
          version: "1.0.0",
          actions: {
            echo: { entry: "", description: "回声动作" },
          },
        },
        actions: { echo: echoAction },
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      const reqId = "svc-req-001";
      const res = await host.execution.run("pkg.svc-reverse/echo", { message: "hello" }, {
        requestId: reqId,
      });
      assert.strictEqual(res.ok, true);

      const hits = await host.runs.list({ requestIds: [reqId] });
      assert.strictEqual(hits.length, 1);
      assert.strictEqual(hits[0].id, res.runId);
      assert.strictEqual(hits[0].requestId, reqId);

      const misses = await host.runs.list({ requestIds: ["svc-req-none"] });
      assert.strictEqual(misses.length, 0);

      // 常规列表路径的记录同样暴露 requestId
      const all = await host.runs.list({});
      assert.strictEqual(all.some((r) => r.requestId === reqId), true);

      await host.close();
    });
  });

  describe("HTTP 路由 requestIds 参数", () => {
    const AUTH_TOKEN = "reverse-route-secret";
    let serverInstance: any;
    let serverUrl: string;
    let host: any;

    before(async () => {
      const echoAction = defineAction({
        run: async (input: { message: string }) => ({ echo: input.message }),
      });

      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.route-reverse",
          name: "Route Reverse Package",
          version: "1.0.0",
          actions: {
            echo: { entry: "", description: "回声动作" },
          },
        },
        actions: { echo: echoAction },
        inMemory: true,
      });

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
    });

    it("GET /runs 支持 requestId 与 requestIds 重复查询参数、原样保留逗号与空格合法标识", async () => {
      const headers = {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      };

      const runRes = await fetch(
        `${serverUrl}/api/v2/packages/pkg.route-reverse/actions/echo/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { message: "route" },
            requestId: "route-req-001",
          }),
        }
      );
      assert.strictEqual(runRes.status, 200);
      const runData = (await runRes.json()) as any;
      assert.strictEqual(runData.ok, true);
      const runId = runData.runId;

      // 单参数形式
      const singleRes = await fetch(`${serverUrl}/api/v2/runs?requestIds=route-req-001`, {
        headers,
      });
      assert.strictEqual(singleRes.status, 200);
      const singleData = (await singleRes.json()) as any;
      assert.strictEqual(singleData.ok, true);
      assert.strictEqual(singleData.items.length, 1);
      assert.strictEqual(singleData.items[0].id, runId);
      assert.strictEqual(singleData.items[0].requestId, "route-req-001");

      // 支持 requestId 单数形式
      const requestIdRes = await fetch(`${serverUrl}/api/v2/runs?requestId=route-req-001`, {
        headers,
      });
      assert.strictEqual(requestIdRes.status, 200);
      const requestIdData = (await requestIdRes.json()) as any;
      assert.strictEqual(requestIdData.ok, true);
      assert.strictEqual(requestIdData.items.length, 1);
      assert.strictEqual(requestIdData.items[0].id, runId);

      // 重复参数形式（命中与未命中混合）
      const repeatRes = await fetch(
        `${serverUrl}/api/v2/runs?requestIds=route-req-none&requestIds=route-req-001`,
        { headers }
      );
      assert.strictEqual(repeatRes.status, 200);
      const repeatData = (await repeatRes.json()) as any;
      assert.strictEqual(repeatData.ok, true);
      assert.strictEqual(repeatData.items.length, 1);
      assert.strictEqual(repeatData.items[0].id, runId);

      // 全部未命中：返回空集合而非错误
      const missRes = await fetch(`${serverUrl}/api/v2/runs?requestIds=route-req-none`, {
        headers,
      });
      assert.strictEqual(missRes.status, 200);
      const missData = (await missRes.json()) as any;
      assert.strictEqual(missData.ok, true);
      assert.strictEqual(missData.items.length, 0);

      // 原样反查带逗号与空格的合法 requestId
      const commaId = "batch,a";
      const spaceId = " batch ";

      const runCommaRes = await fetch(
        `${serverUrl}/api/v2/packages/pkg.route-reverse/actions/echo/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { message: "comma" },
            requestId: commaId,
          }),
        }
      );
      const runCommaData = (await runCommaRes.json()) as any;
      assert.strictEqual(runCommaData.ok, true);

      const runSpaceRes = await fetch(
        `${serverUrl}/api/v2/packages/pkg.route-reverse/actions/echo/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { message: "space" },
            requestId: spaceId,
          }),
        }
      );
      const runSpaceData = (await runSpaceRes.json()) as any;
      assert.strictEqual(runSpaceData.ok, true);

      // 验证带逗号的 requestId 原样命中且不被 split 拆分
      const commaFetchRes = await fetch(
        `${serverUrl}/api/v2/runs?requestId=${encodeURIComponent(commaId)}`,
        { headers }
      );
      const commaFetchData = (await commaFetchRes.json()) as any;
      assert.strictEqual(commaFetchData.ok, true);
      assert.strictEqual(commaFetchData.items.length, 1);
      assert.strictEqual(commaFetchData.items[0].requestId, commaId);

      // 验证带空格的 requestId 原样命中且不被 trim 剥离
      const spaceFetchRes = await fetch(
        `${serverUrl}/api/v2/runs?requestIds=${encodeURIComponent(spaceId)}`,
        { headers }
      );
      const spaceFetchData = (await spaceFetchRes.json()) as any;
      assert.strictEqual(spaceFetchData.ok, true);
      assert.strictEqual(spaceFetchData.items.length, 1);
      assert.strictEqual(spaceFetchData.items[0].requestId, spaceId);

      // 验证通过 SDK client fetchRemoteRuns 直接以数组传递带逗号与空格的 requestIds
      const remoteRunsRes = await fetchRemoteRuns(serverUrl, AUTH_TOKEN, {
        requestIds: [commaId, spaceId],
      });
      assert.strictEqual(remoteRunsRes.ok, true);
      assert.strictEqual(remoteRunsRes.items.length, 2);
      const foundIds = new Set(remoteRunsRes.items.map((r) => r.requestId));
      assert.strictEqual(foundIds.has(commaId), true);
      assert.strictEqual(foundIds.has(spaceId), true);
    });
  });

  describe("远端 51 条相同 requestId 记录全量分页反查", () => {
    const PAGING_AUTH_TOKEN = "paging-route-secret";
    let pagingServerInstance: any;
    let pagingServerUrl: string;
    let pagingHost: any;
    let pagingStorage: any;
    const SHARED_REQ_ID = "req-paging-51-dup";

    before(async () => {
      const echoAction = defineAction({
        run: async (input: { message: string }) => ({ echo: input.message }),
      });

      pagingStorage = new SqliteRuntimeStorage({
        packageId: "pkg.route-paging",
        dbPath: ":memory:",
      });

      // 写入 51 条相同 requestId 的运行记录，超过单页 50 条默认上限
      const baseTime = Date.now() - 100_000;
      for (let i = 0; i < 51; i++) {
        const runId = `paging-run-${String(i).padStart(3, "0")}`;
        pagingStorage.createRun({
          id: runId,
          rootRunId: runId,
          packageId: "pkg.route-paging",
          actionId: "echo",
          ownerId: `owner-${i}`,
          status: "success",
          startedAt: new Date(baseTime + i * 1000).toISOString(),
          finishedAt: new Date(baseTime + i * 1000 + 100).toISOString(),
        });
        pagingStorage.checkAndRecordIdempotency({
          ownerId: `owner-${i}`,
          actionRef: "pkg.route-paging/echo",
          requestId: SHARED_REQ_ID,
          inputDigest: `digest-${i}`,
          runId,
        });
      }

      const app = await createPackageRuntime({
        projectConfig: {
          id: "pkg.route-paging",
          name: "Route Paging Package",
          version: "1.0.0",
          actions: {
            echo: { entry: "", description: "回声动作" },
          },
        },
        actions: { echo: echoAction },
        storage: pagingStorage,
      } as any);

      pagingHost = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      pagingServerInstance = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: PAGING_AUTH_TOKEN,
        service: pagingHost,
        enableManagement: false,
      });
      pagingServerUrl = `http://127.0.0.1:${pagingServerInstance.port}`;
    });

    after(async () => {
      if (pagingServerInstance) await pagingServerInstance.stop();
      if (pagingHost) await pagingHost.close();
      if (pagingStorage) await pagingStorage.close();
    });

    it("HTTP 路由层验证：默认 limit 50 截断单页但 total 返回真实 51 条，带 offset 可完整获取后续页", async () => {
      // 1. 不传 limit：默认返回 50 条，但 total 必须为真实全量 51 条
      const firstPage = await fetchRemoteRuns(pagingServerUrl, PAGING_AUTH_TOKEN, {
        requestIds: [SHARED_REQ_ID],
      });
      assert.strictEqual(firstPage.ok, true);
      assert.strictEqual(firstPage.total, 51);
      assert.strictEqual(firstPage.items.length, 50);

      // 2. 携带 offset 翻页：offset=50, limit=50 获取第 51 条记录
      const secondPage = await fetchRemoteRuns(pagingServerUrl, PAGING_AUTH_TOKEN, {
        requestIds: [SHARED_REQ_ID],
        offset: 50,
        limit: 50,
      });
      assert.strictEqual(secondPage.ok, true);
      assert.strictEqual(secondPage.total, 51);
      assert.strictEqual(secondPage.items.length, 1);
      assert.strictEqual(secondPage.items[0].requestId, SHARED_REQ_ID);
    });

    it("远端服务层验证：调用方不传 limit 时自动循环分页拉取完整 51 条记录不会截断", async () => {
      const client = await connectActionDock({
        serverUrl: pagingServerUrl,
        token: PAGING_AUTH_TOKEN,
      });

      try {
        // 调用方不传 limit（模拟 watch 反查场景）
        const records = await client.runs.list({ requestIds: [SHARED_REQ_ID] });
        assert.strictEqual(records.length, 51);

        // 验证 51 条记录均关联了该 requestId 且 runId 各不相同
        const distinctRunIds = new Set(records.map((r) => r.id));
        assert.strictEqual(distinctRunIds.size, 51);
        for (const record of records) {
          assert.strictEqual(record.requestId, SHARED_REQ_ID);
        }

        // 调用方传入 limit 时保持单次拉取
        const limited = await client.runs.list({ requestIds: [SHARED_REQ_ID], limit: 20 });
        assert.strictEqual(limited.length, 20);
      } finally {
        await client.close();
      }
    });
  });
});
