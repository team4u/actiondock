import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { generateSourceSkillMd } from "./skill";
import { BuilderError } from "./errors";
import { getInternalDependencyVersion } from "./fs-utils";
import {
  assertValidManifestActionIds,
  sanitizeExportDependencies,
  serializePlanManifest,
} from "./manifest";
import { isOwnAction } from "./types";
import type { SelectionPlan, SkillExporterOptions } from "./types";
import {
  buildConfigForTemplates,
  toPlaybookDefinitions,
  toSkillActionItems,
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
  const playbooksDestDir = join(skillDir, playbooksDir);
  if (plan.playbooks.length > 0) {
    mkdirSync(playbooksDestDir, { recursive: true });
  }

  const configForTemplates = buildConfigForTemplates(plan, actionsDir, playbooksDir);

  const usedExistingSkillMd = writeSkillMd(
    root,
    skillDir,
    plan,
    { skipSkillMd: options.skipSkillMd, skillMdPath: options.skillMdPath, pkgSlug },
    () =>
      generateSourceSkillMd(
        configForTemplates,
        toSkillActionItems(plan.actions),
        toPlaybookDefinitions(plan.playbooks)
      )
  );

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

  // 拷贝 Action 源码文件，保留相对路径（仅拷贝自有 Action，跨包依赖不物化进消费包目录）
  for (const act of plan.actions) {
    if (!isOwnAction(act)) {
      continue;
    }
    if (existsSync(act.resolvedPath)) {
      const destFile = join(skillDir, act.entry);
      mkdirSync(dirname(destFile), { recursive: true });
      copyFileSync(act.resolvedPath, destFile);
    }
  }

  // 拷贝静态资产与代码模块文件，保留相对路径
  for (const dep of plan.dependencies.modulesAndAssets) {
    if (
      (dep.type === "asset" || dep.type === "module" || dep.type === "file") &&
      existsSync(dep.resolvedPath)
    ) {
      const destAsset = join(skillDir, dep.path);
      mkdirSync(dirname(destAsset), { recursive: true });
      copyFileSync(dep.resolvedPath, destAsset);
    }
  }

  // 拷贝 Playbook 规程文件
  for (const pb of plan.playbooks) {
    if (existsSync(pb.filePath)) {
      const destPb = join(playbooksDestDir, basename(pb.filePath));
      copyFileSync(pb.filePath, destPb);
    }
  }

  return usedExistingSkillMd;
}

/**
 * 生成源码型 Skill 的 package.json（依赖清洗统一复用 manifest 的 sanitizeExportDependencies 单一入口）。
 */
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
