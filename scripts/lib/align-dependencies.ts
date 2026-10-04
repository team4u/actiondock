/**
 * 工程脚本域共享的包清单内部依赖对齐辅助（bump-version 复用的单一事实源）。
 *
 * 预发布版本必须与目标版本号严格对齐（不加 ^ 前缀），否则 npm 无法匹配
 * 预发布版本而回退加载旧稳定版；正式版本沿用 ^ 范围语义。
 */

/** 计算目标版本对应的内部依赖版本串 */
export function internalDependencyRange(targetVersion: string): string {
  return targetVersion.includes("-") ? targetVersion : `^${targetVersion}`;
}

/**
 * 将包清单对象中全部 @actiondock/ 前缀依赖对齐至目标版本（原地更新）。
 *
 * 遍历 dependencies / peerDependencies / devDependencies 三类依赖声明，
 * 非本域依赖保持原值；未声明的依赖段跳过，不创建空段。
 */
export function alignInternalDependencies(pkg: Record<string, unknown>, targetVersion: string): void {
  const range = internalDependencyRange(targetVersion);
  for (const field of ["dependencies", "peerDependencies", "devDependencies"] as const) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith("@actiondock/")) {
        (deps as Record<string, string>)[dep] = range;
      }
    }
  }
}
