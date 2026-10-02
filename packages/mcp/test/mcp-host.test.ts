import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createActionDock } from "@actiondock/core";
import { defineAction, type ActionContext } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";

describe("@actiondock/mcp Host Integration", () => {
  it("connects ActionDockService directly, handling tools/list, tools/call, cancellation, and close", async () => {
    let slowTaskCancelled = false;

    // 1. 定义测试用 Action
    const addAction = defineAction({
      run(input: { a: number; b: number }) {
        return { sum: input.a + input.b };
      },
    });

    const slowAction = defineAction({
      async run(input: { durationMs?: number }, ctx: ActionContext) {
        const delay = input.durationMs || 1000;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ completed: true });
          }, delay);

          ctx.signal.addEventListener("abort", () => {
            slowTaskCancelled = true;
            clearTimeout(timer);
            reject(new Error("Action execution was cancelled"));
          });
        });
      },
    });

    // 2. 创建 ActionDockService
    const service = await createActionDock({
      packages: [
        {
          projectConfig: {
            id: "test.mcp-host-app",
            name: "MCP Host Test App",
            version: "1.0.0",
            description: "Package for testing ActionDockHost with MCP",
            actions: {
              "calc.add": {
                entry: "",
                description: "加法计算动作",
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
                    sum: { type: "number" },
                  },
                  required: ["sum"],
                },
              },
              "task.slow": {
                entry: "",
                description: "慢速动作用于取消测试",
                inputSchema: {
                  type: "object",
                  properties: {
                    durationMs: { type: "number" },
                  },
                },
              },
            },
          },
          actions: {
            "calc.add": addAction,
            "task.slow": slowAction,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
      inMemory: true,
    });

    // 3. 传入 service 创建 MCP 服务端
    const server = await createActionDockMcpServer({ service, cascadeServiceClose: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsListResult: any = null;
    let syncCallResult: any = null;

    let resolveAllDone: () => void;
    const allDonePromise = new Promise<void>((r) => {
      resolveAllDone = r;
    });

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        // 初始化就绪后确认通知
        clientTransport.send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });

        // 验证 tools/list
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        });
      } else if (msg.id === 2) {
        toolsListResult = msg.result;

        // 验证 tools/call 同步调用
        const addToolName = toolsListResult.tools.find((t: any) =>
          t.name.includes("calc.add")
        )?.name;

        clientTransport.send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: addToolName,
            arguments: { a: 15, b: 27 },
          },
        });
      } else if (msg.id === 3) {
        syncCallResult = msg.result;

        // 验证标准 MCP 取消流程
        const slowToolName = toolsListResult.tools.find((t: any) =>
          t.name.includes("task.slow")
        )?.name;

        clientTransport.send({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: slowToolName,
            arguments: { durationMs: 2000 },
          },
        });

        setTimeout(() => {
          clientTransport.send({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: 4, reason: "Testing MCP host cancel" },
          });
          setTimeout(() => {
            resolveAllDone();
          }, 100);
        }, 50);
      }
    };

    // 发起 initialize
    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-mcp-host-client", version: "1.0.0" },
      },
    });

    await allDonePromise;

    // 4. 断言 tools/list 正确注册工具
    assert.notStrictEqual(toolsListResult, undefined);
    assert.strictEqual(Array.isArray(toolsListResult.tools), true);
    assert.strictEqual(toolsListResult.tools.length, 2);

    const calcTool = toolsListResult.tools.find((t: any) => t.name.includes("calc.add"));
    assert.notStrictEqual(calcTool, undefined);
    assert.strictEqual(calcTool.description, "加法计算动作");
    assert.strictEqual(calcTool.inputSchema.properties.a.type, "number");
    assert.strictEqual(calcTool.outputSchema.properties.sum.type, "number");

    // 5. 断言 tools/call 同步执行成功
    assert.notStrictEqual(syncCallResult, undefined);
    assert.deepStrictEqual(syncCallResult.structuredContent, { sum: 42 });
    const syncParsed = JSON.parse(syncCallResult.content[0].text);
    assert.strictEqual(syncParsed.ok, true);
    assert.deepStrictEqual(syncParsed.data, { sum: 42 });

    // 6. 断言取消信号成功向下传播触发 Action 中止
    assert.strictEqual(slowTaskCancelled, true);

    // 7. 断言 server.close() 优雅关闭 host 资源
    await server.close();
    await assert.rejects(
      service.execution.run("test.mcp-host-app/calc.add", { a: 1, b: 2 })
    );
  });

  it("injects ActionDockService directly, verifying tools list discovery, sync call, and cancellation", async () => {
    let slowTaskCancelled = false;

    const addAction = defineAction({
      run(input: { a: number; b: number }) {
        return { sum: input.a + input.b };
      },
    });

    const slowAction = defineAction({
      async run(input: { durationMs?: number }, ctx: ActionContext) {
        const delay = input.durationMs || 1000;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ completed: true });
          }, delay);

          ctx.signal.addEventListener("abort", () => {
            slowTaskCancelled = true;
            clearTimeout(timer);
            reject(new Error("Action execution was cancelled"));
          });
        });
      },
    });

    const service = await createActionDock({
      packages: [
        {
          projectConfig: {
            id: "test.mcp-target-app",
            name: "MCP Target Test App",
            version: "1.0.0",
            actions: {
              "calc.add": {
                entry: "",
                description: "加法计算动作",
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
                    sum: { type: "number" },
                  },
                  required: ["sum"],
                },
              },
              "task.slow": {
                entry: "",
                description: "慢速动作",
                inputSchema: {
                  type: "object",
                  properties: {
                    durationMs: { type: "number" },
                  },
                },
              },
            },
          },
          actions: {
            "calc.add": addAction,
            "task.slow": slowAction,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
      inMemory: true,
    });

    const server = await createActionDockMcpServer({ service, cascadeServiceClose: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsListResult: any = null;
    let syncCallResult: any = null;

    let resolveDone: () => void;
    const donePromise = new Promise<void>((r) => {
      resolveDone = r;
    });

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (msg.id === 2) {
        toolsListResult = msg.result;
        clientTransport.send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "calc.add", arguments: { a: 10, b: 20 } },
        });
      } else if (msg.id === 3) {
        syncCallResult = msg.result;
        clientTransport.send({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "task.slow", arguments: { durationMs: 2000 } },
        });
        setTimeout(() => {
          clientTransport.send({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: 4, reason: "Cancel target task" },
          });
          setTimeout(() => {
            resolveDone();
          }, 100);
        }, 50);
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

    await donePromise;

    assert.strictEqual(toolsListResult.tools.length, 2);
    assert.deepStrictEqual(syncCallResult.structuredContent, { sum: 30 });
    assert.strictEqual(slowTaskCancelled, true);

    await server.close();
    await assert.rejects(service.execution.run("calc.add", { a: 1, b: 2 }));
  });
});
