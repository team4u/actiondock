import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { getPackageSlug } from "../utils";
import {
  createPackageIdConflictError,
  isSameRealPath,
} from "./package-conflict";
import type { LinkedPackageEntry } from "./types";

/**
 * 判定 packageIdOrPath 是否为显式文件系统路径或无参数，并尝试直接解析为工程根目录。
 * 共享解析规则，使无参数或显式物理路径跳过全局注册表候选检索，避免无关全局冲突中断。
 */
export function resolveDirectProjectPath(
  packageIdOrPath: string | undefined,
  cwd: string | undefined
): { resolved: true; root: string | null } | { resolved: false } {
  if (!packageIdOrPath) {
    return { resolved: true, root: findProjectRoot(cwd) };
  }

  const baseDir = cwd || process.cwd();
  const resolvedPath = resolve(baseDir, packageIdOrPath);

  // 1. 检查 packageIdOrPath 是否为磁盘上现存的目录或文件路径
  if (existsSync(resolvedPath)) {
    try {
      const info = statSync(resolvedPath);
      const targetDir = info.isDirectory() ? resolvedPath : dirname(resolvedPath);
      if (existsSync(join(targetDir, "actiondock.json"))) {
        return { resolved: true, root: targetDir };
      }
      const parentRoot = findProjectRoot(targetDir);
      if (parentRoot) {
        return { resolved: true, root: parentRoot };
      }
    } catch {
      // stat 失败（如并发删除）：忽略并继续走标识符解析路径
    }
  }

  // 显式路径形态但未解析成功的场景：
  // scoped package 标识符（如 @team/tools）虽含 '/' 但属于包 ID 而非文件路径
  const isScopedPackage = packageIdOrPath.startsWith("@");
  const isExplicitPath =
    !isScopedPackage &&
    (packageIdOrPath.startsWith(".") ||
      packageIdOrPath.startsWith("/") ||
      packageIdOrPath.startsWith("~") ||
      packageIdOrPath.includes("/") ||
      packageIdOrPath.includes("\\"));

  if (isExplicitPath) {
    // 显式路径不存在或不是 ActionDock 项目时必须失败，禁止静默回退
    return { resolved: true, root: null };
  }

  return { resolved: false };
}

/**
 * 基于候选链接包列表解析目标包根目录（内部共享解析规则，不公开暴露于 registry/index.ts）。
 *
 * 遵循严格优先级：
 * 1. 显式文件系统路径解析（直接存在或向上探测工程根目录）；
 * 2. 精确完整包 ID 匹配：当前工程优先于短名（slug）匹配，存在同完整 ID 冲突时抛 ActionDockError(PACKAGE_ID_CONFLICT)；
 * 3. 短名（slug）匹配：调用方当前所在工程优先，但若存在与当前工程具有相同完整 ID 的外部链接包，仍须报告冲突；
 * 4. 失效/已删除路径自动忽略，不阻碍有效身份解析与触发伪冲突。
 *
 * @param packageIdOrPath 包标识符或路径
 * @param cwd 当前工作目录
 * @param candidates 链接包候选列表（已过滤或全部）
 */
export function resolvePackageRootWithCandidates(
  packageIdOrPath: string | undefined,
  cwd: string | undefined,
  candidates: LinkedPackageEntry[]
): string | null {
  const direct = resolveDirectProjectPath(packageIdOrPath, cwd);
  if (direct.resolved) {
    return direct.root;
  }

  // 2. 检查当前本地工程（自 cwd 向上探测）
  const currentRoot = findProjectRoot(cwd);
  let currentConfigId: string | undefined;
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      currentConfigId = config.id;
    } catch {
      // 当前工程配置损坏：忽略，不作为有效身份参与冲突
    }
  }

  const currentExactMatch = Boolean(currentConfigId && currentConfigId === packageIdOrPath);
  const currentSlugMatch = Boolean(
    currentConfigId && getPackageSlug(currentConfigId) === packageIdOrPath
  );

  // 3. 过滤存活的有效候选包（排除不存在或损坏的项目）
  const liveCandidates = candidates.filter((p) => p && p.path && existsSync(p.path));

  // 精确 ID 匹配
  const exactCandidate = liveCandidates.find((p) => p.id === packageIdOrPath);

  // 短名 slug 匹配
  const slugCandidate = liveCandidates.find((p) => getPackageSlug(p.id) === packageIdOrPath);

  // 4. 解析优先级判定：
  // 规则 A：当前工程精确全 ID 匹配
  if (currentExactMatch && currentRoot && currentConfigId) {
    if (exactCandidate) {
      if (!isSameRealPath(currentRoot, exactCandidate.path)) {
        throw createPackageIdConflictError(
          { id: exactCandidate.id, path: exactCandidate.path, workspaceRoot: exactCandidate.workspaceRoot },
          { id: currentConfigId, path: currentRoot, isCurrentProject: true }
        );
      }
      return currentRoot;
    }
    // 即使外部候选存在同 slug 短名匹配，当前工程的精确完整 ID 优先，绝不触发短名冲突
    return currentRoot;
  }

  // 规则 B：外部候选包精确全 ID 匹配
  if (exactCandidate) {
    return exactCandidate.path;
  }

  // 规则 C：短名（slug）匹配：调用方当前所在工程优先
  if (currentSlugMatch && currentRoot && currentConfigId) {
    // 检查外部链接包中是否含有与当前工程相同完整 ID 的来源
    // 当前与链接均为相同完整 ID（如 team.tools），按 slug（tools）查询仍应抛出 PACKAGE_ID_CONFLICT
    const sameFullIdCandidate = liveCandidates.find(
      (p) => p.id === currentConfigId && !isSameRealPath(currentRoot, p.path)
    );
    if (sameFullIdCandidate) {
      throw createPackageIdConflictError(
        { id: sameFullIdCandidate.id, path: sameFullIdCandidate.path, workspaceRoot: sameFullIdCandidate.workspaceRoot },
        { id: currentConfigId, path: currentRoot, isCurrentProject: true }
      );
    }
    // 只有不同完整 ID 且同 slug 时，才允许当前工程优先返回
    return currentRoot;
  }

  // 规则 D：外部候选包短名匹配
  if (slugCandidate) {
    return slugCandidate.path;
  }

  return null;
}
