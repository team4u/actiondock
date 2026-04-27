import type {
  ConfigValue,
  ExecutionPreset,
  RepositoryDefinition,
  ScriptDefinition,
  ScriptSchedule,
  PluginView
} from "./types";
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

export interface SystemBackupBundleV1 {
  version: 1;
  type: "actiondock-system-backup";
  exportedAt: string;
  data: {
    scripts: ScriptDefinition[];
    schedules: ScriptSchedule[];
    configValues: ConfigValue[];
    executionPresets: ExecutionPreset[];
    repositories: RepositoryDefinition[];
    plugins: PluginBackupEntry[];
  };
}

export interface BackupAnalysis {
  scripts: { total: number; create: number; overwrite: number };
  schedules: { total: number; create: number; overwrite: number };
  configValues: { total: number; create: number; overwrite: number };
  executionPresets: { total: number; create: number; overwrite: number };
  repositories: { total: number; create: number; overwrite: number };
  plugins: { total: number; create: number; overwrite: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildBackupJson(
  data: {
    scripts: ScriptDefinition[];
    schedules: ScriptSchedule[];
    configValues: ConfigValue[];
    executionPresets: ExecutionPreset[];
    repositories: RepositoryDefinition[];
    plugins: PluginView[];
    pluginConfigs: Map<string, Record<string, unknown>>;
  },
  options?: { includeSecretValues?: boolean }
): SystemBackupBundleV1 {
  const includeSecretValues = options?.includeSecretValues ?? false;
  const pluginEntries: PluginBackupEntry[] = data.plugins.map(p => ({
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

  return {
    version: 1,
    type: "actiondock-system-backup",
    exportedAt: new Date().toISOString(),
    data: {
      scripts: [...data.scripts].sort((a, b) => a.id.localeCompare(b.id)),
      schedules: [...data.schedules].sort((a, b) => a.id.localeCompare(b.id)),
      configValues: [...data.configValues]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(item => ({
          ...item,
          value: item.secret && !includeSecretValues ? undefined : item.value
        })),
      executionPresets: [...data.executionPresets].sort((a, b) => a.id.localeCompare(b.id)),
      repositories: [...data.repositories].sort((a, b) => a.id.localeCompare(b.id)),
      plugins: pluginEntries.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
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

  return {
    version: 1,
    type: "actiondock-system-backup",
    exportedAt: parsed.exportedAt as string,
    data: { scripts, schedules, configValues, executionPresets, repositories, plugins }
  };
}

export function analyzeBackupBundle(
  bundle: SystemBackupBundleV1,
  current: {
    scripts: ScriptDefinition[];
    schedules: ScriptSchedule[];
    configValues: ConfigValue[];
    executionPresets: ExecutionPreset[];
    repositories: RepositoryDefinition[];
    plugins: PluginView[];
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

  return {
    scripts: analyze(bundle.data.scripts, current.scripts),
    schedules: analyze(bundle.data.schedules, current.schedules),
    configValues: { total: bundle.data.configValues.length, create: cvCreate, overwrite: cvOverwrite },
    executionPresets: analyze(bundle.data.executionPresets, current.executionPresets),
    repositories: analyze(bundle.data.repositories, current.repositories),
    plugins: { total: bundle.data.plugins.length, create: pluginCreate, overwrite: pluginOverwrite }
  };
}

export function formatBackupFileName(now = new Date()): string {
  const stamp = formatExportStamp(now);
  return `actiondock-backup-${stamp}.zip`;
}
