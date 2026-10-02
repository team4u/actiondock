import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PlannerError } from "./errors";
import type { ExternalDependency } from "./types";

/**
 * 测试与类型声明文件后缀常量（供 fallback 清单过滤与 isIgnoredPath 共享同一口径）。
 */
export const TEST_FILE_SUFFIXES = [
  ".test.ts",
  ".test.js",
  ".test.tsx",
  ".test.jsx",
  ".spec.ts",
  ".spec.js",
  ".spec.tsx",
  ".spec.jsx",
  ".d.ts",
];

/**
 * 忽略的文件模式判断（排除测试文件、类型声明文件以及构建/版本控制等私有目录）。
 */
export function isIgnoredPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return (
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith(".actiondock/") ||
    TEST_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

/**
 * 收集项目根目录 package.json 中声明的外部 npm 依赖。
 *
 * 防御与透明原则：文件不存在返回空集合（合法的无依赖工程）；
 * 文件存在但不可读或 JSON 损坏时抛 PlannerError 并携带路径与原因，
 * 严禁静默吞掉导致后续 build 的生产依赖、pack 的产物依赖与 vendorDeps 全部无声缺失。
 */
export function extractExternalDependencies(projectRoot: string): ExternalDependency[] {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return [];

  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(pkgPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new PlannerError(
      `Failed to read or parse package.json at ${pkgPath}: ${err?.message || String(err)}`,
      "EXTRACT_DEPS_ERROR"
    );
  }

  const deps: ExternalDependency[] = [];

  if (parsed.dependencies && typeof parsed.dependencies === "object") {
    for (const [name, versionRange] of Object.entries(parsed.dependencies as Record<string, unknown>)) {
      deps.push({
        name,
        versionRange: String(versionRange),
        isDev: false,
      });
    }
  }

  if (parsed.devDependencies && typeof parsed.devDependencies === "object") {
    for (const [name, versionRange] of Object.entries(parsed.devDependencies as Record<string, unknown>)) {
      deps.push({
        name,
        versionRange: String(versionRange),
        isDev: true,
      });
    }
  }

  return deps;
}
