import { describe, expect, it } from "bun:test";
import {
  compileIntentRegex,
  filterByIntent,
  filterWithFallbackInfo,
  matchIntent,
} from "../src/filter";

describe("Intent & Fuzzy Filter", () => {
  it("compiles single and multiple pattern strings", () => {
    const r1 = compileIntentRegex("user");
    expect(r1?.test("get-user")).toBe(true);
    expect(r1?.test("USER_PROFILE")).toBe(true);
    expect(r1?.test("post")).toBe(false);

    const r2 = compileIntentRegex(["pr", "issue"]);
    expect(r2?.test("list-prs")).toBe(true);
    expect(r2?.test("get-issue")).toBe(true);
    expect(r2?.test("deploy")).toBe(false);

    const r3 = compileIntentRegex("git.*(pr|issue)");
    expect(r3?.test("github-pr")).toBe(true);
    expect(r3?.test("git_fetch_issue")).toBe(true);

    // Invalid regex syntax safely falls back to literal match
    const r4 = compileIntentRegex("[invalid(regex");
    expect(r4?.test("[invalid(regex")).toBe(true);
    expect(r4?.test("other")).toBe(false);

    expect(compileIntentRegex("")).toBeNull();
    expect(compileIntentRegex([])).toBeNull();
    expect(compileIntentRegex(undefined)).toBeNull();
  });

  it("matches across various data types (string, array, object, number)", () => {
    const reg = /target/i;
    expect(matchIntent("this is a target string", reg)).toBe(true);
    expect(matchIntent(["sample", "target_item"], reg)).toBe(true);
    expect(matchIntent({ name: "my-target", value: 123 }, reg)).toBe(true);
    expect(matchIntent(12345, /234/)).toBe(true);
    expect(matchIntent(null, reg)).toBe(false);
    expect(matchIntent(undefined, reg)).toBe(false);
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
    expect(res1.map((i) => i.id)).toEqual([
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
    expect(res2.map((i) => i.id)).toEqual(["slack.post-msg", "deploy.k8s"]);
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
    expect(resFallback.isFallback).toBe(true);
    expect(resFallback.matchedCount).toBe(0);
    expect(resFallback.items.length).toBe(2);

    // With fallback disabled
    const resStrict = filterWithFallbackInfo(
      items,
      "nonexistent-pattern",
      [(i) => i.id, (i) => i.desc],
      false
    );
    expect(resStrict.isFallback).toBe(false);
    expect(resStrict.matchedCount).toBe(0);
    expect(resStrict.items.length).toBe(0);
  });
});
