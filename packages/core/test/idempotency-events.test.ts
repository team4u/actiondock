import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import { createActionDockTarget } from "../src/target";
import { startActionDockServer } from "../src/server";
import { InMemoryEventSink } from "../src/runtime/events";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("Task F: requestId 幂等去重与高级事件流契约验证", () => {
  describe("requestId 提交去重与冲突检测", () => {
    it("相同 requestId 与相同输入摘要时返回同一运行票据及终态结果，Action 不重复执行", async () => {
      let runCount = 0;
      const testAction = defineAction({
        run: async (input: { value: number }) => {
          runCount++;
          return { doubled: input.value * 2 };
        },
      });

      const app = await createActionDockApp({
        projectConfig: {
          id: "pkg.idemp",
          name: "Idempotency Test",
          version: "1.0.0",
          actions: {
            double: {
              entry: "",
              description: "数值翻倍动作",
            },
          },
        },
        actions: {
          double: testAction,
        },
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const target = await createActionDockTarget({ host });

      const reqId = "client-req-001";
      const input = { value: 21 };

      const res1 = await target.runAction("pkg.idemp/double", input, { requestId: reqId });
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.data).toEqual({ doubled: 42 });
      }
      expect(runCount).toBe(1);

      const res2 = await target.runAction("pkg.idemp/double", input, { requestId: reqId });
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.data).toEqual({ doubled: 42 });
      }
      expect(res2.runId).toBe(res1.runId);
      expect(runCount).toBe(1);

      const ticket = await target.startAction("pkg.idemp/double", input, { requestId: reqId });
      expect(ticket.runId).toBe(res1.runId);
      const ticketRes = await ticket.result;
      expect(ticketRes?.ok).toBe(true);
      if (ticketRes?.ok) {
        expect(ticketRes.data).toEqual({ doubled: 42 });
      }
      expect(runCount).toBe(1);

      await host.close();
    });

    it("相同 requestId 但输入摘要不同时抛出带有 IDEMPOTENCY_CONFLICT 错误码的异常", async () => {
      const testAction = defineAction({
        run: async (input: { message: string }) => ({ echo: input.message }),
      });

      const app = await createActionDockApp({
        projectConfig: {
          id: "pkg.conflict",
          name: "Conflict Test",
          version: "1.0.0",
          actions: {
            echo: {
              entry: "",
              description: "回声动作",
            },
          },
        },
        actions: {
          echo: testAction,
        },
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const target = await createActionDockTarget({ host });

      const reqId = "client-conflict-001";
      const res1 = await target.runAction("pkg.conflict/echo", { message: "initial" }, { requestId: reqId });
      expect(res1.ok).toBe(true);

      let conflictError: any;
      try {
        await target.runAction("pkg.conflict/echo", { message: "tampered" }, { requestId: reqId });
      } catch (err: any) {
        conflictError = err;
      }

      expect(conflictError).toBeDefined();
      expect(conflictError.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(conflictError.message).toContain("Idempotency conflict");

      await host.close();
    });

    it("未提供 requestId 的请求不进行去重，每次创建独立运行", async () => {
      let counter = 0;
      const testAction = defineAction({
        run: async () => ({ count: ++counter }),
      });

      const app = await createActionDockApp({
        projectConfig: {
          id: "pkg.no-idemp",
          name: "No Idempotency Test",
          version: "1.0.0",
          actions: {
            inc: { entry: "" },
          },
        },
        actions: {
          inc: testAction,
        },
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      const target = await createActionDockTarget({ host });

      const res1 = await target.runAction("pkg.no-idemp/inc", {});
      const res2 = await target.runAction("pkg.no-idemp/inc", {});

      expect(res1.runId).not.toBe(res2.runId);
      if (res1.ok && res2.ok) {
        expect(res1.data).toEqual({ count: 1 });
        expect(res2.data).toEqual({ count: 2 });
      }

      await host.close();
    });

    it("当原运行记录被清理淘汰后，同一 requestId 可再次安全使用重新创建运行", async () => {
      const storage = new SqliteRuntimeStorage({ packageId: "pkg.cleanup" });
      const record = {
        ownerId: "local",
        actionRef: "pkg.cleanup/action",
        requestId: "reusable-req-1",
        inputDigest: "sha256-hash-val",
        runId: "run-target-1",
      };

      storage.createRun({
        id: "run-target-1",
        packageId: "pkg.cleanup",
        actionId: "action",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });

      const check1 = storage.checkAndRecordIdempotency(record);
      expect(check1.outcome).toBe("new");

      const checkDup = storage.checkAndRecordIdempotency(record);
      expect(checkDup.outcome).toBe("duplicate");

      storage.clearRuns({ actionId: "action" });

      const check2 = storage.checkAndRecordIdempotency(record);
      expect(check2.outcome).toBe("new");

      await storage.close();
    });
  });

  describe("事件队列背压截断（EVENT_BACKPRESSURE_LIMIT）", () => {
    it("慢订阅者队列溢出时主运行非阻塞完成，慢订阅者收到背压终止事件并切断通道", async () => {
      const eventSink = new InMemoryEventSink({ maxSubscriberQueueSize: 3 });
      const receivedEvents: any[] = [];
      let slowDone = false;

      const subscription = eventSink.subscribe("run-backpressure-1", { maxQueueSize: 3 });

      const slowConsumer = (async () => {
        for await (const evt of subscription) {
          receivedEvents.push(evt);
          await new Promise((r) => setTimeout(r, 60));
        }
        slowDone = true;
      })();

      // 先发送首条事件并稍作等待，让慢订阅者成功确认消费首条事件以确立已确认游标
      eventSink.emit({
        runId: "run-backpressure-1",
        rootRunId: "run-backpressure-1",
        sequence: 0,
        timestamp: new Date().toISOString(),
        type: "log",
        level: "info",
        message: "Initial event 0",
      });

      await new Promise((r) => setTimeout(r, 20));

      // 随后连续快速发送多条事件填满并溢出慢订阅者队列（maxQueueSize=3）
      for (let i = 1; i <= 6; i++) {
        eventSink.emit({
          runId: "run-backpressure-1",
          rootRunId: "run-backpressure-1",
          sequence: i,
          timestamp: new Date().toISOString(),
          type: "log",
          level: "info",
          message: `Event message ${i}`,
        });
      }

      await slowConsumer;
      expect(slowDone).toBe(true);

      const errorEvent = receivedEvents.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe("EVENT_BACKPRESSURE_LIMIT");
      expect(errorEvent.error.details?.lastConfirmedCursor).toBeDefined();
      expect(errorEvent.error.details?.lastConfirmedSequence).toBe(0);

      eventSink.clear("run-backpressure-1");
    });

    it("正常消费速率的订阅者不受慢消费者溢出影响，正常收取全量事件", async () => {
      const eventSink = new InMemoryEventSink({ maxSubscriberQueueSize: 3 });
      const normalEvents: any[] = [];

      const normalSub = eventSink.subscribe("run-multi-sub", { maxQueueSize: 50 });
      const slowSub = eventSink.subscribe("run-multi-sub", { maxQueueSize: 3 });

      const normalConsumer = (async () => {
        for await (const evt of normalSub) {
          normalEvents.push(evt);
        }
      })();

      const slowConsumer = (async () => {
        for await (const _evt of slowSub) {
          await new Promise((r) => setTimeout(r, 60));
        }
      })();

      for (let i = 0; i < 8; i++) {
        eventSink.emit({
          runId: "run-multi-sub",
          rootRunId: "run-multi-sub",
          sequence: i,
          timestamp: new Date().toISOString(),
          type: "progress",
          current: i,
          total: 8,
        });
      }

      // 发送终态 finish 事件
      eventSink.emit({
        runId: "run-multi-sub",
        rootRunId: "run-multi-sub",
        sequence: 8,
        timestamp: new Date().toISOString(),
        type: "finish",
        result: { ok: true, runId: "run-multi-sub", data: null },
      });

      await Promise.all([normalConsumer, slowConsumer]);

      expect(normalEvents.length).toBe(9);
      expect(normalEvents.some((e) => e.type === "error" && e.error?.code === "EVENT_BACKPRESSURE_LIMIT")).toBe(false);

      eventSink.clear("run-multi-sub");
    });
  });

  describe("基于游标的断点续传与过期清理（EVENT_CURSOR_EXPIRED）", () => {
    it("基于 after 游标正常续传后续增量事件", async () => {
      const eventSink = new InMemoryEventSink();
      const runId = "run-cursor-1";

      for (let i = 0; i < 5; i++) {
        eventSink.emit({
          runId,
          rootRunId: runId,
          sequence: i,
          timestamp: new Date().toISOString(),
          type: "log",
          level: "info",
          message: `Log line ${i}`,
        });
      }
      eventSink.emit({
        runId,
        rootRunId: runId,
        sequence: 5,
        timestamp: new Date().toISOString(),
        type: "finish",
        result: { ok: true, runId, data: null },
      });

      const resumedEvents: any[] = [];
      const sub = eventSink.subscribe(runId, { after: 2 });
      for await (const evt of sub) {
        resumedEvents.push(evt);
      }

      expect(resumedEvents.length).toBe(3);
      expect(resumedEvents[0].sequence).toBe(3);
      expect(resumedEvents[1].sequence).toBe(4);
      expect(resumedEvents[2].sequence).toBe(5);

      eventSink.close();
    });

    it("传入早于已修剪的最早可用游标时抛出带有 EVENT_CURSOR_EXPIRED 错误码的异常", async () => {
      const eventSink = new InMemoryEventSink();
      const runId = "run-pruned-1";

      for (let i = 0; i < 10; i++) {
        eventSink.emit({
          runId,
          rootRunId: runId,
          sequence: i,
          timestamp: new Date().toISOString(),
          type: "progress",
          current: i,
          total: 10,
        });
      }

      eventSink.pruneEvents(runId, 5);

      let caughtError: any;
      try {
        const sub = eventSink.subscribe(runId, { after: 1 });
        for await (const _evt of sub) {
          // 不应产出正常数据
        }
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.code).toBe("EVENT_CURSOR_EXPIRED");
      expect(caughtError.details?.earliestRetainedCursor).toBeDefined();

      eventSink.close();
    });
  });

  describe("HTTP SSE 协议接入（Last-Event-ID、HTTP 409、HTTP 410）", () => {
    const AUTH_TOKEN = "test-stream-secret";
    let serverInstance: any;
    let serverUrl: string;
    let host: any;
    let target: any;

    beforeAll(async () => {
      const stepAction = defineAction({
        run: async (_input: unknown, ctx: ActionContext) => {
          for (let i = 0; i < 4; i++) {
            ctx.log.info(`Step ${i}`);
            await new Promise((r) => setTimeout(r, 20));
          }
          return { done: true };
        },
      });

      const app = await createActionDockApp({
        projectConfig: {
          id: "pkg.stream",
          name: "Stream Package",
          version: "1.0.0",
          actions: {
            step: {
              entry: "",
              description: "步骤进度动作",
            },
          },
        },
        actions: {
          step: stepAction,
        },
        inMemory: true,
      });

      host = await createActionDockHost({
        packages: [app],
        autoLoadCurrentProject: false,
        inMemory: true,
      });
      target = await createActionDockTarget({ host });

      serverInstance = await startActionDockServer({
        port: 0,
        host: "127.0.0.1",
        token: AUTH_TOKEN,
        target,
        hostInstance: host,
        enableManagement: false,
      });
      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    afterAll(async () => {
      if (serverInstance) {
        await serverInstance.stop();
      }
      if (host) {
        await host.close();
      }
    });

    it("HTTP POST 携带 Idempotency-Key 请求头重复提交返回相同运行并阻止重复执行", async () => {
      const reqId = "http-idemp-001";
      const headers = {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": reqId,
      };

      const res1 = await fetch(`${serverUrl}/api/v2/packages/pkg.stream/actions/step/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: {} }),
      });
      expect(res1.status).toBe(200);
      const data1 = (await res1.json()) as any;
      expect(data1.ok).toBe(true);

      const res2 = await fetch(`${serverUrl}/api/v2/packages/pkg.stream/actions/step/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: {} }),
      });
      expect(res2.status).toBe(200);
      const data2 = (await res2.json()) as any;
      expect(data2.ok).toBe(true);
      expect(data2.runId).toBe(data1.runId);
    });

    it("HTTP POST 携带相同 Idempotency-Key 但不同参数时返回 HTTP 409 状态码", async () => {
      const reqId = "http-conflict-001";
      const headers = {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": reqId,
      };

      const res1 = await fetch(`${serverUrl}/api/v2/packages/pkg.stream/actions/step/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: { param: "A" } }),
      });
      expect(res1.status).toBe(200);

      const res2 = await fetch(`${serverUrl}/api/v2/packages/pkg.stream/actions/step/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: { param: "B" } }),
      });
      expect(res2.status).toBe(409);
      const errBody = (await res2.json()) as any;
      expect(errBody.ok).toBe(false);
      expect(errBody.error?.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("HTTP GET events 携带 Last-Event-ID 请求头续传事件流并在 SSE 输出 id 字段", async () => {
      const ticket = await target.startAction("pkg.stream/step", {});
      await ticket.result;

      const eventsRes = await fetch(`${serverUrl}/api/v2/runs/${ticket.runId}/events`, {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Last-Event-ID": "2",
        },
      });

      expect(eventsRes.status).toBe(200);
      expect(eventsRes.headers.get("content-type")).toContain("text/event-stream");

      const bodyText = await eventsRes.text();
      expect(bodyText).toContain("id: ");
      expect(bodyText).toContain("event: ");
      expect(bodyText).toContain("data: ");
    });

    it("HTTP GET events 传入已过期游标时直接返回 HTTP 410 与 EVENT_CURSOR_EXPIRED 错误", async () => {
      const ticket = await target.startAction("pkg.stream/step", {});
      await ticket.result;

      const app = host.getApp("pkg.stream");
      const eventSink = (app?.executionService as any)?.eventSink;
      if (eventSink?.pruneEvents) {
        eventSink.pruneEvents(ticket.runId, 5);
      }

      const eventsRes = await fetch(`${serverUrl}/api/v2/runs/${ticket.runId}/events`, {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Last-Event-ID": "0",
        },
      });

      expect(eventsRes.status).toBe(410);
      const errBody = (await eventsRes.json()) as any;
      expect(errBody.ok).toBe(false);
      expect(errBody.error?.code).toBe("EVENT_CURSOR_EXPIRED");
      expect(errBody.error?.details?.earliestRetainedCursor).toBeDefined();
    });
  });
});
