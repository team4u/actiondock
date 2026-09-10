import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createActionDockTarget, linkPackage } from "@actiondock/core";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer, toMcpResult } from "../src/adapter";
import { startMcpHttpServer } from "../src/http";

function setupTestProject(tmpDir: string) {
  mkdirSync(tmpDir, { recursive: true });
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
  const tmpDir = join(process.cwd(), "tmp", `test-mcp-${Date.now()}`);

  try {
    setupTestProject(tmpDir);
  } catch (err) {
    console.error("Failed to setup test project:", err);
  }

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

    expect(toolsListResult).toBeDefined();
    expect(Array.isArray(toolsListResult.tools)).toBe(true);

    const tools = toolsListResult.tools;
    expect(tools.length).toBe(3);

    // M02: action.id == MCP tool.name
    const calcTool = tools.find((t: any) => t.name === "calc.multiply");
    expect(calcTool).toBeDefined();

    // M03: description matches
    expect(calcTool.description).toBe("Multiply two numbers");

    // M04: inputSchema matches
    expect(calcTool.inputSchema).toBeDefined();
    expect(calcTool.inputSchema.type).toBe("object");
    expect(calcTool.inputSchema.properties.a.type).toBe("number");
    expect(calcTool.inputSchema.properties.b.type).toBe("number");
    expect(calcTool.inputSchema.required).toEqual(["a", "b"]);

    // M05: outputSchema matches
    expect(calcTool.outputSchema).toBeDefined();
    expect(calcTool.outputSchema.properties.result.type).toBe("number");
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

    await new Promise((r) => setTimeout(r, 100));

    expect(callResult).toBeDefined();
    expect(callResult.structuredContent).toEqual({ result: 42 });
    expect(callResult.content.length).toBe(1);

    const parsedEnvelope = JSON.parse(callResult.content[0].text);
    expect(parsedEnvelope.ok).toBe(true);
    expect(parsedEnvelope.runId).toBeDefined();
    expect(parsedEnvelope.data).toEqual({ result: 42 });
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
    expect(callResult?.isError || callError).toBeTruthy();
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

    expect(callResult).toBeDefined();
    expect(callResult.isError).toBe(true);
    const parsed = JSON.parse(callResult.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("ACTION_FAILED");
  });

  it("M14: MCP client cancellation propagates to ActionRunner signal", async () => {
    let actionSignalAborted = false;
    const testCancelAction = defineAction({
      id: "task.test-cancel",
      description: "Action for testing cancel",
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
      actions: new Map([[testCancelAction.id, testCancelAction]]),
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

    expect(actionSignalAborted).toBe(true);
  });

  it("M12, M13: HTTP Transport enforces security defaults and handles MCP requests", async () => {
    // M13: non-loopback without token throws
    expect(() => {
      startMcpHttpServer({
        host: "0.0.0.0",
        port: 6188,
        projectRoot: tmpDir,
      });
    }).toThrow("Authentication token is required when binding to a non-loopback address");

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
      expect(unauthHealth.status).toBe(401);

      // 2. Authorized health check
      const authHealth = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: "Bearer mcp-secret-123" },
      });
      expect(authHealth.status).toBe(200);
      const healthData = await authHealth.json();
      expect(healthData.status).toBe("ok");
      expect(healthData.protocol).toBe("mcp");

      // 3. Unauthorized MCP POST
      const unauthMcp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(unauthMcp.status).toBe(401);

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
      expect(authMcp.status).toBe(200);
    } finally {
      serverInstance.stop();
    }
  });

  afterAll(() => {
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
    let taskGetCompletedResult: any = null;
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
    expect(asyncCallResult).toBeDefined();
    expect(asyncCallResult.taskId).toBeDefined();
    expect(asyncCallResult.status).toBe("running");

    // Assert M15: tasks/get returned task payload
    expect(taskGetWorkingResult).toBeDefined();
    expect(taskGetWorkingResult.task.taskId).toBe(asyncCallResult.taskId);
    expect(["working", "completed"]).toContain(taskGetWorkingResult.task.status);

    // Assert M18: tasks/list returned list of tasks
    expect(taskListResult).toBeDefined();
    expect(Array.isArray(taskListResult.tasks)).toBe(true);
    expect(taskListResult.tasks.some((t: any) => t.taskId === asyncCallResult.taskId)).toBe(true);

    // Assert M17: tasks/cancel successfully cancelled task
    expect(taskCancelResult).toBeDefined();
    expect(taskCancelResult.status).toBe("cancelled");
  });

  it("M19: supports multiple directories with namespacing on collision", async () => {
    const pkg1Dir = join(tmpDir, "pkg1");
    const pkg2Dir = join(tmpDir, "pkg2");
    mkdirSync(join(pkg1Dir, "actions"), { recursive: true });
    mkdirSync(join(pkg2Dir, "actions"), { recursive: true });

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

    expect(toolsList).toBeDefined();
    const toolNames = toolsList.map((t: any) => t.name);
    // Non-colliding tools keep original names
    expect(toolNames).toContain("unique1");
    expect(toolNames).toContain("unique2");
    // Colliding 'echo' tools are namespaced with packageId_actionId
    expect(toolNames).toContain("pkg-one_echo");
    expect(toolNames).toContain("pkg-two_echo");

    expect(callResult1?.structuredContent).toEqual({ from: "pkg1", msg: "hello" });
    expect(callResult2?.structuredContent).toEqual({ ok: true });
  });

  it("M20: supports packageIds and --all with customHome registry", async () => {
    const customHome = join(tmpDir, "home");
    const pkg1Dir = join(tmpDir, "pkg1");
    const pkg2Dir = join(tmpDir, "pkg2");

    linkPackage(pkg1Dir, customHome);
    linkPackage(pkg2Dir, customHome);

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

    expect(toolsList).toBeDefined();
    expect(toolsList.length).toBeGreaterThanOrEqual(4);
  });

  it("M21: toMcpResult wraps non-plain objects into { value: result.data }", () => {
    // 1. Plain object is kept as-is
    const objResult = toMcpResult({
      ok: true,
      runId: "run-1",
      data: { score: 100, name: "alpha" },
    });
    expect(objResult.structuredContent).toEqual({ score: 100, name: "alpha" });
    expect(JSON.parse(objResult.content[0].text).ok).toBe(true);

    // 2. String primitive
    const strResult = toMcpResult({
      ok: true,
      runId: "run-2",
      data: "hello world",
    });
    expect(strResult.structuredContent).toEqual({ value: "hello world" });

    // 3. Number primitive
    const numResult = toMcpResult({
      ok: true,
      runId: "run-3",
      data: 42,
    });
    expect(numResult.structuredContent).toEqual({ value: 42 });

    // 4. Boolean primitive
    const boolResult = toMcpResult({
      ok: true,
      runId: "run-4",
      data: true,
    });
    expect(boolResult.structuredContent).toEqual({ value: true });

    // 5. Array
    const arrResult = toMcpResult({
      ok: true,
      runId: "run-5",
      data: [1, 2, 3],
    });
    expect(arrResult.structuredContent).toEqual({ value: [1, 2, 3] });

    // 6. null and undefined
    const nullResult = toMcpResult({
      ok: true,
      runId: "run-6",
      data: null,
    });
    expect(nullResult.structuredContent).toEqual({ value: null });

    const undefResult = toMcpResult({
      ok: true,
      runId: "run-7",
      data: undefined as any,
    });
    expect(undefResult.structuredContent).toEqual({ value: undefined });

    // 7. Error case
    const errResult = toMcpResult({
      ok: false,
      runId: "run-8",
      error: { code: "ERR", message: "fail" },
    });
    expect(errResult.isError).toBe(true);
    expect(errResult.structuredContent).toBeUndefined();
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

    expect(typeof server.close).toBe("function");
    await server.close();
    // External storage provided by caller must NOT be closed
    expect(storageClosed).toBe(false);

    // Internal storage created by server should be closed cleanly
    const internalServer = await createActionDockMcpServer({
      projectRoot: tmpDir,
    });
    await expect(internalServer.close()).resolves.toBeUndefined();
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

    expect(toolsList).toBeDefined();
    const toolNames = toolsList.map((t: any) => t.name);

    // simple-pkg_reconcile
    expect(toolNames).toContain("simple-pkg_reconcile");

    // The long scoped tool name should not contain @ or /
    const longTool = toolsList.find((t: any) => !t.name.startsWith("simple-pkg"));
    expect(longTool).toBeDefined();
    expect(longTool.name).not.toContain("@");
    expect(longTool.name).not.toContain("/");
    // Must be <= 64 characters
    expect(longTool.name.length).toBeLessThanOrEqual(64);

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
    expect(getRes.task.status).toBe("failed");

    // tasks/cancel on already success task should return completed, not cancelled
    const cancelHandler = (server.server as any)._requestHandlers.get("tasks/cancel");
    const cancelRes = await cancelHandler({ method: "tasks/cancel", params: { taskId: "task-success" } });
    expect(cancelRes.status).toBe("completed");

    await server.close();
  });

  it("M25: strips execution control fields (__async, execution) before passing to action", async () => {
    let receivedInput: any = null;
    const strictAction = defineAction({
      id: "strict-action",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
      },
      run(input) {
        receivedInput = input;
        return { matched: true };
      },
    });

    const server = await createActionDockMcpServer({
      actions: new Map([[strictAction.id, strictAction]]),
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

    expect(callResult).toBeDefined();
    expect(callResult.isError).toBeFalsy();
    expect(receivedInput).toEqual({ query: "test" });
    expect(receivedInput.execution).toBeUndefined();
    expect(receivedInput.__async).toBeUndefined();

    await server.close();
  });

  it("coordinates target.close() upon server.close()", async () => {
    let targetClosed = false;
    const dummyTarget = await createActionDockTarget({ projectRoot: tmpDir });
    const originalTargetClose = dummyTarget.close.bind(dummyTarget);
    dummyTarget.close = async () => {
      targetClosed = true;
      return originalTargetClose();
    };

    const server = await createActionDockMcpServer({
      target: dummyTarget,
    });

    await server.close();
    expect(targetClosed).toBe(true);
  });

  it("coordinates target.close() on startMcpHttpServer stop()", async () => {
    let targetClosed = false;
    const dummyTarget = await createActionDockTarget({ projectRoot: tmpDir });
    const originalTargetClose = dummyTarget.close.bind(dummyTarget);
    dummyTarget.close = async () => {
      targetClosed = true;
      return originalTargetClose();
    };

    const httpServer = await startMcpHttpServer({
      target: dummyTarget,
      port: 0,
      host: "127.0.0.1",
    });

    await httpServer.stop();
    expect(targetClosed).toBe(true);
  });

  it("passes customHome to target resolution correctly", async () => {
    const fakeHome = join(process.cwd(), "tmp", `test-mcp-custom-home-${Date.now()}`);
    mkdirSync(fakeHome, { recursive: true });

    linkPackage(tmpDir, fakeHome);

    const server = await createActionDockMcpServer({
      packageId: "test.mcp-pkg",
      customHome: fakeHome,
    });
    expect(server).toBeDefined();
    await server.close();

    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("startMcpHttpServer stop() transparently propagates target.close errors", async () => {
    const dummyTarget: any = {
      info: async () => ({ id: "test", version: "1.0.0" }),
      listActions: async () => [],
      listPlaybooks: async () => [],
      close: async () => {
        throw new Error("Simulated Target Close Failure");
      },
    };

    const httpServer = await startMcpHttpServer({
      target: dummyTarget,
      port: 0,
      host: "127.0.0.1",
    });

    await expect(httpServer.stop()).rejects.toThrow("Simulated Target Close Failure");
  });

  it("maps playbooks to read-only MCP Resource and Prompt", async () => {
    mkdirSync(join(tmpDir, "playbooks"), { recursive: true });
    writeFileSync(
      join(tmpDir, "playbooks", "guide.md"),
      `---\nid: test.guide\ndescription: A test guide playbook\n---\n# Step 1\nRun test.`
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

    expect(resourcesList.resources.some((r: any) => r.uri === "playbook://test.guide")).toBe(true);
    expect(resourceRead.contents[0].text).toContain("Step 1");
    expect(promptsList.prompts.some((p: any) => p.name === "test.guide")).toBe(true);
    expect(promptGet.messages[0].content.text).toContain("Step 1");

    await server.close();
  });
});
