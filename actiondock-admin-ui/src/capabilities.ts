import type { CapabilityView, ScriptDefinition, ScriptType } from "./types";

export function capabilityToScriptDefinition(capability: CapabilityView, target: "draft" | "published" = "draft"): ScriptDefinition {
  const binding = target === "published" ? capability.publishedBinding : capability.draftBinding;
  const draftBinding = capability.draftBinding;
  const publishedBinding = capability.publishedBinding;
  return {
    id: capability.id,
    name: capability.name ?? capability.id,
    type: (binding?.runtime as ScriptType | undefined) ?? (capability.runtime as ScriptType | undefined) ?? "GROOVY",
    packaging: (binding?.packaging as ScriptDefinition["packaging"] | undefined) ?? "TOOL",
    source: binding?.source ?? "",
    pythonRequirements: undefined,
    inputSchema: binding?.inputSchema ?? {},
    outputSchema: binding?.outputSchema ?? {},
    status: publishedBinding ? "PUBLISHED" : "DRAFT",
    version: capability.version ?? 1,
    scope: capability.scope as ScriptDefinition["scope"] | undefined,
    owner: capability.owner,
    description: capability.description,
    tags: capability.tags ?? [],
    publishedSnapshot: publishedBinding
      ? {
          name: capability.name ?? capability.id,
          type: (publishedBinding.runtime as ScriptType | undefined) ?? "GROOVY",
          packaging: (publishedBinding.packaging as ScriptDefinition["packaging"] | undefined) ?? "TOOL",
          source: publishedBinding.source ?? "",
          inputSchema: publishedBinding.inputSchema ?? {},
          outputSchema: publishedBinding.outputSchema ?? {}
        }
      : undefined,
    hasUnpublishedChanges: Boolean(draftBinding && publishedBinding && JSON.stringify(draftBinding) !== JSON.stringify(publishedBinding)),
    createdAt: capability.createdAt,
    updatedAt: capability.updatedAt
  };
}
