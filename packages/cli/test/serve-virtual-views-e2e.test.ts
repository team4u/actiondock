import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { linkPackage } from "@actiondock/core/registry";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

async function getAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolvePort(port);
      });
    });
    server.on("error", reject);
  });
}

function parseMcpPayload(rawText: string): any {
  if (rawText.startsWith("event:")) {
    const dataLine = rawText.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(dataLine ? dataLine.slice(5).trim() : rawText);
  }
  return JSON.parse(rawText);
}

async function sendMcpRequest(
  url: string,
  token: string,
  payload: any,
  sessionId?: string | null
): Promise<{ status: number; data: any; sessionId: string | null; rawText: string }> {
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
  } catch {
    // 非 JSON 或空白响应
  }
  return { status: res.status, data, sessionId: newSessionId, rawText };
}

describe("ad serve 命令行虚拟投影视图（Virtual Views）端到端集成测试", () => {
  let tempHome: string;
  let tempDataDir: string;
  let adminPkgDir: string;
  let calcPkgDir: string;
  let viewsFilePath: string;
  let serveProc: ChildProcess | undefined;

  const ADMIN_TOKEN = "admin-secret-token-2026";
  const RESTRICTED_TOKEN = "restricted-secret-token-2026";
  const NO_MCP_TOKEN = "no-mcp-secret-token-2026";

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), "ad-views-home-"));
    tempDataDir = mkdtempSync(join(tmpdir(), "ad-views-data-"));
    adminPkgDir = mkdtempSync(join(tmpdir(), "ad-pkg-admin-"));
    calcPkgDir = mkdtempSync(join(tmpdir(), "ad-pkg-calc-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    // 1. 构建 admin-pkg
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(adminPkgDir, "node_modules"), "junction");
    }
    mkdirSync(join(adminPkgDir, "actions"), { recursive: true });
    writeFileSync(
      join(adminPkgDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.admin-pkg",
          name: "Admin Package",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            manage: {
              entry: "actions/manage.ts",
              description: "管理员专属操作",
            },
          },
          config: {
            systemKey: { type: "string", default: "admin-root-key" },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(adminPkgDir, "actions", "manage.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "manage",
  description: "管理员专属操作",
  async run() {
    return { ok: true, privileged: true };
  },
});
`
    );

    // 2. 构建 calc-pkg
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(calcPkgDir, "node_modules"), "junction");
    }
    mkdirSync(join(calcPkgDir, "actions"), { recursive: true });
    writeFileSync(
      join(calcPkgDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.calc-pkg",
          name: "Calculator Package",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            "calc-add": {
              entry: "actions/calc-add.ts",
              description: "加法计算",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "number" },
                  b: { type: "number" },
                },
                required: ["a", "b"],
              },
            },
            "calc-secret": {
              entry: "actions/calc-secret.ts",
              description: "保密计算",
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(calcPkgDir, "actions", "calc-add.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "calc-add",
  description: "加法计算",
  async run(input: { a: number; b: number }) {
    return { sum: (input.a || 0) + (input.b || 0) };
  },
});
`
    );
    writeFileSync(
      join(calcPkgDir, "actions", "calc-secret.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "calc-secret",
  description: "保密计算",
  async run() {
    return { secretCode: "classified-formula" };
  },
});
`
    );

    // 3. 软链接包到测试运行时
    await linkPackage(adminPkgDir, tempHome);
    await linkPackage(calcPkgDir, tempHome);

    // 4. 生成多视图配置文件 views.json
    viewsFilePath = join(tempHome, "views.json");
    writeFileSync(
      viewsFilePath,
      JSON.stringify(
        {
          views: {
            admin: {
              token: ADMIN_TOKEN,
              enableManagement: true,
            },
            restricted: {
              token: RESTRICTED_TOKEN,
              packageAllowlist: ["test.calc-pkg"],
              actionAllowlist: ["test.calc-pkg/calc-add"],
              enableManagement: false,
            },
            "no-mcp": {
              token: NO_MCP_TOKEN,
              enableMcp: false,
            },
          },
        },
        null,
        2
      )
    );
  });

  afterEach(async () => {
    if (serveProc) {
      const proc = serveProc;
      serveProc = undefined;
      if (proc.exitCode === null && proc.signalCode === null) {
        await new Promise<void>((resolveExit) => {
          let timer: NodeJS.Timeout | null = null;
          const onExit = () => {
            if (timer) clearTimeout(timer);
            resolveExit();
          };
          proc.once("exit", onExit);
          proc.kill("SIGTERM");
          timer = setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) {
              proc.kill("SIGKILL");
            }
            resolveExit();
          }, 500);
        });
      }
    }

    for (const dir of [tempHome, tempDataDir, adminPkgDir, calcPkgDir]) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {
          // 忽略临时目录清理异常
        }
      }
    }
  });

  it("通过 --views-file 启动并加载多视图配置，验证 MCP 隔离性、鉴权边界与执行流", async () => {
    const port = await getAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}`;

    let bannerOutput = "";
    serveProc = spawn(
      process.execPath,
      [
        cliPath,
        "serve",
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--views-file",
        viewsFilePath,
        "--data-dir",
        tempDataDir,
      ],
      {
        cwd: tempHome,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    serveProc.stdout?.on("data", (chunk) => {
      bannerOutput += chunk.toString();
    });

    // 轮询等待服务监听就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        });
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // 重试等待
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // 1. 验证横幅展示配置的多视图标识与端点信息
    expect(bannerOutput).toContain("* Views:");
    expect(bannerOutput).toContain("- admin:");
    expect(bannerOutput).toContain("/views/admin");
    expect(bannerOutput).toContain("- restricted:");
    expect(bannerOutput).toContain("/views/restricted");
    expect(bannerOutput).toContain("- no-mcp:");

    // 2. 验证多视图下的 MCP 隔离性（admin 视图 vs restricted 视图）
    // 2.1 admin 视图下的 MCP initialize 与 tools/list
    const adminInit = await sendMcpRequest(`${serverUrl}/views/admin/mcp`, ADMIN_TOKEN, {
      jsonrpc: "2.0",
      id: "admin-init",
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-admin-client", version: "1.0.0" },
      },
    });
    expect(adminInit.status).toBe(200);

    const adminTools = await sendMcpRequest(
      `${serverUrl}/views/admin/mcp`,
      ADMIN_TOKEN,
      {
        jsonrpc: "2.0",
        id: "admin-tools",
        method: "tools/list",
        params: {},
      },
      adminInit.sessionId
    );
    expect(adminTools.status).toBe(200);
    const adminToolNames = adminTools.data?.result?.tools?.map((t: any) => t.name) || [];
    expect(adminToolNames).toContain("calc-add");
    expect(adminToolNames).toContain("calc-secret");
    expect(adminToolNames).toContain("manage");

    // 2.2 restricted 视图下的 MCP initialize 与 tools/list
    const restrictedInit = await sendMcpRequest(
      `${serverUrl}/views/restricted/mcp`,
      RESTRICTED_TOKEN,
      {
        jsonrpc: "2.0",
        id: "restricted-init",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test-restricted-client", version: "1.0.0" },
        },
      }
    );
    expect(restrictedInit.status).toBe(200);

    const restrictedTools = await sendMcpRequest(
      `${serverUrl}/views/restricted/mcp`,
      RESTRICTED_TOKEN,
      {
        jsonrpc: "2.0",
        id: "restricted-tools",
        method: "tools/list",
        params: {},
      },
      restrictedInit.sessionId
    );
    expect(restrictedTools.status).toBe(200);
    const restrictedToolNames = restrictedTools.data?.result?.tools?.map((t: any) => t.name) || [];
    // 白名单内工具必须存在
    expect(restrictedToolNames).toContain("calc-add");
    // 未授权工具绝不包含在受限视图中
    expect(restrictedToolNames).not.toContain("calc-secret");
    expect(restrictedToolNames).not.toContain("manage");

    // 2.3 禁用 MCP 的视图访问返回 404
    const noMcpRes = await sendMcpRequest(`${serverUrl}/views/no-mcp/mcp`, NO_MCP_TOKEN, {
      jsonrpc: "2.0",
      id: "no-mcp-test",
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    expect(noMcpRes.status).toBe(404);

    // 3. 验证视图间鉴权边界：Token 不匹配或跨视图访问拦截 401
    // 3.1 携带 admin token 请求 restricted 视图 MCP 端点，拦截 401
    const crossTokenMcpRes = await sendMcpRequest(
      `${serverUrl}/views/restricted/mcp`,
      ADMIN_TOKEN,
      {
        jsonrpc: "2.0",
        id: "cross-token",
        method: "tools/list",
        params: {},
      }
    );
    expect(crossTokenMcpRes.status).toBe(401);

    // 3.2 携带 restricted token 请求 admin 视图 MCP 端点，拦截 401
    const reverseCrossTokenMcpRes = await sendMcpRequest(
      `${serverUrl}/views/admin/mcp`,
      RESTRICTED_TOKEN,
      {
        jsonrpc: "2.0",
        id: "reverse-cross-token",
        method: "tools/list",
        params: {},
      }
    );
    expect(reverseCrossTokenMcpRes.status).toBe(401);

    // 3.3 携带错误 Token 请求 restricted 视图 MCP 端点，拦截 401
    const wrongTokenMcpRes = await sendMcpRequest(
      `${serverUrl}/views/restricted/mcp`,
      "invalid-token",
      {
        jsonrpc: "2.0",
        id: "wrong-token",
        method: "tools/list",
        params: {},
      }
    );
    expect(wrongTokenMcpRes.status).toBe(401);

    // 3.4 携带 admin token 请求 restricted 视图 HTTP API 端点，拦截 401
    const crossTokenHttpRes = await fetch(`${serverUrl}/views/restricted/api/v2/actions`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(crossTokenHttpRes.status).toBe(401);

    // 3.5 携带 restricted token 请求 admin 视图 HTTP API 端点，拦截 401
    const reverseCrossTokenHttpRes = await fetch(`${serverUrl}/views/admin/api/v2/actions`, {
      headers: { Authorization: `Bearer ${RESTRICTED_TOKEN}` },
    });
    expect(reverseCrossTokenHttpRes.status).toBe(401);

    // 4. 验证 HTTP API 路由维度的多视图隔离与权限策略
    // 4.1 admin 视图可见全部动作
    const adminActionsRes = await fetch(`${serverUrl}/views/admin/api/v2/actions`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(adminActionsRes.status).toBe(200);
    const adminActionsData = (await adminActionsRes.json()) as any[];
    const adminActionIds = adminActionsData.map((a: any) => a.id);
    expect(adminActionIds.some((id: string) => id.includes("calc-add"))).toBe(true);
    expect(adminActionIds.some((id: string) => id.includes("calc-secret"))).toBe(true);
    expect(adminActionIds.some((id: string) => id.includes("manage"))).toBe(true);

    // 4.2 restricted 视图仅可见白名单内的 calc-add
    const restrictedActionsRes = await fetch(`${serverUrl}/views/restricted/api/v2/actions`, {
      headers: { Authorization: `Bearer ${RESTRICTED_TOKEN}` },
    });
    expect(restrictedActionsRes.status).toBe(200);
    const restrictedActionsData = (await restrictedActionsRes.json()) as any[];
    const restrictedActionIds = restrictedActionsData.map((a: any) => a.id);
    expect(restrictedActionIds.some((id: string) => id.includes("calc-add"))).toBe(true);
    expect(restrictedActionIds.some((id: string) => id.includes("calc-secret"))).toBe(false);
    expect(restrictedActionIds.some((id: string) => id.includes("manage"))).toBe(false);

    // 4.3 访问白名单外的动作详情返回 403
    const forbiddenActionDetail = await fetch(
      `${serverUrl}/views/restricted/api/v2/packages/test.calc-pkg/actions/calc-secret`,
      {
        headers: { Authorization: `Bearer ${RESTRICTED_TOKEN}` },
      }
    );
    expect(forbiddenActionDetail.status).toBe(403);
    const forbiddenActionJson = await forbiddenActionDetail.json();
    expect(forbiddenActionJson.error.code).toBe("ACTION_FORBIDDEN");

    // 4.4 访问白名单外的包下动作返回 403
    const forbiddenPkgDetail = await fetch(
      `${serverUrl}/views/restricted/api/v2/packages/test.admin-pkg/actions/manage`,
      {
        headers: { Authorization: `Bearer ${RESTRICTED_TOKEN}` },
      }
    );
    expect(forbiddenPkgDetail.status).toBe(403);

    // 4.5 管理端点控制：admin 开启返回 200，restricted 关闭返回 403
    const adminConfigRes = await fetch(`${serverUrl}/views/admin/api/v2/config?package=test.admin-pkg`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(adminConfigRes.status).toBe(200);

    const restrictedConfigRes = await fetch(
      `${serverUrl}/views/restricted/api/v2/config?package=test.admin-pkg`,
      {
        headers: { Authorization: `Bearer ${RESTRICTED_TOKEN}` },
      }
    );
    expect(restrictedConfigRes.status).toBe(403);

    // 5. 验证动作执行与拦截流
    // 5.1 在受限视图下成功执行允许动作
    const allowedRunRes = await fetch(
      `${serverUrl}/views/restricted/api/v2/packages/test.calc-pkg/actions/calc-add/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESTRICTED_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { a: 15, b: 25 } }),
      }
    );
    expect(allowedRunRes.status).toBe(200);
    const allowedRunData = await allowedRunRes.json();
    expect(allowedRunData.ok).toBe(true);
    expect(allowedRunData.data.sum).toBe(40);

    // 5.2 在受限视图下尝试执行未授权动作拦截 403
    const forbiddenRunRes = await fetch(
      `${serverUrl}/views/restricted/api/v2/packages/test.calc-pkg/actions/calc-secret/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESTRICTED_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: {} }),
      }
    );
    expect(forbiddenRunRes.status).toBe(403);

    // 6. 验证根路径智能 Token 分发机制
    // 6.1 访问根路径 /api/v2/actions 携带 restricted token 自动匹配受限策略
    const rootRestrictedRes = await fetch(`${serverUrl}/api/v2/actions`, {
      headers: { Authorization: `Bearer ${RESTRICTED_TOKEN}` },
    });
    expect(rootRestrictedRes.status).toBe(200);
    const rootRestrictedActions = (await rootRestrictedRes.json()) as any[];
    expect(rootRestrictedActions.length).toBe(1);
    expect(rootRestrictedActions[0].id).toContain("calc-add");

    // 6.2 访问根路径 /mcp 携带 restricted token 自动隔离 MCP 工具列表
    const rootMcpInit = await sendMcpRequest(`${serverUrl}/mcp`, RESTRICTED_TOKEN, {
      jsonrpc: "2.0",
      id: "root-mcp-init",
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "root-client", version: "1.0.0" },
      },
    });
    expect(rootMcpInit.status).toBe(200);

    const rootMcpTools = await sendMcpRequest(
      `${serverUrl}/mcp`,
      RESTRICTED_TOKEN,
      {
        jsonrpc: "2.0",
        id: "root-mcp-tools",
        method: "tools/list",
        params: {},
      },
      rootMcpInit.sessionId
    );
    expect(rootMcpTools.status).toBe(200);
    const rootToolNames = rootMcpTools.data?.result?.tools?.map((t: any) => t.name) || [];
    expect(rootToolNames).toContain("calc-add");
    expect(rootToolNames).not.toContain("calc-secret");
    expect(rootToolNames).not.toContain("manage");
  });

  it("当通过 --views-file 指定的文件不存在时抛出错误并以非零状态码退出", async () => {
    const invalidPath = join(tempHome, "non-existent-views.json");
    const port = await getAvailablePort();

    const proc = spawn(
      process.execPath,
      [
        cliPath,
        "serve",
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--views-file",
        invalidPath,
        "--data-dir",
        tempDataDir,
      ],
      {
        cwd: tempHome,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stderrOutput = "";
    proc.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolveCode) => {
      proc.once("exit", (code) => resolveCode(code));
    });

    expect(exitCode).not.toBe(0);
    expect(stderrOutput).toContain("Views file not found");
  });
});
