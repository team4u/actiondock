import { generateStandaloneSkillMd } from "@actiondock/core";
import { buildProject } from "./build";
import { collectRelativeFiles } from "./fs-utils";
import {
  buildConfigForTemplates,
  toPlaybookDefinitions,
  toSkillActionItems,
  writeSkillMd,
} from "./skill-md";
import { createArchive, resolveArchiveFormat } from "./export-archive";
import type {
  SelectionPlan,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";

/**
 * Node 目录型 Skill 导出装配层。
 *
 * 职责：复用 Node 目录型构建产出可执行交付目录，
 * 并在目录内生成调用该入口的 SKILL.md 说明书。
 */

/**
 * 执行 Node 目录型 Skill 导出。
 */
export async function exportNodeSkill(
  root: string,
  targetSkillDir: string,
  plan: SelectionPlan,
  options: SkillExporterOptions,
  pkgSlug: string
): Promise<SkillExportResult> {
  await buildProject({
    projectRoot: root,
    outDir: targetSkillDir,
    actions: options.actions,
    playbooks: options.playbooks,
    config: options.config,
    manifest: options.manifest,
    vendorDeps: Boolean(options.vendorDeps),
    allowInstallScripts: options.allowInstallScripts,
    requireReproducible: options.requireReproducible,
  });

  const usedExistingSkillMd = writeSkillMd(
    root,
    targetSkillDir,
    plan,
    { skipSkillMd: options.skipSkillMd, skillMdPath: options.skillMdPath, pkgSlug },
    () => {
      const configForTemplates = buildConfigForTemplates(
        plan,
        plan.actionsDir || "actions",
        plan.playbooksDir || "playbooks"
      );
      return generateStandaloneSkillMd(
        configForTemplates,
        toSkillActionItems(plan.actions),
        toPlaybookDefinitions(plan.playbooks),
        "node ./entry.mjs"
      );
    }
  );

  let archivePath: string | undefined;
  if (options.archive) {
    archivePath = await createArchive(targetSkillDir, resolveArchiveFormat(options));
  }

  return {
    packageId: plan.packageId,
    version: plan.version,
    mode: "node",
    skillDir: targetSkillDir,
    archivePath,
    actionsCount: plan.actions.length,
    playbooksCount: plan.playbooks.length,
    actions: plan.actions.map((a) => a.id),
    playbooks: plan.playbooks.map((p) => p.id),
    files: collectRelativeFiles(targetSkillDir),
    usedExistingSkillMd,
  };
}
