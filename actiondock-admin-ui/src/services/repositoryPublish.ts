import type { RepositoryDefinition } from "../shared/types";

export function getEnabledRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return repositories
    .filter((item) => item.enabled && item.type !== "HTTP")
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getPublishableRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return getEnabledRepositories(repositories);
}

export function pickDefaultPublishRepository(repositories: RepositoryDefinition[]): RepositoryDefinition | undefined {
  return repositories[0];
}
