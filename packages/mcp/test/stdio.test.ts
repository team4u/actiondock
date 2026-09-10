import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MCP STDIO Protocol Process Isolation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-stdio-test-"));
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
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("physically isolates child process stdout and protects MCP JSON-RPC protocol framing", async () => {
    const cliScript = join(__dirname, "../../cli/dist/index.js");

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

    child.kill("SIGTERM");

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
    const cliScript = join(__dirname, "../../cli/dist/index.js");

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

    child.kill("SIGTERM");

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
});
