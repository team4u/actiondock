import type { ScriptDependency } from "./types";

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
      toolId: item.toolId.trim(),
      versionRange: item.versionRange?.trim() || undefined
    }))
    .filter((item) => item.scriptId && item.repositoryId && item.toolId);
}
