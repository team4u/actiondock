import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPackageSlug, loadProjectConfig } from "@actiondock/core";
import { BuilderError } from "./errors";
import type {
  BatchSkillExportOptions,
  BatchSkillExportResult,
  SkillExportResult,
  SkillExporterOptions,
} from "./types";

/**
 * 批量 Skill 导出装配层。
 *
 * 职责：按项目根目录列表逐一执行单包导出并聚合统计结果，
 * 目录名冲突时回退为原始 Package ID 的安全形式。
 */

/** 单包导出回调：由 SkillExporter 注入自身导出能力，避免模块间循环依赖 */
export type SingleSkillExporter = (
  options: SkillExporterOptions
) => Promise<SkillExportResult>;

/**
 * 执行批量导出多个 Skill。
 */
export async function exportBatchImpl(
  options: BatchSkillExportOptions,
  exportSingle: SingleSkillExporter
): Promise<BatchSkillExportResult> {
  if (!options.projectRoots || options.projectRoots.length === 0) {
    throw new BuilderError("No project roots provided for batch skill export.");
  }

  const results: SkillExportResult[] = [];
  const baseOutDir = resolve(options.outDir || join(process.cwd(), "dist", "skills"));
  mkdirSync(baseOutDir, { recursive: true });

  const usedDirNames = new Set<string>();
  for (const projectRoot of options.projectRoots) {
    const config = loadProjectConfig(projectRoot);
    let pkgSlug = getPackageSlug(config.id);
    if (usedDirNames.has(pkgSlug)) {
      pkgSlug = config.id.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
    }
    usedDirNames.add(pkgSlug);

    const pkgOutDir = join(baseOutDir, `${pkgSlug}-skill`);

    const res = await exportSingle({
      ...options,
      projectRoot,
      outDir: pkgOutDir,
    });
    results.push(res);
  }

  const totalActions = results.reduce((sum, r) => sum + r.actionsCount, 0);
  const totalPlaybooks = results.reduce((sum, r) => sum + r.playbooksCount, 0);

  return {
    results,
    outDir: baseOutDir,
    totalActions,
    totalPlaybooks,
  };
}
