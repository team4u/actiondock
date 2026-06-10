import type { RepositoryDefinition, RepositoryScriptDescriptor, ScriptDependency } from "../shared/types";

const SCRIPT_INVOKE_PATTERN = /scripts\s*\.\s*invoke\s*\(\s*(["'`])([^"'`]+)\1/g;
const SCRIPT_INVOKE_ANY_PATTERN = /scripts\s*\.\s*invoke\s*\(/g;

export interface DetectedScriptDependency {
  scriptId: string;
}

export function extractScriptDependenciesFromSource(source: string): DetectedScriptDependency[] {
  if (!source.trim()) {
    return [];
  }

  const scriptIds = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = SCRIPT_INVOKE_PATTERN.exec(source)) !== null) {
    const scriptId = match[2].trim();
    if (scriptId) {
      scriptIds.add(scriptId);
    }
  }

  return [...scriptIds].map((scriptId) => ({ scriptId }));
}

export function hasDynamicScriptDependencies(source: string): boolean {
  if (!source.trim()) {
    return false;
  }
  const totalInvocations = [...source.matchAll(SCRIPT_INVOKE_ANY_PATTERN)].length;
  const literalInvocations = [...source.matchAll(SCRIPT_INVOKE_PATTERN)].length;
  return totalInvocations !== literalInvocations;
}

export function normalizeScriptDependencies(dependencies: ScriptDependency[]): ScriptDependency[] {
  return dependencies
    .map((item) => ({
      scriptId: item.scriptId.trim(),
      repositoryId: item.repositoryId.trim(),
      repositoryScriptId: item.repositoryScriptId.trim(),
      versionRange: item.versionRange?.trim() || undefined
    }))
    .filter((item) => item.scriptId && item.repositoryId && item.repositoryScriptId);
}

function getPreferredRepositoryIds(
  repositories: Pick<RepositoryDefinition, "id">[],
  preferredRepositoryId?: string
): string[] {
  const orderedIds = repositories.map((item) => item.id);
  if (!preferredRepositoryId) {
    return orderedIds;
  }
  return [
    preferredRepositoryId,
    ...orderedIds.filter((repositoryId) => repositoryId !== preferredRepositoryId)
  ];
}

export function autoMatchScriptDependency(
  scriptId: string,
  repositories: Pick<RepositoryDefinition, "id">[],
  repositoryTools: Pick<RepositoryScriptDescriptor, "repositoryId" | "scriptId" | "version">[],
  preferredRepositoryId?: string
): ScriptDependency | undefined {
  const normalizedScriptId = scriptId.trim();
  if (!normalizedScriptId) {
    return undefined;
  }

  const repositoryIds = getPreferredRepositoryIds(repositories, preferredRepositoryId);
  for (const repositoryId of repositoryIds) {
    const matched = repositoryTools.find(
      (item) => item.repositoryId === repositoryId && item.scriptId === normalizedScriptId
    );
    if (!matched) {
      continue;
    }
    return {
      scriptId: normalizedScriptId,
      repositoryId,
      repositoryScriptId: matched.scriptId,
      versionRange: matched.version ? `>= ${matched.version}` : undefined
    };
  }
  return undefined;
}

export interface ScriptDependencyLocalSource {
  repositoryId?: string | null;
  repositoryScriptId?: string | null;
  repositoryVersion?: string | null;
}

export interface ResolveAutoScriptDependencyOptions {
  scriptId: string;
  repositories: Pick<RepositoryDefinition, "id">[];
  repositoryTools: Pick<RepositoryScriptDescriptor, "repositoryId" | "scriptId" | "version">[];
  preferredRepositoryId?: string;
  declaredDependency?: Pick<ScriptDependency, "repositoryId" | "repositoryScriptId" | "versionRange"> | null;
  localScriptSource?: ScriptDependencyLocalSource | null;
}

function resolveRepositoryToolVersionRange(
  versionRange: string | undefined,
  version: string | undefined | null
): string | undefined {
  if (versionRange?.trim()) {
    return versionRange.trim();
  }
  return version?.trim() ? `>= ${version.trim()}` : undefined;
}

function toMatchedDependency(
  scriptId: string,
  repositoryId: string | undefined | null,
  repositoryScriptId: string | undefined | null,
  versionRange?: string,
  repositoryVersion?: string | null
): ScriptDependency | undefined {
  const normalizedScriptId = scriptId.trim();
  const normalizedRepositoryId = repositoryId?.trim();
  const normalizedToolId = repositoryScriptId?.trim();
  if (!normalizedScriptId || !normalizedRepositoryId || !normalizedToolId) {
    return undefined;
  }
  return {
    scriptId: normalizedScriptId,
    repositoryId: normalizedRepositoryId,
    repositoryScriptId: normalizedToolId,
    versionRange: resolveRepositoryToolVersionRange(versionRange, repositoryVersion)
  };
}

export function resolveAutoScriptDependency({
  scriptId,
  repositories,
  repositoryTools,
  preferredRepositoryId,
  declaredDependency,
  localScriptSource
}: ResolveAutoScriptDependencyOptions): ScriptDependency | undefined {
  const normalizedScriptId = scriptId.trim();
  if (!normalizedScriptId) {
    return undefined;
  }

  const preferredTool = preferredRepositoryId
    ? repositoryTools.find(
        (item) => item.repositoryId === preferredRepositoryId && item.scriptId === normalizedScriptId
      )
    : undefined;
  const preferredMatch = preferredTool
    ? toMatchedDependency(
        normalizedScriptId,
        preferredTool.repositoryId,
        preferredTool.scriptId,
        undefined,
        preferredTool.version
      )
    : undefined;
  if (preferredMatch) {
    return preferredMatch;
  }

  const declaredMatch = toMatchedDependency(
    normalizedScriptId,
    declaredDependency?.repositoryId,
    declaredDependency?.repositoryScriptId,
    declaredDependency?.versionRange
  );
  if (declaredMatch) {
    return declaredMatch;
  }

  const localSourceMatch = toMatchedDependency(
    normalizedScriptId,
    localScriptSource?.repositoryId,
    localScriptSource?.repositoryScriptId,
    undefined,
    localScriptSource?.repositoryVersion
  );
  if (localSourceMatch) {
    return localSourceMatch;
  }

  return autoMatchScriptDependency(normalizedScriptId, repositories, repositoryTools, preferredRepositoryId);
}
