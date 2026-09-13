import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * 终止 ad mcp 子进程并等待其退出。
 *
 * Windows 兼容：Node 的 child.kill("SIGTERM") 仅硬杀直接子进程（supervisor），
 * 其派生的 worker 进程会成为孤儿并继续持有 tempDir 工作目录句柄——Windows
 * 禁止删除任何进程的 cwd，afterAll 清理将永久 EPERM。因此 Windows 下必须用
 * taskkill /T /F 按进程树整棵终止；POSIX 下保持 SIGTERM 语义。
 */
async function killMcpChild(child: ChildProcess): Promise<void> {
  if (process.platform === "win32") {
    if (child.pid) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    }
  } else {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("MCP STDIO Protocol Process Isolation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-stdio-test-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }

    mkdirSync(join(tempDir, "actions"), { recursive: true });

    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "test.noisy-pkg",
          name: "Noisy Package",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            "noisy.greet": {
              entry: "actions/greet.ts",
              description: "Action that pollutes console.log heavily",
              inputSchema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                },
                required: ["name"],
              },
              outputSchema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                },
                required: ["message"],
              },
            },
            "fatal.crash": {
              entry: "actions/crash.ts",
              description: "Action that deliberately crashes the process",
              inputSchema: { type: "object" },
            },
          },
        },
        null,
        2
      )
    );

    writeFileSync(
      join(tempDir, "actions", "greet.ts"),
      `
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "noisy.greet",
  description: "Action that pollutes console.log heavily",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  run(input: { name: string }) {
    console.log("=== RAW POLLUTING LOG THAT MUST NOT CORRUPT MCP PROTOCOL ===");
    console.log(JSON.stringify({ arbitrary: "unframed business debug info" }));
    process.stdout.write("UNFORMATTED_RAW_STREAM_DATA\\n");
    return { message: "Hello " + input.name };
  },
});
`
    );

    writeFileSync(
      join(tempDir, "actions", "crash.ts"),
      `
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "fatal.crash",
  description: "Action that deliberately crashes the process",
  inputSchema: { type: "object" },
  run() {
    process.exit(42);
  },
});
`
    );
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      // Windows 兼容：ad mcp 子进程退出与句柄释放存在竞态，EPERM/EBUSY 需重试
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("physically isolates child process stdout and protects MCP JSON-RPC protocol framing", async () => {
    const cliScript = resolve(import.meta.dirname, "../../cli/dist/index.js");

    const child = spawn(process.execPath, [cliScript, "mcp", "-d", tempDir], {
      cwd: tempDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const receivedLines: string[] = [];
    const stderrChunks: string[] = [];

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          receivedLines.push(line.trim());
        }
      }
    });

    // 1. 初始化 MCP 握手 (initialize)
    const initReq = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    };
    child.stdin.write(JSON.stringify(initReq) + "\n");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for init response")), 5000);
      const check = setInterval(() => {
        if (receivedLines.some((l) => l.includes(`"id":1`))) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    // 2. 执行包含大量 console.log 输出的 noisy.greet 工具
    const callReq = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "noisy.greet",
        arguments: { name: "World" },
      },
    };
    child.stdin.write(JSON.stringify(callReq) + "\n");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for call response")), 5000);
      const check = setInterval(() => {
        if (receivedLines.some((l) => l.includes(`"id":2`))) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    await killMcpChild(child);

    expect(receivedLines.length).toBeGreaterThanOrEqual(2);
    for (const line of receivedLines) {
      const parsed = JSON.parse(line);
      expect(parsed.jsonrpc).toBe("2.0");
    }

    const callRespLine = receivedLines.find((l) => l.includes(`"id":2`));
    expect(callRespLine).toBeDefined();
    const callResp = JSON.parse(callRespLine!);
    expect(callResp.result.content[0].text).toContain("Hello World");

    const fullStderr = stderrChunks.join("");
    expect(fullStderr).toContain("RAW POLLUTING LOG THAT MUST NOT CORRUPT MCP PROTOCOL");
    expect(fullStderr).toContain("unframed business debug info");
    expect(fullStderr).toContain("UNFORMATTED_RAW_STREAM_DATA");
  }, 10000);

  it("converts child process sudden exit into structured JSON-RPC error without corrupting transport framing", async () => {
    const cliScript = resolve(import.meta.dirname, "../../cli/dist/index.js");

    const child = spawn(process.execPath, [cliScript, "mcp", "-d", tempDir], {
      cwd: tempDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const receivedLines: string[] = [];

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          receivedLines.push(line.trim());
        }
      }
    });

    // 1. 初始化 MCP 握手
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "crash-test", version: "1.0.0" },
        },
      }) + "\n"
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for init response")), 5000);
      const check = setInterval(() => {
        if (receivedLines.some((l) => l.includes(`"id":10`))) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    // 2. 调用会故意导致进程退出的 fatal.crash 工具
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "fatal.crash",
          arguments: {},
        },
      }) + "\n"
    );

    // 等待响应返回
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for crash tool response")), 5000);
      const check = setInterval(() => {
        if (receivedLines.some((l) => l.includes(`"id":20`))) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    await killMcpChild(child);

    // 校验：即使子进程崩溃，监督进程仍返回标准的 JSON-RPC 错误，未破坏通信协议
    const crashRespLine = receivedLines.find((l) => l.includes(`"id":20`));
    expect(crashRespLine).toBeDefined();
    const crashResp = JSON.parse(crashRespLine!);
    expect(crashResp.jsonrpc).toBe("2.0");
    // MCP tool error result (isError: true) or JSON-RPC error
    if (crashResp.result) {
      expect(crashResp.result.isError).toBe(true);
      expect(crashResp.result.content[0].text).toContain("HOST_PROCESS_EXITED");
    } else {
      expect(crashResp.error).toBeDefined();
      expect(crashResp.error.message).toContain("HOST_PROCESS_EXITED");
    }
  }, 10000);

  it("exits the supervisor process after the MCP client closes stdin instead of hanging forever", async () => {
    const cliScript = resolve(import.meta.dirname, "../../cli/dist/index.js");

    const child = spawn(process.execPath, [cliScript, "mcp", "-d", tempDir], {
      cwd: tempDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const receivedLines: string[] = [];

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          receivedLines.push(line.trim());
        }
      }
    });

    // 初始化 MCP 握手
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "detach-test", version: "1.0.0" },
        },
      }) + "\n"
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for init response")), 5000);
      const check = setInterval(() => {
        if (receivedLines.some((l) => l.includes(`"id":30`))) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // 模拟 MCP 客户端断开：关闭 stdin 管道
    child.stdin.end();

    // 断言监督进程在有限时间内自行退出（不依赖外部信号），且退出码为 0
    const exitInfo = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      const timeout = setTimeout(() => resolve({ code: null, signal: "HANG_TIMEOUT" }), 8000);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    expect(exitInfo.signal).not.toBe("HANG_TIMEOUT");
    expect(exitInfo.code).toBe(0);
  }, 15000);
});
