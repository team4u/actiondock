import { readdirSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadProjectConfig } from "../project/loader";
import type { LinkedPackageEntry } from "./types";

/**
 * 目录扫描时跳过的非项目目录（依赖缓存、构建产物与编辑器配置等）。
 */
export const IGNORED_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".gemini",
  ".actiondock",
  ".claude",
  ".idea",
  ".vscode",
]);

/**
 * 递归扫描包含 actiondock.json 的子项目根目录（同步版本）。
 */
export function discoverProjects(dir: string, maxDepth: number = 3): string[] {
  const results: string[] = [];
  const resolvedDir = resolve(dir);

  function walk(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      const hasActiondock = entries.some((e) => e.isFile() && e.name === "actiondock.json");

      if (hasActiondock && currentDir !== resolvedDir) {
        results.push(currentDir);
        return; // 不再向项目内部子目录递归
      }

      for (const entry of entries) {
        if (entry.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name)) {
          walk(join(currentDir, entry.name), currentDepth + 1);
        }
      }
    } catch {
      // 忽略无法读取的目录：扫描是尽力而为的探测，单目录不可读不应中断整体发现
    }
  }

  walk(resolvedDir, 1);
  return results;
}

/**
 * 递归扫描包含 actiondock.json 的子项目根目录（异步版本，逻辑与同步版一致）。
 */
export async function discoverProjectsAsync(dir: string, maxDepth: number = 3): Promise<string[]> {
  const results: string[] = [];
  const resolvedDir = resolve(dir);

  async function walk(currentDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      // 忽略无法读取的目录：扫描是尽力而为的探测，单目录不可读不应中断整体发现
      return;
    }

    const hasActiondock = entries.some((e) => e.isFile() && e.name === "actiondock.json");
    if (hasActiondock && currentDir !== resolvedDir) {
      results.push(currentDir);
      return; // 不再向项目内部子目录递归
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name)) {
        await walk(join(currentDir, entry.name), currentDepth + 1);
      }
    }
  }

  await walk(resolvedDir, 1);
  return results;
}

/**
 * 扫描并加载全部子项目配置（同步版本）。
 * 损坏项目（配置缺失或非法）跳过不中断：注册表操作面对的是外部任意目录，
 * 单个损坏项目不应阻塞其余项目的正常链接与解析。
 */
export function discoverProjectConfigs(dir: string, maxDepth: number = 3): Array<{
  root: string;
  config: ReturnType<typeof loadProjectConfig>;
}> {
  const results: Array<{ root: string; config: ReturnType<typeof loadProjectConfig> }> = [];
  for (const root of discoverProjects(dir, maxDepth)) {
    try {
      results.push({ root, config: loadProjectConfig(root) });
    } catch {
      // 跳过损坏项目：其 actiondock.json 缺失必要字段或非法，无法构成有效链接条目
    }
  }
  return results;
}

/**
 * 扫描并加载全部子项目配置（异步版本，跳过策略与同步版一致）。
 */
export async function discoverProjectConfigsAsync(dir: string, maxDepth: number = 3): Promise<Array<{
  root: string;
  config: ReturnType<typeof loadProjectConfig>;
}>> {
  const results: Array<{ root: string; config: ReturnType<typeof loadProjectConfig> }> = [];
  for (const root of await discoverProjectsAsync(dir, maxDepth)) {
    try {
      results.push({ root, config: loadProjectConfig(root) });
    } catch {
      // 跳过损坏项目：其 actiondock.json 缺失必要字段或非法，无法构成有效链接条目
    }
  }
  return results;
}

/**
 * 由项目配置构造注册表链接条目（纯函数，无副作用）。
 */
export function buildLinkedPackageEntry(
  config: ReturnType<typeof loadProjectConfig>,
  path: string,
  linkedAt: string,
  workspaceRoot?: string
): LinkedPackageEntry {
  return {
    id: config.id,
    name: config.name || config.id,
    version: config.version || "0.0.0",
    path,
    linkedAt,
    ...(workspaceRoot ? { workspaceRoot } : {}),
  };
}

/**
 * 异步探测路径是否存在。
 */
export async function pathExistsAsync(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
