import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isOwnAction } from "./types";
import type {
  ActionDependency,
  AssetDependency,
  PlaybookPlanEntry,
  SelectionPlan,
} from "./types";

/**
 * stageSources 共享拷贝内核。
 *
 * build 与 pack 两个同名 stageSources 的拷贝循环（Action 入口、Playbook、
 * modulesAndAssets）重叠约七成，差异仅在编译排除与目标路径细节；
 * 本模块收敛为单一拷贝实现，各链路通过谓词与目标路径计算函数分化差异，
 * 产物文件清单保持不变。
 */

/**
 * 共享拷贝内核选项：各链路仅通过谓词分化差异。
 */
export interface CopyPlanEntriesOptions {
  /** Action 入口拷贝谓词（如 build 拷贝全部自有入口、pack 仅拷贝非 TypeScript 入口） */
  copyAction?: (action: ActionDependency) => boolean;
  /** modulesAndAssets 拷贝谓词（如 pack 跳过已编译的 TypeScript 模块） */
  copyModule?: (dep: AssetDependency) => boolean;
  /** Playbook 目标相对路径计算（build 收敛到 playbooksDir，pack 保留源工程相对路径） */
  playbookRelPath?: (playbook: PlaybookPlanEntry) => string;
}

/** 拷贝单个文件到目标相对路径，自动创建父目录 */
function copyPlanFile(stagingDir: string, srcPath: string, relPath: string): void {
  const destPath = join(stagingDir, relPath);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}

/**
 * stageSources 共享拷贝内核：Action 入口、Playbook 规程、modulesAndAssets 三类条目的统一物化。
 * 返回已拷贝 Action 入口的相对导入说明符清单（build 的入口生成使用，pack 忽略）。
 */
export function copyPlanEntries(
  stagingDir: string,
  plan: SelectionPlan,
  options: CopyPlanEntriesOptions = {}
): string[] {
  // 拷贝 Action 源码文件，保留相对路径（仅拷贝包自有 Action，跨包外部依赖不物化进本包目录）
  const relativeActionImports: string[] = [];
  for (const act of plan.actions) {
    if (!isOwnAction(act)) {
      continue;
    }
    if (options.copyAction && !options.copyAction(act)) {
      continue;
    }
    if (existsSync(act.resolvedPath)) {
      copyPlanFile(stagingDir, act.resolvedPath, act.entry);
      relativeActionImports.push(`./${act.entry.replace(/\\/g, "/")}`);
    }
  }

  // 拷贝 Playbook 规程文件
  if (plan.playbooks.length > 0) {
    const defaultPlaybooksDir = plan.playbooksDir || "playbooks";
    for (const pb of plan.playbooks) {
      if (!existsSync(pb.filePath)) {
        continue;
      }
      const relPath = options.playbookRelPath
        ? options.playbookRelPath(pb)
        : join(defaultPlaybooksDir, basename(pb.filePath));
      copyPlanFile(stagingDir, pb.filePath, relPath);
    }
  }

  // 拷贝声明的代码文件与静态资产
  for (const dep of plan.dependencies.modulesAndAssets) {
    if (
      (dep.type === "asset" || dep.type === "module" || dep.type === "file") &&
      existsSync(dep.resolvedPath) &&
      (!options.copyModule || options.copyModule(dep))
    ) {
      copyPlanFile(stagingDir, dep.resolvedPath, dep.path);
    }
  }

  return relativeActionImports;
}
