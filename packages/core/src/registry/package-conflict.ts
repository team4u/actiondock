import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ActionDockError, PACKAGE_ID_CONFLICT } from "../errors";

/**
 * 包位置描述元数据（用于冲突定位与恢复指引）。
 */
export interface PackageLocationInfo {
  id: string;
  path: string;
  workspaceRoot?: string;
  isCurrentProject?: boolean;
}

/**
 * 将文件路径安全格式化为可直接在 CLI 中复制执行的参数形式（带引号转义）。
 */
export function quotePathForCli(
  pathStr: string,
  platform: NodeJS.Platform = process.platform
): string {
  // Windows 提示面向 PowerShell；其他平台使用 POSIX Shell 的单引号规则。
  // 始终引用，避免空格、变量、命令替换及运算符改变路径含义。
  const escaped = platform === "win32"
    ? pathStr.replace(/'/g, "''")
    : pathStr.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

/**
 * 安全解析真实物理路径。
 * 仅对明确的路径失效异常（ENOENT 与 ENOTDIR）回退至 resolve 绝对路径，
 * 其余系统异常（如权限不足 EACCES / EPERM）向上传播。
 */
export function safeRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
      return resolve(p);
    }
    throw err;
  }
}

/**
 * 比较两物理路径是否指向同一底层目录（支持符号链接、Windows junction 别名去重）。
 * 相同字符串路径直接短路返回 true。
 */
export function isSameRealPath(pathA: string, pathB: string): boolean {
  if (pathA === pathB) return true;
  return safeRealPath(pathA) === safeRealPath(pathB);
}

/**
 * 统一包冲突详情结构（单一事实源命名，无冗余同义字段）。
 */
export interface PackageConflictDetails {
  packageId: string;
  existingPath: string;
  incomingPath: string;
  existingWorkspaceRoot?: string;
  incomingWorkspaceRoot?: string;
  hint: string;
}

/**
 * 构造统一的包标识冲突异常（PACKAGE_ID_CONFLICT）。
 * - 错误消息含双方路径及工作区来源；
 * - details 字段命名收敛（packageId、existingPath、incomingPath、existingWorkspaceRoot、incomingWorkspaceRoot、hint）；
 * - 恢复指引优先指导解除工作区根目录，区分未链接当前工程与已链接来源，带安全引号。
 */
export function createPackageIdConflictError(
  existing: PackageLocationInfo,
  incoming: PackageLocationInfo
): ActionDockError<PackageConflictDetails> {
  let unlinkAdvice: string;
  if (existing.workspaceRoot) {
    unlinkAdvice = `请先执行 'ad unlink ${quotePathForCli(existing.workspaceRoot)}' 解除所属工作区根目录（注意：解除工作区会连带解除该工作区下的所有其他子包），然后再执行 'ad link'。`;
  } else if (incoming.workspaceRoot) {
    unlinkAdvice = `请先执行 'ad unlink ${quotePathForCli(incoming.workspaceRoot)}' 解除所属工作区根目录（注意：解除工作区会连带解除该工作区下的所有其他子包），然后再执行 'ad link'。`;
  } else if (existing.isCurrentProject) {
    unlinkAdvice = `当前工作目录为未链接的本地工程，无法通过 unlink 解除；请先执行 'ad unlink ${quotePathForCli(incoming.path)}' 解除另一侧已链接的冲突包，然后再执行 'ad link'。`;
  } else if (incoming.isCurrentProject) {
    unlinkAdvice = `当前工作目录为未链接的本地工程，无法通过 unlink 解除；请先执行 'ad unlink ${quotePathForCli(existing.path)}' 解除另一侧已链接的冲突包，然后再执行 'ad link'。`;
  } else {
    unlinkAdvice = `请根据需要执行 'ad unlink ${quotePathForCli(existing.path)}' 或 'ad unlink ${quotePathForCli(incoming.path)}' 解除冲突来源（若其中一方为未链接的本地工程，请解除另一侧已链接的来源），然后再执行 'ad link'。`;
  }

  const hint = `检测到相同的包标识 '${incoming.id}' 存在于不同的物理路径。ActionDock 默认拒绝并要求保持身份唯一性。${unlinkAdvice}`;

  const existingLoc = existing.workspaceRoot
    ? `'${existing.path}' (workspace: '${existing.workspaceRoot}')`
    : `'${existing.path}'`;
  const incomingLoc = incoming.workspaceRoot
    ? `'${incoming.path}' (workspace: '${incoming.workspaceRoot}')`
    : `'${incoming.path}'`;

  const message = `PACKAGE_ID_CONFLICT: Package ID '${incoming.id}' is declared by multiple locations: ${existingLoc} and ${incomingLoc}`;

  const details: PackageConflictDetails = {
    packageId: incoming.id,
    existingPath: existing.path,
    incomingPath: incoming.path,
    existingWorkspaceRoot: existing.workspaceRoot,
    incomingWorkspaceRoot: incoming.workspaceRoot,
    hint,
  };

  return new ActionDockError(
    PACKAGE_ID_CONFLICT,
    message,
    details,
    undefined,
    hint
  );
}
