import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import getPrAction from "../actions/get-pr";
import listPrsAction from "../actions/list-prs";
import reviewPrAction from "../actions/review-pr";

describe("GitHub Tools Action Package", () => {
  it("executes list-prs action", async () => {
    const runtime = createTestRuntime();
    const res = await runtime.run(listPrsAction, { repo: "team4u/actiondock" });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.count).toBe(res.items.length);
  });

  it("executes get-pr action", async () => {
    const runtime = createTestRuntime();
    const pr = await runtime.run(getPrAction, {
      repo: "team4u/actiondock",
      pullNumber: 42,
    });
    expect(pr.number).toBe(42);
    expect(pr.title).toBeDefined();
    expect(pr.state).toBe("open");
  });

  it("executes review-pr composite action and saves state", async () => {
    const runtime = createTestRuntime();
    const review = await runtime.run(reviewPrAction, {
      repo: "team4u/actiondock",
      pullNumber: 42,
    });

    expect(review.pullNumber).toBe(42);
    expect(review.verdict).toBeDefined();
    expect(review.summary).toBeDefined();

    // Verify state checkpoint
    const saved = await runtime.state.get("review:team4u/actiondock:42");
    expect(saved).toBeDefined();
  });
});
