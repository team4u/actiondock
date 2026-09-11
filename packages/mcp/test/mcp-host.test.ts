import { describe, expect, it } from "bun:test";
import {
  createActionDockApp,
  createActionDockHost,
  createActionDockTarget,
} from "@actiondock/core";
import { defineAction, type ActionContext } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";

describe("@actiondock/mcp Host Integration", () => {
  it("connects ActionDockHost directly, handling tools/list, sync/async tools/call, tasks/get, tasks/cancel, and close", async () => {
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

    // 2. 创建 ActionDockApp 与 ActionDockHost
    const app = await createActionDockApp({
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
            description: "慢速动作用于异步与取消测试",
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
    });

    const host = await createActionDockHost({
      packages: [app],
      autoLoadCurrentProject: false,
      inMemory: true,
    });

    // 3. 传入 host 创建 MCP 服务端
    const server = await createActionDockMcpServer({ host, cascadeTargetClose: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsListResult: any = null;
    let syncCallResult: any = null;
    let asyncCallResult: any = null;
    let taskGetResult: any = null;
    let cancelCallResult: any = null;
    let taskCancelResult: any = null;
    let taskGetCancelledResult: any = null;

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

        // 验证 tools/call 异步任务启动
        const slowToolName = toolsListResult.tools.find((t: any) =>
          t.name.includes("task.slow")
        )?.name;

        clientTransport.send({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: slowToolName,
            arguments: { durationMs: 1500, execution: { mode: "async" } },
          },
        });
      } else if (msg.id === 4) {
        asyncCallResult = JSON.parse(msg.result.content[0].text);
        const taskId = asyncCallResult.taskId || asyncCallResult.runId;

        // 验证 tasks/get 查询正在执行的任务
        clientTransport.send({
          jsonrpc: "2.0",
          id: 5,
          method: "tasks/get",
          params: { taskId },
        });
      } else if (msg.id === 5) {
        taskGetResult = msg.result;

        // 启动另一个慢任务以测试 tasks/cancel 取消流程
        const slowToolName = toolsListResult.tools.find((t: any) =>
          t.name.includes("task.slow")
        )?.name;

        clientTransport.send({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: slowToolName,
            arguments: { durationMs: 3000, execution: { mode: "async" } },
          },
        });
      } else if (msg.id === 6) {
        cancelCallResult = JSON.parse(msg.result.content[0].text);
        const cancelTaskId = cancelCallResult.taskId || cancelCallResult.runId;

        // 验证 tasks/cancel
        clientTransport.send({
          jsonrpc: "2.0",
          id: 7,
          method: "tasks/cancel",
          params: { taskId: cancelTaskId, reason: "Testing MCP host cancel" },
        });
      } else if (msg.id === 7) {
        taskCancelResult = msg.result;
        const cancelTaskId = cancelCallResult.taskId || cancelCallResult.runId;

        // 验证取消后 tasks/get 返回 cancelled 状态
        clientTransport.send({
          jsonrpc: "2.0",
          id: 8,
          method: "tasks/get",
          params: { taskId: cancelTaskId },
        });
      } else if (msg.id === 8) {
        taskGetCancelledResult = msg.result;
        resolveAllDone();
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
    expect(toolsListResult).toBeDefined();
    expect(Array.isArray(toolsListResult.tools)).toBe(true);
    expect(toolsListResult.tools.length).toBe(2);

    const calcTool = toolsListResult.tools.find((t: any) => t.name.includes("calc.add"));
    expect(calcTool).toBeDefined();
    expect(calcTool.description).toBe("加法计算动作");
    expect(calcTool.inputSchema.properties.a.type).toBe("number");
    expect(calcTool.outputSchema.properties.sum.type).toBe("number");

    // 5. 断言 tools/call 同步执行成功
    expect(syncCallResult).toBeDefined();
    expect(syncCallResult.structuredContent).toEqual({ sum: 42 });
    const syncParsed = JSON.parse(syncCallResult.content[0].text);
    expect(syncParsed.ok).toBe(true);
    expect(syncParsed.data).toEqual({ sum: 42 });

    // 6. 断言 tools/call 异步执行返回票据
    expect(asyncCallResult).toBeDefined();
    expect(asyncCallResult.ok).toBe(true);
    expect(asyncCallResult.status).toBe("running");
    expect(asyncCallResult.taskId).toBeDefined();

    // 7. 断言 tasks/get 查得运行记录
    expect(taskGetResult).toBeDefined();
    expect(taskGetResult.task.taskId).toBe(asyncCallResult.taskId);
    expect(["working", "completed"]).toContain(taskGetResult.task.status);

    // 8. 断言 tasks/cancel 成功取消
    expect(taskCancelResult).toBeDefined();
    expect(taskCancelResult.status).toBe("cancelled");
    expect(taskGetCancelledResult).toBeDefined();
    expect(taskGetCancelledResult.task.status).toBe("cancelled");
    expect(slowTaskCancelled).toBe(true);

    // 9. 断言 server.close() 优雅关闭 host 资源
    await server.close();
    await expect(
      host.runAction("test.mcp-host-app/calc.add", { a: 1, b: 2 })
    ).rejects.toThrow("ActionDockHost is closed");
  });

  it("injects ActionDockTarget directly, verifying tools list discovery, sync call, async task, and cancellation", async () => {
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

    const app = await createActionDockApp({
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
    });

    const target = await createActionDockTarget({ app });
    const server = await createActionDockMcpServer({ target, cascadeTargetClose: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let toolsListResult: any = null;
    let syncCallResult: any = null;
    let asyncCallResult: any = null;
    let cancelResult: any = null;

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
          params: { name: "task.slow", arguments: { durationMs: 2000, execution: { mode: "async" } } },
        });
      } else if (msg.id === 4) {
        asyncCallResult = JSON.parse(msg.result.content[0].text);
        const taskId = asyncCallResult.taskId || asyncCallResult.runId;
        clientTransport.send({
          jsonrpc: "2.0",
          id: 5,
          method: "tasks/cancel",
          params: { taskId, reason: "Cancel target task" },
        });
      } else if (msg.id === 5) {
        cancelResult = msg.result;
        resolveDone();
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

    expect(toolsListResult.tools.length).toBe(2);
    expect(syncCallResult.structuredContent).toEqual({ sum: 30 });
    expect(asyncCallResult.status).toBe("running");
    expect(cancelResult.status).toBe("cancelled");
    expect(slowTaskCancelled).toBe(true);

    await server.close();
    await expect(target.runAction("calc.add", { a: 1, b: 2 })).rejects.toThrow();
  });
});

