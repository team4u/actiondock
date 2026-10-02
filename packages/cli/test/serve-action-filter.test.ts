import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
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

describe("ad serve 命令行 -A, --action 选项与动作白名单验证", () => {
  let tempHome: string;
  let tempDataDir: string;
  let pkgADir: string;
  let pkgBDir: string;
  let pkgCDir: string;
  let serveProc: ChildProcess | undefined;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-serve-act-home-"));
    tempDataDir = mkdtempSync(join(tmpdir(), "actiondock-serve-act-data-"));
    pkgADir = mkdtempSync(join(tmpdir(), "actiondock-act-pkg-a-"));
    pkgBDir = mkdtempSync(join(tmpdir(), "actiondock-act-pkg-b-"));
    pkgCDir = mkdtempSync(join(tmpdir(), "actiondock-act-pkg-c-"));

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
            "secret-a": {
              entry: "actions/secret-a.ts",
              description: "Secret Action in Package A",
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
    writeFileSync(
      join(pkgADir, "actions", "secret-a.ts"),
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "secret-a",
  description: "Secret Action in Package A",
  async run() {
    return { secret: "hidden" };
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

    // 软链接到全局测试环境
    await linkPackage(pkgADir, tempHome);
    await linkPackage(pkgBDir, tempHome);
    await linkPackage(pkgCDir, tempHome);
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

  it("通过 -A 指定单个全限定动作启动时，横幅输出、HTTP 与 MCP 均受到动作白名单限制", async () => {
    const SECRET = "test-token-single-act";
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
        "-A",
        "test.pkg-a/echo-a",
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

    // 等待服务监听就绪与横幅输出
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        });
        if (res.status === 200 && bannerOutput.includes("* Actions:")) {
          ready = true;
          break;
        }
      } catch {
        // 重试
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(ready, true);

    // 1. 验证横幅展示 Actions 白名单信息
    assert.ok((bannerOutput).includes("* Actions:         test.pkg-a/echo-a"));

    // 2. 验证 GET /api/v2/actions 仅返回 echo-a
    const actionsRes = await fetch(`${serverUrl}/api/v2/actions`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    assert.strictEqual(actionsRes.status, 200);
    const actionsData = (await actionsRes.json()) as any[];
    const actionIds = actionsData.map((a: any) => a.id);
    assert.strictEqual(actionIds.some((id: string) => id.includes("echo-a")), true);
    assert.strictEqual(actionIds.some((id: string) => id.includes("secret-a")), false);
    assert.strictEqual(actionIds.some((id: string) => id.includes("echo-b")), false);

    // 3. 验证 GET /packages/:packageId/actions/:actionId 拦截与放行
    const showAllowedRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-a/actions/echo-a`,
      { headers: { Authorization: `Bearer ${SECRET}` } }
    );
    assert.strictEqual(showAllowedRes.status, 200);

    const showForbiddenSamePkgRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-a/actions/secret-a`,
      { headers: { Authorization: `Bearer ${SECRET}` } }
    );
    assert.strictEqual(showForbiddenSamePkgRes.status, 403);
    const showForbiddenSamePkgData = await showForbiddenSamePkgRes.json();
    assert.strictEqual(showForbiddenSamePkgData.error.code, "ACTION_FORBIDDEN");

    const showForbiddenOtherPkgRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-b/actions/echo-b`,
      { headers: { Authorization: `Bearer ${SECRET}` } }
    );
    assert.strictEqual(showForbiddenOtherPkgRes.status, 403);
    const showForbiddenOtherPkgData = await showForbiddenOtherPkgRes.json();
    assert.strictEqual(showForbiddenOtherPkgData.error.code, "ACTION_FORBIDDEN");

    // 4. 验证 POST run 路由阻断与放行
    const runAllowedRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-a/actions/echo-a/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: "hello-cli" }),
      }
    );
    assert.strictEqual(runAllowedRes.status, 200);
    const runAllowedData = await runAllowedRes.json();
    assert.strictEqual(runAllowedData.ok, true);
    assert.strictEqual(runAllowedData.data.echo, "hello-cli");

    const runForbiddenRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-a/actions/secret-a/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: {} }),
      }
    );
    assert.strictEqual(runForbiddenRes.status, 403);
    const runForbiddenData = await runForbiddenRes.json();
    assert.strictEqual(runForbiddenData.error.code, "ACTION_FORBIDDEN");

    // 5. 验证 MCP 端点工具过滤
    const mcpInitRes = await fetch(`${serverUrl}/mcp`, {
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
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    assert.strictEqual(mcpInitRes.status, 200);

    const sessionId = mcpInitRes.headers.get("mcp-session-id");
    const mcpHeaders: Record<string, string> = {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) {
      mcpHeaders["mcp-session-id"] = sessionId;
    }

    const mcpToolsRes = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-1",
        method: "tools/list",
        params: {},
      }),
    });
    assert.strictEqual(mcpToolsRes.status, 200);
    const listRawText = await mcpToolsRes.text();
    let mcpToolsData: any;
    if (listRawText.startsWith("event:")) {
      const dataLine = listRawText.split("\n").find((l) => l.startsWith("data:"));
      mcpToolsData = JSON.parse(dataLine ? dataLine.slice(5).trim() : listRawText);
    } else {
      mcpToolsData = JSON.parse(listRawText);
    }
    const toolNames = mcpToolsData.result?.tools?.map((t: any) => t.name) || [];
    assert.ok((toolNames).includes("echo-a"));
    assert.ok(!(toolNames).includes("secret-a"));
    assert.ok(!(toolNames).includes("echo-b"));
  });

  it("支持多次指定与逗号分隔的 -A 参数配置", async () => {
    const SECRET = "test-token-multi-act";
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
        "-A",
        "test.pkg-a/echo-a,test.pkg-b/echo-b",
        "-A",
        "test.pkg-a/secret-a",
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
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        });
        if (res.status === 200 && bannerOutput.includes("test.pkg-a/echo-a")) {
          ready = true;
          break;
        }
      } catch {
        // 重试
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(ready, true);

    // 验证横幅展示
    assert.ok((bannerOutput).includes("test.pkg-a/echo-a, test.pkg-b/echo-b, test.pkg-a/secret-a"));

    // 验证授权的 actions 均可执行
    const runARes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-a/actions/echo-a/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }
    );
    assert.strictEqual(runARes.status, 200);

    const runBRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-b/actions/echo-b/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }
    );
    assert.strictEqual(runBRes.status, 200);

    // 验证未包含在白名单中的 echo-c 被拦截
    const runCRes = await fetch(
      `${serverUrl}/api/v2/packages/test.pkg-c/actions/echo-c/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }
    );
    assert.strictEqual(runCRes.status, 403);
    const runCData = await runCRes.json();
    assert.strictEqual(runCData.error.code, "ACTION_FORBIDDEN");
  });

  it("当 -A 参数指定不存在的包时输出告警信息至 stderr", async () => {
    const SECRET = "test-token-warning";
    const port = await getAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}`;

    let stderrOutput = "";
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
        "-A",
        "nonexistent-pkg/my-action",
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

    serveProc.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        });
        if (res.status === 200 && stderrOutput.includes("Warning: Package 'nonexistent-pkg'")) {
          ready = true;
          break;
        }
      } catch {
        // 重试
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(ready, true);
    assert.ok((stderrOutput).includes(
      "Warning: Package 'nonexistent-pkg' specified in action 'nonexistent-pkg/my-action' was not found."
    ));
  });
});
