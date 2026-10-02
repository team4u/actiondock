import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createActionDockHost } from "../src/host";
import { createActionDock } from "../src/service";
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

      const app = await createPackageRuntime({
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
      const service = host;

      const reqId = "client-req-001";
      const input = { value: 21 };

      const res1 = await service.execution.run("pkg.idemp/double", input, { requestId: reqId });
      assert.strictEqual(res1.ok, true);
      if (res1.ok) {
        assert.deepStrictEqual(res1.data, { doubled: 42 });
      }
      assert.strictEqual(runCount, 1);

      const res2 = await service.execution.run("pkg.idemp/double", input, { requestId: reqId });
      assert.strictEqual(res2.ok, true);
      if (res2.ok) {
        assert.deepStrictEqual(res2.data, { doubled: 42 });
      }
      assert.strictEqual(res2.runId, res1.runId);
      assert.strictEqual(runCount, 1);

      const ticket = await service.execution.start("pkg.idemp/double", input, { requestId: reqId });
      assert.strictEqual(ticket.runId, res1.runId);
      const ticketRes = await ticket.result;
      assert.strictEqual(ticketRes?.ok, true);
      if (ticketRes?.ok) {
        assert.deepStrictEqual(ticketRes.data, { doubled: 42 });
      }
      assert.strictEqual(runCount, 1);

      await host.close();
    });

    it("相同 requestId 但输入摘要不同时抛出带有 IDEMPOTENCY_CONFLICT 错误码的异常", async () => {
      const testAction = defineAction({
        run: async (input: { message: string }) => ({ echo: input.message }),
      });

      const app = await createPackageRuntime({
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
      const service = host;

      const reqId = "client-conflict-001";
      const res1 = await service.execution.run("pkg.conflict/echo", "initial", { requestId: reqId });
      assert.strictEqual(res1.ok, true);

      let conflictError: any;
      try {
        await service.execution.run("pkg.conflict/echo", "tampered", { requestId: reqId });
      } catch (err: any) {
        conflictError = err;
      }

      assert.notStrictEqual(conflictError, undefined);
      assert.strictEqual(conflictError.code, "IDEMPOTENCY_CONFLICT");
      assert.ok((conflictError.message).includes("Idempotency conflict"));

      await host.close();
    });

    it("未提供 requestId 的请求不进行去重，每次创建独立运行", async () => {
      let counter = 0;
      const testAction = defineAction({
        run: async () => ({ count: ++counter }),
      });

      const app = await createPackageRuntime({
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
      const service = host;

      const res1 = await service.execution.run("pkg.no-idemp/inc", {});
      const res2 = await service.execution.run("pkg.no-idemp/inc", {});

      assert.notStrictEqual(res1.runId, res2.runId);
      if (res1.ok && res2.ok) {
        assert.deepStrictEqual(res1.data, { count: 1 });
        assert.deepStrictEqual(res2.data, { count: 2 });
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
      assert.strictEqual(check1.outcome, "new");

      const checkDup = storage.checkAndRecordIdempotency(record);
      assert.strictEqual(checkDup.outcome, "duplicate");

      storage.clearRuns({ actionId: "action" });

      const check2 = storage.checkAndRecordIdempotency(record);
      assert.strictEqual(check2.outcome, "new");

      await storage.close();
    });
  });

  describe("事件队列缓冲上限与慢订阅者丢弃", () => {
    it("慢订阅者队列溢出时主运行非阻塞完成，慢订阅者丢弃旧事件并持续接收最新事件", async () => {
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

      // 先发送首条事件并稍作等待
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

      eventSink.emit({
        runId: "run-backpressure-1",
        rootRunId: "run-backpressure-1",
        sequence: 7,
        timestamp: new Date().toISOString(),
        type: "finish",
        result: { ok: true, runId: "run-backpressure-1", data: null },
      });

      await slowConsumer;
      assert.strictEqual(slowDone, true);

      // 慢订阅者不会被切断通道，没有合成的错误事件
      const errorEvent = receivedEvents.find((e) => e.type === "error");
      assert.strictEqual(errorEvent, undefined);

      // 慢订阅者因为消费慢，队列满时丢弃了旧事件，只收到了初始事件和队列保留的最新事件（含终态事件）
      assert.ok((receivedEvents.length) < 8);
      assert.strictEqual(receivedEvents[receivedEvents.length - 1].type, "finish");

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

      assert.strictEqual(normalEvents.length, 9);
      assert.deepStrictEqual(normalEvents.map((e) => e.sequence), [0, 1, 2, 3, 4, 5, 6, 7, 8]);

      eventSink.clear("run-multi-sub");
    });
  });

  describe("基于游标的断点续传", () => {
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

      assert.strictEqual(resumedEvents.length, 3);
      assert.strictEqual(resumedEvents[0].sequence, 3);
      assert.strictEqual(resumedEvents[1].sequence, 4);
      assert.strictEqual(resumedEvents[2].sequence, 5);

      eventSink.close();
    });

    it("传入早于已淘汰事件的游标时正常返回剩余可用增量事件，不抛出过期异常", async () => {
      const eventSink = new InMemoryEventSink({ maxEventsPerRun: 5 });
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
      eventSink.emit({
        runId,
        rootRunId: runId,
        sequence: 10,
        timestamp: new Date().toISOString(),
        type: "finish",
        result: { ok: true, runId, data: null },
      });

      const events: any[] = [];
      const sub = eventSink.subscribe(runId, { after: 1 });
      for await (const evt of sub) {
        events.push(evt);
      }

      // 缓冲区上限为 5，早期事件已滚动淘汰，订阅直接消费剩余可用的最新 5 条事件
      assert.strictEqual(events.length, 5);
      assert.deepStrictEqual(events.map((e) => e.sequence), [6, 7, 8, 9, 10]);

      eventSink.close();
    });
  });

  describe("HTTP SSE 协议接入（Last-Event-ID、HTTP 409）", () => {
    const AUTH_TOKEN = "test-stream-secret";
    let serverInstance: any;
    let serverUrl: string;
    let host: any;
    let service: any;

    before(async () => {
      const stepAction = defineAction({
        run: async (_input: unknown, ctx: ActionContext) => {
          for (let i = 0; i < 4; i++) {
            ctx.log.info(`Step ${i}`);
            await new Promise((r) => setTimeout(r, 20));
          }
          return { done: true };
        },
      });

      const app = await createPackageRuntime({
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
      service = host;

      serverInstance = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: AUTH_TOKEN,
        service,
        enableManagement: false,
      });
      serverUrl = `http://127.0.0.1:${serverInstance.port}`;
    });

    after(async () => {
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
      assert.strictEqual(res1.status, 200);
      const data1 = (await res1.json()) as any;
      assert.strictEqual(data1.ok, true);

      const res2 = await fetch(`${serverUrl}/api/v2/packages/pkg.stream/actions/step/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: {} }),
      });
      assert.strictEqual(res2.status, 200);
      const data2 = (await res2.json()) as any;
      assert.strictEqual(data2.ok, true);
      assert.strictEqual(data2.runId, data1.runId);
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
      assert.strictEqual(res1.status, 200);

      const res2 = await fetch(`${serverUrl}/api/v2/packages/pkg.stream/actions/step/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: { param: "B" } }),
      });
      assert.strictEqual(res2.status, 409);
      const errBody = (await res2.json()) as any;
      assert.strictEqual(errBody.ok, false);
      assert.strictEqual(errBody.error?.code, "IDEMPOTENCY_CONFLICT");
    });

    it("HTTP GET events 携带 Last-Event-ID 请求头续传事件流并在 SSE 输出 id 字段", async () => {
      const ticket = await service.execution.start("pkg.stream/step", {});
      await ticket.result;

      const eventsRes = await fetch(`${serverUrl}/api/v2/runs/${ticket.runId}/events`, {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Last-Event-ID": "2",
        },
      });

      assert.strictEqual(eventsRes.status, 200);
      assert.ok(eventsRes.headers.get("content-type")!.includes("text/event-stream"));

      const bodyText = await eventsRes.text();
      assert.ok((bodyText).includes("id: "));
      assert.ok((bodyText).includes("event: "));
      assert.ok((bodyText).includes("data: "));
    });

    it("HTTP GET events 传入早期游标时返回 HTTP 200 并续传后续事件流", async () => {
      const ticket = await service.execution.start("pkg.stream/step", {});
      await ticket.result;

      const eventsRes = await fetch(`${serverUrl}/api/v2/runs/${ticket.runId}/events`, {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Last-Event-ID": "0",
        },
      });

      assert.strictEqual(eventsRes.status, 200);
      assert.ok(eventsRes.headers.get("content-type")!.includes("text/event-stream"));
      const bodyText = await eventsRes.text();
      assert.ok((bodyText).includes("id: "));
      assert.ok((bodyText).includes("event: "));
    });
  });
});
