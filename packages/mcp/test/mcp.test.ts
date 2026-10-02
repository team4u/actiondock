import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createActionDock } from "@actiondock/core";
import { linkPackage } from "@actiondock/core/registry";
import { decodeText, defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer, toMcpResult } from "../src/adapter";
import { startMcpHttpServer } from "../src/http";

function setupTestProject(tmpDir: string) {
  mkdirSync(tmpDir, { recursive: true });
  const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
  if (existsSync(rootNodeModules) && !existsSync(join(tmpDir, "node_modules"))) {
    symlinkSync(rootNodeModules, join(tmpDir, "node_modules"), "junction");
  }
  mkdirSync(join(tmpDir, "actions"), { recursive: true });

  writeFileSync(
    join(tmpDir, "actiondock.json"),
    JSON.stringify(
      {
        id: "test.mcp-pkg",
        name: "MCP Test Package",
        version: "1.0.0",
        description: "Package for testing MCP adapter",
        schemaVersion: 2,
        actions: {
          "calc.multiply": {
            entry: "actions/calc.ts",
            description: "Multiply two numbers",
            inputSchema: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
            outputSchema: {
              type: "object",
              properties: {
                result: { type: "number" },
              },
              required: ["result"],
            },
          },
          "task.slow": {
            entry: "actions/slow.ts",
            description: "Slow running action for cancellation test",
            inputSchema: {
              type: "object",
              properties: {
                durationMs: { type: "number" },
              },
            },
          },
          "task.fail": {
            entry: "actions/error.ts",
            description: "Action that intentionally throws",
          },
        },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(tmpDir, "actions", "calc.ts"),
    `
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "calc.multiply",
  description: "Multiply two numbers",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" }
    },
    required: ["a", "b"]
  },
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "number" }
    },
    required: ["result"]
  },
  run(input: { a: number; b: number }) {
    return { result: input.a * input.b };
  }
});
`
  );

  writeFileSync(
    join(tmpDir, "actions", "slow.ts"),
    `
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "task.slow",
  description: "Slow running action for cancellation test",
  inputSchema: {
    type: "object",
    properties: {
      durationMs: { type: "number" }
    }
  },
  async run(input: { durationMs?: number }, ctx) {
    const delay = input.durationMs || 1000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ done: true });
      }, delay);

      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Action execution was cancelled"));
      });
    });
  }
});
`
  );

  writeFileSync(
    join(tmpDir, "actions", "error.ts"),
    `
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "task.fail",
  description: "Action that intentionally throws",
  run() {
    const err = new Error("Intentional failure");
    (err as any).code = "ACTION_FAILED";
    throw err;
  }
});
`
  );
}

describe("@actiondock/mcp Adapter", () => {
  // 夹具统一落在系统临时目录（mkdtemp 随机子目录），避免污染仓库工作区
  const tmpDir = mkdtempSync(join(tmpdir(), "test-mcp-"));

  // 兜底清理：afterAll 之外再挂进程退出钩子，尽量覆盖中断场景下的残留
  process.on("exit", () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // 忽略清理异常，避免影响退出流程
    }
  });

  setupTestProject(tmpDir);

  it("M01-M05: tools/list discovers all actions and maps schemas correctly", async () => {
    const server = await createActionDockMcpServer({ projectRoot: tmpDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsListResult: any = null;

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        // Initialized
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        });
      } else if (msg.id === 2) {
        toolsListResult = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    // Wait for response
    await new Promise((r) => setTimeout(r, 100));

    assert.notStrictEqual(toolsListResult, undefined);
    assert.strictEqual(Array.isArray(toolsListResult.tools), true);

    const tools = toolsListResult.tools;
    assert.strictEqual(tools.length, 3);

    // M02: action.id == MCP tool.name
    const calcTool = tools.find((t: any) => t.name === "calc.multiply");
    assert.notStrictEqual(calcTool, undefined);

    // M03: description matches
    assert.strictEqual(calcTool.description, "Multiply two numbers");

    // M04: inputSchema matches
    assert.notStrictEqual(calcTool.inputSchema, undefined);
    assert.strictEqual(calcTool.inputSchema.type, "object");
    assert.strictEqual(calcTool.inputSchema.properties.a.type, "number");
    assert.strictEqual(calcTool.inputSchema.properties.b.type, "number");
    assert.deepStrictEqual(calcTool.inputSchema.required, ["a", "b"]);

    // M05: outputSchema matches（不注入 execution 包装字段，与实际 structuredContent 一致）
    assert.notStrictEqual(calcTool.outputSchema, undefined);
    assert.strictEqual(calcTool.outputSchema.properties.result.type, "number");
    assert.strictEqual(calcTool.outputSchema.properties.execution, undefined);
    // 入参 schema 仍注入 execution 执行控制包装字段
    assert.notStrictEqual(calcTool.inputSchema.properties.execution, undefined);
  });

  it("M06, M09: tools/call executes through ActionRunner and writes run record", async () => {
    const server = await createActionDockMcpServer({ projectRoot: tmpDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let callResult: any = null;

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "calc.multiply",
            arguments: { a: 6, b: 7 },
          },
        });
      } else if (msg.id === 2) {
        callResult = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const startWait = Date.now();
    while (!callResult && Date.now() - startWait < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.notStrictEqual(callResult, undefined);
    assert.deepStrictEqual(callResult.structuredContent, { result: 42 });
    assert.strictEqual(callResult.content.length, 1);

    const parsedEnvelope = JSON.parse(callResult.content[0].text);
    assert.strictEqual(parsedEnvelope.ok, true);
    assert.notStrictEqual(parsedEnvelope.runId, undefined);
    assert.deepStrictEqual(parsedEnvelope.data, { result: 42 });
  });

  it("M07: input validation fails gracefully in MCP tool call", async () => {
    const server = await createActionDockMcpServer({ projectRoot: tmpDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let callResult: any = null;
    let callError: any = null;

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        // Missing required 'b'
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "calc.multiply",
            arguments: { a: 5 },
          },
        });
      } else if (msg.id === 2) {
        callResult = msg.result;
        callError = msg.error;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    // SDK validates schema and either rejects param or returns isError
    assert.ok(callResult?.isError || callError);
  });

  it("M10: action error maps to MCP isError=true", async () => {
    const server = await createActionDockMcpServer({ projectRoot: tmpDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let callResult: any = null;

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "task.fail",
            arguments: {},
          },
        });
      } else if (msg.id === 2) {
        callResult = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    assert.notStrictEqual(callResult, undefined);
    assert.strictEqual(callResult.isError, true);
    const parsed = JSON.parse(callResult.content[0].text);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "ACTION_FAILED");
  });

  it("M14: MCP client cancellation propagates to ActionRunner signal", async () => {
    let actionSignalAborted = false;
    const testCancelAction = defineAction({
      async run(_input, ctx) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ done: true }), 2000);
          ctx.signal.addEventListener("abort", () => {
            actionSignalAborted = true;
            clearTimeout(timer);
            reject(new Error("Action execution was cancelled"));
          });
        });
      },
    });

    const server = await createActionDockMcpServer({
      projectRoot: tmpDir,
      actions: new Map([["task.test-cancel", testCancelAction]]),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "task.test-cancel",
            arguments: {},
          },
        });

        // Cancel after 40ms
        setTimeout(() => {
          clientTransport.send({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: 2, reason: "user aborted" },
          });
        }, 40);
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(actionSignalAborted, true);
  });

  it("M12, M13: HTTP Transport enforces security defaults and handles MCP requests", async () => {
    // M13: non-loopback without token throws
    assert.throws(() => {
      startMcpHttpServer({
        host: "0.0.0.0",
        port: 6188,
        projectRoot: tmpDir,
      });
    }, /Authentication token is required when binding to a non\-loopback address/);

    // Start with loopback default
    const serverInstance = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      token: "mcp-secret-123",
      projectRoot: tmpDir,
    });

    try {
      const baseUrl = serverInstance.url;

      // 1. Unauthorized health check
      const unauthHealth = await fetch(`${baseUrl}/health`);
      assert.strictEqual(unauthHealth.status, 401);

      // 2. Authorized health check
      const authHealth = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: "Bearer mcp-secret-123" },
      });
      assert.strictEqual(authHealth.status, 200);
      const healthData = await authHealth.json();
      assert.strictEqual(healthData.status, "ok");
      assert.strictEqual(healthData.protocol, "mcp");

      // 3. Unauthorized MCP POST
      const unauthMcp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.strictEqual(unauthMcp.status, 401);

      // 4. Authorized MCP POST
      const authMcp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer mcp-secret-123",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2026-07-28",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0" },
          },
        }),
      });
      assert.strictEqual(authMcp.status, 200);
    } finally {
      await serverInstance.stop();
    }
  });

  it("HTTP Transport: enforces authentication prior to request body reading and payload size validation", async () => {
    const serverInstance = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      token: "mcp-secret-123",
      maxBodyBytes: 1024,
      projectRoot: tmpDir,
    });

    try {
      const baseUrl = serverInstance.url;
      const oversizedPayload = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        padding: "x".repeat(2048),
      });

      // 验证未认证请求即使携带超过 maxBodyBytes 的超大请求体，依然优先被 401 拦截（而不是 413）
      const unauthOversizedRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: oversizedPayload,
      });
      assert.strictEqual(unauthOversizedRes.status, 401);
      const unauthData = await unauthOversizedRes.json();
      assert.strictEqual(unauthData.error?.code, -32000);

      // 验证未认证请求访问健康检查端点携带超大请求体，同样优先被 401 拦截
      const unauthHealthRes = await fetch(`${baseUrl}/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: oversizedPayload,
      });
      assert.strictEqual(unauthHealthRes.status, 401);

      // 验证已认证请求若携带超过 maxBodyBytes 的超大请求体，则如期返回 413 REQUEST_TOO_LARGE
      const authOversizedRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mcp-secret-123",
        },
        body: oversizedPayload,
      });
      assert.strictEqual(authOversizedRes.status, 413);
      const authOversizedData = await authOversizedRes.json();
      assert.strictEqual(authOversizedData.error?.code, "REQUEST_TOO_LARGE");

      // 验证已认证请求通过流式传输超过 maxBodyBytes 时同样被流式截断并返回 413
      const chunkedStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(2048)));
          controller.close();
        },
      });
      const authStreamRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mcp-secret-123",
        },
        body: chunkedStream,
        // @ts-ignore
        duplex: "half",
      });
      assert.strictEqual(authStreamRes.status, 413);

      // 验证已认证且体积正常的请求正常交互
      const normalPayload = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      });
      const authNormalRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mcp-secret-123",
          Accept: "application/json, text/event-stream",
        },
        body: normalPayload,
      });
      assert.strictEqual(authNormalRes.status, 200);
    } finally {
      await serverInstance.stop();
    }
  });

  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("M15-M18: Tasks extension supports async tool calls, tasks/get, tasks/cancel, and tasks/list", async () => {

    const server = await createActionDockMcpServer({ projectRoot: tmpDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let asyncCallResult: any = null;
    let taskGetWorkingResult: any = null;
    let taskCancelResult: any = null;
    let taskListResult: any = null;

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {


        // Initialized
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });

        // 1. Trigger async tool call on task.slow
        clientTransport.send({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: {
            name: "task.slow",
            arguments: { durationMs: 1500, execution: { mode: "async" } },
          },
        });
      } else if (msg.id === 10 && msg.result?.content) {
        asyncCallResult = JSON.parse(msg.result.content[0].text);
        const taskId = asyncCallResult.taskId || asyncCallResult.runId;


        // 2. Query tasks/get
        clientTransport.send({
          jsonrpc: "2.0",
          id: 11,
          method: "tasks/get",
          params: { taskId },
        });

        // 3. Query tasks/list
        clientTransport.send({
          jsonrpc: "2.0",
          id: 12,
          method: "tasks/list",
          params: { limit: 10 },
        });

        // 4. Trigger slow task to test cancel
        clientTransport.send({
          jsonrpc: "2.0",
          id: 20,
          method: "tools/call",
          params: {
            name: "task.slow",
            arguments: { durationMs: 2000, execution: { mode: "async" } },
          },
        });
      } else if (msg.id === 11) {
        taskGetWorkingResult = msg.result;
      } else if (msg.id === 12) {
        taskListResult = msg.result;
      } else if (msg.id === 20) {
        const slowParsed = JSON.parse(msg.result.content[0].text);
        const slowTaskId = slowParsed.taskId || slowParsed.runId;
        // Cancel slow task
        clientTransport.send({
          jsonrpc: "2.0",
          id: 21,
          method: "tasks/cancel",
          params: { taskId: slowTaskId, reason: "Testing MCP tasks/cancel" },
        });
      } else if (msg.id === 21) {
        taskCancelResult = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    // Wait for async task execution and cancel roundtrips
    await new Promise((r) => setTimeout(r, 350));

    // Assert M15 / M16: Async tool call returned taskId and working status
    assert.notStrictEqual(asyncCallResult, undefined);
    assert.notStrictEqual(asyncCallResult.taskId, undefined);
    assert.strictEqual(asyncCallResult.status, "running");

    // Assert M15: tasks/get returned task payload
    assert.notStrictEqual(taskGetWorkingResult, undefined);
    assert.strictEqual(taskGetWorkingResult.task.taskId, asyncCallResult.taskId);
    assert.ok((["working", "completed"]).includes(taskGetWorkingResult.task.status));

    // Assert M18: tasks/list returned list of tasks
    assert.notStrictEqual(taskListResult, undefined);
    assert.strictEqual(Array.isArray(taskListResult.tasks), true);
    assert.strictEqual(taskListResult.tasks.some((t: any) => t.taskId === asyncCallResult.taskId), true);

    // Assert M17: tasks/cancel successfully cancelled task
    assert.notStrictEqual(taskCancelResult, undefined);
    assert.strictEqual(taskCancelResult.status, "cancelled");
  });

  it("M19: supports multiple directories with namespacing on collision", async () => {
    const pkg1Dir = join(tmpDir, "pkg1");
    const pkg2Dir = join(tmpDir, "pkg2");
    mkdirSync(join(pkg1Dir, "actions"), { recursive: true });
    mkdirSync(join(pkg2Dir, "actions"), { recursive: true });
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      if (!existsSync(join(pkg1Dir, "node_modules"))) {
        symlinkSync(rootNodeModules, join(pkg1Dir, "node_modules"), "junction");
      }
      if (!existsSync(join(pkg2Dir, "node_modules"))) {
        symlinkSync(rootNodeModules, join(pkg2Dir, "node_modules"), "junction");
      }
    }

    writeFileSync(
      join(pkg1Dir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg-one",
          name: "Package One",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            echo: {
              entry: "actions/echo.ts",
              description: "Echo 1",
            },
            unique1: {
              entry: "actions/unique1.ts",
              description: "Unique 1",
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkg1Dir, "actions", "echo.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "echo", description: "Echo 1", run: (i: any) => ({ from: "pkg1", ...i }) });`
    );
    writeFileSync(
      join(pkg1Dir, "actions", "unique1.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "unique1", description: "Unique 1", run: () => ({ ok: true }) });`
    );

    writeFileSync(
      join(pkg2Dir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg-two",
          name: "Package Two",
          version: "1.0.0",
          schemaVersion: 2,
          actions: {
            echo: {
              entry: "actions/echo.ts",
              description: "Echo 2",
            },
            unique2: {
              entry: "actions/unique2.ts",
              description: "Unique 2",
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(pkg2Dir, "actions", "echo.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "echo", description: "Echo 2", run: (i: any) => ({ from: "pkg2", ...i }) });`
    );
    writeFileSync(
      join(pkg2Dir, "actions", "unique2.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "unique2", description: "Unique 2", run: () => ({ ok: true }) });`
    );

    const server = await createActionDockMcpServer({
      projectRoots: [pkg1Dir, pkg2Dir],
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsList: any = null;
    let callResult1: any = null;
    let callResult2: any = null;

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (msg.id === 2) {
        toolsList = msg.result.tools;
        // Call namespaced conflicting tool from pkg1
        clientTransport.send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "pkg-one_echo", arguments: { msg: "hello" } },
        });
        // Call unique tool from pkg2
        clientTransport.send({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "unique2", arguments: {} },
        });
      } else if (msg.id === 3) {
        callResult1 = msg.result;
      } else if (msg.id === 4) {
        callResult2 = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "client", version: "1.0" } },
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.notStrictEqual(toolsList, undefined);
    const toolNames = toolsList.map((t: any) => t.name);
    // Non-colliding tools keep original names
    assert.ok((toolNames).includes("unique1"));
    assert.ok((toolNames).includes("unique2"));
    // Colliding 'echo' tools are namespaced with packageId_actionId
    assert.ok((toolNames).includes("pkg-one_echo"));
    assert.ok((toolNames).includes("pkg-two_echo"));

    assert.deepStrictEqual(callResult1?.structuredContent, { from: "pkg1", msg: "hello" });
    assert.deepStrictEqual(callResult2?.structuredContent, { ok: true });
  });

  it("M20: supports packageIds and --all with customHome registry", async () => {
    const customHome = join(tmpDir, "home");
    const pkg1Dir = join(tmpDir, "pkg1");
    const pkg2Dir = join(tmpDir, "pkg2");

    await linkPackage(pkg1Dir, customHome);
    await linkPackage(pkg2Dir, customHome);

    const server = await createActionDockMcpServer({
      all: true,
      customHome,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsList: any = null;
    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (msg.id === 2) {
        toolsList = msg.result.tools;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "client", version: "1.0" } },
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.notStrictEqual(toolsList, undefined);
    assert.ok((toolsList.length) >= 4);
  });

  it("M21: toMcpResult wraps non-plain objects into { value: result.data }", () => {
    // 1. Plain object is kept as-is
    const objResult = toMcpResult({
      ok: true,
      runId: "run-1",
      data: { score: 100, name: "alpha" },
    });
    assert.deepStrictEqual(objResult.structuredContent, { score: 100, name: "alpha" });
    assert.strictEqual(JSON.parse(objResult.content[0].text).ok, true);

    // 2. String primitive
    const strResult = toMcpResult({
      ok: true,
      runId: "run-2",
      data: "hello world",
    });
    assert.deepStrictEqual(strResult.structuredContent, { value: "hello world" });

    // 3. Number primitive
    const numResult = toMcpResult({
      ok: true,
      runId: "run-3",
      data: 42,
    });
    assert.deepStrictEqual(numResult.structuredContent, { value: 42 });

    // 4. Boolean primitive
    const boolResult = toMcpResult({
      ok: true,
      runId: "run-4",
      data: true,
    });
    assert.deepStrictEqual(boolResult.structuredContent, { value: true });

    // 5. Array
    const arrResult = toMcpResult({
      ok: true,
      runId: "run-5",
      data: [1, 2, 3],
    });
    assert.deepStrictEqual(arrResult.structuredContent, { value: [1, 2, 3] });

    // 6. null and undefined
    const nullResult = toMcpResult({
      ok: true,
      runId: "run-6",
      data: null,
    });
    assert.deepStrictEqual(nullResult.structuredContent, { value: null });

    const undefResult = toMcpResult({
      ok: true,
      runId: "run-7",
      data: undefined as any,
    });
    assert.deepStrictEqual(undefResult.structuredContent, { value: undefined });

    // 7. Error case
    const errResult = toMcpResult({
      ok: false,
      runId: "run-8",
      error: { code: "ERR", message: "fail" },
    });
    assert.strictEqual(errResult.isError, true);
    assert.strictEqual(errResult.structuredContent, undefined);
  });

  it("M22: server.close() preserves external storage and closes internal storage", async () => {
    let storageClosed = false;
    const mockStorage: any = {
      getRun: () => undefined,
      listRuns: () => [],
      updateRun: () => {},
      close: () => {
        storageClosed = true;
      },
    };

    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: mockStorage,
    });

    assert.strictEqual(typeof server.close, "function");
    await server.close();
    // External storage provided by caller must NOT be closed
    assert.strictEqual(storageClosed, false);

    // Internal storage created by server should be closed cleanly
    const internalServer = await createActionDockMcpServer({
      projectRoot: tmpDir,
    });
    await (internalServer.close());
  });

  it("M23: sanitizes scoped package names and enforces 64-character limit on MCP tool names", async () => {
    const pkg1Dir = join(tmpDir, "scoped-pkg1");
    const pkg2Dir = join(tmpDir, "scoped-pkg2");
    mkdirSync(pkg1Dir, { recursive: true });
    mkdirSync(pkg2Dir, { recursive: true });

    // Scoped package with long package name
    writeFileSync(
      join(pkg1Dir, "actiondock.json"),
      JSON.stringify({
        id: "@enterprise-scope/super-long-subsystem-management-tools-package",
        name: "Enterprise Long Tools",
        version: "1.0.0",
        schemaVersion: 2,
        actions: {
          reconcile: {
            entry: "actions/reconcile.ts",
          },
        },
      })
    );
    mkdirSync(join(pkg1Dir, "actions"), { recursive: true });
    writeFileSync(
      join(pkg1Dir, "actions", "reconcile.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "reconcile", run: () => "ok1" });`
    );

    // Another package with the same action id to cause collision
    writeFileSync(
      join(pkg2Dir, "actiondock.json"),
      JSON.stringify({
        id: "simple-pkg",
        name: "Simple Pkg",
        version: "1.0.0",
        schemaVersion: 2,
        actions: {
          reconcile: {
            entry: "actions/reconcile.ts",
          },
        },
      })
    );
    mkdirSync(join(pkg2Dir, "actions"), { recursive: true });
    writeFileSync(
      join(pkg2Dir, "actions", "reconcile.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "reconcile", run: () => "ok2" });`
    );

    const server = await createActionDockMcpServer({
      projectRoots: [pkg1Dir, pkg2Dir],
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsList: any = null;
    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (msg.id === 2) {
        toolsList = msg.result.tools;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "client", version: "1.0" } },
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.notStrictEqual(toolsList, undefined);
    const toolNames = toolsList.map((t: any) => t.name);

    // simple-pkg_reconcile
    assert.ok((toolNames).includes("simple-pkg_reconcile"));

    // The long scoped tool name should not contain @ or /
    const longTool = toolsList.find((t: any) => !t.name.startsWith("simple-pkg"));
    assert.notStrictEqual(longTool, undefined);
    assert.ok(!(longTool.name).includes("@"));
    assert.ok(!(longTool.name).includes("/"));
    // Must be <= 64 characters
    assert.ok((longTool.name.length) <= 64);

    await server.close();
  });

  it("M24: tasks/cancel returns true terminal status when already finished, and maps timed_out/interrupted to failed", async () => {
    const mockStorage: any = {
      runs: new Map<string, any>(),
      getRun(id: string) {
        return this.runs.get(id);
      },
      listRuns() {
        return Array.from(this.runs.values());
      },
      updateRun(id: string, status: any) {
        const r = this.runs.get(id);
        if (r) r.status = status;
      },
      close() {},
    };

    mockStorage.runs.set("task-success", {
      id: "task-success",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    mockStorage.runs.set("task-timed-out", {
      id: "task-timed-out",
      status: "timed_out",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: mockStorage,
    });

    // tasks/get for timed_out should map to failed
    const reqHandler = (server.server as any)._requestHandlers.get("tasks/get");
    const getRes = await reqHandler({ method: "tasks/get", params: { taskId: "task-timed-out" } });
    assert.strictEqual(getRes.task.status, "failed");

    // tasks/cancel on already success task should return completed, not cancelled
    const cancelHandler = (server.server as any)._requestHandlers.get("tasks/cancel");
    const cancelRes = await cancelHandler({ method: "tasks/cancel", params: { taskId: "task-success" } });
    assert.strictEqual(cancelRes.status, "completed");

    await server.close();
  });

  it("M25: strips execution control fields (__async, execution) before passing to action", async () => {
    let receivedInput: any = null;
    const strictAction = defineAction({
      run(input) {
        receivedInput = input;
        return { matched: true };
      },
    });

    const server = await createActionDockMcpServer({
      actions: new Map([["strict-action", strictAction]]),
      storage: {
        getRun: () => undefined,
        listRuns: () => [],
        updateRun: () => {},
        createRun: () => {},
        close: () => {},
      } as any,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let callResult: any = null;
    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "strict-action",
            arguments: {
              query: "test",
              __async: false,
              execution: { mode: "sync" },
            },
          },
        });
      } else if (msg.id === 2) {
        callResult = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "client", version: "1.0" } },
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.notStrictEqual(callResult, undefined);
    assert.ok(!(callResult.isError));
    assert.deepStrictEqual(receivedInput, { query: "test" });
    const receivedRecord = receivedInput as Record<string, unknown>;
    assert.strictEqual(receivedRecord.execution, undefined);
    assert.strictEqual(receivedRecord.__async, undefined);

    await server.close();
  });

  it("coordinates service.close() upon server.close() when cascadeServiceClose is set", async () => {
    let serviceClosed = false;
    const dummyService = await createActionDock({ projectRoot: tmpDir });
    const originalServiceClose = dummyService.close.bind(dummyService);
    dummyService.close = async () => {
      serviceClosed = true;
      return originalServiceClose();
    };

    const server = await createActionDockMcpServer({
      service: dummyService,
      // 独立持有实例：close 级联释放 service
      cascadeServiceClose: true,
    });

    await server.close();
    assert.strictEqual(serviceClosed, true);
  });

  it("coordinates service.close() on startMcpHttpServer stop()", async () => {
    let serviceClosed = false;
    const dummyService = await createActionDock({ projectRoot: tmpDir });
    const originalServiceClose = dummyService.close.bind(dummyService);
    dummyService.close = async () => {
      serviceClosed = true;
      return originalServiceClose();
    };

    const httpServer = await startMcpHttpServer({
      service: dummyService,
      port: 0,
      host: "127.0.0.1",
    });

    await httpServer.stop();
    assert.strictEqual(serviceClosed, true);
  });

  it("passes customHome to service resolution correctly", async () => {
    // 使用系统临时目录承载伪 Home，测试结束无论成败均兜底清理
    const fakeHome = mkdtempSync(join(tmpdir(), "test-mcp-custom-home-"));
    try {
      await linkPackage(tmpDir, fakeHome);

      const server = await createActionDockMcpServer({
        packageId: "test.mcp-pkg",
        customHome: fakeHome,
        // 测试独立持有实例：close 必须级联释放 service 及其 SQLite 句柄，否则 Windows 下临时目录无法删除
        cascadeServiceClose: true,
      });
      assert.notStrictEqual(server, undefined);
      await server.close();
    } finally {
      rmSync(fakeHome, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("startMcpHttpServer stop() transparently propagates service.close errors", async () => {
    const dummyService: any = {
      discovery: {
        listPackages: async () => [],
        listActions: async () => [],
        listPlaybooks: async () => [],
      },
      close: async () => {
        throw new Error("Simulated Service Close Failure");
      },
    };

    const httpServer = await startMcpHttpServer({
      service: dummyService,
      port: 0,
      host: "127.0.0.1",
    });

    await assert.rejects(httpServer.stop(), /Simulated Service Close Failure/);
  });

  it("maps playbooks to read-only MCP Resource and Prompt", async () => {
    const manifestPath = join(tmpDir, "actiondock.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.playbooks = {
      "test.guide": {
        entry: "playbooks/guide.md",
        description: "A test guide playbook",
      },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    mkdirSync(join(tmpDir, "playbooks"), { recursive: true });
    writeFileSync(
      join(tmpDir, "playbooks", "guide.md"),
      "# Step 1\nRun test."
    );

    const server = await createActionDockMcpServer({ projectRoot: tmpDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let resourcesList: any = null;
    let resourceRead: any = null;
    let promptsList: any = null;
    let promptGet: any = null;

    let resolvePb: () => void;
    const pbPromise = new Promise<void>((r) => {
      resolvePb = r;
    });

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} });
      } else if (msg.id === 2) {
        resourcesList = msg.result;
        clientTransport.send({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "playbook://test.guide" } });
      } else if (msg.id === 3) {
        resourceRead = msg.result;
        clientTransport.send({ jsonrpc: "2.0", id: 4, method: "prompts/list", params: {} });
      } else if (msg.id === 4) {
        promptsList = msg.result;
        clientTransport.send({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "test.guide" } });
      } else if (msg.id === 5) {
        promptGet = msg.result;
        resolvePb();
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });

    await pbPromise;

    assert.strictEqual(resourcesList.resources.some((r: any) => r.uri === "playbook://test.guide"), true);
    assert.ok((resourceRead.contents[0].text).includes("Step 1"));
    assert.strictEqual(promptsList.prompts.some((p: any) => p.name === "test.guide"), true);
    assert.ok((promptGet.messages[0].content.text).includes("Step 1"));

    await server.close();
  });

  it("executes actions using ctx.process in createActionDockMcpServer without UNSUPPORTED_CAPABILITY", async () => {
    const procAction = defineAction({
      id: "proc.echo",
      description: "Echo via process",
      async run(_input: unknown, ctx) {
        const res = await ctx.process.run({
          spec: { executable: process.execPath, args: ["-e", "console.log('mcp process works')"], io: { mode: "pipe" } },
          timeoutMs: 5000,
          maxOutputBytes: 1024,
        });
        return { stdout: decodeText(res.chunks).trim() };
      },
    });

    const server = await createActionDockMcpServer({
      actions: {
        "proc.echo": procAction,
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let callResult: any = null;
    let resolveCall: () => void;
    const callPromise = new Promise<void>((r) => {
      resolveCall = r;
    });

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "proc.echo",
            arguments: {},
          },
        });
      } else if (msg.id === 2) {
        callResult = msg.result;
        resolveCall();
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });

    await callPromise;

    assert.ok(!(callResult.isError));
    const parsed = JSON.parse(callResult.content[0].text);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.stdout, "mcp process works");

    await server.close();
  });
});
