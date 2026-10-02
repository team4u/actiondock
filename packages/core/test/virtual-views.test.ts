import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { createActionDockMcpServer } from "@actiondock/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import {
  filterActionsByPolicy,
  filterPackagesByPolicy,
  isActionAllowedByPolicy,
  isManagementAllowedByPolicy,
  isPackageAllowedByPolicy,
  matchViewByToken,
  normalizeServerViews,
  safeEqual,
  startActionDockServer,
} from "../src/server";

describe("虚拟投影视图（Virtual Views）与统一策略守卫验证", () => {
  describe("统一策略守卫与视图归一化单元测试", () => {
    it("正确归一化默认视图与对象字典形式的自定义视图", () => {
      const { defaultView, views } = normalizeServerViews({
        token: "global-token",
        packageAllowlist: ["pkg.a"],
        enableManagement: false,
        views: {
          admin: {
            token: "admin-token",
            enableManagement: true,
          },
          readonly: {
            token: "ro-token",
            packageAllowlist: ["pkg.b"],
            actionAllowlist: ["pkg.b/read"],
          },
        },
      });

      assert.strictEqual(defaultView.name, "default");
      assert.strictEqual(defaultView.policy.token, "global-token");
      assert.deepStrictEqual(defaultView.policy.packageAllowlist, ["pkg.a"]);
      assert.strictEqual(defaultView.policy.enableManagement, false);

      assert.strictEqual(views.size, 3);
      assert.strictEqual(views.has("default"), true);
      assert.strictEqual(views.has("admin"), true);
      assert.strictEqual(views.has("readonly"), true);

      const adminView = views.get("admin")!;
      assert.strictEqual(adminView.policy.token, "admin-token");
      assert.strictEqual(adminView.policy.enableManagement, true);

      const roView = views.get("readonly")!;
      assert.strictEqual(roView.policy.token, "ro-token");
      assert.deepStrictEqual(roView.policy.packageAllowlist, ["pkg.b"]);
      assert.deepStrictEqual(roView.policy.actionAllowlist, ["pkg.b/read"]);
    });

    it("正确归一化数组形式配置的视图并支持显式覆盖 default 视图", () => {
      const { defaultView, views } = normalizeServerViews({
        token: "fallback-token",
        views: [
          {
            name: "default",
            token: "overridden-default-token",
            packageAllowlist: ["pkg.common"],
          },
          {
            name: "worker",
            token: "worker-token",
            actionAllowlist: ["run-job"],
          },
        ],
      });

      assert.strictEqual(defaultView.policy.token, "overridden-default-token");
      assert.deepStrictEqual(defaultView.policy.packageAllowlist, ["pkg.common"]);

      assert.strictEqual(views.get("worker")?.policy.token, "worker-token");
      assert.deepStrictEqual(views.get("worker")?.policy.actionAllowlist, ["run-job"]);
    });

    it("通过 matchViewByToken 安全匹配视图并防范未命中", () => {
      const { views } = normalizeServerViews({
        views: {
          admin: { token: "secret-admin" },
          guest: { token: "secret-guest" },
        },
      });

      const matchedAdmin = matchViewByToken("secret-admin", views.values());
      assert.strictEqual(matchedAdmin?.name, "admin");

      const matchedGuest = matchViewByToken("secret-guest", views.values());
      assert.strictEqual(matchedGuest?.name, "guest");

      const notFound = matchViewByToken("unknown-token", views.values());
      assert.strictEqual(notFound, undefined);

      const emptyToken = matchViewByToken("", views.values());
      assert.strictEqual(emptyToken, undefined);
    });

    it("isActionAllowedByPolicy 与 filterActionsByPolicy 判定逻辑正确", () => {
      const policy = {
        viewName: "test",
        packageAllowlist: ["pkg.math"],
        actionAllowlist: ["pkg.math/calc", "ping"],
      };

      // 允许列表中的全限定动作
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "calc" }, policy), true);
      assert.strictEqual(isActionAllowedByPolicy("pkg.math/calc", policy), true);

      // 短名 ping，但所属包在 packageAllowlist 中
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "ping" }, policy), true);

      // 所属包不在 packageAllowlist 中
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.other", actionId: "calc" }, policy), false);

      // 包允许但动作不在 actionAllowlist 中
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "unknown" }, policy), false);

      // 过滤动作列表
      const allActions = [
        { id: "pkg.math/calc", packageId: "pkg.math", actionId: "calc" },
        { id: "pkg.math/advanced", packageId: "pkg.math", actionId: "advanced" },
        { id: "pkg.other/ping", packageId: "pkg.other", actionId: "ping" },
      ];
      const filtered = filterActionsByPolicy(allActions, policy);
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].id, "pkg.math/calc");
    });

    it("isPackageAllowedByPolicy 与 isManagementAllowedByPolicy 判定正确", () => {
      const policyA = { packageAllowlist: ["pkg.a"], enableManagement: true };
      const policyB = { enableManagement: false };

      assert.strictEqual(isPackageAllowedByPolicy("pkg.a", policyA), true);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.b", policyA), false);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.b", policyB), true);

      assert.strictEqual(isManagementAllowedByPolicy(policyA), true);
      assert.strictEqual(isManagementAllowedByPolicy(policyB), false);
      assert.strictEqual(isManagementAllowedByPolicy(undefined), false);
    });
  });

  describe("多视图 HTTP 服务集成与智能鉴权分发", () => {
    let server: any;
    let baseUrl: string;
    const recordedMcpCalls: Array<{ path: string; viewName?: string; token?: string }> = [];

    before(async () => {
      const calcAction = defineAction({
        run: (input: { x: number; y: number }) => ({ result: input.x + input.y }),
      });
      const advancedAction = defineAction({
        run: () => ({ ok: "advanced" }),
      });
      const manageAction = defineAction({
        run: () => ({ managed: true }),
      });

      const mathPkg = await createPackageRuntime({
        projectConfig: {
          id: "pkg.math",
          name: "Math Package",
          version: "1.0.0",
          actions: {
            calc: { entry: "", description: "计算" },
            advanced: { entry: "", description: "高级功能" },
          },
          config: {
            precision: { type: "number", default: 2 },
          },
        },
        actions: {
          calc: calcAction,
          advanced: advancedAction,
        },
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
        actions: {
          manage: manageAction,
        },
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [mathPkg, adminPkg],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      const service = host;

      server = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        service,
        token: "master-token",
        enableManagement: false,
        mcpHandler: (req, view) => {
          recordedMcpCalls.push({
            path: new URL(req.url).pathname,
            viewName: view?.viewName,
            token: view?.token,
          });
          return new Response(JSON.stringify({ mcp: true, view: view?.viewName }), {
            headers: { "Content-Type": "application/json" },
          });
        },
        views: {
          admin: {
            token: "admin-token",
            enableManagement: true,
          },
          "math-only": {
            token: "math-token",
            packageAllowlist: ["pkg.math"],
            actionAllowlist: ["pkg.math/calc"],
            enableManagement: false,
          },
          "no-mcp": {
            token: "no-mcp-token",
            enableMcp: false,
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

    it("根路径兼容：携带全局 Token 访问默认视图", async () => {
      const res = await fetch(`${baseUrl}/api/v2/actions`, {
        headers: { Authorization: "Bearer master-token" },
      });
      assert.strictEqual(res.status, 200);
      const data: any = await res.json();
      assert.strictEqual(data.length, 3); // calc, advanced, manage 全部可见

      // 默认视图未开启 management，返回 403
      const cfgRes = await fetch(`${baseUrl}/api/v2/config`, {
        headers: { Authorization: "Bearer master-token" },
      });
      assert.strictEqual(cfgRes.status, 403);
    });

    it("根路径鉴权拦截：未携带或携带错误 Token 返回 401", async () => {
      const noAuthRes = await fetch(`${baseUrl}/api/v2/actions`);
      assert.strictEqual(noAuthRes.status, 401);

      const wrongAuthRes = await fetch(`${baseUrl}/api/v2/actions`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      assert.strictEqual(wrongAuthRes.status, 401);
    });

    it("命名空间视图访问：正确映射 /views/:viewName/api/v2/* 与独立白名单", async () => {
      // 使用 math-token 访问 /views/math-only/api/v2/actions
      const res = await fetch(`${baseUrl}/views/math-only/api/v2/actions`, {
        headers: { Authorization: "Bearer math-token" },
      });
      assert.strictEqual(res.status, 200);
      const actions: any = await res.json();
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].id, "pkg.math/calc");

      // 访问白名单外的动作详情返回 403
      const forbiddenActionRes = await fetch(
        `${baseUrl}/views/math-only/api/v2/packages/pkg.math/actions/advanced`,
        {
          headers: { Authorization: "Bearer math-token" },
        }
      );
      assert.strictEqual(forbiddenActionRes.status, 403);

      // 访问白名单外的包返回 403
      const forbiddenPkgRes = await fetch(
        `${baseUrl}/views/math-only/api/v2/packages/pkg.admin/actions/manage`,
        {
          headers: { Authorization: "Bearer math-token" },
        }
      );
      assert.strictEqual(forbiddenPkgRes.status, 403);
    });

    it("命名空间视图鉴权：Token 不匹配目标视图时拒绝访问", async () => {
      // 拿 admin-token 尝试访问 /views/math-only/
      const res = await fetch(`${baseUrl}/views/math-only/api/v2/actions`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      assert.strictEqual(res.status, 401);
    });

    it("命名空间视图访问不存在的视图返回 404", async () => {
      const res = await fetch(`${baseUrl}/views/non-existent-view/api/v2/actions`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      assert.strictEqual(res.status, 404);
      const json: any = await res.json();
      assert.ok((json.error.message).includes("non-existent-view"));
    });

    it("命名空间视图管理权限控制：admin 视图允许，math-only 视图拒绝", async () => {
      // admin 视图管理接口开启
      const adminCfgRes = await fetch(`${baseUrl}/views/admin/api/v2/config?package=pkg.math`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      assert.strictEqual(adminCfgRes.status, 200);

      // math-only 视图管理接口关闭
      const mathCfgRes = await fetch(`${baseUrl}/views/math-only/api/v2/config?package=pkg.math`, {
        headers: { Authorization: "Bearer math-token" },
      });
      assert.strictEqual(mathCfgRes.status, 403);
    });

    it("根路径智能匹配：根据 Bearer Token 自动绑定到对应的视图策略", async () => {
      // 请求根路径 /api/v2/actions，携带 math-token，应自动应用 math-only 视图的白名单策略
      const res = await fetch(`${baseUrl}/api/v2/actions`, {
        headers: { Authorization: "Bearer math-token" },
      });
      assert.strictEqual(res.status, 200);
      const actions: any = await res.json();
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].id, "pkg.math/calc");

      // 请求根路径 /api/v2/config，携带 admin-token，应自动激活 admin 视图的管理权限
      const adminRes = await fetch(`${baseUrl}/api/v2/config?package=pkg.math`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      assert.strictEqual(adminRes.status, 200);
    });

    it("支持通过各视图运行动作并校验白名单拦截", async () => {
      // 在 math-only 视图下执行白名单内动作 calc
      const runRes = await fetch(`${baseUrl}/views/math-only/api/v2/actions/calc/run`, {
        method: "POST",
        headers: {
          Authorization: "Bearer math-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { x: 10, y: 20 } }),
      });
      assert.strictEqual(runRes.status, 200);
      const result: any = await runRes.json();
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.result, 30);

      // 在 math-only 视图下尝试执行未在白名单的 advanced
      const forbiddenRun = await fetch(`${baseUrl}/views/math-only/api/v2/actions/advanced/run`, {
        method: "POST",
        headers: {
          Authorization: "Bearer math-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: {} }),
      });
      assert.strictEqual(forbiddenRun.status, 403);
    });

    it("MCP 统一网关分发：支持独立视图端点与根路径智能分发", async () => {
      recordedMcpCalls.length = 0;

      // 1. 访问命名空间 MCP: /views/admin/mcp
      const adminMcp = await fetch(`${baseUrl}/views/admin/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });
      assert.strictEqual(adminMcp.status, 200);
      const adminJson: any = await adminMcp.json();
      assert.strictEqual(adminJson.mcp, true);
      assert.strictEqual(adminJson.view, "admin");

      // 2. 访问禁用 MCP 的视图: /views/no-mcp/mcp 应返回 404
      const disabledMcp = await fetch(`${baseUrl}/views/no-mcp/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer no-mcp-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 2 }),
      });
      assert.strictEqual(disabledMcp.status, 404);

      // 3. 根路径 /mcp 携带 math-token 智能分发到 math-only 视图
      const rootMcpMath = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer math-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 3 }),
      });
      assert.strictEqual(rootMcpMath.status, 200);
      const mathJson: any = await rootMcpMath.json();
      assert.strictEqual(mathJson.view, "math-only");

      // 4. 根路径 /mcp 携带 master-token 分发到 default 视图
      const rootMcpMaster = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer master-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 4 }),
      });
      assert.strictEqual(rootMcpMaster.status, 200);
      const masterJson: any = await rootMcpMaster.json();
      assert.strictEqual(masterJson.view, "default");
    });
  });

  describe("真实 MCP 协议集成：多视图 tools/list 隔离与鉴权端到端验证", () => {
    let mcpServer: any;
    let mcpBaseUrl: string;

    const parseMcpPayload = (rawText: string): any => {
      if (rawText.startsWith("event:")) {
        const dataLine = rawText.split("\n").find((l) => l.startsWith("data:"));
        return JSON.parse(dataLine ? dataLine.slice(5).trim() : rawText);
      }
      return JSON.parse(rawText);
    };

    const callMcp = async (
      url: string,
      token: string,
      payload: any,
      sessionId?: string | null
    ) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (sessionId) {
        headers["mcp-session-id"] = sessionId;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const newSessionId = res.headers.get("mcp-session-id") || sessionId || null;
      const rawText = await res.text();
      let data: any = null;
      try {
        data = parseMcpPayload(rawText);
      } catch {}
      return { status: res.status, data, sessionId: newSessionId, rawText };
    };

    before(async () => {
      const calcAction = defineAction({
        run: (input: { x: number; y: number }) => ({ result: input.x + input.y }),
      });
      const advancedAction = defineAction({
        run: () => ({ ok: "advanced" }),
      });
      const manageAction = defineAction({
        run: () => ({ managed: true }),
      });

      const mathPkg = await createPackageRuntime({
        projectConfig: {
          id: "pkg.math",
          name: "Math Package",
          version: "1.0.0",
          actions: {
            calc: { entry: "", description: "计算" },
            advanced: { entry: "", description: "高级功能" },
          },
        },
        actions: {
          calc: calcAction,
          advanced: advancedAction,
        },
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
        actions: {
          manage: manageAction,
        },
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [mathPkg, adminPkg],
        autoLoadCurrentProject: false,
        inMemory: true,
      });

      const service = host;

      mcpServer = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        service,
        token: "global-master-token",
        mcpHandlerFactory: (policy) => {
          const handler = createMcpHandler(
            () => {
              return createActionDockMcpServer({
                service,
                packageAllowlist: policy?.packageAllowlist,
                actionAllowlist: policy?.actionAllowlist,
              });
            }
          );
          return async (req: Request) => handler.fetch(req);
        },
        views: {
          admin: {
            token: "admin-token",
            enableManagement: true,
          },
          restricted: {
            token: "restricted-token",
            packageAllowlist: ["pkg.math"],
            actionAllowlist: ["pkg.math/calc"],
            enableManagement: false,
          },
        },
      });

      mcpBaseUrl = mcpServer.url;
    });

    after(async () => {
      if (mcpServer) {
        await mcpServer.stop();
      }
    });

    it("通过 POST /views/admin/mcp 调用 tools/list，验证管理员视图返回全部工具", async () => {
      const init = await callMcp(`${mcpBaseUrl}/views/admin/mcp`, "admin-token", {
        jsonrpc: "2.0",
        id: "admin-init",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "admin-client", version: "1.0.0" },
        },
      });
      assert.strictEqual(init.status, 200);

      const tools = await callMcp(
        `${mcpBaseUrl}/views/admin/mcp`,
        "admin-token",
        {
          jsonrpc: "2.0",
          id: "admin-tools",
          method: "tools/list",
          params: {},
        },
        init.sessionId
      );
      assert.strictEqual(tools.status, 200);
      const toolNames = tools.data?.result?.tools?.map((t: any) => t.name) || [];
      assert.ok((toolNames).includes("calc"));
      assert.ok((toolNames).includes("advanced"));
      assert.ok((toolNames).includes("manage"));
    });

    it("通过 POST /views/restricted/mcp 调用 tools/list，验证严格按照白名单隔离且不包含未授权工具", async () => {
      const init = await callMcp(`${mcpBaseUrl}/views/restricted/mcp`, "restricted-token", {
        jsonrpc: "2.0",
        id: "restricted-init",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "restricted-client", version: "1.0.0" },
        },
      });
      assert.strictEqual(init.status, 200);

      const tools = await callMcp(
        `${mcpBaseUrl}/views/restricted/mcp`,
        "restricted-token",
        {
          jsonrpc: "2.0",
          id: "restricted-tools",
          method: "tools/list",
          params: {},
        },
        init.sessionId
      );
      assert.strictEqual(tools.status, 200);
      const toolNames = tools.data?.result?.tools?.map((t: any) => t.name) || [];
      assert.ok((toolNames).includes("calc"));
      assert.ok(!(toolNames).includes("advanced"));
      assert.ok(!(toolNames).includes("manage"));
    });

    it("携带 admin token 请求 restricted 视图 MCP 端点时返回 401 拦截", async () => {
      const res = await callMcp(`${mcpBaseUrl}/views/restricted/mcp`, "admin-token", {
        jsonrpc: "2.0",
        id: "cross-auth",
        method: "tools/list",
        params: {},
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data?.error?.code, "UNAUTHORIZED");
    });

    it("携带 restricted token 请求 admin 视图 MCP 端点时返回 401 拦截", async () => {
      const res = await callMcp(`${mcpBaseUrl}/views/admin/mcp`, "restricted-token", {
        jsonrpc: "2.0",
        id: "cross-auth-rev",
        method: "tools/list",
        params: {},
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data?.error?.code, "UNAUTHORIZED");
    });

    it("根路径 /mcp 携带 restricted-token 智能隔离为仅含白名单工具", async () => {
      const init = await callMcp(`${mcpBaseUrl}/mcp`, "restricted-token", {
        jsonrpc: "2.0",
        id: "root-init",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "client", version: "1.0.0" },
        },
      });
      assert.strictEqual(init.status, 200);

      const tools = await callMcp(
        `${mcpBaseUrl}/mcp`,
        "restricted-token",
        {
          jsonrpc: "2.0",
          id: "root-tools",
          method: "tools/list",
          params: {},
        },
        init.sessionId
      );
      assert.strictEqual(tools.status, 200);
      const toolNames = tools.data?.result?.tools?.map((t: any) => t.name) || [];
      assert.ok((toolNames).includes("calc"));
      assert.ok(!(toolNames).includes("advanced"));
      assert.ok(!(toolNames).includes("manage"));
    });
  });

  describe("安全防御、时序防范与边界条件严苛测试", () => {
    it("matchViewByToken: 遍历比对所有视图无短路退出以防范时序侧信道", () => {
      let view2Checked = false;
      const fakeViews = [
        {
          name: "view1",
          policy: { token: "token-view-1" },
          enableMcp: true,
          rawOptions: {},
        },
        {
          name: "view2",
          get policy() {
            view2Checked = true;
            return { token: "token-view-2" };
          },
          enableMcp: true,
          rawOptions: {},
        },
      ];

      const matched = matchViewByToken("token-view-1", fakeViews as any);
      assert.strictEqual(matched?.name, "view1");
      assert.strictEqual(view2Checked, true);
    });

    it("safeEqual: 长度不匹配时执行恒定时间自我比对而不提前泄露", () => {
      assert.strictEqual(safeEqual("abc", "abcdef"), false);
      assert.strictEqual(safeEqual("abcdef", "abc"), false);
      assert.strictEqual(safeEqual("secret-token", "secret-token"), true);
      assert.strictEqual(safeEqual("", ""), true);
    });

    it("normalizeServerViews: 自动过滤危险视图名 . 与 ..", () => {
      const { views } = normalizeServerViews({
        views: {
          ".": { token: "dot-token" },
          "..": { token: "dot-dot-token" },
          normal: { token: "normal-token" },
        },
      });
      assert.strictEqual(views.has("."), false);
      assert.strictEqual(views.has(".."), false);
      assert.strictEqual(views.has("normal"), true);
    });

    it("isActionAllowedByPolicy: 仅配置包白名单时拒绝未指明所属包的短名动作", () => {
      const pkgOnlyPolicy = {
        viewName: "pkg-only",
        packageAllowlist: ["pkg.math"],
      };

      // 明确包名的动作放行
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "calc" }, pkgOnlyPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy("pkg.math/calc", pkgOnlyPolicy), true);

      // 短名动作且未声明包名，拒绝放行
      assert.strictEqual(isActionAllowedByPolicy("calc", pkgOnlyPolicy), false);
      assert.strictEqual(isActionAllowedByPolicy({ actionId: "calc" }, pkgOnlyPolicy), false);
    });

    it("HTTP 服务端防范路径混淆、多斜杠与畸形编码穿透", async () => {
      const calcAction = defineAction({
        run: () => ({ ok: true }),
      });
      const mathPkg = await createPackageRuntime({
        projectConfig: {
          id: "pkg.math",
          name: "Math Package",
          version: "1.0.0",
          actions: {
            calc: { entry: "" },
          },
        },
        actions: { calc: calcAction },
        inMemory: true,
      });
      const host = await createActionDockHost({
        packages: [mathPkg],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const service = host;

      const secServer = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        service,
        token: "master-token",
        views: {
          "特殊 视图": {
            token: "special-token",
            packageAllowlist: ["pkg.math"],
          },
          target: {
            token: "target-token",
            packageAllowlist: ["pkg.math"],
          },
        },
      });

      try {
        const secUrl = secServer.url;

        // 1. 特殊字符（包含空格与中文）URL 编码视图访问成功
        const specialRes = await fetch(`${secUrl}/views/%E7%89%B9%E6%AE%8A%20%E8%A7%86%E5%9B%BE/api/v2/actions`, {
          headers: { Authorization: "Bearer special-token" },
        });
        assert.strictEqual(specialRes.status, 200);

        // 2. 畸形 URL 编码视图名返回 400 Bad Request
        const malformedRes = await fetch(`${secUrl}/views/%FF/api/v2/actions`, {
          headers: { Authorization: "Bearer special-token" },
        });
        assert.strictEqual(malformedRes.status, 400);

        // 3. 多斜杠与相对路径跳转安全折叠规范化
        const doubleSlashRes = await fetch(`${secUrl}/views/target//api/v2///actions`, {
          headers: { Authorization: "Bearer target-token" },
        });
        assert.strictEqual(doubleSlashRes.status, 200);
      } finally {
        await secServer.stop();
      }
    });
  });
});
