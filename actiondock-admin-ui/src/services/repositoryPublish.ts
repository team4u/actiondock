import type { RepositoryDefinition } from "../shared/types";

export function getEnabledRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return repositories
    .filter((item) => item.enabled)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getPublishableRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return getEnabledRepositories(repositories)
    .filter((item) => item.type !== "HTTP");
}

export function pickDefaultPublishRepository(repositories: RepositoryDefinition[]): RepositoryDefinition | undefined {
  return repositories.find((repository) => repository.usage !== "DEVELOPMENT") ?? repositories[0];
}
