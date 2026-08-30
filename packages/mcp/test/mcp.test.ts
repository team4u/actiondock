import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";
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
    const serverInstance = startMcpHttpServer({
      host: "127.0.0.1",
      port: 6189,
      token: "mcp-secret-123",
      projectRoot: tmpDir,
    });

    try {
      // 1. Unauthorized health check
      const unauthHealth = await fetch(`http://127.0.0.1:6189/health`);
      expect(unauthHealth.status).toBe(401);

      // 2. Authorized health check
      const authHealth = await fetch(`http://127.0.0.1:6189/health`, {
        headers: { Authorization: "Bearer mcp-secret-123" },
      });
      expect(authHealth.status).toBe(200);
      const healthData = await authHealth.json();
      expect(healthData.status).toBe("ok");
      expect(healthData.protocol).toBe("mcp");

      // 3. Unauthorized MCP POST
      const unauthMcp = await fetch(`http://127.0.0.1:6189/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(unauthMcp.status).toBe(401);

      // 4. Authorized MCP POST
      const authMcp = await fetch(`http://127.0.0.1:6189/mcp`, {
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
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
