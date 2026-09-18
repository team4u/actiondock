import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { createServer } from "node:net";

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

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync([process.execPath, cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("ad serve 模式下进程驱动与 ctx.process 远程执行验证", () => {
  let tempDir: string;
  let tempHome: string;
  let tempDataDir: string;
  let serveProc: ChildProcess | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-serve-proc-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-serve-proc-home-"));
    tempDataDir = mkdtempSync(join(tmpdir(), "actiondock-serve-proc-data-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }

    mkdirSync(join(tempDir, "actions"), { recursive: true });

    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.serve-process",
          name: "Serve Process Test Package",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            "proc.exec": {
              entry: "actions/proc.ts",
              description: "Action utilizing ctx.process",
              inputSchema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                },
              },
            },
          },
        },
        null,
        2
      )
    );

    writeFileSync(
      join(tempDir, "actions", "proc.ts"),
      `
import { decodeText, defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "proc.exec",
  description: "Action utilizing ctx.process",
  async run(input: { message?: string }, ctx) {
    const msg = input.message || "hello-from-process";
    const res = await ctx.process.run({
      spec: {
        executable: process.execPath,
        args: ["-e", \`console.log("\${msg}")\`],
        io: { mode: "pipe" },
      },
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    return {
      output: decodeText(res.chunks).trim(),
      exitCode: res.exit.code,
    };
  },
});
`
    );
  });

  afterEach(async () => {
    if (serveProc) {
      serveProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      serveProc = undefined;
    }
    for (const dir of [tempHome, tempDataDir, tempDir]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {
          // 忽略清理异常
        }
      }
    }
  });

  it("通过 ad serve 启动并在远程执行调用 ctx.process 的 Action 成功", async () => {
    const SECRET = "token-serve-proc-123";
    const port = await getAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}`;

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
        "--dir",
        tempDir,
        "--data-dir",
        tempDataDir,
      ],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // 等待服务监听就绪
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v1/health`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // 继续等待
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);

    // 1. 通过远程 ad run 执行进程类 Action
    const runResultProc = runCli(
      [
        "run",
        "proc.exec",
        "--server",
        serverUrl,
        "--token",
        SECRET,
        "--input",
        '{"message":"custom-echo-success"}',
        "--json",
      ],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );

    expect(runResultProc.exitCode).toBe(0);
    const resultJson = JSON.parse(runResultProc.stdout.toString());
    expect(resultJson.ok).toBe(true);
    expect(resultJson.data.output).toBe("custom-echo-success");
    expect(resultJson.data.exitCode).toBe(0);

    // 2. 通过内置 /mcp 端点执行进程类 Action
    // 首先进行 MCP 初始化握手
    const initResponse = await fetch(`${serverUrl}/mcp`, {
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
    expect(initResponse.status).toBe(200);

    const sessionId = initResponse.headers.get("mcp-session-id");
    const mcpHeaders: Record<string, string> = {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) {
      mcpHeaders["mcp-session-id"] = sessionId;
    }

    const mcpResponse = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "proc.exec",
          arguments: { message: "mcp-echo-success" },
        },
      }),
    });

    expect(mcpResponse.status).toBe(200);
    const mcpRawText = await mcpResponse.text();
    let mcpData: any;
    if (mcpRawText.startsWith("event:")) {
      // SSE 格式，提取 data: 行
      const dataLine = mcpRawText.split("\n").find((l) => l.startsWith("data:"));
      mcpData = JSON.parse(dataLine ? dataLine.slice(5).trim() : mcpRawText);
    } else {
      mcpData = JSON.parse(mcpRawText);
    }
    expect(mcpData.error).toBeUndefined();
    expect(mcpData.result.isError).toBeFalsy();
    const contentText = mcpData.result.content[0].text;
    const parsedActionData = JSON.parse(contentText);
    expect(parsedActionData.ok).toBe(true);
    expect(parsedActionData.data.output).toBe("mcp-echo-success");
  });
});
