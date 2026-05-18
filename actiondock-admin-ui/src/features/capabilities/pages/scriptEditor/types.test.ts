import { describe, expect, it } from "vitest";
import { resolveRepositoryPublishVersion, suggestNextRepositoryVersion } from "./types";

describe("suggestNextRepositoryVersion", () => {
  it("uses 0.1.0 as the first repository version", () => {
    expect(suggestNextRepositoryVersion()).toBe("0.1.0");
  });

  it("increments the last numeric version segment", () => {
    expect(suggestNextRepositoryVersion("1.0.9")).toBe("1.0.10");
  });

  it("keeps non-numeric suffix versions unchanged", () => {
    expect(suggestNextRepositoryVersion("1.0.0-beta")).toBe("1.0.0-beta");
  });
});

describe("resolveRepositoryPublishVersion", () => {
  const tools = [
    { scriptId: "demo-tool", version: "1.0.0" },
    { scriptId: "manual-tool", version: "1.0.0-beta" }
  ];

  it("suggests the next patch version for an existing repository tool", () => {
    expect(resolveRepositoryPublishVersion(tools, "demo-tool")).toEqual({
      status: "READY",
      currentVersion: "1.0.0",
      suggestedVersion: "1.0.1"
    });
  });

  it("does not suggest a version when the repository has no matching tool", () => {
    expect(resolveRepositoryPublishVersion(tools, "missing-tool")).toEqual({ status: "NOT_FOUND" });
  });

  it("asks for manual input when the current repository version cannot be incremented", () => {
    expect(resolveRepositoryPublishVersion(tools, "manual-tool")).toEqual({
      status: "MANUAL",
      currentVersion: "1.0.0-beta"
    });
  });
});
