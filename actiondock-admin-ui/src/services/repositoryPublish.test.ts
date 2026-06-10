import { describe, expect, it } from "vitest";
import {
  getEnabledRepositories,
  getPublishableRepositories,
  pickDefaultPublishRepository,
  resolveRepositoryPublishVersion,
  suggestNextRepositoryVersion
} from "./repositoryPublish";
import type { RepositoryDefinition } from "../shared/types";

function repository(overrides: Partial<RepositoryDefinition>): RepositoryDefinition {
  return {
    id: "repo",
    name: "Repo",
    type: "GIT",
    url: "https://example.com/repo.git",
    branch: "main",
    enabled: true,
    trustLevel: "UNTRUSTED",
    ...overrides
  };
}

describe("repositoryPublish", () => {
  it("filters enabled repositories and sorts by id", () => {
    const repositories = getEnabledRepositories([
      repository({ id: "b" }),
      repository({ id: "c", enabled: false }),
      repository({ id: "a", type: "LOCAL_DIR" }),
      repository({ id: "d", type: "HTTP" })
    ]);

    expect(repositories.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("filters non-publishable repositories and excludes PROJECT purpose", () => {
    const repositories = getPublishableRepositories([
      repository({ id: "b" }),
      repository({ id: "c", enabled: false }),
      repository({ id: "a", type: "LOCAL_DIR" }),
      repository({ id: "d", type: "HTTP" }),
      repository({ id: "e", purpose: "PROJECT" }),
      repository({ id: "f", purpose: "CAPABILITY" })
    ]);

    expect(repositories.map((item) => item.id)).toEqual(["a", "b", "f"]);
  });

  it("uses the first publishable repository as publish default", () => {
    const repositories = [
      repository({ id: "alpha" }),
      repository({ id: "beta" })
    ];

    expect(pickDefaultPublishRepository(repositories)?.id).toBe("alpha");
  });

  it("uses 0.1.0 as the first repository version", () => {
    expect(suggestNextRepositoryVersion()).toBe("0.1.0");
  });

  it("increments the last numeric version segment", () => {
    expect(suggestNextRepositoryVersion("1.0.9")).toBe("1.0.10");
  });

  it("keeps non-numeric suffix versions unchanged", () => {
    expect(suggestNextRepositoryVersion("1.0.0-beta")).toBe("1.0.0-beta");
  });

  it("suggests the next patch version for an existing repository item", () => {
    expect(resolveRepositoryPublishVersion(
      [
        { skillId: "demo-skill", version: "1.0.0" },
        { skillId: "manual-skill", version: "1.0.0-beta" }
      ],
      "demo-skill",
      (item) => item.skillId
    )).toEqual({
      status: "READY",
      currentVersion: "1.0.0",
      suggestedVersion: "1.0.1"
    });
  });

  it("does not suggest a version when the repository has no matching item", () => {
    expect(resolveRepositoryPublishVersion(
      [{ skillId: "demo-skill", version: "1.0.0" }],
      "missing-skill",
      (item) => item.skillId
    )).toEqual({ status: "NOT_FOUND" });
  });

  it("asks for manual input when the current repository version cannot be incremented", () => {
    expect(resolveRepositoryPublishVersion(
      [{ skillId: "manual-skill", version: "1.0.0-beta" }],
      "manual-skill",
      (item) => item.skillId
    )).toEqual({
      status: "MANUAL",
      currentVersion: "1.0.0-beta"
    });
  });
});
