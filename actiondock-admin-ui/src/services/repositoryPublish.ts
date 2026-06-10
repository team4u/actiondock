import type { RepositoryDefinition } from "../shared/types";

export type RepositoryPublishVersionResolution =
  | { status: "NOT_FOUND" }
  | { status: "READY"; currentVersion: string; suggestedVersion: string }
  | { status: "MANUAL"; currentVersion: string };

export type RepositoryPublishVersionSuggestion =
  | { status: "IDLE" }
  | { status: "LOADING" }
  | { status: "NOT_FOUND" }
  | { status: "READY"; currentVersion: string; suggestedVersion: string; autoFilled: boolean }
  | { status: "MANUAL"; currentVersion: string }
  | { status: "ERROR"; message: string };

export function getEnabledRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return repositories
    .filter((item) => item.enabled && item.type !== "HTTP")
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getPublishableRepositories(repositories: RepositoryDefinition[]): RepositoryDefinition[] {
  return getEnabledRepositories(repositories).filter(
    (item) => (item.purpose ?? "CAPABILITY") === "CAPABILITY"
  );
}

export function pickDefaultPublishRepository(repositories: RepositoryDefinition[]): RepositoryDefinition | undefined {
  return repositories[0];
}

export function suggestNextRepositoryVersion(value?: string): string {
  if (!value) {
    return "0.1.0";
  }
  const parts = value.split(".");
  const last = Number(parts[parts.length - 1]);
  if (Number.isNaN(last)) {
    return value;
  }
  const next = [...parts];
  next[next.length - 1] = String(last + 1);
  return next.join(".");
}

export function resolveRepositoryPublishVersion<T extends { version?: string }>(
  items: T[],
  itemId: string,
  idSelector: (item: T) => string
): RepositoryPublishVersionResolution {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId) {
    return { status: "NOT_FOUND" };
  }
  const current = items.find((item) => idSelector(item) === normalizedItemId);
  if (!current?.version) {
    return { status: "NOT_FOUND" };
  }
  const suggestedVersion = suggestNextRepositoryVersion(current.version);
  if (suggestedVersion === current.version) {
    return { status: "MANUAL", currentVersion: current.version };
  }
  return {
    status: "READY",
    currentVersion: current.version,
    suggestedVersion
  };
}
