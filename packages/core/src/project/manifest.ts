import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { ActionDockManifest } from "./types";
import { isPathOutsideBoundary, PACKAGE_ID_REGEX } from "../utils";

export const MANIFEST_FILE_NAME = "actiondock.json";

export const ACTION_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
export const PLAYBOOK_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * 读取并解析项目的声明式清单文件（actiondock.json 为唯一事实源）。
 * 若文件不存在则返回 null。
 */
export function loadManifest(projectRoot: string): ActionDockManifest | null {
  const filePath = join(projectRoot, MANIFEST_FILE_NAME);
  if (!existsSync(filePath)) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    throw new Error(`Failed to read manifest at ${filePath}: ${err.message}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Corrupted JSON in manifest at ${filePath}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid manifest format in ${filePath}: expected a JSON object`);
  }

  if (
    parsed.schemaVersion !== undefined &&
    (typeof parsed.schemaVersion !== "number" || parsed.schemaVersion < 1 || parsed.schemaVersion > 2)
  ) {
    throw new Error(
      `Unsupported manifest schemaVersion in ${filePath}: received '${parsed.schemaVersion}', expected 2`
    );
  }

  if (!parsed.id) {
    parsed.id = basename(projectRoot);
  }

  return parsed as ActionDockManifest;
}

/**
 * 保存声明式清单文件至项目根目录（actiondock.json）。
 */
export function saveManifest(projectRoot: string, manifest: ActionDockManifest): void {
  const filePath = join(projectRoot, MANIFEST_FILE_NAME);
  writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/**
 * 校验清单数据结构的合法性与安全性。
 */
export function validateManifest(
  manifest: unknown,
  options?: { projectRoot?: string }
): { valid: boolean; errors?: string[] } {
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest must be an object"] };
  }
  const m = manifest as ActionDockManifest;
  const errors: string[] = [];

  if (
    m.schemaVersion !== undefined &&
    (typeof m.schemaVersion !== "number" || m.schemaVersion < 1 || m.schemaVersion > 2)
  ) {
    errors.push(`Manifest 'schemaVersion' must be 1 or 2 (received '${m.schemaVersion}')`);
  }

  if (m.id !== undefined) {
    if (typeof m.id !== "string" || !PACKAGE_ID_REGEX.test(m.id)) {
      errors.push(`Manifest 'id' is invalid: '${m.id}' (must match ${PACKAGE_ID_REGEX})`);
    }
  }

  if (m.actions !== undefined) {
    if (!m.actions || typeof m.actions !== "object" || Array.isArray(m.actions)) {
      errors.push("Manifest 'actions' must be an object");
    } else {
      for (const [actionId, item] of Object.entries(m.actions)) {
        if (!ACTION_ID_REGEX.test(actionId)) {
          errors.push(`Invalid action ID '${actionId}' in manifest. Action IDs must match ${ACTION_ID_REGEX}`);
        }
        if (!item || typeof item !== "object") {
          errors.push(`Action entry '${actionId}' must be an object`);
          continue;
        }
        if (!item.entry || typeof item.entry !== "string") {
          errors.push(`Action '${actionId}' must specify string 'entry'`);
        } else {
          if (isAbsolute(item.entry)) {
            errors.push(`Action '${actionId}' entry cannot be an absolute path: ${item.entry}`);
          } else if (item.entry.split("/").some((part) => part === ".." || part === "\\..")) {
            errors.push(`Action '${actionId}' entry cannot contain path traversal: ${item.entry}`);
          } else if (options?.projectRoot) {
            const resolvedPath = resolve(options.projectRoot, item.entry);
            const rel = relative(options.projectRoot, resolvedPath);
            if (isPathOutsideBoundary(rel)) {
              errors.push(`Action '${actionId}' entry escapes project root: ${item.entry}`);
            } else if (existsSync(resolvedPath)) {
              try {
                const realEntry = realpathSync(resolvedPath);
                const realRoot = realpathSync(options.projectRoot);
                const relReal = relative(realRoot, realEntry);
                if (isPathOutsideBoundary(relReal)) {
                  errors.push(`Action '${actionId}' entry symlink resolves outside project root: ${item.entry}`);
                }
              } catch (err: any) {
                errors.push(`Failed to resolve real path for Action '${actionId}': ${err.message}`);
              }
            }
          }
        }
        if (item.uses && !Array.isArray(item.uses)) {
          errors.push(`Action '${actionId}' property 'uses' must be an array`);
        }
        if (item.tags && !Array.isArray(item.tags)) {
          errors.push(`Action '${actionId}' property 'tags' must be an array`);
        }
      }
    }
  }

  if (m.playbooks !== undefined) {
    if (!m.playbooks || typeof m.playbooks !== "object" || Array.isArray(m.playbooks)) {
      errors.push("Manifest 'playbooks' must be an object");
    } else {
      for (const [playbookId, item] of Object.entries(m.playbooks)) {
        if (!PLAYBOOK_ID_REGEX.test(playbookId)) {
          errors.push(`Invalid playbook ID '${playbookId}' in manifest. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`);
        }
        if (!item || typeof item !== "object") {
          errors.push(`Playbook entry '${playbookId}' must be an object`);
          continue;
        }
        if (!item.entry || typeof item.entry !== "string") {
          errors.push(`Playbook '${playbookId}' must specify string 'entry'`);
        } else {
          if (isAbsolute(item.entry)) {
            errors.push(`Playbook '${playbookId}' entry cannot be an absolute path: ${item.entry}`);
          } else if (item.entry.split("/").some((part) => part === ".." || part === "\\..")) {
            errors.push(`Playbook '${playbookId}' entry cannot contain path traversal: ${item.entry}`);
          } else if (options?.projectRoot) {
            const resolvedPath = resolve(options.projectRoot, item.entry);
            const rel = relative(options.projectRoot, resolvedPath);
            if (isPathOutsideBoundary(rel)) {
              errors.push(`Playbook '${playbookId}' entry escapes project root: ${item.entry}`);
            } else if (existsSync(resolvedPath)) {
              try {
                const realEntry = realpathSync(resolvedPath);
                const realRoot = realpathSync(options.projectRoot);
                const relReal = relative(realRoot, realEntry);
                if (isPathOutsideBoundary(relReal)) {
                  errors.push(`Playbook '${playbookId}' entry symlink resolves outside project root: ${item.entry}`);
                }
              } catch (err: any) {
                errors.push(`Failed to resolve real path for Playbook '${playbookId}': ${err.message}`);
              }
            }
          }
        }
        if (item.actions && !Array.isArray(item.actions)) {
          errors.push(`Playbook '${playbookId}' property 'actions' must be an array`);
        }
      }
    }
  }

  if (m.dependencies !== undefined) {
    if (!m.dependencies || typeof m.dependencies !== "object" || Array.isArray(m.dependencies)) {
      errors.push("Manifest 'dependencies' must be an object");
    }
  }

  if (m.assets !== undefined) {
    if (!Array.isArray(m.assets)) {
      errors.push("Manifest 'assets' must be an array");
    } else {
      for (const asset of m.assets) {
        if (typeof asset !== "string") {
          errors.push("Asset entry must be a string");
        } else if (isAbsolute(asset)) {
          errors.push(`Asset path cannot be an absolute path: ${asset}`);
        } else if (asset.split("/").some((part) => part === ".." || part === "\\..")) {
          errors.push(`Asset path cannot contain path traversal: ${asset}`);
        } else if (options?.projectRoot) {
          const resolvedPath = resolve(options.projectRoot, asset);
          const rel = relative(options.projectRoot, resolvedPath);
          if (isPathOutsideBoundary(rel)) {
            errors.push(`Asset path escapes project root: ${asset}`);
          } else if (existsSync(resolvedPath)) {
            try {
              const realAsset = realpathSync(resolvedPath);
              const realRoot = realpathSync(options.projectRoot);
              const relReal = relative(realRoot, realAsset);
              if (isPathOutsideBoundary(relReal)) {
                errors.push(`Asset symlink resolves outside project root: ${asset}`);
              }
            } catch (err: any) {
              errors.push(`Failed to resolve real path for asset '${asset}': ${err.message}`);
            }
          }
        }
      }
    }
  }

  if (m.files !== undefined && !Array.isArray(m.files)) {
    errors.push("Manifest 'files' must be an array");
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}


