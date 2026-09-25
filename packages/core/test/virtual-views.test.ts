import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { createActionDockMcpServer } from "@actiondock/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import { LocalActionDockService } from "../src/service";
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

      expect(defaultView.name).toBe("default");
      expect(defaultView.policy.token).toBe("global-token");
      expect(defaultView.policy.packageAllowlist).toEqual(["pkg.a"]);
      expect(defaultView.policy.enableManagement).toBe(false);

      expect(views.size).toBe(3);
      expect(views.has("default")).toBe(true);
      expect(views.has("admin")).toBe(true);
      expect(views.has("readonly")).toBe(true);

      const adminView = views.get("admin")!;
      expect(adminView.policy.token).toBe("admin-token");
      expect(adminView.policy.enableManagement).toBe(true);

      const roView = views.get("readonly")!;
      expect(roView.policy.token).toBe("ro-token");
      expect(roView.policy.packageAllowlist).toEqual(["pkg.b"]);
      expect(roView.policy.actionAllowlist).toEqual(["pkg.b/read"]);
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

      expect(defaultView.policy.token).toBe("overridden-default-token");
      expect(defaultView.policy.packageAllowlist).toEqual(["pkg.common"]);

      expect(views.get("worker")?.policy.token).toBe("worker-token");
      expect(views.get("worker")?.policy.actionAllowlist).toEqual(["run-job"]);
    });

    it("通过 matchViewByToken 安全匹配视图并防范未命中", () => {
      const { views } = normalizeServerViews({
        views: {
          admin: { token: "secret-admin" },
          guest: { token: "secret-guest" },
        },
      });

      const matchedAdmin = matchViewByToken("secret-admin", views.values());
      expect(matchedAdmin?.name).toBe("admin");

      const matchedGuest = matchViewByToken("secret-guest", views.values());
      expect(matchedGuest?.name).toBe("guest");

      const notFound = matchViewByToken("unknown-token", views.values());
      expect(notFound).toBeUndefined();

      const emptyToken = matchViewByToken("", views.values());
      expect(emptyToken).toBeUndefined();
    });

    it("isActionAllowedByPolicy 与 filterActionsByPolicy 判定逻辑正确", () => {
      const policy = {
        viewName: "test",
        packageAllowlist: ["pkg.math"],
        actionAllowlist: ["pkg.math/calc", "ping"],
      };

      // 允许列表中的全限定动作
      expect(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "calc" }, policy)).toBe(true);
      expect(isActionAllowedByPolicy("pkg.math/calc", policy)).toBe(true);

      // 短名 ping，但所属包在 packageAllowlist 中
      expect(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "ping" }, policy)).toBe(true);

      // 所属包不在 packageAllowlist 中
      expect(isActionAllowedByPolicy({ packageId: "pkg.other", actionId: "calc" }, policy)).toBe(false);

      // 包允许但动作不在 actionAllowlist 中
      expect(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "unknown" }, policy)).toBe(false);

      // 过滤动作列表
      const allActions = [
        { id: "pkg.math/calc", packageId: "pkg.math", actionId: "calc" },
        { id: "pkg.math/advanced", packageId: "pkg.math", actionId: "advanced" },
        { id: "pkg.other/ping", packageId: "pkg.other", actionId: "ping" },
      ];
      const filtered = filterActionsByPolicy(allActions, policy);
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("pkg.math/calc");
    });

    it("isPackageAllowedByPolicy 与 isManagementAllowedByPolicy 判定正确", () => {
      const policyA = { packageAllowlist: ["pkg.a"], enableManagement: true };
      const policyB = { enableManagement: false };

      expect(isPackageAllowedByPolicy("pkg.a", policyA)).toBe(true);
      expect(isPackageAllowedByPolicy("pkg.b", policyA)).toBe(false);
      expect(isPackageAllowedByPolicy("pkg.b", policyB)).toBe(true);

      expect(isManagementAllowedByPolicy(policyA)).toBe(true);
      expect(isManagementAllowedByPolicy(policyB)).toBe(false);
      expect(isManagementAllowedByPolicy(undefined)).toBe(false);
    });
  });

  describe("多视图 HTTP 服务集成与智能鉴权分发", () => {
    let server: any;
    let baseUrl: string;
    const recordedMcpCalls: Array<{ path: string; viewName?: string; token?: string }> = [];

    beforeAll(async () => {
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

      const service = new LocalActionDockService(host);

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

    afterAll(async () => {
      if (server) {
        await server.stop();
      }
    });

    it("根路径兼容：携带全局 Token 访问默认视图", async () => {
      const res = await fetch(`${baseUrl}/api/v2/actions`, {
        headers: { Authorization: "Bearer master-token" },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.length).toBe(3); // calc, advanced, manage 全部可见

      // 默认视图未开启 management，返回 403
      const cfgRes = await fetch(`${baseUrl}/api/v2/config`, {
        headers: { Authorization: "Bearer master-token" },
      });
      expect(cfgRes.status).toBe(403);
    });

    it("根路径鉴权拦截：未携带或携带错误 Token 返回 401", async () => {
      const noAuthRes = await fetch(`${baseUrl}/api/v2/actions`);
      expect(noAuthRes.status).toBe(401);

      const wrongAuthRes = await fetch(`${baseUrl}/api/v2/actions`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(wrongAuthRes.status).toBe(401);
    });

    it("命名空间视图访问：正确映射 /views/:viewName/api/v2/* 与独立白名单", async () => {
      // 使用 math-token 访问 /views/math-only/api/v2/actions
      const res = await fetch(`${baseUrl}/views/math-only/api/v2/actions`, {
        headers: { Authorization: "Bearer math-token" },
      });
      expect(res.status).toBe(200);
      const actions: any = await res.json();
      expect(actions.length).toBe(1);
      expect(actions[0].id).toBe("pkg.math/calc");

      // 访问白名单外的动作详情返回 403
      const forbiddenActionRes = await fetch(
        `${baseUrl}/views/math-only/api/v2/packages/pkg.math/actions/advanced`,
        {
          headers: { Authorization: "Bearer math-token" },
        }
      );
      expect(forbiddenActionRes.status).toBe(403);

      // 访问白名单外的包返回 403
      const forbiddenPkgRes = await fetch(
        `${baseUrl}/views/math-only/api/v2/packages/pkg.admin/actions/manage`,
        {
          headers: { Authorization: "Bearer math-token" },
        }
      );
      expect(forbiddenPkgRes.status).toBe(403);
    });

    it("命名空间视图鉴权：Token 不匹配目标视图时拒绝访问", async () => {
      // 拿 admin-token 尝试访问 /views/math-only/
      const res = await fetch(`${baseUrl}/views/math-only/api/v2/actions`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      expect(res.status).toBe(401);
    });

    it("命名空间视图访问不存在的视图返回 404", async () => {
      const res = await fetch(`${baseUrl}/views/non-existent-view/api/v2/actions`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      expect(res.status).toBe(404);
      const json: any = await res.json();
      expect(json.error.message).toContain("non-existent-view");
    });

    it("命名空间视图管理权限控制：admin 视图允许，math-only 视图拒绝", async () => {
      // admin 视图管理接口开启
      const adminCfgRes = await fetch(`${baseUrl}/views/admin/api/v2/config?package=pkg.math`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      expect(adminCfgRes.status).toBe(200);

      // math-only 视图管理接口关闭
      const mathCfgRes = await fetch(`${baseUrl}/views/math-only/api/v2/config?package=pkg.math`, {
        headers: { Authorization: "Bearer math-token" },
      });
      expect(mathCfgRes.status).toBe(403);
    });

    it("根路径智能匹配：根据 Bearer Token 自动绑定到对应的视图策略", async () => {
      // 请求根路径 /api/v2/actions，携带 math-token，应自动应用 math-only 视图的白名单策略
      const res = await fetch(`${baseUrl}/api/v2/actions`, {
        headers: { Authorization: "Bearer math-token" },
      });
      expect(res.status).toBe(200);
      const actions: any = await res.json();
      expect(actions.length).toBe(1);
      expect(actions[0].id).toBe("pkg.math/calc");

      // 请求根路径 /api/v2/config，携带 admin-token，应自动激活 admin 视图的管理权限
      const adminRes = await fetch(`${baseUrl}/api/v2/config?package=pkg.math`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      expect(adminRes.status).toBe(200);
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
      expect(runRes.status).toBe(200);
      const result: any = await runRes.json();
      expect(result.ok).toBe(true);
      expect(result.data.result).toBe(30);

      // 在 math-only 视图下尝试执行未在白名单的 advanced
      const forbiddenRun = await fetch(`${baseUrl}/views/math-only/api/v2/actions/advanced/run`, {
        method: "POST",
        headers: {
          Authorization: "Bearer math-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: {} }),
      });
      expect(forbiddenRun.status).toBe(403);
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
      expect(adminMcp.status).toBe(200);
      const adminJson: any = await adminMcp.json();
      expect(adminJson.mcp).toBe(true);
      expect(adminJson.view).toBe("admin");

      // 2. 访问禁用 MCP 的视图: /views/no-mcp/mcp 应返回 404
      const disabledMcp = await fetch(`${baseUrl}/views/no-mcp/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer no-mcp-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 2 }),
      });
      expect(disabledMcp.status).toBe(404);

      // 3. 根路径 /mcp 携带 math-token 智能分发到 math-only 视图
      const rootMcpMath = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer math-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 3 }),
      });
      expect(rootMcpMath.status).toBe(200);
      const mathJson: any = await rootMcpMath.json();
      expect(mathJson.view).toBe("math-only");

      // 4. 根路径 /mcp 携带 master-token 分发到 default 视图
      const rootMcpMaster = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer master-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 4 }),
      });
      expect(rootMcpMaster.status).toBe(200);
      const masterJson: any = await rootMcpMaster.json();
      expect(masterJson.view).toBe("default");
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

    beforeAll(async () => {
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

      const service = new LocalActionDockService(host);

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

    afterAll(async () => {
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
      expect(init.status).toBe(200);

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
      expect(tools.status).toBe(200);
      const toolNames = tools.data?.result?.tools?.map((t: any) => t.name) || [];
      expect(toolNames).toContain("calc");
      expect(toolNames).toContain("advanced");
      expect(toolNames).toContain("manage");
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
      expect(init.status).toBe(200);

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
      expect(tools.status).toBe(200);
      const toolNames = tools.data?.result?.tools?.map((t: any) => t.name) || [];
      expect(toolNames).toContain("calc");
      expect(toolNames).not.toContain("advanced");
      expect(toolNames).not.toContain("manage");
    });

    it("携带 admin token 请求 restricted 视图 MCP 端点时返回 401 拦截", async () => {
      const res = await callMcp(`${mcpBaseUrl}/views/restricted/mcp`, "admin-token", {
        jsonrpc: "2.0",
        id: "cross-auth",
        method: "tools/list",
        params: {},
      });
      expect(res.status).toBe(401);
      expect(res.data?.error?.code).toBe("UNAUTHORIZED");
    });

    it("携带 restricted token 请求 admin 视图 MCP 端点时返回 401 拦截", async () => {
      const res = await callMcp(`${mcpBaseUrl}/views/admin/mcp`, "restricted-token", {
        jsonrpc: "2.0",
        id: "cross-auth-rev",
        method: "tools/list",
        params: {},
      });
      expect(res.status).toBe(401);
      expect(res.data?.error?.code).toBe("UNAUTHORIZED");
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
      expect(init.status).toBe(200);

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
      expect(tools.status).toBe(200);
      const toolNames = tools.data?.result?.tools?.map((t: any) => t.name) || [];
      expect(toolNames).toContain("calc");
      expect(toolNames).not.toContain("advanced");
      expect(toolNames).not.toContain("manage");
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
      expect(matched?.name).toBe("view1");
      expect(view2Checked).toBe(true);
    });

    it("safeEqual: 长度不匹配时执行恒定时间自我比对而不提前泄露", () => {
      expect(safeEqual("abc", "abcdef")).toBe(false);
      expect(safeEqual("abcdef", "abc")).toBe(false);
      expect(safeEqual("secret-token", "secret-token")).toBe(true);
      expect(safeEqual("", "")).toBe(true);
    });

    it("normalizeServerViews: 自动过滤危险视图名 . 与 ..", () => {
      const { views } = normalizeServerViews({
        views: {
          ".": { token: "dot-token" },
          "..": { token: "dot-dot-token" },
          normal: { token: "normal-token" },
        },
      });
      expect(views.has(".")).toBe(false);
      expect(views.has("..")).toBe(false);
      expect(views.has("normal")).toBe(true);
    });

    it("isActionAllowedByPolicy: 仅配置包白名单时拒绝未指明所属包的短名动作", () => {
      const pkgOnlyPolicy = {
        viewName: "pkg-only",
        packageAllowlist: ["pkg.math"],
      };

      // 明确包名的动作放行
      expect(isActionAllowedByPolicy({ packageId: "pkg.math", actionId: "calc" }, pkgOnlyPolicy)).toBe(true);
      expect(isActionAllowedByPolicy("pkg.math/calc", pkgOnlyPolicy)).toBe(true);

      // 短名动作且未声明包名，拒绝放行
      expect(isActionAllowedByPolicy("calc", pkgOnlyPolicy)).toBe(false);
      expect(isActionAllowedByPolicy({ actionId: "calc" }, pkgOnlyPolicy)).toBe(false);
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
      const service = new LocalActionDockService(host);

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
        expect(specialRes.status).toBe(200);

        // 2. 畸形 URL 编码视图名返回 400 Bad Request
        const malformedRes = await fetch(`${secUrl}/views/%FF/api/v2/actions`, {
          headers: { Authorization: "Bearer special-token" },
        });
        expect(malformedRes.status).toBe(400);

        // 3. 多斜杠与相对路径跳转安全折叠规范化
        const doubleSlashRes = await fetch(`${secUrl}/views/target//api/v2///actions`, {
          headers: { Authorization: "Bearer target-token" },
        });
        expect(doubleSlashRes.status).toBe(200);
      } finally {
        await secServer.stop();
      }
    });
  });
});
