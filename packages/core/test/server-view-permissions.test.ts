import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import { startActionDockServer } from "../src/server";

/**
 * 服务端白名单并集授权核心 HTTP 集成验证：
 * 包 A（整包授权）与包 B（仅 read 单动作授权）与包 C（无授权）三包形态下，
 * 全部发现、详情、执行、历史记录与管理边界的端到端行为。
 */
describe("服务端白名单并集授权核心 HTTP 集成验证", () => {
  let server: any;
  let baseUrl: string;

  const AGENT_TOKEN = "agent-view-token";
  const ALL_TOKEN = "all-view-token";
  const EMPTY_TOKEN = "empty-view-token";
  const MASTER_TOKEN = "master-token";

  let readRunId: string;
  let writeRunId: string;
  let cRunId: string;

  before(async () => {
    const readAction = defineAction({
      run: (input: { x?: number }) => ({ op: "read", x: input?.x ?? 0 }),
    });
    const writeAction = defineAction({
      run: (input: { x?: number }) => ({ op: "write", x: input?.x ?? 0 }),
    });
    const adminAction = defineAction({
      run: () => ({ op: "admin" }),
    });
    const cAction = defineAction({
      run: () => ({ op: "c" }),
    });

    const pkgA = await createPackageRuntime({
      projectConfig: {
        id: "pkg.a",
        name: "Package A",
        version: "1.0.0",
        actions: {
          read: { entry: "", description: "A 读取" },
          write: { entry: "", description: "A 写入" },
        },
        playbooks: {
          "a-sop": { description: "A 规程", actions: ["read"], content: "# A SOP" },
        } as any,
        config: {
          aKey: { type: "string", default: "a-secret" },
        },
      },
      actions: { read: readAction, write: writeAction },
      inMemory: true,
    });

    const pkgB = await createPackageRuntime({
      projectConfig: {
        id: "pkg.b",
        name: "Package B",
        version: "2.0.0",
        description: "B 包描述",
        actions: {
          read: { entry: "", description: "B 读取" },
          write: { entry: "", description: "B 写入" },
        },
        playbooks: {
          "b-sop": { description: "B 规程", actions: ["read"], content: "# B SECRET SOP" },
        } as any,
        config: {
          bKey: { type: "string", default: "b-secret" },
        },
      },
      actions: { read: readAction, write: writeAction },
      inMemory: true,
    });

    const pkgC = await createPackageRuntime({
      projectConfig: {
        id: "pkg.c",
        name: "Package C",
        version: "3.0.0",
        actions: {
          exec: { entry: "", description: "C 执行" },
        },
        playbooks: {
          "c-sop": { description: "C 规程", actions: ["exec"], content: "# C SOP" },
        } as any,
      },
      actions: { exec: cAction },
      inMemory: true,
    });

    const adminPkg = await createPackageRuntime({
      projectConfig: {
        id: "pkg.admin",
        name: "Admin Package",
        version: "1.0.0",
        actions: {
          manage: { entry: "", description: "管理动作" },
        },
      },
      actions: { manage: adminAction },
      inMemory: true,
    });

    const host = await createActionDockHost({
      packages: [pkgA, pkgB, pkgC, adminPkg],
      autoLoadCurrentProject: false,
      inMemory: true,
    });

    // 预生成历史运行记录：B/read、B/write、C 各一条
    const readResult = await host.execution.run({ packageId: "pkg.b", actionId: "read" }, { x: 1 });
    readRunId = readResult.runId!;
    const writeResult = await host.execution.run({ packageId: "pkg.b", actionId: "write" }, { x: 2 });
    writeRunId = writeResult.runId!;
    const cResult = await host.execution.run({ packageId: "pkg.c", actionId: "exec" }, {});
    cRunId = cResult.runId!;

    server = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      service: host,
      token: MASTER_TOKEN,
      packageAllowlist: ["*"],
      views: {
        agent: {
          token: AGENT_TOKEN,
          packageAllowlist: ["pkg.a"],
          actionAllowlist: ["pkg.b/read"],
        },
        "all-view": {
          token: ALL_TOKEN,
          packageAllowlist: ["*"],
        },
        "empty-view": {
          token: EMPTY_TOKEN,
          packageAllowlist: [],
          actionAllowlist: [],
        },
      },
    });
    baseUrl = server.url;
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  const get = (path: string, token: string) =>
    fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  const post = (path: string, token: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  describe("受限白名单下批量清理安全范围（runs clear / clean-expired）", () => {
    let clearServer: any;
    let clearBaseUrl: string;
    let clearWriteRunId: string;

    before(async () => {
      const readAction = defineAction({
        run: () => ({ op: "b-read" }),
      });
      const writeAction = defineAction({
        run: () => ({ op: "b-write" }),
      });
      const aAction = defineAction({
        run: () => ({ op: "a" }),
      });

      const pkgB = await createPackageRuntime({
        projectConfig: {
          id: "clr.pkg.b",
          name: "Clear B",
          version: "1.0.0",
          actions: { read: { entry: "" }, write: { entry: "" } },
        },
        actions: { read: readAction, write: writeAction },
        inMemory: true,
      });
      const pkgA = await createPackageRuntime({
        projectConfig: {
          id: "clr.pkg.a",
          name: "Clear A",
          version: "1.0.0",
          actions: { go: { entry: "" } },
        },
        actions: { go: aAction },
        inMemory: true,
      });
      const host = await createActionDockHost({
        packages: [pkgA, pkgB],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      // 预置历史记录：B/read、B/write 与 A 各一条（同步完成，状态稳定）
      await host.execution.run({ packageId: "clr.pkg.b", actionId: "read" }, {});
      const writeResult = await host.execution.run({ packageId: "clr.pkg.b", actionId: "write" }, {});
      clearWriteRunId = writeResult.runId!;
      await host.execution.run({ packageId: "clr.pkg.a", actionId: "go" }, {});

      clearServer = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        service: host,
        token: "clear-master",
        packageAllowlist: ["*"],
        views: {
          agent: {
            token: "clear-agent",
            packageAllowlist: ["clr.pkg.a"],
            actionAllowlist: ["clr.pkg.b/read"],
          },
          empty: { token: "clear-empty", packageAllowlist: [], actionAllowlist: [] },
          allView: { token: "clear-all", packageAllowlist: ["*"] },
        },
      });
      clearBaseUrl = clearServer.url;
    });

    after(async () => {
      if (clearServer) {
        await clearServer.stop();
      }
    });

    const postClear = (token: string, body: unknown, path = "/api/v2/runs/clear") =>
      fetch(`${clearBaseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("空授权与无范围清理拒绝且后端零调用（B 仅单动作时按包清理拒绝）", async () => {
      for (const [token, body] of [
        ["clear-empty", {}],
        ["clear-empty", { packageId: "clr.pkg.a" }],
        ["clear-agent", {}],
        ["clear-agent", { packageId: "clr.pkg.b" }],
        ["clear-agent", { packageId: "clr.pkg.b", actionId: "write" }],
        // packageId 与全限定 actionId 归一化后不一致必须拒绝
        ["clear-agent", { packageId: "clr.pkg.a", actionId: "clr.pkg.b/write" }],
        ["clear-agent", { packageId: "clr.pkg.b", actionId: "clr.pkg.a/go" }],
      ] as Array<[string, unknown]>) {
        const res = await postClear(token, body);
        assert.strictEqual(res.status, 403, `${JSON.stringify(body)} should be rejected`);
        const data: any = await res.json();
        assert.strictEqual(data.error.code, "PACKAGE_FORBIDDEN");
      }
    });

    it("明确安全范围内清理放行且实际过滤范围不扩大", async () => {
      // B 单动作授权的精确清理：仅删 B/read 记录，B/write 记录不受影响
      const scopedRes = await postClear("clear-agent", { packageId: "clr.pkg.b", actionId: "read" });
      assert.strictEqual(scopedRes.status, 200);
      const scopedData: any = await scopedRes.json();
      assert.strictEqual(scopedData.ok, true);
      assert.ok(scopedData.clearedCount >= 1, "B/read records must be cleared");

      const afterScoped: any = await (await fetch(`${clearBaseUrl}/api/v2/runs/${clearWriteRunId}`, { headers: { Authorization: "Bearer clear-master" } })).json();
      // runs/show 返回记录本体（无 ok 信封）；存在 id 即代表记录未被误删
      assert.strictEqual(
        afterScoped.id,
        clearWriteRunId,
        `B/write run must remain after scoped clear: ${JSON.stringify({ writeRunId: clearWriteRunId, response: afterScoped }).slice(0, 400)}`
      );

      // 全限定 actionId 单独给定时同样收敛到该精确引用
      const writeTicket = await postClear("clear-agent", { actionId: "clr.pkg.b/read" });
      assert.strictEqual(writeTicket.status, 200);

      // A 整包授权：按包清理放行
      const pkgRes = await postClear("clear-agent", { packageId: "clr.pkg.a" });
      assert.strictEqual(pkgRes.status, 200);
      const pkgData: any = await pkgRes.json();
      assert.ok(pkgData.clearedCount >= 1, "A package records must be cleared");

      // B/write 仍未被误删（agent 视图查询 B/write 记录应为 403，master 可见）
      const masterList: any = await (await fetch(`${clearBaseUrl}/api/v2/runs`, { headers: { Authorization: "Bearer clear-master" } })).json();
      assert.ok(
        masterList.items.some((r: any) => r.id === clearWriteRunId),
        "B/write run must survive all scoped clears"
      );
    });

    it("clean-expired 只允许显式全量授权视图", async () => {
      assert.strictEqual((await postClear("clear-empty", {}, "/api/v2/runs/clean-expired")).status, 403);
      assert.strictEqual((await postClear("clear-agent", {}, "/api/v2/runs/clean-expired")).status, 403);
      assert.strictEqual((await postClear("clear-all", {}, "/api/v2/runs/clean-expired")).status, 200);
      assert.strictEqual((await postClear("clear-master", {}, "/api/v2/runs/clean-expired")).status, 200);
    });

    it("packageAllowlist: [\"*\"] 保留全局清理能力", async () => {
      const res = await postClear("clear-all", {});
      assert.strictEqual(res.status, 200);
    });
  });

  describe("动作列表发现", () => {
    it("agent 视图列表仅含 A 全部动作与 B/read", async () => {
      const res = await get("/api/v2/actions", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const actions: any[] = await res.json();
      const ids = actions.map((a) => a.id).sort();
      assert.deepStrictEqual(ids, ["pkg.a/read", "pkg.a/write", "pkg.b/read"]);
    });

    it("agent 视图按包过滤查询：package=pkg.b 仅返回 B/read", async () => {
      const res = await get("/api/v2/actions?package=pkg.b", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const actions: any[] = await res.json();
      assert.deepStrictEqual(actions.map((a) => a.id), ["pkg.b/read"]);
    });

    it("agent 视图按包过滤查询：package=pkg.c 返回空列表", async () => {
      const res = await get("/api/v2/actions?package=pkg.c", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const actions: any[] = await res.json();
      assert.deepStrictEqual(actions, []);
    });

    it("all-view 视图返回全部动作", async () => {
      const res = await get("/api/v2/actions", ALL_TOKEN);
      assert.strictEqual(res.status, 200);
      const actions: any[] = await res.json();
      const ids = actions.map((a) => a.id);
      assert.ok(ids.includes("pkg.a/read"));
      assert.ok(ids.includes("pkg.b/write"));
      assert.ok(ids.includes("pkg.c/exec"));
    });

    it("空授权视图返回空列表而非全量", async () => {
      const res = await get("/api/v2/actions", EMPTY_TOKEN);
      assert.strictEqual(res.status, 200);
      const actions: any[] = await res.json();
      assert.deepStrictEqual(actions, []);
    });
  });

  describe("信息与包发现投影", () => {
    it("info 多包形态：A 完整脱敏投影，B 最小身份投影，C 不可见", async () => {
      const res = await get("/api/v2/info", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const data: any = await res.json();
      assert.strictEqual(data.type, "package_list");
      const ids = data.packages.map((p: any) => p.id).sort();
      assert.deepStrictEqual(ids, ["pkg.a", "pkg.b"]);

      const pkgA = data.packages.find((p: any) => p.id === "pkg.a");
      // A 整包授权沿用安全脱敏完整结构
      assert.ok(Array.isArray(pkgA.actions));
      assert.ok(pkgA.actions.includes("read"));
      assert.strictEqual(pkgA.packageRoot, undefined);
      assert.ok(pkgA.config && pkgA.config.aKey);

      const pkgB = data.packages.find((p: any) => p.id === "pkg.b");
      // B 最小身份元数据：不泄露完整动作清单、规程、配置与目录
      assert.deepStrictEqual(pkgB.actions, ["read"]);
      assert.strictEqual(pkgB.actionsCount, 1);
      assert.strictEqual(pkgB.playbooks, undefined);
      assert.strictEqual(pkgB.playbooksCount, undefined);
      assert.strictEqual(pkgB.playbooksDir, undefined);
      assert.strictEqual(pkgB.actionsDir, undefined);
      assert.strictEqual(pkgB.config, undefined);
      assert.strictEqual(pkgB.packageRoot, undefined);
      assert.strictEqual(pkgB.version, "2.0.0");
    });

    it("info?tree=true 树形与列表形态投影一致", async () => {
      const res = await get("/api/v2/info?tree=true", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const data: any = await res.json();
      assert.strictEqual(data.type, "tree");
      const pkgB = data.packages.find((p: any) => p.id === "pkg.b");
      assert.deepStrictEqual(pkgB.actions, ["read"]);
      assert.strictEqual(pkgB.config, undefined);
    });

    it("info 显式包查询：B 仅返回最小元数据，C 返回 403", async () => {
      const resB = await get("/api/v2/info?package=pkg.b", AGENT_TOKEN);
      assert.strictEqual(resB.status, 200);
      const dataB: any = await resB.json();
      assert.strictEqual(dataB.type, "package_detail");
      assert.deepStrictEqual(dataB.actions, ["read"]);
      assert.strictEqual(dataB.config, undefined);
      assert.strictEqual(dataB.playbooks, undefined);

      const resC = await get("/api/v2/info?package=pkg.c", AGENT_TOKEN);
      assert.strictEqual(resC.status, 403);
      const dataC = await resC.json();
      assert.strictEqual(dataC.error.code, "PACKAGE_NOT_ALLOWED");
    });

    it("packages 列表投影与 info 一致", async () => {
      const res = await get("/api/v2/packages", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const data: any = await res.json();
      const ids = data.packages.map((p: any) => p.id).sort();
      assert.deepStrictEqual(ids, ["pkg.a", "pkg.b"]);
      const pkgB = data.packages.find((p: any) => p.id === "pkg.b");
      assert.deepStrictEqual(pkgB.actions, ["read"]);
      assert.strictEqual(pkgB.config, undefined);
    });

    it("scoped 包单动作授权：授权动作与真实清单去重交集，不存在动作不暴露", async () => {
      const scopedPkg = {
        id: "@scope/pkg",
        name: "Scoped Package",
        version: "9.0.0",
        description: "scoped",
        actions: ["read", "write"],
        actionsCount: 2,
        config: { secret: "hidden" },
        packageRoot: "/private/scoped",
      };
      const fakeService = {
        ...server.service,
        info: async () => [scopedPkg],
        discovery: {
          ...server.service.discovery,
          listPackages: async () => [scopedPkg],
        },
      };
      const originalService = server.service;
      (server as any).service = fakeService;
      try {
        const scopedServer = await startActionDockServer({
          port: 0,
          host: "127.0.0.1",
          service: fakeService as any,
          token: "scoped-master",
          enableMcp: false,
          views: {
            "scoped-view": {
              token: "scoped-token",
              actionAllowlist: ["@scope/pkg/read", " @scope/pkg/missing ", "@scope/pkg/read"],
            },
          },
        });
        try {
          const headers = { Authorization: "Bearer scoped-token" };
          const infoRes = await fetch(`${scopedServer.url}/api/v2/info?package=%40scope%2Fpkg`, { headers });
          assert.strictEqual(infoRes.status, 200);
          const infoData: any = await infoRes.json();
          assert.strictEqual(infoData.type, "package_detail");
          // 授权引用经 parseActionRef 归一化（scoped 名与空白容忍），与真实清单交集去重：
          // missing 不在实际清单中，不作为已发现能力暴露
          assert.deepStrictEqual(infoData.actions, ["read"]);
          assert.strictEqual(infoData.actionsCount, 1);
          for (const key of ["config", "packageRoot", "projectRoot", "playbooks"]) {
            assert.strictEqual(infoData[key], undefined, `${key} must not leak`);
          }

          const listRes = await fetch(`${scopedServer.url}/api/v2/packages`, { headers });
          assert.strictEqual(listRes.status, 200);
          const listData: any = await listRes.json();
          assert.strictEqual(listData.packages.length, 1);
          assert.deepStrictEqual(listData.packages[0].actions, ["read"]);
          assert.strictEqual(listData.packages[0].config, undefined);
        } finally {
          await scopedServer.stop();
        }
      } finally {
        (server as any).service = originalService;
      }
    });
  });

  describe("动作详情 describe 两种路径", () => {
    it("全限定路径：A 两个动作与 B/read 放行，B/write 与 C 动作拒绝", async () => {
      assert.strictEqual((await get("/api/v2/packages/pkg.a/actions/read", AGENT_TOKEN)).status, 200);
      assert.strictEqual((await get("/api/v2/packages/pkg.a/actions/write", AGENT_TOKEN)).status, 200);
      assert.strictEqual((await get("/api/v2/packages/pkg.b/actions/read", AGENT_TOKEN)).status, 200);
      assert.strictEqual((await get("/api/v2/packages/pkg.b/actions/write", AGENT_TOKEN)).status, 403);
      assert.strictEqual((await get("/api/v2/packages/pkg.c/actions/exec", AGENT_TOKEN)).status, 403);
    });

    it("短名路径解析后按实际归属判定：b/read 命中单动作授权", async () => {
      const res = await get("/api/v2/actions/read", AGENT_TOKEN);
      // 短名 read 在多包存在歧义时由底层解析；无论解析到 A 或 B，
      // 两者均在授权范围内（A 整包，B/read 单动作）
      assert.ok([200, 404].includes(res.status));
      if (res.status === 200) {
        const spec: any = await res.json();
        assert.ok(spec.packageId === "pkg.a" || (spec.packageId === "pkg.b" && spec.id === "read"));
      }
    });

    it("短名路径未授权动作拒绝：write/exec", async () => {
      // pkg.b/write 短名 write：解析后未授权包拒绝
      const writeRes = await get("/api/v2/actions/write", AGENT_TOKEN);
      // 短名 write 解析到 A 则放行（A 整包），解析到 B 则拒绝
      if (writeRes.status === 200) {
        const spec: any = await writeRes.json();
        assert.strictEqual(spec.packageId, "pkg.a");
      } else {
        assert.ok([403, 404].includes(writeRes.status));
      }

      const execRes = await get("/api/v2/actions/exec", AGENT_TOKEN);
      assert.strictEqual(execRes.status, 403);
    });
  });

  describe("动作执行 run/start", () => {
    it("run：A 两动作与 B/read 放行，B/write 与 C 拒绝", async () => {
      const aRead = await post("/api/v2/packages/pkg.a/actions/read/run", AGENT_TOKEN, { input: { x: 7 } });
      assert.strictEqual(aRead.status, 200);
      const aReadData: any = await aRead.json();
      assert.strictEqual(aReadData.data.op, "read");

      const aWrite = await post("/api/v2/packages/pkg.a/actions/write/run", AGENT_TOKEN, { input: { x: 8 } });
      assert.strictEqual(aWrite.status, 200);

      const bRead = await post("/api/v2/packages/pkg.b/actions/read/run", AGENT_TOKEN, { input: { x: 9 } });
      assert.strictEqual(bRead.status, 200);
      const bReadData: any = await bRead.json();
      assert.strictEqual(bReadData.data.op, "read");

      const bWrite = await post("/api/v2/packages/pkg.b/actions/write/run", AGENT_TOKEN, { input: {} });
      assert.strictEqual(bWrite.status, 403);
      const bWriteData = await bWrite.json();
      assert.strictEqual(bWriteData.error.code, "ACTION_FORBIDDEN");

      const cExec = await post("/api/v2/packages/pkg.c/actions/exec/run", AGENT_TOKEN, { input: {} });
      assert.strictEqual(cExec.status, 403);
    });

    it("start：A 动作放行，B/write 拒绝", async () => {
      const aStart = await post("/api/v2/packages/pkg.a/actions/read/start", AGENT_TOKEN, { input: {} });
      assert.strictEqual(aStart.status, 202);

      const bWrite = await post("/api/v2/packages/pkg.b/actions/write/start", AGENT_TOKEN, { input: {} });
      assert.strictEqual(bWrite.status, 403);
    });

    it("全限定管理动作与跨视图 token 不能越权", async () => {
      // agent 视图不能执行管理动作
      assert.strictEqual(
        (await post("/api/v2/packages/pkg.admin/actions/manage/run", AGENT_TOKEN, { input: {} })).status,
        403
      );
      // agent token 访问 all-view 命名空间 401
      assert.strictEqual(
        (await get("/views/all-view/api/v2/actions", AGENT_TOKEN)).status,
        401
      );
    });
  });

  describe("历史运行记录 runs 全链路", () => {
    it("列表：agent 视图可见 A 全部与 B/read 记录，不可见 B/write 与 C", async () => {
      const res = await get("/api/v2/runs", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const data: any = await res.json();
      assert.strictEqual(data.ok, true);
      const ids = data.items.map((r: any) => r.id);
      assert.ok(ids.includes(readRunId), "B/read run must be visible");
      assert.ok(!ids.includes(writeRunId), "B/write run must be hidden");
      assert.ok(!ids.includes(cRunId), "C run must be hidden");
    });

    it("show：B/read 记录可查，B/write 与 C 记录拒绝", async () => {
      assert.strictEqual((await get(`/api/v2/runs/${readRunId}`, AGENT_TOKEN)).status, 200);
      assert.strictEqual((await get(`/api/v2/runs/${writeRunId}`, AGENT_TOKEN)).status, 403);
      assert.strictEqual((await get(`/api/v2/runs/${cRunId}`, AGENT_TOKEN)).status, 403);
    });

    it("events：B/read 记录可订阅，B/write 记录拒绝", async () => {
      const okRes = await get(`/api/v2/runs/${readRunId}/events`, AGENT_TOKEN);
      assert.strictEqual(okRes.status, 200);
      await okRes.body?.cancel();

      const deniedRes = await get(`/api/v2/runs/${writeRunId}/events`, AGENT_TOKEN);
      assert.strictEqual(deniedRes.status, 403);
    });

    it("cancel：B/read 记录可取消，B/write 记录拒绝", async () => {
      // 先各自启动一个长任务
      const bReadTicket = await post("/api/v2/packages/pkg.b/actions/read/start", AGENT_TOKEN, { input: {} });
      assert.strictEqual(bReadTicket.status, 202);
      const bReadRunId = (await bReadTicket.json()).runId;

      const cancelRes = await post(`/api/v2/runs/${bReadRunId}/cancel`, AGENT_TOKEN);
      assert.ok([200, 409].includes(cancelRes.status));

      assert.strictEqual((await post(`/api/v2/runs/${writeRunId}/cancel`, AGENT_TOKEN)).status, 403);
    });

    it("列表显式过滤参数：package=pkg.b 与 actionId 组合校验", async () => {
      const okRes = await get("/api/v2/runs?packageId=pkg.b&actionId=read", AGENT_TOKEN);
      assert.strictEqual(okRes.status, 200);
      const okData: any = await okRes.json();
      assert.ok(okData.items.every((r: any) => r.packageId === "pkg.b" && r.actionId === "read"));

      // 未授权包的显式列表查询 403
      const cRes = await get("/api/v2/runs?packageId=pkg.c", AGENT_TOKEN);
      assert.strictEqual(cRes.status, 403);

      // 未授权动作的显式列表查询 403
      const wRes = await get("/api/v2/runs?packageId=pkg.b&actionId=write", AGENT_TOKEN);
      assert.strictEqual(wRes.status, 403);
    });
  });

  describe("管理门禁与 global 边界", () => {
    it("agent 视图关闭管理（enableManagement 默认 false）", async () => {
      assert.strictEqual((await get("/api/v2/config?package=pkg.a", AGENT_TOKEN)).status, 403);
      assert.strictEqual((await get("/api/v2/state?package=pkg.a", AGENT_TOKEN)).status, 403);
    });

    it("packageAllowlist: [\"*\"] 不自动开启管理门禁", async () => {
      assert.strictEqual((await get("/api/v2/config?package=pkg.a", ALL_TOKEN)).status, 403);
    });

    it("受限白名单下 global 特殊值不能绕过包级授权", async () => {
      const res = await get("/api/v2/config?package=global", AGENT_TOKEN);
      assert.strictEqual(res.status, 403);
    });
  });

  describe("规程与 doctor 边界", () => {
    it("playbooks 列表仅包含整包授权的 A", async () => {
      const res = await get("/api/v2/playbooks", AGENT_TOKEN);
      assert.strictEqual(res.status, 200);
      const pbs: any[] = await res.json();
      const ids = pbs.map((p) => p.id);
      assert.ok(ids.some((id) => id.includes("a-sop")));
      assert.ok(!ids.some((id) => id.includes("b-sop")), "B playbook must not be listed for action-only grant");
      assert.ok(!ids.some((id) => id.includes("c-sop")));
    });

    it("playbooks 详情：A 规程放行，B 规程拒绝", async () => {
      assert.strictEqual((await get("/api/v2/packages/pkg.a/playbooks/a-sop", AGENT_TOKEN)).status, 200);
      assert.strictEqual((await get("/api/v2/packages/pkg.b/playbooks/b-sop", AGENT_TOKEN)).status, 403);
    });

    it("doctor：整包授权包放行，单动作授权包拒绝，全局请求拒绝", async () => {
      const aRes = await get("/api/v2/doctor?package=pkg.a", AGENT_TOKEN);
      assert.ok([200, 500].includes(aRes.status), `A doctor expected 200/500 got ${aRes.status}`);

      const bRes = await get("/api/v2/doctor?package=pkg.b", AGENT_TOKEN);
      assert.strictEqual(bRes.status, 403);

      const globalRes = await get("/api/v2/doctor", AGENT_TOKEN);
      assert.strictEqual(globalRes.status, 403);
    });

    it("all-view 视图保留 doctor 全局能力", async () => {
      const res = await get("/api/v2/doctor", ALL_TOKEN);
      assert.ok([200, 500].includes(res.status), `all-view doctor expected 200/500 got ${res.status}`);
    });
  });

  describe("空授权与全量授权两个极端", () => {
    it("空授权视图：信息为空、动作拒绝、runs 为空、playbooks 为空", async () => {
      assert.deepStrictEqual((await (await get("/api/v2/actions", EMPTY_TOKEN)).json()), []);
      const infoRes = await get("/api/v2/info", EMPTY_TOKEN);
      assert.strictEqual(infoRes.status, 200);
      const infoData: any = await infoRes.json();
      assert.deepStrictEqual(infoData.packages, []);

      const runRes = await get("/api/v2/runs", EMPTY_TOKEN);
      assert.strictEqual(runRes.status, 200);
      assert.deepStrictEqual((await runRes.json()).items, []);

      const pbRes = await get("/api/v2/playbooks", EMPTY_TOKEN);
      assert.strictEqual(pbRes.status, 200);
      assert.deepStrictEqual(await pbRes.json(), []);

      assert.strictEqual(
        (await post("/api/v2/packages/pkg.a/actions/read/run", EMPTY_TOKEN, { input: {} })).status,
        403
      );
      // 显式包查询也拒绝（零授权）
      assert.strictEqual((await get("/api/v2/info?package=pkg.a", EMPTY_TOKEN)).status, 403);
    });

    it("packageAllowlist: [\"*\"] 视图动作、信息、runs、规程全量可见", async () => {
      const actions: any[] = await (await get("/api/v2/actions", ALL_TOKEN)).json();
      assert.ok(actions.length >= 5);

      const infoRes = await get("/api/v2/info", ALL_TOKEN);
      const infoData: any = await infoRes.json();
      assert.ok(infoData.packages.length >= 4);

      const runs: any = await (await get("/api/v2/runs", ALL_TOKEN)).json();
      const ids = runs.items.map((r: any) => r.id);
      assert.ok(ids.includes(cRunId));

      const pbs: any[] = await (await get("/api/v2/playbooks", ALL_TOKEN)).json();
      assert.ok(pbs.some((p) => p.id.includes("b-sop")));
    });
  });
});
