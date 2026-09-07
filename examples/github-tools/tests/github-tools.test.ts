import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import getPrAction from "../actions/get-pr";
import listPrsAction from "../actions/list-prs";
import reviewPrAction from "../actions/review-pr";

describe("GitHub Tools Action Package", () => {
  it("executes list-prs action", async () => {
    const runtime = createTestRuntime();
    const res = await runtime.run(listPrsAction, { repo: "team4u/actiondock" });
    assert.ok(res.items.length > 0);
    assert.equal(res.count, res.items.length);
  });

  it("executes get-pr action", async () => {
    const runtime = createTestRuntime();
    const pr = await runtime.run(getPrAction, {
      repo: "team4u/actiondock",
      pullNumber: 42,
    });
    assert.equal(pr.number, 42);
    assert.notEqual(pr.title, undefined);
    assert.equal(pr.state, "open");
  });

  it("executes review-pr composite action and saves state", async () => {
    const runtime = createTestRuntime();
    const review = await runtime.run(reviewPrAction, {
      repo: "team4u/actiondock",
      pullNumber: 42,
    });

    assert.equal(review.pullNumber, 42);
    assert.notEqual(review.verdict, undefined);
    assert.notEqual(review.summary, undefined);

    // Verify state checkpoint
    const saved = await runtime.state.get("review:team4u/actiondock:42");
    assert.notEqual(saved, undefined);
  });
});
