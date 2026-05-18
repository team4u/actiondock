import { describe, expect, it } from "vitest";
import { getEnabledRepositories, getPublishableRepositories, pickDefaultPublishRepository } from "./repositoryPublish";
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

  it("filters non-publishable repositories and sorts by id", () => {
    const repositories = getPublishableRepositories([
      repository({ id: "b" }),
      repository({ id: "c", enabled: false }),
      repository({ id: "a", type: "LOCAL_DIR" }),
      repository({ id: "d", type: "HTTP" })
    ]);

    expect(repositories.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("uses the first publishable repository as publish default", () => {
    const repositories = [
      repository({ id: "alpha" }),
      repository({ id: "beta" })
    ];

    expect(pickDefaultPublishRepository(repositories)?.id).toBe("alpha");
  });
});
