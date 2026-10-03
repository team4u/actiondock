import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { generateSourceSkillMd } from "./skill";
import {
  RUNTIME_REFERENCE_REL_PATH,
  renderRuntimeReferenceContent,
} from "./skill/templates";
import { BuilderError } from "./errors";
import { getInternalDependencyVersion } from "./fs-utils";
import {
  assertValidManifestActionIds,
  sanitizeExportDependencies,
  serializePlanManifest,
} from "./manifest";
import { copyPlanEntries } from "./stage-sources";
import type { SelectionPlan, SkillExporterOptions } from "./types";
import {
  buildConfigForTemplates,
  writeSkillMd,
} from "./skill-md";

/**
 * 源码型 Skill 导出装配层。
 *
 * 职责：在暂存目录内完成 SKILL.md、actiondock.json、package.json
 * 与全部源码/资产/Playbook 文件的物化，产物保持源码形态可直接编辑。
 */

/**
 * 源码型 Skill 的暂存阶段：生成 SKILL.md、actiondock.json、package.json 并拷贝源码。
 */
export function stageSourceSkill(
  root: string,
  skillDir: string,
  plan: SelectionPlan,
  options: SkillExporterOptions,
  pkgSlug: string
): string | undefined {
  const actionsDir = plan.actionsDir || "actions";
  const playbooksDir = plan.playbooksDir || "playbooks";

  const configForTemplates = buildConfigForTemplates(plan, actionsDir, playbooksDir);

  const usedExistingSkillMd = writeSkillMd(
    root,
    skillDir,
    plan,
    { skipSkillMd: options.skipSkillMd, skillMdPath: options.skillMdPath, pkgSlug },
    () =>
      generateSourceSkillMd(
        configForTemplates,
        plan.actions,
        plan.playbooks
      )
  );

  // 仅在使用自动模板时生成默认运行参考文件；与项目声明资产同路径冲突时报错不覆盖
  if (usedExistingSkillMd === undefined && !options.skipSkillMd) {
    writeRuntimeReferenceFile(skillDir, {
      dependencyStepLabel: "安装技能源码依赖",
      relinkStepLabel: "完成安装后重新链接本技能",
      invocationStyle: "global-ad",
    });
  }

  // 导出精简后的 actiondock.json 项目配置（项目元数据与清单的单一事实源）
  const exportedConfig = serializePlanManifest(plan, {
    omitEmptyConfig: true,
    includeDirs: { actionsDir, playbooksDir },
  });
  if (exportedConfig.actions && typeof exportedConfig.actions === "object") {
    assertValidManifestActionIds(exportedConfig.actions as Record<string, unknown>);
  }
  writeFileSync(
    join(skillDir, "actiondock.json"),
    JSON.stringify(exportedConfig, null, 2) + "\n",
    "utf-8"
  );

  // 导出 package.json
  writeSourceSkillPkgJson(root, skillDir, plan, pkgSlug);

  // 拷贝 tsconfig.json（若存在）
  const tsconfigPath = join(root, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    copyFileSync(tsconfigPath, join(skillDir, "tsconfig.json"));
  }

  // 拷贝 Action 源码、静态资产与 Playbook 规程文件（共享拷贝内核，行为与 stage-sources 单一事实源对齐）
  copyPlanEntries(skillDir, plan, {
    playbookRelPath: (pb) => join(playbooksDir, basename(pb.filePath)),
  });

  return usedExistingSkillMd;
}

/**
 * 写出运行参考文件 references/actiondock-runtime.md。
 * 与项目声明资产同路径冲突时报告错误，不覆盖用户文件。
 */
export function writeRuntimeReferenceFile(
  destDir: string,
  options: Parameters<typeof renderRuntimeReferenceContent>[0]
): void {
  const referencePath = join(destDir, RUNTIME_REFERENCE_REL_PATH);
  if (existsSync(referencePath)) {
    throw new BuilderError(
      `Runtime reference file conflict: '${referencePath}' already exists (declared asset or user file). Refusing to overwrite user files.`
    );
  }
  mkdirSync(dirname(referencePath), { recursive: true });
  writeFileSync(referencePath, renderRuntimeReferenceContent(options), "utf-8");
}

function writeSourceSkillPkgJson(
  root: string,
  skillDir: string,
  plan: SelectionPlan,
  pkgSlug: string
): void {
  let exportedPkg: Record<string, unknown>;
  const projectPkgPath = join(root, "package.json");
  if (existsSync(projectPkgPath)) {
    try {
      const raw = readFileSync(projectPkgPath, "utf-8");
      const parsed = JSON.parse(raw);
      exportedPkg = {
        name: parsed.name || pkgSlug,
        version: plan.version || parsed.version || "0.1.0",
        description: plan.description || parsed.description,
        type: "module",
        dependencies: sanitizeExportDependencies(
          root,
          parsed.dependencies,
          "exported skill packages"
        ),
      };
    } catch (err) {
      if (err instanceof BuilderError) {
        throw err;
      }
      exportedPkg = fallbackSkillPkg(plan, pkgSlug);
    }
  } else {
    exportedPkg = fallbackSkillPkg(plan, pkgSlug);
  }
  writeFileSync(
    join(skillDir, "package.json"),
    JSON.stringify(exportedPkg, null, 2) + "\n",
    "utf-8"
  );
}

/** 无 package.json 或解析失败时的兜底导出描述 */
function fallbackSkillPkg(
  plan: SelectionPlan,
  pkgSlug: string
): Record<string, unknown> {
  return {
    name: pkgSlug,
    version: plan.version,
    description: plan.description,
    type: "module",
    dependencies: { "@actiondock/sdk": getInternalDependencyVersion() },
  };
}
