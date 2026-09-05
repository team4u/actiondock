import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionDockManifest, ActionManifestEntry } from "./types";

export const MANIFEST_FILE_NAME = "actiondock.manifest.json";

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
