import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

describe("ad serve 命令行 -P, --package 选项与包白名单过滤验证", () => {
  let tempHome: string;
  let tempDataDir: string;
  let pkgADir: string;
  let pkgBDir: string;
  let pkgCDir: string;
  let serveProc: ChildProcess | undefined;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-serve-filter-home-"));
    tempDataDir = mkdtempSync(join(tmpdir(), "actiondock-serve-filter-data-"));
    pkgADir = mkdtempSync(join(tmpdir(), "actiondock-pkg-a-"));
    pkgBDir = mkdtempSync(join(tmpdir(), "actiondock-pkg-b-"));
    pkgCDir = mkdtempSync(join(tmpdir(), "actiondock-pkg-c-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    // 配置 Package A
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgADir, "node_modules"), "junction");
    }
    mkdirSync(join(pkgADir, "actions"), { recursive: true });
    writeFileSync(
      join(pkgADir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.pkg-a",
          name: "Package A",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            "echo-a": {
              entry: "actions/echo-a.ts",
              description: "Action from Package A",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string" } },
              },
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkgADir, "actions", "echo-a.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "echo-a",
  description: "Action from Package A",
  async run(input: { message?: string }) {
    return { from: "pkg-a", echo: input.message || "hello-a" };
  },
});
`
    );

    // 配置 Package B
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgBDir, "node_modules"), "junction");
    }
    mkdirSync(join(pkgBDir, "actions"), { recursive: true });
    writeFileSync(
      join(pkgBDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.pkg-b",
          name: "Package B",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            "echo-b": {
              entry: "actions/echo-b.ts",
              description: "Action from Package B",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string" } },
              },
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkgBDir, "actions", "echo-b.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "echo-b",
  description: "Action from Package B",
  async run(input: { message?: string }) {
    return { from: "pkg-b", echo: input.message || "hello-b" };
  },
});
`
    );

    // 配置 Package C
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgCDir, "node_modules"), "junction");
    }
    mkdirSync(join(pkgCDir, "actions"), { recursive: true });
    writeFileSync(
      join(pkgCDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.pkg-c",
          name: "Package C",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            "echo-c": {
              entry: "actions/echo-c.ts",
              description: "Action from Package C",
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkgCDir, "actions", "echo-c.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "echo-c",
  description: "Action from Package C",
  async run() {
    return { from: "pkg-c" };
  },
});
`
    );

    // 将 A、B、C 软链接到全局测试环境
    await linkPackage(pkgADir, tempHome);
    await linkPackage(pkgBDir, tempHome);
    await linkPackage(pkgCDir, tempHome);
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

    for (const dir of [tempHome, tempDataDir, pkgADir, pkgBDir, pkgCDir]) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {
          // 忽略清理异常
        }
      }
    }
  });

  it("当通过 -P 指定的包不存在时抛出清晰的错误并以非零码退出", async () => {
    const res = spawnSync(
      process.execPath,
      [cliPath, "serve", "-P", "non-existent-package-id"],
      {
        cwd: tempHome,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        encoding: "utf-8",
      }
    );

    expect(res.status).not.toBe(0);
    const combinedOutput = `${res.stdout}\n${res.stderr}`;
    expect(combinedOutput).toContain("Package 'non-existent-package-id' not found in linked packages or path");
  });

  it("通过 -P 指定单个包启动时，横幅正确展示且 HTTP 路由与 MCP 端点均受白名单限制", async () => {
    const SECRET = "test-token-single-pkg";
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
        "--token",
        SECRET,
        "-P",
        "test.pkg-a",
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

    // 等待服务监听就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        });
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // 继续重试
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);

    // 1. 验证启动横幅（banner）中清晰输出了当前服务的 Packages 清单
    expect(bannerOutput).toContain("* Packages:        test.pkg-a");

    // 2. 验证 HTTP 路由：GET /api/v2/actions 仅返回 test.pkg-a 的 actions
    const actionsRes = await fetch(`${serverUrl}/api/v2/actions`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(actionsRes.status).toBe(200);
    const actionsData = (await actionsRes.json()) as any[];
    const actionIds = actionsData.map((a: any) => a.id);
    expect(actionIds.some((id: string) => id.includes("echo-a"))).toBe(true);
    expect(actionIds.some((id: string) => id.includes("echo-b"))).toBe(false);
    expect(actionIds.some((id: string) => id.includes("echo-c"))).toBe(false);

    // 3. 验证 HTTP 路由：GET /api/v2/info 仅返回授权包
    const infoRes = await fetch(`${serverUrl}/api/v2/info`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(infoRes.status).toBe(200);
    const infoData = (await infoRes.json()) as any;
    const packagesList = infoData.packages || [infoData];
    const packageIdsInInfo = packagesList.map((p: any) => p.id);
    expect(packageIdsInInfo).toContain("test.pkg-a");
    expect(packageIdsInInfo).not.toContain("test.pkg-b");
    expect(packageIdsInInfo).not.toContain("test.pkg-c");

    // 4. 验证 HTTP 路由：已授权包详情返回 200，未授权包详情返回 403
    const showAllowedRes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-a/actions/echo-a`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(showAllowedRes.status).toBe(200);

    const showForbiddenRes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-b/actions/echo-b`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(showForbiddenRes.status).toBe(403);
    const showForbiddenJson = (await showForbiddenRes.json()) as any;
    expect(showForbiddenJson.error.code).toBe("PACKAGE_FORBIDDEN");

    // 5. 验证 HTTP 路由：未授权包执行返回 403，已授权包执行返回 200
    const runForbiddenRes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-b/actions/echo-b/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: {} }),
    });
    expect(runForbiddenRes.status).toBe(403);
    const runForbiddenJson = (await runForbiddenRes.json()) as any;
    expect(runForbiddenJson.error.code).toBe("PACKAGE_FORBIDDEN");

    const runAllowedRes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-a/actions/echo-a/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: { message: "run-success" } }),
    });
    expect(runAllowedRes.status).toBe(200);
    const runAllowedJson = (await runAllowedRes.json()) as any;
    expect(runAllowedJson.ok).toBe(true);
    expect(runAllowedJson.data.echo).toBe("run-success");

    // 6. 验证 MCP 端点 (/mcp)：tools/list 限制在指定包范围内
    const initRes = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get("mcp-session-id");
    const mcpHeaders: Record<string, string> = {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) {
      mcpHeaders["mcp-session-id"] = sessionId;
    }

    const listToolsRes = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-list-1",
        method: "tools/list",
        params: {},
      }),
    });
    expect(listToolsRes.status).toBe(200);
    const listRawText = await listToolsRes.text();
    let listData: any;
    if (listRawText.startsWith("event:")) {
      const dataLine = listRawText.split("\n").find((l) => l.startsWith("data:"));
      listData = JSON.parse(dataLine ? dataLine.slice(5).trim() : listRawText);
    } else {
      listData = JSON.parse(listRawText);
    }

    const toolNames = listData.result.tools.map((t: any) => t.name);
    expect(toolNames.some((name: string) => name.includes("echo-a"))).toBe(true);
    expect(toolNames.some((name: string) => name.includes("echo-b"))).toBe(false);
    expect(toolNames.some((name: string) => name.includes("echo-c"))).toBe(false);

    // 7. 验证 MCP 端点：调用已授权工具成功，调用未授权工具失败
    const callAllowedRes = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-allowed",
        method: "tools/call",
        params: {
          name: toolNames.find((name: string) => name.includes("echo-a")),
          arguments: { message: "mcp-hello" },
        },
      }),
    });
    expect(callAllowedRes.status).toBe(200);
    const callAllowedText = await callAllowedRes.text();
    const callAllowedData = JSON.parse(
      callAllowedText.startsWith("event:")
        ? callAllowedText.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim()
        : callAllowedText
    );
    expect(callAllowedData.error).toBeUndefined();
    expect(callAllowedData.result.isError).toBeFalsy();
    const parsedPayload = JSON.parse(callAllowedData.result.content[0].text);
    expect(parsedPayload.ok).toBe(true);
    expect(parsedPayload.data.echo).toBe("mcp-hello");

    const callForbiddenRes = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-forbidden",
        method: "tools/call",
        params: {
          name: "echo-b",
          arguments: {},
        },
      }),
    });
    expect(callForbiddenRes.status).toBe(200);
    const callForbiddenText = await callForbiddenRes.text();
    const callForbiddenData = JSON.parse(
      callForbiddenText.startsWith("event:")
        ? callForbiddenText.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim()
        : callForbiddenText
    );
    expect(callForbiddenData.error).toBeDefined();
  });

  it("支持通过逗号分隔或多次 -P 指定多个包，横幅聚合且服务限制在集合范围内", async () => {
    const SECRET = "test-token-multi-pkg";
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
        "--token",
        SECRET,
        "-P",
        "test.pkg-a,test.pkg-b",
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

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
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

    // 1. 横幅包含两个包
    expect(bannerOutput).toContain("* Packages:        test.pkg-a, test.pkg-b");

    // 2. Actions 接口包含 A 和 B，不包含 C
    const actionsRes = await fetch(`${serverUrl}/api/v2/actions`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(actionsRes.status).toBe(200);
    const actionsData = (await actionsRes.json()) as any[];
    const actionIds = actionsData.map((a: any) => a.id);
    expect(actionIds.some((id: string) => id.includes("echo-a"))).toBe(true);
    expect(actionIds.some((id: string) => id.includes("echo-b"))).toBe(true);
    expect(actionIds.some((id: string) => id.includes("echo-c"))).toBe(false);

    // 3. A 和 B 均可访问，C 返回 403
    const showARes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-a/actions/echo-a`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(showARes.status).toBe(200);

    const showBRes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-b/actions/echo-b`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(showBRes.status).toBe(200);

    const showCRes = await fetch(`${serverUrl}/api/v2/packages/test.pkg-c/actions/echo-c`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(showCRes.status).toBe(403);
    const showCJson = (await showCRes.json()) as any;
    expect(showCJson.error.code).toBe("PACKAGE_FORBIDDEN");
  });

  it("多次指定 -P 选项（-P pkgA -P pkgB）正确聚合参数", async () => {
    const SECRET = "test-token-repeat-flags";
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
        "--token",
        SECRET,
        "-P",
        "test.pkg-a",
        "-P",
        "test.pkg-b",
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

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
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

    expect(bannerOutput).toContain("* Packages:        test.pkg-a, test.pkg-b");

    const actionsRes = await fetch(`${serverUrl}/api/v2/actions`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(actionsRes.status).toBe(200);
    const actionsData = (await actionsRes.json()) as any[];
    const actionIds = actionsData.map((a: any) => a.id);
    expect(actionIds.some((id: string) => id.includes("echo-a"))).toBe(true);
    expect(actionIds.some((id: string) => id.includes("echo-b"))).toBe(true);
    expect(actionIds.some((id: string) => id.includes("echo-c"))).toBe(false);
  });
});
