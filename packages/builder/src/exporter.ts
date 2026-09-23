import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getPackageSlug } from "@actiondock/core/project";
import { BuilderError } from "./errors";
import { replaceDirAtomic } from "./fs-utils";
import { collectRelativeFiles } from "./fs-utils";
import { SelectionPlanner } from "./planner";
import { isOwnAction } from "./types";
import {
  buildConfigForTemplates,
  findExistingCompositeSkillMd,
  findExistingSingleSkillMd,
  resolveCustomSkillDeclaration,
  writeSkillMd,
} from "./skill-md";
import { createArchive, resolveArchiveFormat } from "./export-archive";
import { stageSourceSkill } from "./export-source";
import { exportNodeSkill } from "./export-node";
import { exportCompositeImpl } from "./export-composite";
import { exportBatchImpl } from "./export-batch";
import type {
  BatchSkillExportOptions,
  BatchSkillExportResult,
  CompositeSkillExportOptions,
  CompositeSkillExportResult,
  SelectionPlan,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";

/**
 * Agent Skill 导出器门面。
 * 仅承担编排职责：单包模式分派、复合/批量流程装配与结果组装，
 * 各导出模式的具体装配逻辑由 export-* 单一职责模块承担。
 */
export class SkillExporter {
  /**
   * 导出 Skill 产物包。
   * 主流程仅做编排，各阶段职责由独立函数承担。
   *
   * @param options 导出配置
   * @returns 导出产物详细描述
   */
  public async export(options: SkillExporterOptions): Promise<SkillExportResult> {
    const root = resolve(options.projectRoot);
    const mode: "source" | "node" = options.mode === "node" ? "node" : "source";

    // 调用 SelectionPlanner 执行声明式构建规划
    const plan = SelectionPlanner.plan({
      projectRoot: root,
      config: options.config,
      manifest: options.manifest,
      actions: options.actions,
      playbooks: options.playbooks,
      skipDependencyValidation: options.skipDependencyValidation,
    });

    const pkgSlug = getPackageSlug(plan.packageId);
    const defaultFolderName = `${pkgSlug}-skill`;
    const defaultSkillDir = join(root, "dist", defaultFolderName);
    const targetSkillDir = resolve(options.outDir || defaultSkillDir);

    const hasExternalDeps = Boolean(
      plan.externalProjectRoots && plan.externalProjectRoots.length > 0
    );

    // 单包源码导出若依赖闭包含外部包，导成 mini-workspace 形态（packages/ 下带齐依赖包），和 bundle 统一成一个交付形状
    // 该复合分支会展开全部依赖包，无法保留调用方传入的 actions/playbooks 过滤选项；
    // 静默丢弃过滤会导致产物全量导出，必须显式拒绝并给出调整指引（CLI 侧已有 roots>1 守卫，此处补齐 composite 分支守卫）
    const hasFilters = Boolean(
      (options.actions && options.actions.length > 0) ||
        (options.playbooks && options.playbooks.length > 0)
    );
    const willUseComposite = mode === "source" && !options._isSubpackage && hasExternalDeps;
    if (hasFilters && willUseComposite) {
      throw new BuilderError(
        "Filtering options (--actions, --playbook) cannot be combined with a source export whose dependency closure spans external linked packages (composite mini-workspace output). Remove the filtering options to export the full closure, or adjust the 'uses' declarations so the closure stays within a single package.",
        "FILTERS_UNSUPPORTED_FOR_COMPOSITE"
      );
    }

    if (willUseComposite) {
      const allProjectRoots = Array.from(
        new Set([root, ...plan.externalProjectRoots!])
      );
      const compositeRes = await this.exportComposite({
        bundleName: plan.packageName || plan.packageId,
        projectRoots: allProjectRoots,
        outDir: targetSkillDir,
        archive: options.archive,
        archiveFormat: resolveArchiveFormat(options),
        workspaceRoot: options.workspaceRoot,
        skillMdPath: options.skillMdPath,
        customMdPath: options.customMdPath,
      });

      return {
        packageId: plan.packageId,
        version: plan.version,
        mode: "source",
        skillDir: compositeRes.skillDir,
        archivePath: compositeRes.archivePath,
        actionsCount: compositeRes.actionsCount,
        playbooksCount: compositeRes.playbooksCount,
        actions: plan.actions.map((a) => a.id),
        playbooks: plan.playbooks.map((p) => p.id),
        files: compositeRes.files,
        usedExistingSkillMd: compositeRes.usedExistingSkillMd,
      };
    }

    if (mode === "node") {
      return exportNodeSkill(root, targetSkillDir, plan, options, pkgSlug);
    }
    return this.exportSourceSkill(root, targetSkillDir, plan, options, pkgSlug);
  }

  /**
   * 源码型 Skill 导出：暂存目录内完成清单、说明书与源码装配后原子替换目标目录。
   */
  private async exportSourceSkill(
    root: string,
    targetSkillDir: string,
    plan: SelectionPlan,
    options: SkillExporterOptions,
    pkgSlug: string
  ): Promise<SkillExportResult> {
    const parentDir = dirname(targetSkillDir);
    mkdirSync(parentDir, { recursive: true });

    const stagingDir = join(
      parentDir,
      `.tmp-${basename(targetSkillDir)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(stagingDir, { recursive: true });

    let usedExistingSkillMd: string | undefined;

    try {
      usedExistingSkillMd = stageSourceSkill(root, stagingDir, plan, options, pkgSlug);
      await replaceDirAtomic(stagingDir, targetSkillDir);
    } finally {
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }

    let archivePath: string | undefined;
    if (options.archive) {
      archivePath = await createArchive(targetSkillDir, resolveArchiveFormat(options));
    }

    const ownActions = plan.actions.filter((a) => isOwnAction(a));

    return {
      packageId: plan.packageId,
      version: plan.version,
      mode: "source",
      skillDir: targetSkillDir,
      archivePath,
      actionsCount: ownActions.length,
      playbooksCount: plan.playbooks.length,
      actions: ownActions.map((a) => a.id),
      playbooks: plan.playbooks.map((p) => p.id),
      files: collectRelativeFiles(targetSkillDir),
      usedExistingSkillMd,
    };
  }

  /**
   * 批量导出多个 Skill。
   */
  public async exportBatch(options: BatchSkillExportOptions): Promise<BatchSkillExportResult> {
    return exportBatchImpl(options, (opts) => this.export(opts));
  }

  /**
   * 复合模式导出：将多个包聚合为一个统一的复合技能目录。
   */
  public async exportComposite(
    options: CompositeSkillExportOptions
  ): Promise<CompositeSkillExportResult> {
    return exportCompositeImpl(options, (opts) => this.export(opts));
  }
}

/**
 * 导出单个 Skill 产物的顶层公共入口函数。
 * 内部创建 SkillExporter 实例并委托其实例导出方法，适合常规单次导出场景；
 * 需要复用导出器或定制行为时可直接实例化 SkillExporter。
 */
export async function exportSkill(options: SkillExporterOptions): Promise<SkillExportResult> {
  const exporter = new SkillExporter();
  return exporter.export(options);
}

/**
 * 批量导出多个 Skill 产物的顶层公共入口函数。
 * 内部创建 SkillExporter 实例并委托其实例批量导出方法。
 */
export async function exportSkillBatch(
  options: BatchSkillExportOptions
): Promise<BatchSkillExportResult> {
  const exporter = new SkillExporter();
  return exporter.exportBatch(options);
}

/**
 * 导出复合技能套件的顶层公共入口函数。
 * 内部创建 SkillExporter 实例并委托其实例复合导出方法。
 */
export async function exportCompositeSkill(
  options: CompositeSkillExportOptions
): Promise<CompositeSkillExportResult> {
  const exporter = new SkillExporter();
  return exporter.exportComposite(options);
}
