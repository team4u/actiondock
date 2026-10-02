import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileIntentRegex,
  filterByIntent,
  filterWithFallbackInfo,
  matchIntent,
} from "../src/utils/intent";

describe("Intent & Fuzzy Filter", () => {
  it("compiles single and multiple pattern strings", () => {
    const r1 = compileIntentRegex("user");
    assert.strictEqual(r1?.test("get-user"), true);
    assert.strictEqual(r1?.test("USER_PROFILE"), true);
    assert.strictEqual(r1?.test("post"), false);

    const r2 = compileIntentRegex(["pr", "issue"]);
    assert.strictEqual(r2?.test("list-prs"), true);
    assert.strictEqual(r2?.test("get-issue"), true);
    assert.strictEqual(r2?.test("deploy"), false);

    const r3 = compileIntentRegex("re:git.*(pr|issue)");
    assert.strictEqual(r3?.test("github-pr"), true);
    assert.strictEqual(r3?.test("git_fetch_issue"), true);

    // 默认字面量模式：特殊字符按子串匹配，不构成正则
    const r3l = compileIntentRegex("git.*(pr|issue)");
    assert.strictEqual(r3l?.test("git.*(pr|issue)"), true);
    assert.strictEqual(r3l?.test("github-pr"), false);

    // re: 前缀但语法非法时安全降级为字面量匹配
    const r4 = compileIntentRegex("re:[invalid(regex");
    assert.strictEqual(r4?.test("[invalid(regex"), true);
    assert.strictEqual(r4?.test("other"), false);

    assert.strictEqual(compileIntentRegex(""), null);
    assert.strictEqual(compileIntentRegex([]), null);
    assert.strictEqual(compileIntentRegex(undefined), null);
  });

  it("matches across various data types (string, array, object, number)", () => {
    const reg = /target/i;
    assert.strictEqual(matchIntent("this is a target string", reg), true);
    assert.strictEqual(matchIntent(["sample", "target_item"], reg), true);
    assert.strictEqual(matchIntent({ name: "my-target", value: 123 }, reg), true);
    assert.strictEqual(matchIntent(12345, /234/), true);
    assert.strictEqual(matchIntent(null, reg), false);
    assert.strictEqual(matchIntent(undefined, reg), false);
  });

  it("filters items by multiple extractors", () => {
    const items = [
      { id: "github.list-prs", desc: "List pull requests", tags: ["git", "pr"] },
      { id: "github.get-pr", desc: "Get single PR details", tags: ["git"] },
      { id: "slack.post-msg", desc: "Send Slack alert", tags: ["notify"] },
      { id: "deploy.k8s", desc: "Deploy to Kubernetes", tags: ["infra", "deploy"] },
    ];

    // Search by ID or description or tags with pipe regex
    const res1 = filterByIntent(
      items,
      "pr|deploy",
      [(i) => i.id, (i) => i.desc, (i) => i.tags],
      false
    );
    assert.deepStrictEqual(res1.map((i) => i.id), [
      "github.list-prs",
      "github.get-pr",
      "deploy.k8s",
    ]);

    // Search by positional tokens
    const res2 = filterByIntent(
      items,
      ["slack", "k8s"],
      [(i) => i.id, (i) => i.desc, (i) => i.tags],
      false
    );
    assert.deepStrictEqual(res2.map((i) => i.id), ["slack.post-msg", "deploy.k8s"]);
  });

  it("handles fallback behavior when 0 items match", () => {
    const items = [
      { id: "action-1", desc: "First action" },
      { id: "action-2", desc: "Second action" },
    ];

    // With fallback enabled (default)
    const resFallback = filterWithFallbackInfo(
      items,
      "nonexistent-pattern",
      [(i) => i.id, (i) => i.desc],
      true
    );
    assert.strictEqual(resFallback.isFallback, true);
    assert.strictEqual(resFallback.matchedCount, 0);
    assert.strictEqual(resFallback.items.length, 2);

    // With fallback disabled
    const resStrict = filterWithFallbackInfo(
      items,
      "nonexistent-pattern",
      [(i) => i.id, (i) => i.desc],
      false
    );
    assert.strictEqual(resStrict.isFallback, false);
    assert.strictEqual(resStrict.matchedCount, 0);
    assert.strictEqual(resStrict.items.length, 0);
  });
});
