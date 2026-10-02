import { describe, expect, it } from "bun:test";
import { InMemoryEventSink } from "../src/runtime/events";
import type { ExecutionEvent } from "@actiondock/sdk";

describe("InMemoryEventSink", () => {
  it("delivers events in sequence and stops on finish event", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-test-1";

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
    })();

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: "step 1" });
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 2,
      timestamp: "t2",
      type: "finish",
      result: { ok: true, runId, data: { done: true } },
    });

    await consumer;
    expect(received.length).toBe(3);
    expect(received.map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it("atomic subscription handoff: concurrent emissions during history playback are not lost or duplicated", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-atomic-race";

    // Pre-populate historical events
    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: "init" });

    const received: ExecutionEvent[] = [];
    let emittedMidWay = false;

    // Start consuming
    const subscription = sink.subscribe(runId);
    for await (const evt of subscription) {
      received.push(evt);

      // Concurrently emit while consuming history
      if (!emittedMidWay && evt.sequence === 0) {
        emittedMidWay = true;
        sink.emit({ runId, rootRunId: runId, sequence: 2, timestamp: "t2", type: "log", level: "info", message: "concurrent 1" });
        sink.emit({ runId, rootRunId: runId, sequence: 3, timestamp: "t3", type: "log", level: "info", message: "concurrent 2" });
        sink.emit({
          runId,
          rootRunId: runId,
          sequence: 4,
          timestamp: "t4",
          type: "finish",
          result: { ok: true, runId, data: null },
        });
      }
    }

    expect(received.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4]);
    // Ensure no duplicates
    const sequences = received.map((e) => e.sequence);
    expect(new Set(sequences).size).toBe(5);
  });

  it("enforces count quota and drops oldest events when buffer is full", () => {
    const sink = new InMemoryEventSink({ maxEventsPerRun: 4 });
    const runId = "run-count-quota";

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: "msg 1" });
    sink.emit({ runId, rootRunId: runId, sequence: 2, timestamp: "t2", type: "progress", current: 50, total: 100 });
    sink.emit({ runId, rootRunId: runId, sequence: 3, timestamp: "t3", type: "log", level: "info", message: "msg 2" });

    const statsBefore = sink.getRunStats(runId);
    expect(statsBefore?.count).toBe(4);
    expect(statsBefore?.droppedCount).toBe(0);

    // Emit 5th event -> should drop oldest event
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 4,
      timestamp: "t4",
      type: "finish",
      result: { ok: true, runId, data: null },
    });

    const statsAfter = sink.getRunStats(runId);
    expect(statsAfter?.count).toBe(4);
    expect(statsAfter?.droppedCount).toBe(1);
    expect(statsAfter?.isTerminal).toBe(true);
  });

  it("enforces count quota and drops oldest events when exceeding maxEventsPerRun", () => {
    const sink = new InMemoryEventSink({ maxEventsPerRun: 3 });
    const runId = "run-count-drop";

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: "msg 1" });
    sink.emit({ runId, rootRunId: runId, sequence: 2, timestamp: "t2", type: "log", level: "info", message: "msg 2" });

    const stats1 = sink.getRunStats(runId)!;
    expect(stats1.count).toBe(3);
    expect(stats1.droppedCount).toBe(0);

    sink.emit({ runId, rootRunId: runId, sequence: 3, timestamp: "t3", type: "log", level: "info", message: "msg 3" });
    sink.emit({ runId, rootRunId: runId, sequence: 4, timestamp: "t4", type: "log", level: "info", message: "msg 4" });

    const stats2 = sink.getRunStats(runId)!;
    expect(stats2.count).toBe(3);
    expect(stats2.droppedCount).toBe(2);
  });

  it("enforces global bounded run eviction when exceeding maxRuns", () => {
    const sink = new InMemoryEventSink({ maxRuns: 2 });

    sink.emit({ runId: "run-a", rootRunId: "run-a", sequence: 0, timestamp: "t0", type: "finish", result: { ok: true, runId: "run-a", data: null } });
    sink.emit({ runId: "run-b", rootRunId: "run-b", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    expect(sink.getRunCount()).toBe(2);

    // Adding 3rd run should evict finished run-a
    sink.emit({ runId: "run-c", rootRunId: "run-c", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    expect(sink.getRunCount()).toBe(2);
    expect(sink.getRunStats("run-a")).toBeUndefined();
    expect(sink.getRunStats("run-b")).toBeDefined();
    expect(sink.getRunStats("run-c")).toBeDefined();
  });

  it("cleans up AbortSignal listeners properly on abort or completion", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-abort-clean";

    const controller = new AbortController();
    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId, { signal: controller.signal })) {
        received.push(evt);
        if (evt.sequence === 0) {
          controller.abort();
        }
      }
    })();

    await consumer;
    expect(received.length).toBe(1);
    expect(controller.signal.aborted).toBe(true);
  });

  it("evictOldestRun strictly enforces maxRuns by evicting terminal runs first or oldest active run", () => {
    const sink = new InMemoryEventSink({ maxRuns: 2 });

    // Both run-1 and run-2 are active (non-terminal)
    sink.emit({ runId: "run-1", rootRunId: "run-1", sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId: "run-2", rootRunId: "run-2", sequence: 0, timestamp: "t0", type: "status", status: "running" });
    expect(sink.getRunCount()).toBe(2);

    // Emit run-3 (also active) - since neither run-1 nor run-2 is terminal, oldest active run (run-1) is evicted
    sink.emit({ runId: "run-3", rootRunId: "run-3", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    expect(sink.getRunCount()).toBe(2);
    expect(sink.getRunStats("run-1")).toBeUndefined();
    expect(sink.getRunStats("run-2")).toBeDefined();
    expect(sink.getRunStats("run-3")).toBeDefined();

    // Now mark run-2 as terminal (finish)
    sink.emit({
      runId: "run-2",
      rootRunId: "run-2",
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: { ok: true, runId: "run-2", data: null },
    });

    // Emitting run-4 should evict the terminal run-2, preserving active run-3
    sink.emit({ runId: "run-4", rootRunId: "run-4", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    expect(sink.getRunCount()).toBe(2);
    expect(sink.getRunStats("run-2")).toBeUndefined();
    expect(sink.getRunStats("run-3")).toBeDefined();
    expect(sink.getRunStats("run-4")).toBeDefined();
  });

  it("clear(runId) wakes up waiting subscribers so async iterator terminates cleanly", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-clear-wakeup";

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });

    const received: ExecutionEvent[] = [];
    let completed = false;

    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
      completed = true;
    })();

    // Yield to let subscriber enter the waiting state
    await new Promise((r) => setTimeout(r, 20));
    expect(completed).toBe(false);
    expect(received.length).toBe(1);

    // Calling clear() must unblock waiting subscriber
    sink.clear(runId);

    await consumer;
    expect(completed).toBe(true);
    expect(received.length).toBe(1);
  });

  it("broadcasts large log and finish events intact without payload truncation or tampering", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-no-tampering";

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
    })();

    // 1. Large log message
    const massiveLog = "A".repeat(10000);
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 0,
      timestamp: "t0",
      type: "log",
      level: "info",
      message: massiveLog,
    });

    // 2. Large finish data
    const massiveFinishData = { payload: "B".repeat(10000) };
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: { ok: true, runId, data: massiveFinishData },
    });

    await consumer;
    expect(received.length).toBe(2);

    const logEvt = received[0];
    expect(logEvt.type).toBe("log");
    if (logEvt.type === "log") {
      expect(logEvt.message).toBe(massiveLog);
      expect(logEvt.message.includes("[TRUNCATED]")).toBe(false);
    }

    const finishEvt = received[1];
    expect(finishEvt.type).toBe("finish");
    if (finishEvt.type === "finish") {
      expect(finishEvt.result.ok).toBe(true);
      expect(finishEvt.result).toEqual({ ok: true, runId, data: massiveFinishData });
      expect((finishEvt.result as any).data?._truncated).toBeUndefined();
    }
  });

  it("delivers finish event even after terminal status event during live subscription", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-terminal-status-then-finish";

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
    })();

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "status", status: "failed" });
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 2,
      timestamp: "t2",
      type: "finish",
      result: { ok: false, runId, error: { code: "SOME_ERR", message: "failed" } },
    });

    await consumer;
    expect(received.length).toBe(3);
    expect(received.map((e) => e.type)).toEqual(["status", "status", "finish"]);
    expect(received[2].type).toBe("finish");
  });

  it("late subscriber terminates cleanly when run is terminal", async () => {
    const sink = new InMemoryEventSink({ maxEventsPerRun: 1 });
    const runId = "run-terminal-late";

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: { ok: true, runId, data: { done: true } },
    });

    const stats = sink.getRunStats(runId);
    expect(stats?.isTerminal).toBe(true);
    expect(stats?.count).toBe(1);

    const received: ExecutionEvent[] = [];
    for await (const evt of sink.subscribe(runId)) {
      received.push(evt);
    }

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("finish");
  });

  it("delivers finish event when subscription starts between terminal status and finish", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-sub-between-status-and-finish";

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "status", status: "failed" });

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
    })();

    // 等待微任务让订阅者完成历史快照回放并挂载监听器
    await new Promise((r) => setTimeout(r, 20));

    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 2,
      timestamp: "t2",
      type: "finish",
      result: { ok: false, runId, error: { code: "SOME_ERR", message: "failed" } },
    });

    await consumer;
    expect(received.length).toBe(3);
    expect(received.map((e) => e.type)).toEqual(["status", "status", "finish"]);
    expect(received[2].type).toBe("finish");
  });

  it("paused subscriber terminates cleanly when active run is evicted by maxRuns", async () => {
    const sink = new InMemoryEventSink({ maxRuns: 2 });
    const runId1 = "run-active-1";

    sink.emit({ runId: runId1, rootRunId: runId1, sequence: 0, timestamp: "t0", type: "status", status: "running" });

    const received: ExecutionEvent[] = [];
    let completed = false;

    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId1)) {
        received.push(evt);
        // 模拟订阅者在消费事件之间暂停异步操作
        await new Promise((r) => setTimeout(r, 60));
      }
      completed = true;
    })();

    // 等待消费第一个事件并进入暂停中
    await new Promise((r) => setTimeout(r, 20));

    // 此时触发全局淘汰：连续发射新运行使活跃运行被淘汰出集合
    sink.emit({ runId: "run-2", rootRunId: "run-2", sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId: "run-3", rootRunId: "run-3", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    // 等待暂停消费的订阅者恢复并正常终止，设置超时保护验证不会死等
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout: subscriber hung")), 500));
    await Promise.race([consumer, timeoutPromise]);

    expect(completed).toBe(true);
    expect(received.length).toBe(1);
  });

  it("drops oldest events in subscriber queue when queue limit is exceeded", async () => {
    const sink = new InMemoryEventSink({ maxSubscriberQueueSize: 2 });
    const runId = "run-subscriber-queue-limit";

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId, { maxQueueSize: 2 })) {
        received.push(evt);
        await new Promise((r) => setTimeout(r, 40));
      }
    })();

    // Emit event 0
    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    await new Promise((r) => setTimeout(r, 10));

    // Emit events 1, 2, 3, 4 quickly while subscriber is slow
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: "m1" });
    sink.emit({ runId, rootRunId: runId, sequence: 2, timestamp: "t2", type: "log", level: "info", message: "m2" });
    sink.emit({ runId, rootRunId: runId, sequence: 3, timestamp: "t3", type: "log", level: "info", message: "m3" });
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 4,
      timestamp: "t4",
      type: "finish",
      result: { ok: true, runId, data: null },
    });

    await consumer;
    expect(received.length).toBeLessThan(5);
    expect(received.some((e) => e.sequence === 0)).toBe(true);
    expect(received[received.length - 1].type).toBe("finish");
  });

  it("preserves finish error payload intact without tampering", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-oversized-finish-err";

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
    })();

    const massiveErrMsg = "E".repeat(5000);
    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: {
        ok: false,
        runId,
        error: {
          code: "HUGE_ERR",
          message: massiveErrMsg,
        },
      },
    });

    await consumer;
    expect(received.length).toBe(2);
    const finishEvt = received[1];
    expect(finishEvt.type).toBe("finish");
    if (finishEvt.type === "finish") {
      expect(finishEvt.result.ok).toBe(false);
      if (!finishEvt.result.ok) {
        expect(finishEvt.result.error.message).toBe(massiveErrMsg);
        expect(finishEvt.result.error.message.includes("[TRUNCATED]")).toBe(false);
      }
    }
  });

  it("isolates errors so a throwing subscriber does not disrupt other subscribers or emit", async () => {
    const sink = new InMemoryEventSink();
    const runId = "run-error-isolation";

    const received: ExecutionEvent[] = [];
    const consumer = (async () => {
      for await (const evt of sink.subscribe(runId)) {
        received.push(evt);
      }
    })();

    // Register a faulty listener that throws on receive
    (sink as any).listeners.get(runId)?.add(() => {
      throw new Error("Malicious listener error");
    });

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: { ok: true, runId, data: null },
    });

    await consumer;
    expect(received.length).toBe(2);
    expect(received.map((e) => e.sequence)).toEqual([0, 1]);
  });

  it("filters events strictly by runId so subscribers only receive their own events", async () => {
    const sink = new InMemoryEventSink();
    const runA = "run-filter-A";
    const runB = "run-filter-B";

    const receivedA: ExecutionEvent[] = [];
    const consumerA = (async () => {
      for await (const evt of sink.subscribe(runA)) {
        receivedA.push(evt);
      }
    })();

    sink.emit({ runId: runB, rootRunId: runB, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId: runA, rootRunId: runA, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId: runB, rootRunId: runB, sequence: 1, timestamp: "t1", type: "finish", result: { ok: true, runId: runB, data: null } });
    sink.emit({ runId: runA, rootRunId: runA, sequence: 1, timestamp: "t1", type: "finish", result: { ok: true, runId: runA, data: null } });

    await consumerA;
    expect(receivedA.length).toBe(2);
    expect(receivedA.every((e) => e.runId === runA)).toBe(true);
  });
});
