import type {
  Playbook,
  PlaybookAgentSkillRef,
  PlaybookRelatedRef,
  PlaybookScriptRef,
  ScriptDefinition
} from "../shared/types";

export interface PlaybookFormValues {
  id: string;
  name: string;
  description?: string;
  tagsText?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  repositoryIds?: string[];
  scriptRefs?: PlaybookScriptRef[];
  agentSkillRefs?: PlaybookAgentSkillRef[];
  relatedPlaybookRefs?: PlaybookRelatedRef[];
  guideMarkdown?: string;
  stopConditionsText?: string;
  enabled?: boolean;
}

export interface KnowledgeEditorState {
  repositoryId: string;
  notes: string[];
  files: string[];
}

export function splitText(value?: string): string[] {
  return value?.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

export function toKnowledgeEditorState(repositoryIds: string[], refs: Playbook["knowledgeRefs"]): KnowledgeEditorState[] {
  return repositoryIds.map((repositoryId) => {
    const notes = refs
      .filter((ref) => ref.repositoryId === repositoryId && ref.type === "NOTE" && ref.markdown)
      .map((ref) => ref.markdown?.trim() ?? "")
      .filter(Boolean);
    const files = refs
      .filter((ref) => ref.repositoryId === repositoryId && ref.type === "FILE" && ref.path)
      .map((ref) => ref.path?.trim() ?? "")
      .filter(Boolean);
    return { repositoryId, notes, files };
  });
}

export function fromKnowledgeEditorState(groups: KnowledgeEditorState[]): Playbook["knowledgeRefs"] {
  return groups.flatMap((group) => [
    ...group.notes
      .map((markdown) => markdown.trim())
      .filter(Boolean)
      .map((markdown) => ({ type: "NOTE" as const, repositoryId: group.repositoryId, markdown })),
    ...group.files
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => ({ type: "FILE" as const, repositoryId: group.repositoryId, path }))
  ]);
}

export function upsertKnowledgeGroups(previous: KnowledgeEditorState[], repositoryIds: string[]): KnowledgeEditorState[] {
  const next = repositoryIds.map((repositoryId) => previous.find((item) => item.repositoryId === repositoryId) ?? { repositoryId, notes: [], files: [] });
  return next.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
}

function hasField(values: Partial<PlaybookFormValues>, key: keyof PlaybookFormValues): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function buildScriptRefs(values: Partial<PlaybookFormValues>, scripts: ScriptDefinition[], editing?: Playbook | null): PlaybookScriptRef[] {
  if (!hasField(values, "scriptRefs")) {
    return editing?.scriptRefs ?? [];
  }
  return (values.scriptRefs ?? []).map((ref) => {
    const scriptId = ref.scriptId;
    const script = scripts.find((item) => item.id === scriptId);
    return {
      scriptId,
      purpose: ref.purpose?.trim() || script?.name || ""
    };
  });
}

function buildAgentSkillRefs(values: Partial<PlaybookFormValues>, editing?: Playbook | null): PlaybookAgentSkillRef[] {
  if (!hasField(values, "agentSkillRefs")) {
    return editing?.agentSkillRefs ?? [];
  }
  return (values.agentSkillRefs ?? []).map((ref) => ({
    skillId: ref.skillId.trim(),
    purpose: ref.purpose?.trim() || undefined,
    required: Boolean(ref.required)
  }));
}

function buildRelatedPlaybookRefs(values: Partial<PlaybookFormValues>, editing?: Playbook | null): PlaybookRelatedRef[] {
  if (!hasField(values, "relatedPlaybookRefs")) {
    return editing?.relatedPlaybookRefs ?? [];
  }
  return (values.relatedPlaybookRefs ?? []).map((ref) => ({
    playbookId: ref.playbookId.trim(),
    relation: ref.relation ?? "RELATED",
    purpose: ref.purpose?.trim() || undefined
  }));
}

export function buildPlaybookSavePayload({
  values,
  knowledgeEditor,
  scripts,
  editing
}: {
  values: Partial<PlaybookFormValues>;
  knowledgeEditor: KnowledgeEditorState[];
  scripts: ScriptDefinition[];
  editing?: Playbook | null;
}): Playbook {
  const repositoryIds = hasField(values, "repositoryIds")
    ? values.repositoryIds ?? []
    : editing?.repositoryIds ?? [];
  const repositoryIdSet = new Set(repositoryIds);

  return {
    id: (hasField(values, "id") ? values.id ?? "" : editing?.id ?? "").trim(),
    name: (hasField(values, "name") ? values.name ?? "" : editing?.name ?? "").trim(),
    description: hasField(values, "description")
      ? values.description?.trim() || undefined
      : editing?.description,
    tags: hasField(values, "tagsText") ? splitText(values.tagsText) : editing?.tags ?? [],
    riskLevel: hasField(values, "riskLevel") ? values.riskLevel : editing?.riskLevel,
    repositoryIds,
    knowledgeRefs: fromKnowledgeEditorState(knowledgeEditor.filter((group) => repositoryIdSet.has(group.repositoryId))),
    scriptRefs: buildScriptRefs(values, scripts, editing),
    agentSkillRefs: buildAgentSkillRefs(values, editing),
    relatedPlaybookRefs: buildRelatedPlaybookRefs(values, editing),
    guideMarkdown: hasField(values, "guideMarkdown") ? values.guideMarkdown ?? "" : editing?.guideMarkdown ?? "",
    stopConditions: hasField(values, "stopConditionsText") ? splitText(values.stopConditionsText) : editing?.stopConditions ?? [],
    enabled: hasField(values, "enabled") ? values.enabled ?? true : editing?.enabled ?? true,
    managed: editing?.managed ?? false
  };
}
