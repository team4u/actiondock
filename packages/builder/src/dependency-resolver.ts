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
 * ActionDock 配置加密主密钥与身份标记的规范文件名（位于密钥目录 keys 内）。
 *
 * 命名事实源为 core/security/config-key.ts 的 resolveKeyPaths：
 * 密钥文件 config.key、身份标记 config.key.id。
 */
const CONFIG_KEY_FILE_NAMES = ["config.key", "config.key.id"];

/**
 * 判断文件名是否为 ActionDock 配置加密密钥资产。
 *
 * 密钥发布采用原子硬链接，临时文件名为 .{原名}.tmp.{pid}.{uuid}
 * （core/security/config-key.ts 的 publishAtomically）；失败清理为尽力而为，
 * 残留临时名同样可能出现在密钥目录内，须一并识别。
 */
function isConfigKeyArtifactName(fileName: string): boolean {
  for (const name of CONFIG_KEY_FILE_NAMES) {
    if (fileName === name || fileName.startsWith(`.${name}.tmp.`)) {
      return true;
    }
  }
  return false;
}

/** 运行环境配置不得进入分发产物；普通业务 bindings.json 不受影响。 */
export function isRuntimeConfigFile(relPath: string): boolean {
  const segments = relPath.replace(/\\/g, "/").split("/");
  const fileName = segments.at(-1) ?? "";
  if (segments.includes(".actiondock") || fileName === "profiles.json") {
    return true;
  }
  // 配置加密主密钥仅落在密钥目录 keys 内：dataDir 定位为 <dataDir>/keys，
  // 主目录定位为 .actiondock/keys（后者已被上方 .actiondock 分支覆盖）。
  // 仅在 keys 目录上下文下精确排除，普通业务 keys 目录内的其他文件
  // （如 keys/data.json、keys/api.key）与密钥目录外的同名业务资产不受影响。
  return segments.at(-2) === "keys" && isConfigKeyArtifactName(fileName);
}

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
    isRuntimeConfigFile(normalized) ||
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
