import type { ScriptDefinition } from "./types";

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema ?? {})) as Record<string, unknown>;
}

export function suggestDuplicateScriptId(sourceId: string, existingIds: Iterable<string>): string {
  const normalizedSourceId = sourceId.trim();
  const knownIds = new Set(existingIds);
  const baseId = `${normalizedSourceId}-copy`;

  if (!knownIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (knownIds.has(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

export function buildDuplicatedScriptDefinition(
  source: ScriptDefinition,
  existingIds: Iterable<string>
): ScriptDefinition {
  const baseName = source.name.trim() || source.id;

  return {
    id: suggestDuplicateScriptId(source.id, existingIds),
    name: `${baseName} 副本`,
    type: source.type,
    source: source.source,
    inputSchema: cloneSchema(source.inputSchema),
    outputSchema: cloneSchema(source.outputSchema),
    status: "DRAFT",
    version: 1
  };
}
