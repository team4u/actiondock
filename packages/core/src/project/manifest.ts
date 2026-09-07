import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadActionFileMap, loadProjectConfig } from "./loader";
import type {
  ActionDockManifest,
  ActionManifestEntry,
  ManifestSyncChange,
  ManifestSyncResult,
  SyncManifestOptions,
} from "./types";

export const MANIFEST_FILE_NAME = "actiondock.manifest.json";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const arrB = b as unknown[];
    if (a.length !== arrB.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], arrB[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * 读取并解析项目的声明式清单文件。
 * 若文件不存在则返回 null。
 */
export function loadManifest(projectRoot: string): ActionDockManifest | null {
  const filePath = join(projectRoot, MANIFEST_FILE_NAME);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ActionDockManifest;
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 保存声明式清单文件至项目根目录。
 */
export function saveManifest(projectRoot: string, manifest: ActionDockManifest): void {
  const filePath = join(projectRoot, MANIFEST_FILE_NAME);
  writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/**
 * 校验清单数据结构的合法性。
 */
export function validateManifest(manifest: unknown): { valid: boolean; errors?: string[] } {
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest must be an object"] };
  }
  const m = manifest as ActionDockManifest;
  const errors: string[] = [];

  if (m.schemaVersion !== 1) {
    errors.push("Manifest 'schemaVersion' must be 1");
  }
  if (!m.actions || typeof m.actions !== "object") {
    errors.push("Manifest 'actions' must be an object");
  } else {
    for (const [actionId, item] of Object.entries(m.actions)) {
      if (!item || typeof item !== "object") {
        errors.push(`Action entry '${actionId}' must be an object`);
        continue;
      }
      if (!item.entry || typeof item.entry !== "string") {
        errors.push(`Action '${actionId}' must specify string 'entry'`);
      }
      if (item.uses && !Array.isArray(item.uses)) {
        errors.push(`Action '${actionId}' property 'uses' must be an array`);
      }
      if (item.tags && !Array.isArray(item.tags)) {
        errors.push(`Action '${actionId}' property 'tags' must be an array`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * 为单个 Action 构建清单项。
 */
export function createManifestEntry(options: {
  entry: string;
  description?: string;
  inputSchema?: Record<string, unknown> | boolean;
  outputSchema?: Record<string, unknown> | boolean;
  uses?: string[];
  tags?: string[];
  annotations?: Record<string, unknown>;
}): ActionManifestEntry {
  return {
    entry: options.entry,
    description: options.description,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    uses: options.uses || [],
    tags: options.tags || [],
    annotations: options.annotations,
  };
}

/**
 * 依据动作源码目录中的 Action 定义，增量同步或校验 actiondock.manifest.json 文件。
 * 
 * @param projectRoot 项目根目录绝对路径
 * @param options 同步选项（包括 actionsDir、check、prune、autoInstall）
 * @returns 同步变更结果报告
 */
export async function syncManifest(
  projectRoot: string,
  options: SyncManifestOptions = {}
): Promise<ManifestSyncResult> {
  const manifestPath = join(projectRoot, MANIFEST_FILE_NAME);

  // 1. 确定 actions 目录
  let actionsDir = options.actionsDir;
  if (!actionsDir) {
    try {
      const config = loadProjectConfig(projectRoot);
      actionsDir = config.actionsDir || "actions";
    } catch {
      actionsDir = "actions";
    }
  }

  // 2. 加载现有清单，不存在则初始化基准结构
  const existingManifest = loadManifest(projectRoot);
  const manifest: ActionDockManifest = existingManifest
    ? {
        schemaVersion: existingManifest.schemaVersion || 1,
        actions: { ...existingManifest.actions },
        assets: existingManifest.assets ? [...existingManifest.assets] : [],
      }
    : {
        schemaVersion: 1,
        actions: {},
        assets: [],
      };

  // 3. 动态加载所有 Action 源码定义
  const actionFileMap = await loadActionFileMap(projectRoot, actionsDir, {
    autoInstall: options.autoInstall !== false,
    strict: true,
  });

  const changes: ManifestSyncChange[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  const scannedActionIds = new Set<string>();

  // 4. 比对源码中的每个 Action 与现有清单项
  for (const [actionId, fileEntry] of actionFileMap.entries()) {
    scannedActionIds.add(actionId);
    const relEntry = relative(projectRoot, fileEntry.filePath).replace(/\\/g, "/");
    const act = fileEntry.action;

    const newManifestEntry: ActionManifestEntry = {
      entry: relEntry,
      description: act.description ?? "",
      inputSchema: act.inputSchema ?? {},
      outputSchema: act.outputSchema ?? {},
      uses: Array.isArray(act.uses) ? [...act.uses] : [],
      tags: Array.isArray(act.tags) ? [...act.tags] : [],
    };
    if (act.annotations && typeof act.annotations === "object") {
      newManifestEntry.annotations = act.annotations;
    }

    const oldManifestEntry = manifest.actions[actionId];

    if (!oldManifestEntry) {
      changes.push({
        actionId,
        type: "added",
        entry: relEntry,
      });
      added.push(actionId);
      if (!options.check) {
        manifest.actions[actionId] = newManifestEntry;
      }
    } else {
      const changedFields: string[] = [];

      if (oldManifestEntry.entry !== newManifestEntry.entry) {
        changedFields.push("entry");
      }
      if ((oldManifestEntry.description ?? "") !== (newManifestEntry.description ?? "")) {
        changedFields.push("description");
      }
      if (!deepEqual(oldManifestEntry.inputSchema ?? {}, newManifestEntry.inputSchema ?? {})) {
        changedFields.push("inputSchema");
      }
      if (!deepEqual(oldManifestEntry.outputSchema ?? {}, newManifestEntry.outputSchema ?? {})) {
        changedFields.push("outputSchema");
      }
      if (!deepEqual(oldManifestEntry.uses ?? [], newManifestEntry.uses ?? [])) {
        changedFields.push("uses");
      }
      if (!deepEqual(oldManifestEntry.tags ?? [], newManifestEntry.tags ?? [])) {
        changedFields.push("tags");
      }
      if (!deepEqual(oldManifestEntry.annotations ?? {}, newManifestEntry.annotations ?? {})) {
        changedFields.push("annotations");
      }

      if (changedFields.length > 0) {
        changes.push({
          actionId,
          type: "updated",
          entry: relEntry,
          changedFields,
        });
        updated.push(actionId);
        if (!options.check) {
          manifest.actions[actionId] = newManifestEntry;
        }
      } else {
        changes.push({
          actionId,
          type: "unchanged",
          entry: relEntry,
        });
        unchanged.push(actionId);
      }
    }
  }

  // 5. 检查清单中存在但源码中已不存在的废弃动作
  for (const [actionId, item] of Object.entries(manifest.actions)) {
    if (!scannedActionIds.has(actionId)) {
      changes.push({
        actionId,
        type: "removed",
        entry: item.entry,
      });
      removed.push(actionId);
      if (!options.check && options.prune !== false) {
        delete manifest.actions[actionId];
      }
    }
  }

  const inSync = added.length === 0 && updated.length === 0 && removed.length === 0;

  // 6. 如果存在变更且非仅检查模式，保存清单文件
  if (!options.check && !inSync) {
    saveManifest(projectRoot, manifest);
  }

  return {
    inSync,
    manifestPath,
    changes,
    added,
    updated,
    removed,
    unchanged,
  };
}

/**
 * 校验当前 actiondock.manifest.json 是否与动作源码定义保持一致（只读检查）。
 */
export async function checkManifestSync(
  projectRoot: string,
  options: Omit<SyncManifestOptions, "check"> = {}
): Promise<ManifestSyncResult> {
  return syncManifest(projectRoot, { ...options, check: true });
}

