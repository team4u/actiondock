import type { ScriptDefinition, ScriptStatus, ScriptType } from "./types";

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

const SUPPORTED_SCRIPT_TYPE: ScriptType = "GROOVY";
const SUPPORTED_STATUSES: ScriptStatus[] = ["DRAFT", "PUBLISHED"];

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

function assertSchemaObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  return value;
}

function parseScriptDefinition(value: unknown, index: number): ScriptDefinition {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条脚本不是对象`);
  }

  const id = value.id;
  const name = value.name;
  const source = value.source;
  const type = value.type;
  const status = value.status;
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
  if (type !== SUPPORTED_SCRIPT_TYPE) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 的 type 仅支持 ${SUPPORTED_SCRIPT_TYPE}`);
  }
  if (!SUPPORTED_STATUSES.includes(status as ScriptStatus)) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 的 status 不合法`);
  }
  if (!Number.isInteger(version) || Number(version) <= 0) {
    throw new Error(`第 ${index + 1} 条脚本 ${id} 的 version 必须是正整数`);
  }

  return {
    id: id.trim(),
    name: name.trim(),
    type: SUPPORTED_SCRIPT_TYPE,
    source,
    inputSchema: assertSchemaObject(value.inputSchema, `第 ${index + 1} 条脚本 ${id} 的 inputSchema`),
    outputSchema: assertSchemaObject(value.outputSchema, `第 ${index + 1} 条脚本 ${id} 的 outputSchema`),
    status: status as ScriptStatus,
    version: Number(version),
    createdAt: assertOptionalString(value.createdAt, `第 ${index + 1} 条脚本 ${id} 的 createdAt`),
    updatedAt: assertOptionalString(value.updatedAt, `第 ${index + 1} 条脚本 ${id} 的 updatedAt`)
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
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `scriptflow-scripts-${year}${month}${day}-${hour}${minute}${second}.json`;
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
