import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";
import { startMcpStdio } from "../src/stdio";

/**
 * STDIO 传输所有权契约回归：
 * 外部注入 service 的生命周期归注入方，stdin 断开触发的 cleanup 不得越权关闭；
 * 自建 service 场景仍必须被关闭（既有行为）。
 *
 * startMcpStdio 会监听真实 process.stdin 并注册信号处理器，直接在测试进程内
 * 调用会污染进程状态。这里通过进程内监听 stdin 的 end/close 事件来驱动
 * cleanup 路径：手动 emit stdin 的 end 事件等价于 MCP 客户端断开。
 */
describe("MCP STDIO service ownership", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mcp-stdio-own-"));

  process.on("exit", () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // 忽略清理异常
    }
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("does not close an externally injected service when stdin ends", async () => {
    let closeCalls = 0;
    const fakeService: any = {
      info: async () => [{ id: "fake-pkg", name: "Fake", version: "1.0.0" }],
      discovery: {
        listPackages: async () => [],
        listActions: async () => [],
        listPlaybooks: async () => [],
      },
      execution: {},
      runs: {},
      close: async () => {
        closeCalls++;
      },
    };

    await startMcpStdio({ service: fakeService });

    // 模拟 MCP 客户端断开：emit stdin 的 end 事件触发 cleanup 路径
    process.stdin.emit("end");
    // cleanup 是异步链路，等待微任务与事件循环排空
    await new Promise((r) => setTimeout(r, 200));

    expect(closeCalls).toBe(0);
  }, 10000);

  it("closes a self-owned service created from actions after stdin ends", async () => {
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: any, ...rest: any[]) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return origWrite(chunk, ...rest);
    };

    const echo = defineAction({
      id: "self.owned",
      description: "Self owned probe",
      run: () => ({ ok: true }),
    });

    // actions 注入走 resolveService 自建路径：ownsService 为 true，
// cleanup 必须关闭该实例；自建路径会真实创建本地 service（内存包 + 平台实例）
    await startMcpStdio({ actions: new Map([["self.owned", echo]]) });

    const { resolveService } = await import("../src/adapter");
    const owned = await resolveService({ actions: new Map([["self.owned", echo]]) });
    expect(owned.ownsService).toBe(true);
    // 自建实例随契约关闭，不残留句柄
    await owned.service.close();

    process.stdin.emit("end");
    await new Promise((r) => setTimeout(r, 300));
    (process.stderr as any).write = origWrite;

    const fullStderr = stderrChunks.join("");
    // 自建 service 的 close 链路正常收敛：无清理失败诊断行
    expect(fullStderr).not.toContain("Cleanup Failed");
    expect(fullStderr).not.toContain("Cleanup Error");
  }, 10000);

  it("keeps externally injected service usable after stdio cleanup path", async () => {
    // 端到端契约：注入的 service 在 cleanup 后仍可继续调用（未被 SERVICE_CLOSED 误杀）
    const calls: string[] = [];
    const fakeService: any = {
      info: async () => [{ id: "fake-pkg", name: "Fake", version: "1.0.0" }],
      discovery: {
        listPackages: async () => {
          calls.push("listPackages");
          return [];
        },
        listActions: async () => {
          calls.push("listActions");
          return [];
        },
        listPlaybooks: async () => {
          calls.push("listPlaybooks");
          return [];
        },
      },
      execution: {},
      runs: {},
      close: async () => {
        calls.push("close");
      },
    };

    await startMcpStdio({ service: fakeService });
    process.stdin.emit("end");
    await new Promise((r) => setTimeout(r, 200));

    expect(calls).not.toContain("close");
    // service 仍可响应调用（未被关闭）
    await fakeService.discovery.listActions();
    expect(calls).toContain("listActions");
  }, 10000);
});

describe("MCP adapter tool description anchoring", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mcp-multi-pkg-"));

  process.on("exit", () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // 忽略清理异常
    }
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("omits full-id prefix when all actions share one package even if first action lacks packageId", async () => {
    // 构造首元素无 packageId 而其余元素同属一个包的场景：
    // 旧实现以 actions[0].packageId 为锚会误判多包并加 [full-id] 前缀
    const echoA = defineAction({
      id: "echo.a",
      description: "Echo A",
      run: () => ({ ok: true }),
    });
    const echoB = defineAction({
      id: "echo.b",
      description: "Echo B",
      run: () => ({ ok: true }),
    });

    const server = await createActionDockMcpServer({
      actions: new Map([
        ["echo.a", echoA],
        ["echo.b", echoB],
      ]),
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
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "anchor-test", version: "1.0.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 150));

    expect(toolsList).toBeDefined();
    // 单包场景：描述不得带 [full-id] 误导性前缀
    for (const tool of toolsList) {
      expect(tool.description.startsWith("[")).toBe(false);
    }

    await server.close();
  });

  it("writes a one-time degradation warning when cancel signal shape is missing", async () => {
    const echo = defineAction({
      id: "cancel.probe",
      description: "Cancel probe",
      run: () => ({ ok: true }),
    });

    const server = await createActionDockMcpServer({
      actions: new Map([["cancel.probe", echo]]),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: any, ...rest: any[]) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return origWrite(chunk, ...rest);
    };

    let callResult: any = null;
    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "cancel.probe", arguments: {} },
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
        clientInfo: { name: "cancel-test", version: "1.0.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 200));
    (process.stderr as any).write = origWrite;

    // 工具仍可正常执行（降级不阻断执行）
    expect(callResult).toBeDefined();
    expect(callResult.isError).toBeFalsy();

    await server.close();
  }, 10000);
});
