import type {
  Playbook,
  PlaybookAgentSkillRef,
  PlaybookKnowledgeRef,
  PlaybookRelatedRef,
  PlaybookRelatedRefRelation,
  PlaybookRiskLevel,
  PlaybookScriptRef,
  ScriptDefinition
} from "../shared/types";
import { formatExportStamp } from "./scriptTransfer";

export interface PlaybookExportBundleV1 {
  version: 1;
  exportedAt: string;
  playbooks: Playbook[];
}

export interface PlaybookImportAnalysis {
  playbooks: Playbook[];
  createIds: string[];
  overwriteIds: string[];
  managedConflictIds: string[];
  missingScriptRefs: Array<{ playbookId: string; scriptIds: string[] }>;
  missingRelatedPlaybookRefs: Array<{ playbookId: string; missingPlaybookIds: string[] }>;
  circularIds: string[];
}

const SUPPORTED_RISK_LEVELS: PlaybookRiskLevel[] = ["LOW", "MEDIUM", "HIGH"];
const SUPPORTED_RELATED_RELATIONS: PlaybookRelatedRefRelation[] = ["RELATED", "FOLLOW_UP", "FALLBACK"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} 必须是字符串`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function assertOptionalStringArray(value: unknown, fieldName: string): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} 必须是字符串数组`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function assertOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} 必须是布尔值`);
  }
  return value;
}

function parseRiskLevel(value: unknown, fieldName: string): PlaybookRiskLevel | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  if (!SUPPORTED_RISK_LEVELS.includes(value as PlaybookRiskLevel)) {
    throw new Error(`${fieldName} 仅支持 ${SUPPORTED_RISK_LEVELS.join(" / ")}`);
  }
  return value as PlaybookRiskLevel;
}

function parseKnowledgeRef(value: unknown, fieldName: string): PlaybookKnowledgeRef {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (value.type !== "NOTE" && value.type !== "FILE") {
    throw new Error(`${fieldName}.type 仅支持 NOTE / FILE`);
  }
  if (!isNonEmptyString(value.repositoryId)) {
    throw new Error(`${fieldName}.repositoryId 缺少合法值`);
  }

  const repositoryId = value.repositoryId.trim();
  if (value.type === "NOTE") {
    if (!isNonEmptyString(value.markdown)) {
      throw new Error(`${fieldName}.markdown 缺少合法值`);
    }
    return { type: "NOTE", repositoryId, markdown: value.markdown.trim() };
  }

  if (!isNonEmptyString(value.path)) {
    throw new Error(`${fieldName}.path 缺少合法值`);
  }
  const path = value.path.trim();
  if (path.startsWith("/") || path.includes("..")) {
    throw new Error(`${fieldName}.path 必须是仓库内相对路径`);
  }
  if (path === "ACTIONDOCK.md") {
    throw new Error(`${fieldName}.path 不需要显式引用 ACTIONDOCK.md`);
  }
  return { type: "FILE", repositoryId, path };
}

function parseKnowledgeRefs(value: unknown, fieldName: string): PlaybookKnowledgeRef[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parseKnowledgeRef(item, `${fieldName}[${index}]`));
}

function parseScriptRef(value: unknown, fieldName: string): PlaybookScriptRef {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (!isNonEmptyString(value.scriptId)) {
    throw new Error(`${fieldName}.scriptId 缺少合法值`);
  }
  return {
    scriptId: value.scriptId.trim(),
    purpose: assertOptionalString(value.purpose, `${fieldName}.purpose`)
  };
}

function parseScriptRefs(value: unknown, fieldName: string): PlaybookScriptRef[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parseScriptRef(item, `${fieldName}[${index}]`));
}

function parseAgentSkillRef(value: unknown, fieldName: string): PlaybookAgentSkillRef {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (!isNonEmptyString(value.skillId)) {
    throw new Error(`${fieldName}.skillId 缺少合法值`);
  }
  return {
    skillId: value.skillId.trim(),
    purpose: assertOptionalString(value.purpose, `${fieldName}.purpose`),
    required: assertOptionalBoolean(value.required, `${fieldName}.required`) ?? false
  };
}

function parseAgentSkillRefs(value: unknown, fieldName: string): PlaybookAgentSkillRef[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parseAgentSkillRef(item, `${fieldName}[${index}]`));
}

function parseRelatedPlaybookRef(value: unknown, fieldName: string): PlaybookRelatedRef {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (!isNonEmptyString(value.playbookId)) {
    throw new Error(`${fieldName}.playbookId 缺少合法值`);
  }
  const relation = value.relation == null || value.relation === "" ? "RELATED" : value.relation;
  if (!SUPPORTED_RELATED_RELATIONS.includes(relation as PlaybookRelatedRefRelation)) {
    throw new Error(`${fieldName}.relation 仅支持 ${SUPPORTED_RELATED_RELATIONS.join(" / ")}`);
  }
  return {
    playbookId: value.playbookId.trim(),
    relation: relation as PlaybookRelatedRefRelation,
    purpose: assertOptionalString(value.purpose, `${fieldName}.purpose`)
  };
}

function parseRelatedPlaybookRefs(value: unknown, fieldName: string): PlaybookRelatedRef[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parseRelatedPlaybookRef(item, `${fieldName}[${index}]`));
}

export function parsePlaybookDefinition(value: unknown, index: number): Playbook {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条任务手册不是对象`);
  }

  const id = value.id;
  const name = value.name;
  const guideMarkdown = value.guideMarkdown;

  if (!isNonEmptyString(id)) {
    throw new Error(`第 ${index + 1} 条任务手册缺少合法 id`);
  }
  if (!isNonEmptyString(name)) {
    throw new Error(`第 ${index + 1} 条任务手册 ${id} 缺少合法 name`);
  }
  if (!isNonEmptyString(guideMarkdown)) {
    throw new Error(`第 ${index + 1} 条任务手册 ${id} 缺少合法 guideMarkdown`);
  }

  return {
    id: id.trim(),
    name: name.trim(),
    description: assertOptionalString(value.description, `第 ${index + 1} 条任务手册 ${id} 的 description`),
    tags: assertOptionalStringArray(value.tags, `第 ${index + 1} 条任务手册 ${id} 的 tags`),
    riskLevel: parseRiskLevel(value.riskLevel, `第 ${index + 1} 条任务手册 ${id} 的 riskLevel`),
    repositoryIds: assertOptionalStringArray(value.repositoryIds, `第 ${index + 1} 条任务手册 ${id} 的 repositoryIds`),
    knowledgeRefs: parseKnowledgeRefs(value.knowledgeRefs, `第 ${index + 1} 条任务手册 ${id} 的 knowledgeRefs`),
    scriptRefs: parseScriptRefs(value.scriptRefs, `第 ${index + 1} 条任务手册 ${id} 的 scriptRefs`),
    agentSkillRefs: parseAgentSkillRefs(value.agentSkillRefs, `第 ${index + 1} 条任务手册 ${id} 的 agentSkillRefs`),
    relatedPlaybookRefs: parseRelatedPlaybookRefs(value.relatedPlaybookRefs, `第 ${index + 1} 条任务手册 ${id} 的 relatedPlaybookRefs`),
    guideMarkdown,
    stopConditions: assertOptionalStringArray(value.stopConditions, `第 ${index + 1} 条任务手册 ${id} 的 stopConditions`),
    enabled: assertOptionalBoolean(value.enabled, `第 ${index + 1} 条任务手册 ${id} 的 enabled`) ?? true,
    managed: false
  };
}

export function buildPlaybookExportBundle(playbooks: Playbook[]): PlaybookExportBundleV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    playbooks: [...playbooks]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        tags: item.tags ?? [],
        riskLevel: item.riskLevel,
        repositoryIds: item.repositoryIds ?? [],
        knowledgeRefs: item.knowledgeRefs ?? [],
        scriptRefs: item.scriptRefs ?? [],
        agentSkillRefs: item.agentSkillRefs ?? [],
        relatedPlaybookRefs: item.relatedPlaybookRefs ?? [],
        guideMarkdown: item.guideMarkdown,
        stopConditions: item.stopConditions ?? [],
        enabled: item.enabled ?? true,
        managed: false
      }))
  };
}

export function formatPlaybookExportFileName(now = new Date()): string {
  const stamp = formatExportStamp(now);
  return `actiondock-playbooks-${stamp}.json`;
}

export function parsePlaybookImportBundle(text: string): Playbook[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "格式错误";
    throw new Error(`导入文件不是合法 JSON: ${detail}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("导入文件顶层必须是对象");
  }
  if (parsed.version !== 1) {
    throw new Error("仅支持 PlaybookExportBundleV1 格式");
  }
  if (!isNonEmptyString(parsed.exportedAt)) {
    throw new Error("导入文件缺少 exportedAt");
  }
  if (!Array.isArray(parsed.playbooks)) {
    throw new Error("导入文件缺少 playbooks 数组");
  }

  const playbooks = parsed.playbooks.map((item, index) => parsePlaybookDefinition(item, index));
  if (playbooks.length === 0) {
    throw new Error("导入文件中没有任务手册");
  }

  const seenIds = new Set<string>();
  for (const playbook of playbooks) {
    if (seenIds.has(playbook.id)) {
      throw new Error(`导入文件中存在重复任务手册 ID: ${playbook.id}`);
    }
    seenIds.add(playbook.id);
  }

  return playbooks;
}

export function analyzePlaybookImport(
  importedPlaybooks: Playbook[],
  currentPlaybooks: Playbook[],
  currentScripts: ScriptDefinition[]
): PlaybookImportAnalysis {
  const currentById = new Map(currentPlaybooks.map((item) => [item.id, item]));
  const currentScriptIds = new Set(currentScripts.map((script) => script.id));
  const importedPlaybookIds = new Set(importedPlaybooks.map((p) => p.id));

  const createIds: string[] = [];
  const overwriteIds: string[] = [];
  const managedConflictIds: string[] = [];
  const missingScriptRefs: Array<{ playbookId: string; scriptIds: string[] }> = [];
  const missingRelatedPlaybookRefs: Array<{ playbookId: string; missingPlaybookIds: string[] }> = [];

  for (const playbook of importedPlaybooks) {
    const current = currentById.get(playbook.id);
    if (!current) {
      createIds.push(playbook.id);
    } else if (current.managed) {
      managedConflictIds.push(playbook.id);
    } else {
      overwriteIds.push(playbook.id);
    }

    const missingScriptIds = Array.from(new Set(
      (playbook.scriptRefs ?? [])
        .map((ref) => ref.scriptId)
        .filter((scriptId) => !currentScriptIds.has(scriptId))
    ));
    if (missingScriptIds.length > 0) {
      missingScriptRefs.push({ playbookId: playbook.id, scriptIds: missingScriptIds });
    }

    const missingPlaybookIds = Array.from(new Set(
      (playbook.relatedPlaybookRefs ?? [])
        .map((ref) => ref.playbookId)
        .filter((playbookId) => !currentById.has(playbookId) && !importedPlaybookIds.has(playbookId))
    ));
    if (missingPlaybookIds.length > 0) {
      missingRelatedPlaybookRefs.push({ playbookId: playbook.id, missingPlaybookIds });
    }
  }

  // Topological sorting for createIds using Kahn's algorithm
  const createIdsSet = new Set(createIds);
  const importedMap = new Map(importedPlaybooks.map((p) => [p.id, p]));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of createIds) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }

  for (const id of createIds) {
    const playbook = importedMap.get(id);
    const deps = (playbook?.relatedPlaybookRefs ?? [])
      .map((ref) => ref.playbookId)
      .filter((depId) => createIdsSet.has(depId));

    for (const dep of deps) {
      adj.get(dep)!.push(id);
      inDegree.set(id, inDegree.get(id)! + 1);
    }
  }

  const queue: string[] = [];
  for (const id of createIds) {
    if (inDegree.get(id) === 0) {
      queue.push(id);
    }
  }

  const sortedCreateIds: string[] = [];
  while (queue.length > 0) {
    queue.sort(); // Deterministic ordering
    const u = queue.shift()!;
    sortedCreateIds.push(u);
    for (const v of adj.get(u)!) {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  let circularIds: string[] = [];
  let sortedPlaybooks = importedPlaybooks;

  if (sortedCreateIds.length < createIds.length) {
    circularIds = createIds.filter((id) => inDegree.get(id)! > 0);
  } else {
    // Sort importedPlaybooks: sortedCreateIds first, then overwriteIds, then managedConflictIds
    const allSortedIds = [
      ...sortedCreateIds,
      ...overwriteIds,
      ...managedConflictIds
    ];
    sortedPlaybooks = allSortedIds
      .map((id) => importedMap.get(id))
      .filter(Boolean) as Playbook[];
  }

  return {
    playbooks: sortedPlaybooks,
    createIds,
    overwriteIds,
    managedConflictIds,
    missingScriptRefs,
    missingRelatedPlaybookRefs,
    circularIds
  };
}
