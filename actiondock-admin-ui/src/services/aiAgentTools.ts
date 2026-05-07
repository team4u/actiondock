import type { AiAgentProfile, AiTool, AiToolset } from "../shared/types";

export type ToolConfigMap = Record<string, Record<string, unknown>>;

export interface AgentToolSourceRef {
  sourceType: "toolset" | "direct";
  sourceId: string;
  label: string;
  toolName: string;
  config: Record<string, unknown>;
}

export interface ResolvedAgentToolView {
  toolName: string;
  tool?: AiTool;
  config: Record<string, unknown>;
  sources: AgentToolSourceRef[];
}

export interface AgentToolConflictView {
  toolName: string;
  reason: "CONFIG_MISMATCH" | "MISSING_TOOL";
  sources: AgentToolSourceRef[];
}

export interface AgentToolResolutionView {
  effectiveTools: ResolvedAgentToolView[];
  conflicts: AgentToolConflictView[];
  mergedToolCount: number;
  selectedToolsetToolNames: string[];
  missingToolsetIds: string[];
  missingToolNames: string[];
}

export interface AgentToolSelectionInput {
  toolsetIds: string[];
  directToolNames: string[];
  directToolOptions?: ToolConfigMap;
}

export function cloneToolConfigMap(source?: ToolConfigMap): ToolConfigMap {
  const next: ToolConfigMap = {};
  Object.entries(source ?? {}).forEach(([name, value]) => {
    if (value && Object.keys(value).length > 0) {
      next[name] = { ...value };
    }
  });
  return next;
}

export function buildToolOptionsPayload(selectedNames: string[], toolOptionsByName: ToolConfigMap): ToolConfigMap {
  const payload: ToolConfigMap = {};
  selectedNames.forEach((name) => {
    const value = toolOptionsByName[name];
    if (value && Object.keys(value).length > 0) {
      payload[name] = { ...value };
    }
  });
  return payload;
}

export function resolveAgentToolSelection(
  selection: AgentToolSelectionInput,
  toolsets: AiToolset[],
  tools: AiTool[]
): AgentToolResolutionView {
  const toolsetById = new Map(toolsets.map((toolset) => [toolset.id, toolset]));
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const selectedToolsetToolNames = new Set<string>();
  const missingToolsetIds = new Set<string>();
  const missingToolNames = new Set<string>();
  const conflictByToolName = new Map<string, AgentToolConflictView>();
  const accumulatorByToolName = new Map<string, ToolAccumulator>();

  const addSource = (source: AgentToolSourceRef) => {
    const tool = toolByName.get(source.toolName);
    if (!tool) {
      missingToolNames.add(source.toolName);
      const existingConflict = conflictByToolName.get(source.toolName);
      if (existingConflict) {
        existingConflict.sources.push(source);
      } else {
        conflictByToolName.set(source.toolName, {
          toolName: source.toolName,
          reason: "MISSING_TOOL",
          sources: [source]
        });
      }
      return;
    }

    const existingConflict = conflictByToolName.get(source.toolName);
    if (existingConflict) {
      existingConflict.sources.push(source);
      return;
    }

    const accumulator = accumulatorByToolName.get(source.toolName);
    if (!accumulator) {
      accumulatorByToolName.set(source.toolName, {
        toolName: source.toolName,
        tool,
        config: source.config,
        canonicalConfig: canonicalize(source.config),
        sources: [source]
      });
      return;
    }

    if (accumulator.canonicalConfig === canonicalize(source.config)) {
      accumulator.sources.push(source);
      return;
    }

    conflictByToolName.set(source.toolName, {
      toolName: source.toolName,
      reason: "CONFIG_MISMATCH",
      sources: [...accumulator.sources, source]
    });
    accumulatorByToolName.delete(source.toolName);
  };

  selection.toolsetIds.forEach((toolsetId) => {
    const toolset = toolsetById.get(toolsetId);
    if (!toolset) {
      missingToolsetIds.add(toolsetId);
      return;
    }
    if (!toolset.enabled) {
      return;
    }
    toolset.toolNames.forEach((toolName) => {
      selectedToolsetToolNames.add(toolName);
      addSource({
        sourceType: "toolset",
        sourceId: toolset.id,
        label: `toolset:${toolset.id}`,
        toolName,
        config: normalizeConfig(toolset.toolOptions?.[toolName])
      });
    });
  });

  Array.from(new Set(selection.directToolNames)).forEach((toolName) => {
    addSource({
      sourceType: "direct",
      sourceId: "direct",
      label: "direct",
      toolName,
      config: normalizeConfig(selection.directToolOptions?.[toolName])
    });
  });

  const effectiveTools = Array.from(accumulatorByToolName.values()).map((item) => ({
    toolName: item.toolName,
    tool: item.tool,
    config: item.config,
    sources: item.sources
  }));

  const conflicts = Array.from(conflictByToolName.values());

  return {
    effectiveTools,
    conflicts,
    mergedToolCount: effectiveTools.filter((item) => item.sources.length > 1).length,
    selectedToolsetToolNames: Array.from(selectedToolsetToolNames),
    missingToolsetIds: Array.from(missingToolsetIds),
    missingToolNames: Array.from(missingToolNames)
  };
}

export function getAgentToolSummary(profile: Pick<AiAgentProfile, "toolsetIds" | "directToolNames" | "directToolOptions">, toolsets: AiToolset[], tools: AiTool[]) {
  return resolveAgentToolSelection({
    toolsetIds: profile.toolsetIds,
    directToolNames: profile.directToolNames,
    directToolOptions: profile.directToolOptions
  }, toolsets, tools);
}

function normalizeConfig(value?: Record<string, unknown>): Record<string, unknown> {
  return canonicalValue(value ?? {}) as Record<string, unknown>;
}

function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

interface ToolAccumulator {
  toolName: string;
  tool: AiTool;
  config: Record<string, unknown>;
  canonicalConfig: string;
  sources: AgentToolSourceRef[];
}
