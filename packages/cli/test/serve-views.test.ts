import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { linkPackage } from "@actiondock/core/registry";
import {
  extractNamespacedViews,
  loadViewsFromFile,
  mergeServerViews,
  printServerBanner,
  printServerViews,
} from "../src/utils";

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

describe("单端口多视图（Virtual Views）单元逻辑验证", () => {
  it("loadViewsFromFile: 正确加载并解析对象字典、数组与包裹格式", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-views-test-"));
    try {
      // 1. 直接对象字典
      const dictPath = join(tempDir, "dict.json");
      writeFileSync(dictPath, JSON.stringify({ admin: { token: "token-a" } }));
      const dictViews = loadViewsFromFile(dictPath);
      expect(dictViews).toEqual({ admin: { token: "token-a" } });

      // 2. 数组形式
      const arrayPath = join(tempDir, "array.json");
      writeFileSync(arrayPath, JSON.stringify([{ name: "worker", token: "token-w" }]));
      const arrayViews = loadViewsFromFile(arrayPath);
      expect(arrayViews).toEqual([{ name: "worker", token: "token-w" }]);

      // 3. { views: ... } 嵌套形态
      const nestedPath = join(tempDir, "nested.json");
      writeFileSync(nestedPath, JSON.stringify({ views: { guest: { token: "token-g" } } }));
      const nestedViews = loadViewsFromFile(nestedPath);
      expect(nestedViews).toEqual({ guest: { token: "token-g" } });

      // 4. { server: { views: ... } } 嵌套形态
      const serverPath = join(tempDir, "server.json");
      writeFileSync(serverPath, JSON.stringify({ server: { views: { svc: { token: "token-s" } } } }));
      const serverViews = loadViewsFromFile(serverPath);
      expect(serverViews).toEqual({ svc: { token: "token-s" } });

      // 5. 文件不存在时抛出 ArgumentError
      expect(() => loadViewsFromFile(join(tempDir, "missing.json"))).toThrow("Views file not found");

      // 6. JSON 非法时抛出 ArgumentError
      const invalidPath = join(tempDir, "invalid.json");
      writeFileSync(invalidPath, "not-valid-json");
      expect(() => loadViewsFromFile(invalidPath)).toThrow("Failed to read views file");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("mergeServerViews: 正确合并项目配置与文件视图，文件定义优先覆盖", () => {
    // 两个字典合并
    const baseDict = {
      shared: { token: "base-token", packageAllowlist: ["pkg-1"] },
      baseOnly: { token: "base-only-token" },
    };
    const overrideDict = {
      shared: { token: "override-token", packageAllowlist: ["pkg-2"] },
      overrideOnly: { token: "override-only-token" },
    };

    const merged = mergeServerViews(baseDict, overrideDict) as Record<string, any>;
    expect(merged.shared.token).toBe("override-token");
    expect(merged.shared.packageAllowlist).toEqual(["pkg-2"]);
    expect(merged.baseOnly.token).toBe("base-only-token");
    expect(merged.overrideOnly.token).toBe("override-only-token");

    // 仅有其一时回退对应配置
    expect(mergeServerViews(undefined, overrideDict)).toEqual(overrideDict);
    expect(mergeServerViews(baseDict, undefined)).toEqual(baseDict);
    expect(mergeServerViews(undefined, undefined)).toBeUndefined();
  });

  it("extractNamespacedViews: 提取命名空间视图并过滤 default 默认视图", () => {
    const views = {
      default: { token: "master-token" },
      admin: { token: "admin-token", enableMcp: true },
      readonly: { token: "ro-token", enableMcp: false },
    };
    const extracted = extractNamespacedViews(views);
    expect(extracted.length).toBe(2);
    expect(extracted.map((v) => v.name)).toEqual(["admin", "readonly"]);
    expect(extracted.find((v) => v.name === "admin")?.enableMcp).toBe(true);
    expect(extracted.find((v) => v.name === "readonly")?.enableMcp).toBe(false);
  });

  it("printServerBanner: 包含命名空间视图时正确渲染名称、专属 MCP 端点与 HTTP 根路径", () => {
    let output = "";
    const fakeContext: any = {
      stdout: (str: string) => {
        output += str + "\n";
      },
    };

    printServerBanner("Test Server", "http", "127.0.0.1", 5177, fakeContext, {
      views: {
        admin: { token: "admin-token" },
        worker: { token: "worker-token", enableMcp: false },
      },
      endpointHost: "127.0.0.1",
      enableMcp: true,
    });

    expect(output).toContain("* Listening on:    http://127.0.0.1:5177");
    expect(output).toContain("* Views:");
    expect(output).toContain("- admin:");
    expect(output).toContain("- HTTP Root:    http://127.0.0.1:5177/views/admin");
    expect(output).toContain("- MCP Endpoint: http://127.0.0.1:5177/views/admin/mcp");
    expect(output).toContain("- worker:");
    expect(output).toContain("- HTTP Root:    http://127.0.0.1:5177/views/worker");
    expect(output).toContain("- MCP Endpoint: Disabled");
  });

  it("printServerBanner: 无视图配置时保持向后兼容，不输出 Views 段落", () => {
    let output = "";
    const fakeContext: any = {
      stdout: (str: string) => {
        output += str + "\n";
      },
    };

    printServerBanner("Legacy Server", "http", "127.0.0.1", 5177, fakeContext);

    expect(output).toContain("* Listening on:    http://127.0.0.1:5177");
    expect(output).not.toContain("* Views:");
  });
});

describe("ad serve 单端口多视图（Virtual Views）端到端集成验证", () => {
  let tempHome: string;
  let tempDataDir: string;
  let projectDir: string;
  let pkgMathDir: string;
  let pkgAdminDir: string;
  let serveProc: ChildProcess | undefined;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-views-home-"));
    tempDataDir = mkdtempSync(join(tmpdir(), "actiondock-views-data-"));
    projectDir = mkdtempSync(join(tmpdir(), "actiondock-views-proj-"));
    pkgMathDir = mkdtempSync(join(tmpdir(), "actiondock-pkg-math-"));
    pkgAdminDir = mkdtempSync(join(tmpdir(), "actiondock-pkg-admin-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    // 1. 创建 Package Math
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgMathDir, "node_modules"), "junction");
    }
    mkdirSync(join(pkgMathDir, "actions"), { recursive: true });
    writeFileSync(
      join(pkgMathDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg.math",
          name: "Math Package",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            calc: {
              entry: "actions/calc.ts",
              description: "Calculate numbers",
              inputSchema: {
                type: "object",
                properties: { num: { type: "number" } },
              },
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkgMathDir, "actions", "calc.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "calc",
  description: "Calculate numbers",
  async run(input: { num?: number }) {
    return { result: (input.num || 0) * 2 };
  },
});
`
    );

    // 2. 创建 Package Admin
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgAdminDir, "node_modules"), "junction");
    }
    mkdirSync(join(pkgAdminDir, "actions"), { recursive: true });
    writeFileSync(
      join(pkgAdminDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg.admin",
          name: "Admin Package",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            manage: {
              entry: "actions/manage.ts",
              description: "Admin manage action",
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkgAdminDir, "actions", "manage.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "manage",
  description: "Admin manage action",
  async run() {
    return { status: "admin-ok" };
  },
});
`
    );

    // 链接至全局测试环境
    await linkPackage(pkgMathDir, tempHome);
    await linkPackage(pkgAdminDir, tempHome);
  });

  afterEach(async () => {
    if (serveProc) {
      serveProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      if (!serveProc.killed) {
        serveProc.kill("SIGKILL");
      }
      serveProc = undefined;
    }

    for (const dir of [tempHome, tempDataDir, projectDir, pkgMathDir, pkgAdminDir]) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {
          // 忽略清理异常
        }
      }
    }
  });

  it("通过 actiondock.json 的 server.views 配置视图，校验启动横幅、命名空间 HTTP 路由及 MCP 工具隔离", async () => {
    const MASTER_TOKEN = "master-token-123";
    const MATH_TOKEN = "math-secret-token";
    const ADMIN_TOKEN = "admin-secret-token";
    const NO_MCP_TOKEN = "no-mcp-secret-token";
    const port = await getAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}`;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "junction");
    }

    // 在项目配置文件中声明 server.views
    writeFileSync(
      join(projectDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.views-project",
          name: "Views Test Project",
          version: "1.0.0",
          schemaVersion: 2,
          server: {
            views: {
              admin: {
                token: ADMIN_TOKEN,
                enableManagement: true,
              },
              "math-only": {
                token: MATH_TOKEN,
                packageAllowlist: ["pkg.math"],
                actionAllowlist: ["pkg.math/calc"],
                enableManagement: false,
              },
              "no-mcp": {
                token: NO_MCP_TOKEN,
                enableMcp: false,
              },
            },
          },
        },
        null,
        2
      )
    );

    let bannerOutput = "";
    serveProc = spawn(
      process.execPath,
      [
        cliPath,
        "serve",
        "--dir",
        projectDir,
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--token",
        MASTER_TOKEN,
        "--data-dir",
        tempDataDir,
      ],
      {
        cwd: projectDir,
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

    // 等待服务监听就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${MASTER_TOKEN}` },
        });
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // 重试
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);

    // 1. 验证启动横幅（banner）中清晰输出了命名空间视图列表
    expect(bannerOutput).toContain("* Views:");
    expect(bannerOutput).toContain("- admin:");
    expect(bannerOutput).toContain(`- HTTP Root:    http://127.0.0.1:${port}/views/admin`);
    expect(bannerOutput).toContain(`- MCP Endpoint: http://127.0.0.1:${port}/views/admin/mcp`);
    expect(bannerOutput).toContain("- math-only:");
    expect(bannerOutput).toContain(`- HTTP Root:    http://127.0.0.1:${port}/views/math-only`);
    expect(bannerOutput).toContain(`- MCP Endpoint: http://127.0.0.1:${port}/views/math-only/mcp`);
    expect(bannerOutput).toContain("- no-mcp:");
    expect(bannerOutput).toContain(`- HTTP Root:    http://127.0.0.1:${port}/views/no-mcp`);
    expect(bannerOutput).toContain("- MCP Endpoint: Disabled");

    // 2. 验证命名空间 HTTP API 隔离：math-only 视图仅返回 pkg.math 动作
    const mathActionsRes = await fetch(`${serverUrl}/views/math-only/api/v2/actions`, {
      headers: { Authorization: `Bearer ${MATH_TOKEN}` },
    });
    expect(mathActionsRes.status).toBe(200);
    const mathActions = (await mathActionsRes.json()) as any[];
    const mathActionIds = mathActions.map((a: any) => a.id);
    expect(mathActionIds.some((id: string) => id.includes("calc"))).toBe(true);
    expect(mathActionIds.some((id: string) => id.includes("manage"))).toBe(false);

    // 3. 验证命名空间 HTTP API 执行：math-only 视图执行 calc 成功，执行 manage 返回 403
    const calcRunRes = await fetch(`${serverUrl}/views/math-only/api/v2/actions/calc/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MATH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: { num: 21 } }),
    });
    expect(calcRunRes.status).toBe(200);
    const calcData = (await calcRunRes.json()) as any;
    expect(calcData.data.result).toBe(42);

    const manageRunRes = await fetch(`${serverUrl}/views/math-only/api/v2/actions/manage/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MATH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: {} }),
    });
    expect(manageRunRes.status).toBe(403);

    // 4. 验证 admin 视图可执行 manage
    const adminManageRes = await fetch(`${serverUrl}/views/admin/api/v2/actions/manage/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: {} }),
    });
    expect(adminManageRes.status).toBe(200);
    const adminData = (await adminManageRes.json()) as any;
    expect(adminData.data.status).toBe("admin-ok");

    // 5. 验证 MCP 端点工具隔离：math-only MCP 服务 tools/list 仅包含 calc
    const mathInitRes = await fetch(`${serverUrl}/views/math-only/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MATH_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-math",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "math-client", version: "1.0" },
        },
      }),
    });
    expect(mathInitRes.status).toBe(200);
    const mathSessionId = mathInitRes.headers.get("mcp-session-id");
    const mathMcpHeaders: Record<string, string> = {
      Authorization: `Bearer ${MATH_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (mathSessionId) {
      mathMcpHeaders["mcp-session-id"] = mathSessionId;
    }

    const mathListRes = await fetch(`${serverUrl}/views/math-only/mcp`, {
      method: "POST",
      headers: mathMcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "list-math-tools",
        method: "tools/list",
        params: {},
      }),
    });
    expect(mathListRes.status).toBe(200);
    const mathListText = await mathListRes.text();
    let mathListData: any;
    if (mathListText.startsWith("event:")) {
      const line = mathListText.split("\n").find((l) => l.startsWith("data:"));
      mathListData = JSON.parse(line ? line.slice(5).trim() : mathListText);
    } else {
      mathListData = JSON.parse(mathListText);
    }
    const mathToolNames = mathListData.result.tools.map((t: any) => t.name);
    expect(mathToolNames.some((n: string) => n.includes("calc"))).toBe(true);
    expect(mathToolNames.some((n: string) => n.includes("manage"))).toBe(false);

    // 6. 验证 admin 视图 MCP 包含所有工具
    const adminInitRes = await fetch(`${serverUrl}/views/admin/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-admin",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "admin-client", version: "1.0" },
        },
      }),
    });
    expect(adminInitRes.status).toBe(200);
    const adminSessionId = adminInitRes.headers.get("mcp-session-id");
    const adminMcpHeaders: Record<string, string> = {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (adminSessionId) {
      adminMcpHeaders["mcp-session-id"] = adminSessionId;
    }

    const adminListRes = await fetch(`${serverUrl}/views/admin/mcp`, {
      method: "POST",
      headers: adminMcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "list-admin-tools",
        method: "tools/list",
        params: {},
      }),
    });
    expect(adminListRes.status).toBe(200);
    const adminListText = await adminListRes.text();
    let adminListData: any;
    if (adminListText.startsWith("event:")) {
      const line = adminListText.split("\n").find((l) => l.startsWith("data:"));
      adminListData = JSON.parse(line ? line.slice(5).trim() : adminListText);
    } else {
      adminListData = JSON.parse(adminListText);
    }
    const adminToolNames = adminListData.result.tools.map((t: any) => t.name);
    expect(adminToolNames.some((n: string) => n.includes("calc"))).toBe(true);
    expect(adminToolNames.some((n: string) => n.includes("manage"))).toBe(true);

    // 7. 验证禁用 MCP 的视图返回 404
    const noMcpRes = await fetch(`${serverUrl}/views/no-mcp/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NO_MCP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-no-mcp",
        method: "initialize",
        params: {},
      }),
    });
    expect(noMcpRes.status).toBe(404);
  });

  it("通过 --views-file 选项加载外部视图文件，且外部视图优先覆盖 actiondock.json 中的同名视图", async () => {
    const port = await getAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}`;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "junction");
    }

    // 1. 项目自带基础视图
    writeFileSync(
      join(projectDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.views-override",
          name: "Override Test Project",
          version: "1.0.0",
          schemaVersion: 2,
          server: {
            views: {
              shared: {
                token: "base-token",
                actionAllowlist: ["pkg.admin/manage"],
              },
              baseOnly: {
                token: "base-only-token",
              },
            },
          },
        },
        null,
        2
      )
    );

    // 2. 外部独立视图文件，覆盖 shared 视图为只允许 pkg.math/calc
    const externalViewsPath = join(projectDir, "external-views.json");
    writeFileSync(
      externalViewsPath,
      JSON.stringify(
        {
          views: {
            shared: {
              token: "file-override-token",
              actionAllowlist: ["pkg.math/calc"],
            },
            fileOnly: {
              token: "file-only-token",
            },
          },
        },
        null,
        2
      )
    );

    let bannerOutput = "";
    serveProc = spawn(
      process.execPath,
      [
        cliPath,
        "serve",
        "--dir",
        projectDir,
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--token",
        "master-key",
        "--views-file",
        externalViewsPath,
        "--data-dir",
        tempDataDir,
      ],
      {
        cwd: projectDir,
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

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: "Bearer master-key" },
        });
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);

    // 启动横幅中包含合并后的全部视图
    expect(bannerOutput).toContain("- shared:");
    expect(bannerOutput).toContain("- baseOnly:");
    expect(bannerOutput).toContain("- fileOnly:");

    // shared 视图已被覆盖：使用 file-override-token 鉴权成功，且仅能执行 pkg.math/calc
    const runRes = await fetch(`${serverUrl}/views/shared/api/v2/actions/calc/run`, {
      method: "POST",
      headers: {
        Authorization: "Bearer file-override-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: { num: 10 } }),
    });
    expect(runRes.status).toBe(200);

    // 旧 base-token 鉴权失败
    const unauthorizedRes = await fetch(`${serverUrl}/views/shared/api/v2/actions/calc/run`, {
      method: "POST",
      headers: {
        Authorization: "Bearer base-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: { num: 10 } }),
    });
    expect(unauthorizedRes.status).toBe(401);
  });
});
