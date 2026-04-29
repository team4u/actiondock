import type { RepositoryDefinition } from "./types";

export function getPublishableRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return repositories
    .filter((item) => item.enabled && item.type !== "HTTP")
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function pickDefaultPublishRepository(repositories: RepositoryDefinition[]): RepositoryDefinition | undefined {
  return repositories.find((repository) => repository.usage !== "DEVELOPMENT") ?? repositories[0];
}
