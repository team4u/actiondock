import { describe, expect, it } from "vitest";
import {
  buildBatchSessionStats,
  createBatchSession,
  deriveBatchSessionStatus,
  rehydrateBatchSession
} from "./session";

describe("batch session helpers", () => {
  it("creates queued and invalid items with aggregate stats", () => {
    const session = createBatchSession({
      surface: "editor",
      scriptId: "repair-order",
      scriptName: "repair-order",
      batchName: "repair-order-1",
      sourceType: "JSON_ARRAY",
      submitMode: "ASYNC",
      failStrategy: "CONTINUE",
      concurrency: 3,
      items: [
        {
          id: "row-1",
          rowIndex: 1,
          input: { orderId: "A001" },
          errors: [],
          warnings: []
        },
        {
          id: "row-2",
          rowIndex: 2,
          input: {},
          errors: ["订单号 必填"],
          warnings: []
        }
      ],
      now: "2026-04-26T10:00:00.000Z"
    });

    const stats = buildBatchSessionStats(session);
    expect(session.status).toBe("RUNNING");
    expect(stats.queued).toBe(1);
    expect(stats.invalid).toBe(1);
  });

  it("derives partial failed status once successes and failures coexist", () => {
    expect(
      deriveBatchSessionStatus([
        {
          id: "row-1",
          rowIndex: 1,
          input: {},
          errors: [],
          warnings: [],
          status: "SUCCESS",
          attempt: 1
        },
        {
          id: "row-2",
          rowIndex: 2,
          input: {},
          errors: [],
          warnings: [],
          status: "FAILED",
          attempt: 1
        }
      ])
    ).toBe("PARTIAL_FAILED");
  });

  it("rehydrates submitting items to interrupted after refresh", () => {
    const session = rehydrateBatchSession({
      id: "batch-1",
      surface: "published",
      scriptId: "repair-order",
      scriptName: "repair-order",
      batchName: "repair-order-1",
      sourceType: "JSONL",
      submitMode: "ASYNC",
      failStrategy: "CONTINUE",
      concurrency: 3,
      status: "RUNNING",
      createdAt: "2026-04-26T10:00:00.000Z",
      updatedAt: "2026-04-26T10:00:00.000Z",
      items: [
        {
          id: "row-1",
          rowIndex: 1,
          input: { orderId: "A001" },
          errors: [],
          warnings: [],
          status: "SUBMITTING",
          attempt: 1
        }
      ]
    });

    expect(session.items[0]?.status).toBe("INTERRUPTED");
    expect(session.status).toBe("INTERRUPTED");
  });
});
