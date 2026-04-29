import { describe, expect, it } from "vitest";
import { getPublishableRepositories, pickDefaultPublishRepository } from "./repositoryPublish";
import type { RepositoryDefinition } from "./types";

function repository(overrides: Partial<RepositoryDefinition>): RepositoryDefinition {
  return {
    id: "repo",
    name: "Repo",
    type: "GIT",
    url: "https://example.com/repo.git",
    branch: "main",
    enabled: true,
    trustLevel: "UNTRUSTED",
    usage: "DISTRIBUTION",
    ...overrides
  };
}

describe("repositoryPublish", () => {
  it("filters non-publishable repositories and sorts by id", () => {
    const repositories = getPublishableRepositories([
      repository({ id: "b" }),
      repository({ id: "c", enabled: false }),
      repository({ id: "a", type: "LOCAL_DIR" }),
      repository({ id: "d", type: "HTTP" })
    ]);

    expect(repositories.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("prefers non-development repositories as publish default", () => {
    const repositories = [
      repository({ id: "dev", usage: "DEVELOPMENT" }),
      repository({ id: "dist", usage: "DISTRIBUTION" })
    ];

    expect(pickDefaultPublishRepository(repositories)?.id).toBe("dist");
  });
});
