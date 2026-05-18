import type {
  ConfigValue,
  WebhookDefinition,
  ExecutionPreset,
  RepositoryDefinition,
  ScriptDefinition,
  ScriptSchedule,
  PluginSummaryView,
  PluginView,
  AiModelProfile,
  AiAgentProfile,
  AiToolset,
  SharedStateDetail,
  SharedStateRequest,
  SharedStateSummary,
  Skill,
  SkillTarget
} from "../shared/types";
import {
  parseScriptDefinition,
  parseScriptSchedule,
  parseConfigValue,
  formatExportStamp
} from "./scriptTransfer";

export interface PluginBackupEntry {
  pluginId: string;
  fileName: string;
  name: string;
  description?: string;
  version: string;
  repositoryId?: string;
  repositoryPluginId?: string;
  repositoryVersion?: string;
  configurable: boolean;
  actions: Array<{ action: string; title: string; description: string }>;
  config?: Record<string, unknown>;
}

export interface SharedStateBackupEntry {
  namespace: string;
  key: string;
  secret: boolean;
  expiresAt?: string | null;
  valueIncluded: boolean;
  value?: unknown;
}

export interface SkillTargetBackupEntry {
  id: string;
  name: string;
  type: string;
  rootPath: string;
  enabled: boolean;
  writable: boolean;
}

export interface SkillBackupEntry {
  skillId: string;
  repositoryId?: string;
  version: string;
  digest: string;
  displayName?: string;
  description?: string;
  fileName: string;
  targetIds: string[];
  disabledTargetIds: string[];
}

export interface SystemBackupBundleV1 {
  version: 1;
  type: "actiondock-system-backup";
  exportedAt: string;
  data: {
    scripts: ScriptDefinition[];
    schedules: ScriptSchedule[];
    webhooks: WebhookDefinition[];
    configValues: ConfigValue[];
    executionPresets: ExecutionPreset[];
    repositories: RepositoryDefinition[];
    plugins: PluginBackupEntry[];
    sharedStates: SharedStateBackupEntry[];
    aiModels: AiModelProfile[];
    aiAgents: AiAgentProfile[];
    aiToolsets: AiToolset[];
    skillTargets: SkillTargetBackupEntry[];
    skills: SkillBackupEntry[];
  };
}

export interface BackupAnalysis {
  scripts: { total: number; create: number; overwrite: number };
  schedules: { total: number; create: number; overwrite: number };
  webhooks: { total: number; create: number; overwrite: number };
  configValues: { total: number; create: number; overwrite: number };
  executionPresets: { total: number; create: number; overwrite: number };
  repositories: { total: number; create: number; overwrite: number };
  plugins: { total: number; create: number; overwrite: number };
  sharedStates: { total: number; create: number; overwrite: number; skipped: number };
  aiModels: { total: number; create: number; overwrite: number };
  aiAgents: { total: number; create: number; overwrite: number };
  aiToolsets: { total: number; create: number; overwrite: number };
  skillTargets: { total: number; create: number; overwrite: number };
  skills: { total: number; create: number; overwrite: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} 必须是布尔值`);
  }
  return value;
}

function assertOptionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} 必须是字符串`);
  }
  return value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function buildSharedStateBackupKey(entry: Pick<SharedStateSummary, "namespace" | "key">): string {
  return `${entry.namespace}/${entry.key}`;
}

export function shouldIncludeSharedStateValue(secret: boolean, includeSecretValues: boolean): boolean {
  return !secret || includeSecretValues;
}

export function buildSharedStateBackupEntry(
  entry: Pick<SharedStateSummary, "namespace" | "key" | "secret" | "expiresAt"> & Partial<Pick<SharedStateDetail, "value">>,
  options?: { includeValue?: boolean }
): SharedStateBackupEntry {
  const includeValue = options?.includeValue ?? false;
  return {
    namespace: entry.namespace,
    key: entry.key,
    secret: entry.secret,
    expiresAt: entry.expiresAt ?? null,
    valueIncluded: includeValue,
    ...(includeValue ? { value: entry.value } : {})
  };
}

function parseSharedStateBackupEntry(value: unknown, index: number): SharedStateBackupEntry {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条共享状态不是对象`);
  }
  if (!isNonEmptyString(value.namespace)) {
    throw new Error(`第 ${index + 1} 条共享状态缺少合法 namespace`);
  }
  if (!isNonEmptyString(value.key)) {
    throw new Error(`第 ${index + 1} 条共享状态 ${String(value.namespace)} 缺少合法 key`);
  }

  const namespace = value.namespace.trim();
  const key = value.key.trim();
  const secret = assertBoolean(value.secret, `第 ${index + 1} 条共享状态 ${namespace}/${key} 的 secret`);
  const valueIncluded = assertBoolean(value.valueIncluded, `第 ${index + 1} 条共享状态 ${namespace}/${key} 的 valueIncluded`);

  if (valueIncluded && !hasOwn(value, "value")) {
    throw new Error(`第 ${index + 1} 条共享状态 ${namespace}/${key} 缺少 value`);
  }

  return {
    namespace,
    key,
    secret,
    expiresAt: assertOptionalNullableString(value.expiresAt, `第 ${index + 1} 条共享状态 ${namespace}/${key} 的 expiresAt`) ?? null,
    valueIncluded,
    ...(valueIncluded ? { value: value.value } : {})
  };
}

export function toSharedStateRestorePayload(entry: SharedStateBackupEntry): SharedStateRequest | null {
  if (!entry.valueIncluded) {
    return null;
  }
  return {
    namespace: entry.namespace,
    key: entry.key,
    value: entry.value,
    secret: entry.secret,
    expiresAt: entry.expiresAt ?? null
  };
}

export function buildBackupJson(
  data: {
    scripts: ScriptDefinition[];
    schedules: ScriptSchedule[];
    webhooks: WebhookDefinition[];
    configValues: ConfigValue[];
    executionPresets: ExecutionPreset[];
    repositories: RepositoryDefinition[];
    plugins: PluginView[];
    pluginConfigs: Map<string, Record<string, unknown>>;
    sharedStates: SharedStateBackupEntry[];
    aiModels: AiModelProfile[];
    aiAgents: AiAgentProfile[];
    aiToolsets: AiToolset[];
    skillTargets?: SkillTarget[];
    skills?: SkillBackupEntry[];
  },
  options?: { includeSecretValues?: boolean }
): SystemBackupBundleV1 {
  const includeSecretValues = options?.includeSecretValues ?? false;
  const skillTargets = data.skillTargets ?? [];
  const skills = data.skills ?? [];
  const pluginEntries: PluginBackupEntry[] = data.plugins.filter(p => p.sourceType !== "SYSTEM").map(p => ({
    pluginId: p.pluginId,
    fileName: p.fileName ?? `${p.pluginId}.jar`,
    name: p.name,
    description: p.description,
    version: p.version,
    repositoryId: p.repositoryId,
    repositoryPluginId: p.repositoryPluginId,
    repositoryVersion: p.repositoryVersion,
    configurable: p.configurable,
    actions: p.actions.map(a => ({ action: a.action, title: a.title, description: a.description })),
    config: p.configurable ? data.pluginConfigs.get(p.pluginId) : undefined
  }));

  const skillTargetEntries: SkillTargetBackupEntry[] = skillTargets.map(t => ({
    id: t.id,
    name: t.name,
    type: t.type,
    rootPath: t.rootPath,
    enabled: t.enabled,
    writable: t.writable
  }));

  return {
    version: 1,
    type: "actiondock-system-backup",
    exportedAt: new Date().toISOString(),
    data: {
      scripts: [...data.scripts].sort((a, b) => a.id.localeCompare(b.id)),
      schedules: [...data.schedules].sort((a, b) => a.id.localeCompare(b.id)),
      webhooks: [...data.webhooks].sort((a, b) => a.id.localeCompare(b.id)),
      configValues: [...data.configValues]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(item => ({
          ...item,
          value: item.secret && !includeSecretValues ? undefined : item.value
        })),
      executionPresets: [...data.executionPresets].sort((a, b) => a.id.localeCompare(b.id)),
      repositories: [...data.repositories].sort((a, b) => a.id.localeCompare(b.id)),
      plugins: pluginEntries.sort((a, b) => a.pluginId.localeCompare(b.pluginId)),
      sharedStates: [...data.sharedStates].sort((a, b) =>
        a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key)
      ),
      aiModels: [...data.aiModels].sort((a, b) => a.id.localeCompare(b.id)),
      aiAgents: [...data.aiAgents].sort((a, b) => a.id.localeCompare(b.id)),
      aiToolsets: [...data.aiToolsets].sort((a, b) => a.id.localeCompare(b.id)),
      skillTargets: skillTargetEntries.sort((a, b) => a.id.localeCompare(b.id)),
      skills: [...skills].sort((a, b) => a.skillId.localeCompare(b.skillId))
    }
  };
}

export function parseBackupJson(text: string): SystemBackupBundleV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "格式错误";
    throw new Error(`备份文件不是合法 JSON: ${detail}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("备份文件顶层必须是对象");
  }
  if (parsed.version !== 1) {
    throw new Error("仅支持 SystemBackupBundleV1 格式");
  }
  if (parsed.type !== "actiondock-system-backup") {
    throw new Error("文件类型不匹配，期望 actiondock-system-backup");
  }
  if (typeof parsed.exportedAt !== "string" || !parsed.exportedAt) {
    throw new Error("备份文件缺少 exportedAt");
  }
  if (!isRecord(parsed.data)) {
    throw new Error("备份文件缺少 data 对象");
  }

  const data = parsed.data;

  const scripts = Array.isArray(data.scripts)
    ? (data.scripts as unknown[]).map((s, i) => parseScriptDefinition(s, i))
    : [];
  const schedules = Array.isArray(data.schedules)
    ? (data.schedules as unknown[]).map((s, i) => parseScriptSchedule(s, i))
    : [];
  const webhooks = Array.isArray(data.webhooks)
    ? (data.webhooks as WebhookDefinition[])
    : [];
  const configValues = Array.isArray(data.configValues)
    ? (data.configValues as unknown[]).map((c, i) => parseConfigValue(c, i))
    : [];
  const executionPresets = Array.isArray(data.executionPresets)
    ? (data.executionPresets as ExecutionPreset[])
    : [];
  const repositories = Array.isArray(data.repositories)
    ? (data.repositories as RepositoryDefinition[])
    : [];
  const plugins = Array.isArray(data.plugins)
    ? (data.plugins as PluginBackupEntry[])
    : [];
  const sharedStates = Array.isArray(data.sharedStates)
    ? (data.sharedStates as unknown[]).map((item, index) => parseSharedStateBackupEntry(item, index))
    : [];
  const aiModels = Array.isArray(data.aiModels)
    ? (data.aiModels as AiModelProfile[])
    : [];
  const aiAgents = Array.isArray(data.aiAgents)
    ? (data.aiAgents as AiAgentProfile[])
    : [];
  const aiToolsets = Array.isArray(data.aiToolsets)
    ? (data.aiToolsets as AiToolset[])
    : [];
  const skillTargets = Array.isArray(data.skillTargets)
    ? (data.skillTargets as SkillTargetBackupEntry[])
    : [];
  const skills = Array.isArray(data.skills)
    ? (data.skills as SkillBackupEntry[])
    : [];

  return {
    version: 1,
    type: "actiondock-system-backup",
    exportedAt: parsed.exportedAt as string,
    data: { scripts, schedules, webhooks, configValues, executionPresets, repositories, plugins, sharedStates, aiModels, aiAgents, aiToolsets, skillTargets, skills }
  };
}

export function analyzeBackupBundle(
  bundle: SystemBackupBundleV1,
  current: {
    scripts: ScriptDefinition[];
    schedules: ScriptSchedule[];
    webhooks: WebhookDefinition[];
    configValues: ConfigValue[];
    executionPresets: ExecutionPreset[];
    repositories: RepositoryDefinition[];
    plugins: PluginSummaryView[];
    sharedStates: SharedStateSummary[];
    aiModels: AiModelProfile[];
    aiAgents: AiAgentProfile[];
    aiToolsets: AiToolset[];
    skillTargets?: SkillTarget[];
    skills?: Skill[];
  }
): BackupAnalysis {
  const analyze = <T extends { id: string }>(
    imported: T[],
    existing: T[]
  ) => {
    const existingIds = new Set(existing.map(e => e.id));
    let create = 0;
    let overwrite = 0;
    for (const item of imported) {
      if (existingIds.has(item.id)) {
        overwrite++;
      } else {
        create++;
      }
    }
    return { total: imported.length, create, overwrite };
  };

  const currentConfigKeys = new Set(current.configValues.map(c => c.key));
  let cvCreate = 0;
  let cvOverwrite = 0;
  for (const item of bundle.data.configValues) {
    if (currentConfigKeys.has(item.key)) {
      cvOverwrite++;
    } else {
      cvCreate++;
    }
  }

  const currentPluginIds = new Set(current.plugins.map(p => p.pluginId));
  let pluginCreate = 0;
  let pluginOverwrite = 0;
  for (const item of bundle.data.plugins) {
    if (currentPluginIds.has(item.pluginId)) {
      pluginOverwrite++;
    } else {
      pluginCreate++;
    }
  }

  const currentSharedStateKeys = new Set(current.sharedStates.map(item => buildSharedStateBackupKey(item)));
  let sharedStateCreate = 0;
  let sharedStateOverwrite = 0;
  let sharedStateSkipped = 0;
  for (const item of bundle.data.sharedStates) {
    if (!item.valueIncluded) {
      sharedStateSkipped++;
      continue;
    }
    if (currentSharedStateKeys.has(buildSharedStateBackupKey(item))) {
      sharedStateOverwrite++;
    } else {
      sharedStateCreate++;
    }
  }

  const currentSkillTargets = current.skillTargets ?? [];
  const currentSkills = current.skills ?? [];
  const currentSkillTargetIds = new Set(currentSkillTargets.map(t => t.id));
  let skillTargetCreate = 0;
  let skillTargetOverwrite = 0;
  for (const item of bundle.data.skillTargets) {
    if (currentSkillTargetIds.has(item.id)) {
      skillTargetOverwrite++;
    } else {
      skillTargetCreate++;
    }
  }

  const currentSkillIds = new Set(currentSkills.map(s => s.skillId));
  let skillCreate = 0;
  let skillOverwrite = 0;
  for (const item of bundle.data.skills) {
    if (currentSkillIds.has(item.skillId)) {
      skillOverwrite++;
    } else {
      skillCreate++;
    }
  }

  return {
    scripts: analyze(bundle.data.scripts, current.scripts),
    schedules: analyze(bundle.data.schedules, current.schedules),
    webhooks: analyze(bundle.data.webhooks, current.webhooks),
    configValues: { total: bundle.data.configValues.length, create: cvCreate, overwrite: cvOverwrite },
    executionPresets: analyze(bundle.data.executionPresets, current.executionPresets),
    repositories: analyze(bundle.data.repositories, current.repositories),
    plugins: { total: bundle.data.plugins.length, create: pluginCreate, overwrite: pluginOverwrite },
    sharedStates: {
      total: bundle.data.sharedStates.length,
      create: sharedStateCreate,
      overwrite: sharedStateOverwrite,
      skipped: sharedStateSkipped
    },
    aiModels: analyze(bundle.data.aiModels, current.aiModels),
    aiAgents: analyze(bundle.data.aiAgents, current.aiAgents),
    aiToolsets: analyze(bundle.data.aiToolsets, current.aiToolsets),
    skillTargets: { total: bundle.data.skillTargets.length, create: skillTargetCreate, overwrite: skillTargetOverwrite },
    skills: { total: bundle.data.skills.length, create: skillCreate, overwrite: skillOverwrite }
  };
}

export function formatBackupFileName(now = new Date()): string {
  const stamp = formatExportStamp(now);
  return `actiondock-backup-${stamp}.zip`;
}

export function buildSkillBackupEntry(
  skill: Skill,
  skillFileName: string
): SkillBackupEntry {
  const targetIds: string[] = [];
  const disabledTargetIds: string[] = [];
  for (const deployment of skill.targets) {
    targetIds.push(deployment.targetId);
    if (!deployment.enabled) {
      disabledTargetIds.push(deployment.targetId);
    }
  }
  return {
    skillId: skill.skillId,
    repositoryId: skill.repositoryId,
    version: skill.version,
    digest: skill.digest,
    displayName: skill.displayName,
    description: skill.description,
    fileName: skillFileName,
    targetIds,
    disabledTargetIds
  };
}
