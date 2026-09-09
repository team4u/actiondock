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

  it("enforces count quota and evicts non-essential events first while preserving finish event", () => {
    const sink = new InMemoryEventSink({ maxEventsPerRun: 4 });
    const runId = "run-count-quota";

    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: "msg 1" });
    sink.emit({ runId, rootRunId: runId, sequence: 2, timestamp: "t2", type: "progress", current: 50, total: 100 });
    sink.emit({ runId, rootRunId: runId, sequence: 3, timestamp: "t3", type: "log", level: "info", message: "msg 2" });

    const statsBefore = sink.getRunStats(runId);
    expect(statsBefore?.count).toBe(4);

    // Emit 5th event -> should evict a non-essential event (log or progress)
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 4,
      timestamp: "t4",
      type: "finish",
      result: { ok: true, runId, data: null },
    });

    const statsAfter = sink.getRunStats(runId);
    expect(statsAfter?.count).toBeLessThanOrEqual(4);
    expect(statsAfter?.isTerminal).toBe(true);
  });

  it("enforces byte quota and triggers eviction on large events", () => {
    // 600 bytes quota
    const sink = new InMemoryEventSink({ maxBytesPerRun: 600 });
    const runId = "run-byte-quota";

    const largeMessage = "x".repeat(300);
    sink.emit({ runId, rootRunId: runId, sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId, rootRunId: runId, sequence: 1, timestamp: "t1", type: "log", level: "info", message: largeMessage });

    const stats1 = sink.getRunStats(runId)!;
    expect(stats1.bytes).toBeGreaterThan(300);

    // Emit another large message that exceeds 600 bytes
    sink.emit({ runId, rootRunId: runId, sequence: 2, timestamp: "t2", type: "log", level: "info", message: largeMessage });

    const stats2 = sink.getRunStats(runId)!;
    expect(stats2.bytes).toBeLessThanOrEqual(600);
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

  it("evictOldestRun strictly protects active non-terminal runs and only evicts terminal runs", () => {
    const sink = new InMemoryEventSink({ maxRuns: 2 });

    // Both run-1 and run-2 are active (non-terminal)
    sink.emit({ runId: "run-1", rootRunId: "run-1", sequence: 0, timestamp: "t0", type: "status", status: "running" });
    sink.emit({ runId: "run-2", rootRunId: "run-2", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    // Emit run-3 (also active) - since neither run-1 nor run-2 is terminal, neither is evicted!
    sink.emit({ runId: "run-3", rootRunId: "run-3", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    expect(sink.getRunStats("run-1")).toBeDefined();
    expect(sink.getRunStats("run-2")).toBeDefined();
    expect(sink.getRunStats("run-3")).toBeDefined();

    // Now mark run-1 as terminal (finish)
    sink.emit({
      runId: "run-1",
      rootRunId: "run-1",
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: { ok: true, runId: "run-1", data: null },
    });

    // Emitting run-4 should evict the terminal run-1, preserving active run-2 and run-3
    sink.emit({ runId: "run-4", rootRunId: "run-4", sequence: 0, timestamp: "t0", type: "status", status: "running" });

    expect(sink.getRunStats("run-1")).toBeUndefined();
    expect(sink.getRunStats("run-2")).toBeDefined();
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

  it("truncates oversized single log / finish events and rejects buffering if still exceeding quota", () => {
    // 300 byte quota
    const sink = new InMemoryEventSink({ maxBytesPerRun: 300 });
    const runId = "run-single-oversized";

    // 1. Oversized log message should be truncated
    const massiveLog = "A".repeat(1000);
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 0,
      timestamp: "t0",
      type: "log",
      level: "info",
      message: massiveLog,
    });

    const statsLog = sink.getRunStats(runId);
    expect(statsLog).toBeDefined();
    expect(statsLog!.bytes).toBeLessThanOrEqual(300);

    // 2. Oversized finish data should be truncated
    const massiveFinishData = { payload: "B".repeat(1000) };
    sink.emit({
      runId,
      rootRunId: runId,
      sequence: 1,
      timestamp: "t1",
      type: "finish",
      result: { ok: true, runId, data: massiveFinishData },
    });

    const statsFinish = sink.getRunStats(runId);
    expect(statsFinish).toBeDefined();
    expect(statsFinish!.bytes).toBeLessThanOrEqual(300);
    expect(statsFinish!.isTerminal).toBe(true);

    // 3. If a non-truncatable event exceeds quota by itself, buffering is rejected
    const tinyQuotaSink = new InMemoryEventSink({ maxBytesPerRun: 50 });
    const runIdTiny = "run-tiny-quota";

    tinyQuotaSink.emit({
      runId: runIdTiny,
      rootRunId: runIdTiny,
      sequence: 0,
      timestamp: "2026-09-09T00:00:00.000Z",
      type: "status",
      status: "running",
    });

    // The status event itself is ~100 bytes which exceeds 50 bytes, so buffering is rejected
    const tinyStats = tinyQuotaSink.getRunStats(runIdTiny);
    expect(tinyStats).toBeDefined();
    expect(tinyStats!.count).toBe(0);
    expect(tinyStats!.bytes).toBe(0);
  });
});
