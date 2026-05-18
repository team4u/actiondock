import type {
  PublishedScriptRevision,
  ScriptDefinition,
  ScriptPublicationState
} from "../shared/types";

export function isScriptPublished(script: ScriptDefinition | null | undefined): boolean {
  return Boolean(script?.publication?.published ?? script?.published);
}

export function hasScriptDraftChanges(script: ScriptDefinition | null | undefined): boolean {
  return Boolean(script?.publication?.dirty);
}

export function getPublishedScriptContent(script: ScriptDefinition | null | undefined): PublishedScriptRevision | null {
  if (!script) {
    return null;
  }
  return script.published ?? null;
}

export function toPublishedScriptDefinition(script: ScriptDefinition | null | undefined): ScriptDefinition | null {
  const published = getPublishedScriptContent(script);
  if (!script || !published) {
    return null;
  }
  return normalizeScriptDefinition({
    ...script,
    name: published.name,
    type: published.type,
    packaging: published.packaging,
    source: published.source,
    pythonRequirements: published.pythonRequirements,
    inputSchema: published.inputSchema,
    outputSchema: published.outputSchema,
    owner: published.owner,
    description: published.description,
    tags: published.tags,
    scriptDependencies: published.scriptDependencies,
    pluginDependencies: published.pluginDependencies,
    aiDependencies: published.aiDependencies,
    publication: {
      published: true,
      dirty: false,
      publishedVersion: published.version,
      publishedAt: published.publishedAt
    }
  });
}

export function fromPublishedScriptRevision(
  revision: PublishedScriptRevision | null | undefined,
  fallbackScriptId?: string
): ScriptDefinition | null {
  if (!revision) {
    return null;
  }
  return normalizeScriptDefinition({
    id: revision.scriptId || fallbackScriptId || "",
    name: revision.name,
    type: revision.type,
    packaging: revision.packaging,
    source: revision.source,
    pythonRequirements: revision.pythonRequirements,
    inputSchema: revision.inputSchema,
    outputSchema: revision.outputSchema,
    version: revision.version,
    owner: revision.owner,
    description: revision.description,
    tags: revision.tags,
    scriptDependencies: revision.scriptDependencies,
    pluginDependencies: revision.pluginDependencies,
    aiDependencies: revision.aiDependencies,
    published: revision,
    publication: {
      published: true,
      dirty: false,
      publishedVersion: revision.version,
      publishedAt: revision.publishedAt
    }
  });
}

export function normalizeScriptDefinitions(scripts: ScriptDefinition[]): ScriptDefinition[] {
  return scripts.map((script) => normalizeScriptDefinition(script));
}

export function normalizeScriptDefinition(script: ScriptDefinition): ScriptDefinition {
  const published = getPublishedScriptContent(script);
  const publishedFlag = Boolean(script.publication?.published ?? published);
  const dirty = Boolean(script.publication?.dirty);
  const publication: ScriptPublicationState = {
    published: publishedFlag,
    dirty,
    publishedVersion: script.publication?.publishedVersion ?? published?.version,
    publishedAt: script.publication?.publishedAt ?? published?.publishedAt
  };

  return {
    ...script,
    published: published ?? null,
    publication
  };
}
