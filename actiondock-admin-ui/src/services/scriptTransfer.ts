import type {
  ConfigValue,
  AiDependency,
  PluginDependency,
  PublishedScriptRevision,
  ScriptSchedule,
  ScriptDefinition,
  ScriptDependency,
  ScriptPackaging,
  ScriptType
} from "../shared/types";
import { normalizeScriptDefinition } from "./scriptPublication";

export interface ScriptExportBundleV1 {
  version: 1;
  exportedAt: string;
  scripts: ScriptDefinition[];
}

export interface ScriptImportAnalysis {
  scripts: ScriptDefinition[];
  createIds: string[];
  overwriteIds: string[];
}

export interface ScheduleExportBundleV1 {
  version: 1;
  exportedAt: string;
  schedules: ScriptSchedule[];
}

export interface ScheduleImportAnalysis {
  schedules: ScriptSchedule[];
  createIds: string[];
  overwriteIds: string[];
}

export interface ConfigValueExportBundleV1 {
  version: 1;
  exportedAt: string;
  configValues: ConfigValue[];
}

export interface ConfigValueImportAnalysis {
  configValues: ConfigValue[];
  createKeys: string[];
  overwriteKeys: string[];
}

const SUPPORTED_SCRIPT_TYPES: ScriptType[] = ["GROOVY", "PYTHON"];
const SUPPORTED_SCRIPT_PACKAGING: ScriptPackaging[] = ["TOOL", "FLOW"];

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
  return value;
}

function assertBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} 必须是布尔值`);
  }
  return value;
}

function assertSchemaObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  return value;
}

function assertOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} 必须是字符串数组`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parsePluginDependency(value: unknown, fieldName: string): PluginDependency {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (!isNonEmptyString(value.pluginId)) {
    throw new Error(`${fieldName}.pluginId 缺少合法值`);
  }
  const requiredActions = assertOptionalStringArray(value.requiredActions, `${fieldName}.requiredActions`) ?? [];
  return {
    pluginId: value.pluginId.trim(),
    versionRange: assertOptionalString(value.versionRange, `${fieldName}.versionRange`),
    requiredActions
  };
}

function parsePluginDependencies(value: unknown, fieldName: string): PluginDependency[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parsePluginDependency(item, `${fieldName}[${index}]`));
}

function parseScriptDependency(value: unknown, fieldName: string): ScriptDependency {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (!isNonEmptyString(value.scriptId)) {
    throw new Error(`${fieldName}.scriptId 缺少合法值`);
  }
  if (!isNonEmptyString(value.repositoryId)) {
    throw new Error(`${fieldName}.repositoryId 缺少合法值`);
  }
  if (!isNonEmptyString(value.repositoryScriptId)) {
    throw new Error(`${fieldName}.repositoryScriptId 缺少合法值`);
  }
  return {
    scriptId: value.scriptId.trim(),
    repositoryId: value.repositoryId.trim(),
    repositoryScriptId: value.repositoryScriptId.trim(),
    versionRange: assertOptionalString(value.versionRange, `${fieldName}.versionRange`)
  };
}

function parseScriptDependencies(value: unknown, fieldName: string): ScriptDependency[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parseScriptDependency(item, `${fieldName}[${index}]`));
}

function parseAiDependency(value: unknown, fieldName: string): AiDependency {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  if (!isNonEmptyString(value.capability)) {
    throw new Error(`${fieldName}.capability 缺少合法值`);
  }
  return {
    capability: value.capability.trim() as AiDependency["capability"],
    profile: assertOptionalString(value.profile, `${fieldName}.profile`),
    agentProfile: assertOptionalString(value.agentProfile, `${fieldName}.agentProfile`),
    required: assertBoolean(value.required, `${fieldName}.required`)
  };
}

function parseAiDependencies(value: unknown, fieldName: string): AiDependency[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }
  return value.map((item, index) => parseAiDependency(item, `${fieldName}[${index}]`));
}

function parsePublishedRevision(value: unknown, fieldName: string): PublishedScriptRevision | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }

  const name = value.name;
  const type = value.type;
  const packaging = value.packaging;
  const source = value.source;

  if (!isNonEmptyString(name)) {
    throw new Error(`${fieldName}.name 缺少合法值`);
  }
  if (!SUPPORTED_SCRIPT_TYPES.includes(type as ScriptType)) {
    throw new Error(`${fieldName}.type 仅支持 ${SUPPORTED_SCRIPT_TYPES.join(" / ")}`);
  }
  if (packaging != null && !SUPPORTED_SCRIPT_PACKAGING.includes(packaging as ScriptPackaging)) {
    throw new Error(`${fieldName}.packaging 仅支持 ${SUPPORTED_SCRIPT_PACKAGING.join(" / ")}`);
  }
  if (!isNonEmptyString(source)) {
    throw new Error(`${fieldName}.source 缺少合法值`);
  }

  return {
    scriptId: assertOptionalString(value.scriptId, `${fieldName}.scriptId`) ?? "",
    revisionId: assertOptionalString(value.revisionId, `${fieldName}.revisionId`) ?? "",
    version: Number.isInteger(value.version) && Number(value.version) > 0 ? Number(value.version) : 1,
    publishedAt: assertOptionalString(value.publishedAt, `${fieldName}.publishedAt`),
    name: name.trim(),
    type: type as ScriptType,
    packaging: (packaging as ScriptPackaging | undefined) ?? "TOOL",
    source,
    pythonRequirements: assertOptionalString(value.pythonRequirements, `${fieldName}.pythonRequirements`),
    owner: assertOptionalString(value.owner, `${fieldName}.owner`),
    description: assertOptionalString(value.description, `${fieldName}.description`),
    tags: assertOptionalStringArray(value.tags, `${fieldName}.tags`),
    inputSchema: assertSchemaObject(value.inputSchema, `${fieldName}.inputSchema`),
    outputSchema: assertSchemaObject(value.outputSchema, `${fieldName}.outputSchema`),
    scriptDependencies: parseScriptDependencies(value.scriptDependencies, `${fieldName}.scriptDependencies`),
    pluginDependencies: parsePluginDependencies(value.pluginDependencies, `${fieldName}.pluginDependencies`),
    aiDependencies: parseAiDependencies(value.aiDependencies, `${fieldName}.aiDependencies`)
  };
}

export function parseScriptDefinition(value: unknown, index: number): ScriptDefinition {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条脚本不是对象`);
  }

  const id = value.id;
  const name = value.name;
  const source = value.source;
  const type = value.type;
  const packaging = value.packaging;
  const version = value.version;

  if (!isNonEmptyString(id)) {
    throw new Error(`第 ${index + 1} 条脚本缺少合法 id`);
  }
  if (!isNonEmptyString(name)) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 缺少合法 name`);
  }
  if (!isNonEmptyString(source)) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 缺少合法 source`);
  }
  if (!SUPPORTED_SCRIPT_TYPES.includes(type as ScriptType)) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 的 type 仅支持 ${SUPPORTED_SCRIPT_TYPES.join(" / ")}`);
  }
  if (packaging != null && !SUPPORTED_SCRIPT_PACKAGING.includes(packaging as ScriptPackaging)) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 的 packaging 仅支持 ${SUPPORTED_SCRIPT_PACKAGING.join(" / ")}`);
  }
  if (!Number.isInteger(version) || Number(version) <= 0) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 的 version 必须是正整数`);
  }

  const published = parsePublishedRevision(
    value.published,
    `第 ${index + 1} 条脚本 ${id} 的 published`
  );
  const publication = isRecord(value.publication)
    ? {
        published: value.publication.published == null ? Boolean(published) : assertBoolean(value.publication.published, `第 ${index + 1} 条脚本 ${id} 的 publication.published`),
        dirty: value.publication.dirty == null ? false : assertBoolean(value.publication.dirty, `第 ${index + 1} 条脚本 ${id} 的 publication.dirty`),
        publishedVersion: value.publication.publishedVersion == null ? undefined : Number(value.publication.publishedVersion),
        publishedAt: assertOptionalString(value.publication.publishedAt, `第 ${index + 1} 条脚本 ${id} 的 publication.publishedAt`)
      }
    : undefined;

  return normalizeScriptDefinition({
    id: id.trim(),
    name: name.trim(),
    type: type as ScriptType,
    packaging: (packaging as ScriptPackaging | undefined) ?? "TOOL",
    source,
    inputSchema: assertSchemaObject(value.inputSchema, `第 ${index + 1} 条脚本 ${id} 的 inputSchema`),
    outputSchema: assertSchemaObject(value.outputSchema, `第 ${index + 1} 条脚本 ${id} 的 outputSchema`),
    version: Number(version),
    owner: assertOptionalString(value.owner, `第 ${index + 1} 条脚本 ${id} 的 owner`),
    description: assertOptionalString(value.description, `第 ${index + 1} 条脚本 ${id} 的 description`),
    tags: assertOptionalStringArray(value.tags, `第 ${index + 1} 条脚本 ${id} 的 tags`),
    scriptDependencies: parseScriptDependencies(
      value.scriptDependencies,
      `第 ${index + 1} 条脚本 ${id} 的 scriptDependencies`
    ),
    pluginDependencies: parsePluginDependencies(
      value.pluginDependencies,
      `第 ${index + 1} 条脚本 ${id} 的 pluginDependencies`
    ),
    published,
    publication,
    createdAt: assertOptionalString(value.createdAt, `第 ${index + 1} 条脚本 ${id} 的 createdAt`),
    updatedAt: assertOptionalString(value.updatedAt, `第 ${index + 1} 条脚本 ${id} 的 updatedAt`)
  });
}

export function parseScriptSchedule(value: unknown, index: number): ScriptSchedule {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条定时任务不是对象`);
  }

  const id = value.id;
  const scriptId = value.scriptId;
  const name = value.name;
  const cronExpression = value.cronExpression;

  if (!isNonEmptyString(id)) {
    throw new Error(`第 ${index + 1} 条定时任务缺少合法 id`);
  }
  if (!isNonEmptyString(scriptId)) {
    throw new Error(`第 ${index + 1} 条定时任务 ${id} 缺少合法 scriptId`);
  }
  if (!isNonEmptyString(name)) {
    throw new Error(`第 ${index + 1} 条定时任务 ${id} 缺少合法 name`);
  }
  if (!isNonEmptyString(cronExpression)) {
    throw new Error(`第 ${index + 1} 条定时任务 ${id} 缺少合法 cronExpression`);
  }

  return {
    id: id.trim(),
    scriptId: scriptId.trim(),
    name: name.trim(),
    cronExpression: cronExpression.trim(),
    input: assertSchemaObject(value.input, `第 ${index + 1} 条定时任务 ${id} 的 input`),
    enabled: assertBoolean(value.enabled, `第 ${index + 1} 条定时任务 ${id} 的 enabled`),
    nextRunAt: assertOptionalString(value.nextRunAt, `第 ${index + 1} 条定时任务 ${id} 的 nextRunAt`),
    lastTriggeredAt: assertOptionalString(value.lastTriggeredAt, `第 ${index + 1} 条定时任务 ${id} 的 lastTriggeredAt`),
    lastExecutionId: assertOptionalString(value.lastExecutionId, `第 ${index + 1} 条定时任务 ${id} 的 lastExecutionId`),
    lastExecutionStatus: value.lastExecutionStatus == null ? undefined : String(value.lastExecutionStatus) as ScriptSchedule["lastExecutionStatus"],
    createdAt: assertOptionalString(value.createdAt, `第 ${index + 1} 条定时任务 ${id} 的 createdAt`),
    updatedAt: assertOptionalString(value.updatedAt, `第 ${index + 1} 条定时任务 ${id} 的 updatedAt`)
  };
}

export function parseConfigValue(value: unknown, index: number): ConfigValue {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条配置值不是对象`);
  }

  const key = value.key;
  const rawValue = value.value;
  const secret = value.secret == null ? false : assertBoolean(value.secret, `第 ${index + 1} 条配置值 ${String(key)} 的 secret`);
  const hasValue = value.hasValue == null ? undefined : assertBoolean(value.hasValue, `第 ${index + 1} 条配置值 ${String(key)} 的 hasValue`);
  if (!isNonEmptyString(key)) {
    throw new Error(`第 ${index + 1} 条配置值缺少合法 key`);
  }
  if (!secret && typeof rawValue !== "string") {
    throw new Error(`第 ${index + 1} 条配置值 ${key} 的 value 必须是字符串`);
  }
  if (secret && rawValue != null && typeof rawValue !== "string") {
    throw new Error(`第 ${index + 1} 条配置值 ${key} 的 value 必须是字符串`);
  }

  return {
    key: key.trim(),
    value: typeof rawValue === "string" ? rawValue : undefined,
    valueMasked: secret && (hasValue ?? (typeof rawValue === "string" && rawValue.length > 0)) ? "********" : undefined,
    hasValue: secret ? (hasValue ?? (typeof rawValue === "string" && rawValue.length > 0)) : undefined,
    secret,
    description: assertOptionalString(value.description, `第 ${index + 1} 条配置值 ${key} 的 description`),
    createdAt: assertOptionalString(value.createdAt, `第 ${index + 1} 条配置值 ${key} 的 createdAt`),
    updatedAt: assertOptionalString(value.updatedAt, `第 ${index + 1} 条配置值 ${key} 的 updatedAt`)
  };
}

export function buildScriptExportBundle(scripts: ScriptDefinition[]): ScriptExportBundleV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    scripts: [...scripts].sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function formatScriptExportFileName(now = new Date()): string {
  const stamp = formatExportStamp(now);
  return `actiondock-scripts-${stamp}.json`;
}

export function formatScheduleExportFileName(now = new Date()): string {
  const stamp = formatExportStamp(now);
  return `actiondock-schedules-${stamp}.json`;
}

export function formatConfigValueExportFileName(now = new Date()): string {
  const stamp = formatExportStamp(now);
  return `actiondock-config-values-${stamp}.json`;
}

export function formatExportStamp(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hour}${minute}${second}`;
}

export function downloadJsonFile(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function parseScriptImportBundle(text: string): ScriptDefinition[] {
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
    throw new Error("仅支持 ScriptExportBundleV1 格式");
  }
  if (typeof parsed.exportedAt !== "string" || !parsed.exportedAt) {
    throw new Error("导入文件缺少 exportedAt");
  }
  if (!Array.isArray(parsed.scripts)) {
    throw new Error("导入文件缺少 scripts 数组");
  }

  const scripts = parsed.scripts.map((script, index) => parseScriptDefinition(script, index));
  if (scripts.length === 0) {
    throw new Error("导入文件中没有脚本");
  }

  const seenIds = new Set<string>();
  for (const script of scripts) {
    if (seenIds.has(script.id)) {
      throw new Error(`导入文件中存在重复脚本 ID: ${script.id}`);
    }
    seenIds.add(script.id);
  }

  return scripts;
}

export function analyzeScriptImport(
  importedScripts: ScriptDefinition[],
  currentScripts: ScriptDefinition[]
): ScriptImportAnalysis {
  const currentIds = new Set(currentScripts.map((script) => script.id));
  const createIds: string[] = [];
  const overwriteIds: string[] = [];

  for (const script of importedScripts) {
    if (currentIds.has(script.id)) {
      overwriteIds.push(script.id);
    } else {
      createIds.push(script.id);
    }
  }

  return {
    scripts: importedScripts,
    createIds,
    overwriteIds
  };
}

export function buildScheduleExportBundle(schedules: ScriptSchedule[]): ScheduleExportBundleV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    schedules: [...schedules].sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function parseScheduleImportBundle(text: string): ScriptSchedule[] {
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
    throw new Error("仅支持 ScheduleExportBundleV1 格式");
  }
  if (!isNonEmptyString(parsed.exportedAt)) {
    throw new Error("导入文件缺少 exportedAt");
  }
  if (!Array.isArray(parsed.schedules)) {
    throw new Error("导入文件缺少 schedules 数组");
  }

  const schedules = parsed.schedules.map((schedule, index) => parseScriptSchedule(schedule, index));
  if (schedules.length === 0) {
    throw new Error("导入文件中没有定时任务");
  }

  const seenIds = new Set<string>();
  for (const schedule of schedules) {
    if (seenIds.has(schedule.id)) {
      throw new Error(`导入文件中存在重复定时任务 ID: ${schedule.id}`);
    }
    seenIds.add(schedule.id);
  }

  return schedules;
}

export function analyzeScheduleImport(
  importedSchedules: ScriptSchedule[],
  currentSchedules: ScriptSchedule[]
): ScheduleImportAnalysis {
  const currentIds = new Set(currentSchedules.map((schedule) => schedule.id));
  const createIds: string[] = [];
  const overwriteIds: string[] = [];

  for (const schedule of importedSchedules) {
    if (currentIds.has(schedule.id)) {
      overwriteIds.push(schedule.id);
    } else {
      createIds.push(schedule.id);
    }
  }

  return {
    schedules: importedSchedules,
    createIds,
    overwriteIds
  };
}

export function buildConfigValueExportBundle(
  configValues: ConfigValue[],
  options?: { includeSecretValues?: boolean }
): ConfigValueExportBundleV1 {
  const includeSecretValues = options?.includeSecretValues ?? false;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    configValues: [...configValues]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((item) => ({
        ...item,
        value: item.secret && !includeSecretValues ? undefined : item.value
      }))
  };
}

export function parseConfigValueImportBundle(text: string): ConfigValue[] {
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
    throw new Error("仅支持 ConfigValueExportBundleV1 格式");
  }
  if (!isNonEmptyString(parsed.exportedAt)) {
    throw new Error("导入文件缺少 exportedAt");
  }
  if (!Array.isArray(parsed.configValues)) {
    throw new Error("导入文件缺少 configValues 数组");
  }

  const configValues = parsed.configValues.map((item, index) => parseConfigValue(item, index));
  if (configValues.length === 0) {
    throw new Error("导入文件中没有配置值");
  }

  const seenKeys = new Set<string>();
  for (const item of configValues) {
    if (seenKeys.has(item.key)) {
      throw new Error(`导入文件中存在重复配置值 key: ${item.key}`);
    }
    seenKeys.add(item.key);
  }

  return configValues;
}

export function analyzeConfigValueImport(
  importedConfigValues: ConfigValue[],
  currentConfigValues: ConfigValue[]
): ConfigValueImportAnalysis {
  const currentKeys = new Set(currentConfigValues.map((item) => item.key));
  const createKeys: string[] = [];
  const overwriteKeys: string[] = [];

  for (const item of importedConfigValues) {
    if (currentKeys.has(item.key)) {
      overwriteKeys.push(item.key);
    } else {
      createKeys.push(item.key);
    }
  }

  return {
    configValues: importedConfigValues,
    createKeys,
    overwriteKeys
  };
}
