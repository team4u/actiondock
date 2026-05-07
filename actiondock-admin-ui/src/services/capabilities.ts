import type { CapabilityView, ScriptDefinition, ScriptType } from "../shared/types";

export function capabilityToScriptDefinition(capability: CapabilityView, target: "draft" | "published" = "draft"): ScriptDefinition {
  const binding = target === "published" ? capability.publishedBinding : capability.draftBinding;
  const publishedBinding = capability.publishedBinding;
    return {
      id: capability.id,
      name: binding?.name?.trim() || capability.name || capability.id,
      type: (binding?.runtime as ScriptType | undefined) ?? (capability.runtime as ScriptType | undefined) ?? "GROOVY",
      packaging: (binding?.packaging as ScriptDefinition["packaging"] | undefined) ?? "TOOL",
      source: binding?.source ?? "",
    pythonRequirements: binding?.pythonRequirements ?? undefined,
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
          name: publishedBinding.name?.trim() || capability.name || capability.id,
          type: (publishedBinding.runtime as ScriptType | undefined) ?? "GROOVY",
          packaging: (publishedBinding.packaging as ScriptDefinition["packaging"] | undefined) ?? "TOOL",
          source: publishedBinding.source ?? "",
          pythonRequirements: publishedBinding.pythonRequirements ?? undefined,
          inputSchema: publishedBinding.inputSchema ?? {},
          outputSchema: publishedBinding.outputSchema ?? {},
          owner: publishedBinding.owner ?? undefined,
          description: publishedBinding.description ?? undefined,
          tags: publishedBinding.tags ?? undefined,
          scriptDependencies: publishedBinding.scriptDependencies ?? undefined,
          pluginDependencies: publishedBinding.pluginDependencies ?? undefined,
          aiDependencies: publishedBinding.aiDependencies ?? undefined
        }
      : undefined,
    hasUnpublishedChanges: capability.hasUnpublishedChanges ?? false,
    createdAt: capability.createdAt,
    updatedAt: capability.updatedAt
  };
}
