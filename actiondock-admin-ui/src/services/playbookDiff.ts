import { diffLines } from "diff";
import { maxRisk, type MetadataDiffSummary, type RiskLevel, type SourceDiffSummary } from "./scriptDiff";
import type {
  Playbook,
  PlaybookAgentSkillRef,
  PlaybookKnowledgeRef,
  PlaybookRelatedRef,
  PlaybookScriptRef,
  RepositoryPlaybookDetail
} from "../shared/types";

export type PlaybookDiffComparisonMode = "INITIAL" | "COMPARE";

export type PlaybookDiffTabKey =
  | "guideMarkdown"
  | "metadata"
  | "stopConditions"
  | "knowledgeRefs"
  | "scriptRefs"
  | "agentSkillRefs"
  | "relatedPlaybookRefs";

export interface PlaybookDiffTarget {
  name: string;
  description?: string;
  tags: string[];
  riskLevel?: RiskLevel;
  enabled: boolean;
  guideMarkdown: string;
  stopConditions: string[];
  knowledgeRefs: PlaybookKnowledgeRef[];
  scriptRefs: PlaybookScriptRef[];
  agentSkillRefs: PlaybookAgentSkillRef[];
  relatedPlaybookRefs: PlaybookRelatedRef[];
}

export interface ListDiffSummary {
  available: boolean;
  changed: boolean;
  risk: RiskLevel;
  added: string[];
  removed: string[];
}

export interface StructuredPropertyChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  risk: RiskLevel;
}

export interface StructuredItemModification {
  id: string;
  label: string;
  changes: StructuredPropertyChange[];
}

export interface StructuredDiffSummary {
  available: boolean;
  changed: boolean;
  risk: RiskLevel;
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  modified: StructuredItemModification[];
}

export interface PlaybookDiffResult {
  comparisonMode: PlaybookDiffComparisonMode;
  hasChanges: boolean;
  riskLevel: RiskLevel;
  highlights: string[];
  warnings: string[];
  tabs: PlaybookDiffTabKey[];
  guideMarkdown: SourceDiffSummary;
  metadata: MetadataDiffSummary;
  stopConditions: ListDiffSummary;
  knowledgeRefs: StructuredDiffSummary;
  scriptRefs: StructuredDiffSummary;
  agentSkillRefs: StructuredDiffSummary;
  relatedPlaybookRefs: StructuredDiffSummary;
}

const HIGH_RISK_SOURCE_KEYWORDS = ["delete", "drop", "truncate", "production"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function diffGuideMarkdown(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): SourceDiffSummary {
  const original = base?.guideMarkdown ?? "";
  const modified = target.guideMarkdown;
  const comparisonMode: PlaybookDiffComparisonMode = base ? "COMPARE" : "INITIAL";

  if (comparisonMode === "INITIAL") {
    return {
      available: true,
      changed: true,
      risk: "LOW",
      addedLines: modified.split("\n").length,
      removedLines: 0,
      original,
      modified,
      matchedHighRiskKeywords: []
    };
  }

  const parts = diffLines(original, modified);
  let addedLines = 0;
  let removedLines = 0;
  for (const part of parts) {
    if (part.added) {
      addedLines += part.count ?? 0;
    } else if (part.removed) {
      removedLines += part.count ?? 0;
    }
  }
  const changed = addedLines > 0 || removedLines > 0;
  const matched = HIGH_RISK_SOURCE_KEYWORDS.filter((keyword) => {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    return re.test(modified) && !re.test(original);
  });
  return {
    available: true,
    changed,
    risk: matched.length > 0 ? "MEDIUM" : "LOW",
    addedLines,
    removedLines,
    original,
    modified,
    matchedHighRiskKeywords: matched
  };
}

function diffPlaybookMetadata(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): MetadataDiffSummary {
  const fields: Array<{
    field: string;
    label: string;
    before: unknown;
    after: unknown;
    risk: RiskLevel;
  }> = [];

  const compare = (
    field: string,
    label: string,
    before: unknown,
    after: unknown,
    risk: RiskLevel
  ) => {
    if (!sameValue(before, after)) {
      fields.push({ field, label, before, after, risk });
    }
  };

  if (!base) {
    const changes: Array<{
      field: string;
      label: string;
      before: unknown;
      after: unknown;
      risk: RiskLevel;
    }> = [
      { field: "name", label: "名称", before: undefined, after: target.name, risk: "LOW" }
    ];
    if (target.description !== undefined) {
      changes.push({ field: "description", label: "描述", before: undefined, after: target.description, risk: "LOW" });
    }
    if (target.tags.length > 0) {
      changes.push({ field: "tags", label: "标签", before: undefined, after: target.tags, risk: "LOW" });
    }
    if (target.riskLevel) {
      changes.push({ field: "riskLevel", label: "风险等级", before: undefined, after: target.riskLevel, risk: "MEDIUM" });
    }
    changes.push({ field: "enabled", label: "启用", before: undefined, after: target.enabled, risk: "LOW" });
    return {
      available: true,
      changed: true,
      risk: "LOW",
      changes
    };
  }

  compare("name", "名称", base.name, target.name, "LOW");
  compare("description", "描述", base.description, target.description, "LOW");
  compare("tags", "标签", base.tags, target.tags, "LOW");
  compare("riskLevel", "风险等级", base.riskLevel, target.riskLevel, "MEDIUM");
  compare("enabled", "启用", base.enabled, target.enabled, "LOW");

  return {
    available: true,
    changed: fields.length > 0,
    risk: maxRisk(...fields.map((change) => change.risk)),
    changes: fields
  };
}

function diffStringList(
  base: string[] | undefined,
  target: string[]
): ListDiffSummary {
  const before = new Set(base ?? []);
  const after = new Set(target);
  const added: string[] = [];
  const removed: string[] = [];
  for (const item of after) {
    if (!before.has(item)) {
      added.push(item);
    }
  }
  for (const item of before) {
    if (!after.has(item)) {
      removed.push(item);
    }
  }
  const changed = added.length > 0 || removed.length > 0;
  return {
    available: true,
    changed,
    risk: removed.length > 0 ? "MEDIUM" : "LOW",
    added,
    removed
  };
}

function knowledgeKey(ref: PlaybookKnowledgeRef): string {
  return `${ref.type}::${ref.repositoryId}::${ref.path ?? ""}::${ref.markdown ?? ""}`;
}

function diffKnowledgeRefs(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): StructuredDiffSummary {
  const baseMap = new Map<string, PlaybookKnowledgeRef>();
  for (const ref of base?.knowledgeRefs ?? []) {
    baseMap.set(knowledgeKey(ref), ref);
  }
  const targetMap = new Map<string, PlaybookKnowledgeRef>();
  for (const ref of target.knowledgeRefs) {
    targetMap.set(knowledgeKey(ref), ref);
  }

  const added: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];
  const modified: StructuredItemModification[] = [];

  for (const [key, ref] of targetMap.entries()) {
    if (!baseMap.has(key)) {
      added.push({ ...ref, _id: ref.path ?? ref.markdown ?? key });
    }
  }
  for (const [key, ref] of baseMap.entries()) {
    if (!targetMap.has(key)) {
      removed.push({ ...ref, _id: ref.path ?? ref.markdown ?? key });
    }
  }

  return {
    available: true,
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    risk: removed.length > 0 ? "MEDIUM" : "LOW",
    added,
    removed,
    modified
  };
}

function diffScriptRefs(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): StructuredDiffSummary {
  const baseMap = new Map<string, PlaybookScriptRef>();
  for (const ref of base?.scriptRefs ?? []) {
    baseMap.set(ref.scriptId, ref);
  }
  const targetMap = new Map<string, PlaybookScriptRef>();
  for (const ref of target.scriptRefs) {
    targetMap.set(ref.scriptId, ref);
  }

  const added: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];
  const modified: StructuredItemModification[] = [];

  for (const [id, ref] of targetMap.entries()) {
    if (!baseMap.has(id)) {
      added.push({ ...ref, _id: id });
    }
  }
  for (const [id, ref] of baseMap.entries()) {
    if (!targetMap.has(id)) {
      removed.push({ ...ref, _id: id });
    }
  }
  for (const [id, baseRef] of baseMap.entries()) {
    const targetRef = targetMap.get(id);
    if (!targetRef) {
      continue;
    }
    const changes: StructuredPropertyChange[] = [];
    if (!sameValue(baseRef.purpose, targetRef.purpose)) {
      changes.push({
        field: "purpose",
        label: "用途",
        before: baseRef.purpose,
        after: targetRef.purpose,
        risk: "LOW"
      });
    }
    if (changes.length > 0) {
      modified.push({ id, label: id, changes });
    }
  }

  return {
    available: true,
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    risk: maxRisk(added.length > 0 ? "MEDIUM" : "LOW", removed.length > 0 ? "MEDIUM" : "LOW"),
    added,
    removed,
    modified
  };
}

function diffAgentSkillRefs(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): StructuredDiffSummary {
  const baseMap = new Map<string, PlaybookAgentSkillRef>();
  for (const ref of base?.agentSkillRefs ?? []) {
    baseMap.set(ref.skillId, ref);
  }
  const targetMap = new Map<string, PlaybookAgentSkillRef>();
  for (const ref of target.agentSkillRefs) {
    targetMap.set(ref.skillId, ref);
  }

  const added: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];
  const modified: StructuredItemModification[] = [];

  for (const [id, ref] of targetMap.entries()) {
    if (!baseMap.has(id)) {
      added.push({ ...ref, _id: id });
    }
  }
  for (const [id, ref] of baseMap.entries()) {
    if (!targetMap.has(id)) {
      removed.push({ ...ref, _id: id });
    }
  }
  for (const [id, baseRef] of baseMap.entries()) {
    const targetRef = targetMap.get(id);
    if (!targetRef) {
      continue;
    }
    const changes: StructuredPropertyChange[] = [];
    if (!sameValue(baseRef.purpose, targetRef.purpose)) {
      changes.push({
        field: "purpose",
        label: "用途",
        before: baseRef.purpose,
        after: targetRef.purpose,
        risk: "LOW"
      });
    }
    if (baseRef.required !== targetRef.required) {
      changes.push({
        field: "required",
        label: "是否必需",
        before: baseRef.required,
        after: targetRef.required,
        risk: "MEDIUM"
      });
    }
    if (changes.length > 0) {
      modified.push({ id, label: id, changes });
    }
  }

  return {
    available: true,
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    risk: maxRisk(
      added.length > 0 ? "MEDIUM" : "LOW",
      removed.length > 0 ? "LOW" : "LOW",
      ...modified.map((item) => item.changes.map((change) => change.risk)).flat()
    ),
    added,
    removed,
    modified
  };
}

function diffRelatedPlaybookRefs(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): StructuredDiffSummary {
  const baseMap = new Map<string, PlaybookRelatedRef>();
  for (const ref of base?.relatedPlaybookRefs ?? []) {
    baseMap.set(ref.playbookId, ref);
  }
  const targetMap = new Map<string, PlaybookRelatedRef>();
  for (const ref of target.relatedPlaybookRefs) {
    targetMap.set(ref.playbookId, ref);
  }

  const added: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];
  const modified: StructuredItemModification[] = [];

  for (const [id, ref] of targetMap.entries()) {
    if (!baseMap.has(id)) {
      added.push({ ...ref, _id: id });
    }
  }
  for (const [id, ref] of baseMap.entries()) {
    if (!targetMap.has(id)) {
      removed.push({ ...ref, _id: id });
    }
  }
  for (const [id, baseRef] of baseMap.entries()) {
    const targetRef = targetMap.get(id);
    if (!targetRef) {
      continue;
    }
    const changes: StructuredPropertyChange[] = [];
    if (baseRef.relation !== targetRef.relation) {
      changes.push({
        field: "relation",
        label: "关联类型",
        before: baseRef.relation,
        after: targetRef.relation,
        risk: "LOW"
      });
    }
    if (!sameValue(baseRef.purpose, targetRef.purpose)) {
      changes.push({
        field: "purpose",
        label: "用途",
        before: baseRef.purpose,
        after: targetRef.purpose,
        risk: "LOW"
      });
    }
    if (changes.length > 0) {
      modified.push({ id, label: id, changes });
    }
  }

  return {
    available: true,
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    risk: "LOW",
    added,
    removed,
    modified
  };
}

export function buildPlaybookDiffTarget(playbook: Playbook): PlaybookDiffTarget {
  return {
    name: playbook.name,
    description: playbook.description,
    tags: normalizeStringArray(playbook.tags),
    riskLevel: playbook.riskLevel,
    enabled: playbook.enabled,
    guideMarkdown: playbook.guideMarkdown ?? "",
    stopConditions: normalizeStringArray(playbook.stopConditions),
    knowledgeRefs: playbook.knowledgeRefs ?? [],
    scriptRefs: playbook.scriptRefs ?? [],
    agentSkillRefs: playbook.agentSkillRefs ?? [],
    relatedPlaybookRefs: playbook.relatedPlaybookRefs ?? []
  };
}

export function toRepositoryPlaybookDiffTarget(
  detail: RepositoryPlaybookDetail
): PlaybookDiffTarget {
  const file = detail.playbook;
  return {
    name: file.displayName,
    description: file.description,
    tags: normalizeStringArray(file.tags),
    riskLevel: file.riskLevel,
    enabled: file.enabled,
    guideMarkdown: file.guideMarkdown ?? "",
    stopConditions: normalizeStringArray(file.stopConditions),
    knowledgeRefs: file.knowledgeRefs ?? [],
    scriptRefs: file.scriptRefs ?? [],
    agentSkillRefs: file.agentSkillRefs ?? [],
    relatedPlaybookRefs: file.relatedPlaybookRefs ?? []
  };
}

export function buildPlaybookDiff(
  base: PlaybookDiffTarget | undefined,
  target: PlaybookDiffTarget
): PlaybookDiffResult {
  const comparisonMode: PlaybookDiffComparisonMode = base ? "COMPARE" : "INITIAL";

  const guideMarkdown = diffGuideMarkdown(base, target);
  const metadata = diffPlaybookMetadata(base, target);
  const stopConditions = diffStringList(base?.stopConditions, target.stopConditions);
  const knowledgeRefs = diffKnowledgeRefs(base, target);
  const scriptRefs = diffScriptRefs(base, target);
  const agentSkillRefs = diffAgentSkillRefs(base, target);
  const relatedPlaybookRefs = diffRelatedPlaybookRefs(base, target);

  const tabs: PlaybookDiffTabKey[] = [];
  if (guideMarkdown.changed || comparisonMode === "INITIAL") {
    tabs.push("guideMarkdown");
  }
  if (metadata.changed || comparisonMode === "INITIAL") {
    tabs.push("metadata");
  }
  if (stopConditions.changed || comparisonMode === "INITIAL") {
    tabs.push("stopConditions");
  }
  if (knowledgeRefs.changed || comparisonMode === "INITIAL") {
    tabs.push("knowledgeRefs");
  }
  if (scriptRefs.changed || comparisonMode === "INITIAL") {
    tabs.push("scriptRefs");
  }
  if (agentSkillRefs.changed || comparisonMode === "INITIAL") {
    tabs.push("agentSkillRefs");
  }
  if (relatedPlaybookRefs.changed || comparisonMode === "INITIAL") {
    tabs.push("relatedPlaybookRefs");
  }

  const hasChanges = tabs.length > 0;
  const riskLevel = maxRisk(
    guideMarkdown.risk,
    metadata.risk,
    stopConditions.risk,
    knowledgeRefs.risk,
    scriptRefs.risk,
    agentSkillRefs.risk,
    relatedPlaybookRefs.risk
  );

  const highlights: string[] = [];
  if (stopConditions.removed.length > 0) {
    highlights.push(`删除了 ${stopConditions.removed.length} 条停止条件`);
  }
  if (guideMarkdown.matchedHighRiskKeywords.length > 0) {
    highlights.push(
      `导览文本包含高风险关键字: ${guideMarkdown.matchedHighRiskKeywords.join(", ")}`
    );
  }
  if (scriptRefs.removed.length > 0) {
    highlights.push(`删除了 ${scriptRefs.removed.length} 个脚本引用`);
  }

  const warnings: string[] = [];
  if (agentSkillRefs.modified.some((item) =>
    item.changes.some((change) => change.field === "required" && change.after === true)
  )) {
    warnings.push("存在 Skill 被标记为必需，请确认运行环境已安装");
  }

  return {
    comparisonMode,
    hasChanges,
    riskLevel,
    highlights,
    warnings,
    tabs,
    guideMarkdown,
    metadata,
    stopConditions,
    knowledgeRefs,
    scriptRefs,
    agentSkillRefs,
    relatedPlaybookRefs
  };
}
