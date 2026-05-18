import { describe, expect, it } from "vitest";
import {
  buildSkillManagementSearch,
  resolveSkillManagementTab
} from "./skillRouting";

describe("skill routing helpers", () => {
  it("defaults to skills when tab is missing or invalid", () => {
    expect(resolveSkillManagementTab("")).toBe("skills");
    expect(resolveSkillManagementTab("?tab=unknown")).toBe("skills");
  });

  it("resolves known tabs from search params", () => {
    expect(resolveSkillManagementTab("?tab=targets")).toBe("targets");
    expect(resolveSkillManagementTab(new URLSearchParams("tab=skills"))).toBe("skills");
  });

  it("builds the canonical skill management search string", () => {
    expect(buildSkillManagementSearch("targets")).toBe("?tab=targets");
  });
});
