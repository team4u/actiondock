import { describe, expect, it } from "vitest";
import { normalizeRepositoryId, suggestRepositoryId } from "./repositoryId";

describe("normalizeRepositoryId", () => {
  it("normalizes casing and invalid characters", () => {
    expect(normalizeRepositoryId(" Team Repo__Prod ")).toBe("team-repo-prod");
  });

  it("trims duplicate separators at the edges", () => {
    expect(normalizeRepositoryId("..repo---name__")).toBe("repo-name");
  });
});

describe("suggestRepositoryId", () => {
  it("derives the repository id from the git url basename", () => {
    expect(suggestRepositoryId("GIT", "git@github.com:team/My-Repo.git")).toBe("my-repo");
  });

  it("derives the repository id from the local directory basename", () => {
    expect(suggestRepositoryId("LOCAL_DIR", "/Users/demo/Action Dock Repo")).toBe("action-dock-repo");
  });

  it("returns an empty id for unsupported repository types", () => {
    expect(suggestRepositoryId("HTTP", "https://example.com/repo")).toBe("");
  });
});
