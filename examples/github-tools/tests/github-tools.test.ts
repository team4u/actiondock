import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createActionDock } from "@actiondock/core";
import { createTestRuntime } from "@actiondock/testing";
import commentPrAction from "../actions/comment-pr";
import getPrAction from "../actions/get-pr";
import listPrsAction from "../actions/list-prs";
import reviewPrAction from "../actions/review-pr";

describe("GitHub Tools Action Package", () => {
  describe("createTestRuntime unit execution", () => {
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

    it("executes comment-pr action", async () => {
      const runtime = createTestRuntime();
      const comment = await runtime.run(commentPrAction, {
        repo: "team4u/actiondock",
        pullNumber: 42,
        comment: "Great work!",
      });
      assert.equal(comment.posted, true);
      assert.ok(comment.commentId);
      assert.ok(comment.timestamp);
    });

    it("executes review-pr composite action and saves state", async () => {
      const runtime = createTestRuntime({
        actions: { "get-pr": getPrAction },
      });
      const review = await runtime.run(reviewPrAction, {
        repo: "team4u/actiondock",
        pullNumber: 42,
      });

      assert.equal(review.pullNumber, 42);
      assert.notEqual(review.verdict, undefined);
      assert.notEqual(review.summary, undefined);

      // Verify state checkpoint (unambiguous slash-delimited key format)
      const saved = await runtime.state.get("review/team4u/actiondock/42");
      assert.notEqual(saved, undefined);
    });
  });

  describe("ActionDock Service Manifest v2 integration", () => {
    it("inspects package info and static declarations", async () => {
      const packageRoot = resolve(import.meta.dirname, "..");
      const dock = await createActionDock({ projectRoot: packageRoot, inMemory: true, scanLinkedPackages: false });

      const infoList = await dock.info();
      const info = infoList[0];
      assert.equal(info.id, "team4u.github-tools");
      assert.equal(info.actionsCount, 4);
      assert.equal(info.playbooksCount, 1);

      const actions = await dock.discovery.listActions();
      const actionIds = actions.map((a) => a.id).sort();
      assert.deepEqual(actionIds, ["comment-pr", "get-pr", "list-prs", "review-pr"]);

      const reviewSpec = await dock.discovery.describeAction("review-pr");
      assert.equal(reviewSpec.id, "review-pr");
      assert.deepEqual(reviewSpec.uses, ["get-pr"]);
      assert.ok(reviewSpec.inputSchema);
      assert.ok(reviewSpec.outputSchema);

      const playbooks = await dock.discovery.listPlaybooks();
      assert.equal(playbooks.length, 1);
      assert.equal(playbooks[0].id, "review-pr");

      const pbSpec = await dock.discovery.describePlaybook("review-pr");
      assert.equal(pbSpec.id, "review-pr");
      assert.deepEqual(pbSpec.actions, ["list-prs", "get-pr", "review-pr", "comment-pr"]);
      assert.ok(!pbSpec.content.startsWith("---"));
      assert.ok(pbSpec.content.includes("代码合并请求自动化评审标准操作规程"));

      await dock.close();
    });

    it("executes actions and persists state through ActionDock", async () => {
      const packageRoot = resolve(import.meta.dirname, "..");
      const dock = await createActionDock({ projectRoot: packageRoot, inMemory: true, scanLinkedPackages: false });

      const listRes = await dock.execution.run("list-prs", { repo: "team4u/actiondock" });
      assert.equal(listRes.ok, true);
      const listData = listRes.data as { items: any[]; count: number };
      assert.ok(listData.items.length > 0);

      const getRes = await dock.execution.run("get-pr", { repo: "team4u/actiondock", pullNumber: 42 });
      assert.equal(getRes.ok, true);
      const getData = getRes.data as { number: number };
      assert.equal(getData.number, 42);

      const commentRes = await dock.execution.run("comment-pr", {
        repo: "team4u/actiondock",
        pullNumber: 42,
        comment: "LGTM!",
      });
      assert.equal(commentRes.ok, true);
      const commentData = commentRes.data as { posted: boolean };
      assert.equal(commentData.posted, true);

      const reviewRes = await dock.execution.run("review-pr", {
        repo: "team4u/actiondock",
        pullNumber: 42,
      });
      assert.equal(reviewRes.ok, true);
      const reviewData = reviewRes.data as { pullNumber: number; verdict: string };
      assert.equal(reviewData.pullNumber, 42);
      assert.equal(reviewData.verdict, "APPROVE");

      const savedState = await dock.management?.state.get<{ verdict: string }>("team4u.github-tools", "", "review/team4u/actiondock/42");
      assert.ok(savedState);
      assert.equal(savedState.verdict, "APPROVE");

      await dock.close();
    });
  });
});
