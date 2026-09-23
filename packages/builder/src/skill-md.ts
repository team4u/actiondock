import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  getPackageSlug,
  type PlaybookDefinition,
  type ProjectConfig,
} from "@actiondock/core/project";
import {
  COMPOSITE_CUSTOM_DECLARATION_FILE,
  parseCustomSkillDeclaration,
  type CompositeCustomDeclaration,
  type SkillActionItem,
} from "./skill";
import { BuilderError } from "./errors";
import type { CompositeSkillExportOptions, SelectionPlan } from "./types";

/**
 * SKILL.md 发现、复用与模板视图适配层。
 *
 * 职责单一聚焦：定位项目中已有的 SKILL.md（单包与复合套件两种检索策略）、
 * 解析自定义说明书声明，并将规划产物适配为模板生成所需视图。
 */

/** 供模板生成使用的 SkillActionItem 兼容视图 */
type PlanActionView = SkillActionItem;

/**
 * 将规划产物中的 Action 列表适配为模板所需的 SkillActionItem 视图。
 */
export function toSkillActionItems(actions: SelectionPlan["actions"]): PlanActionView[] {
  return actions;
}

/**
 * 将规划产物中的 Playbook 列表适配为模板所需的 PlaybookDefinition 视图。
 */
export function toPlaybookDefinitions(playbooks: SelectionPlan["playbooks"]): PlaybookDefinition[] {
  return playbooks as unknown as PlaybookDefinition[];
}

/**
 * 检索单个 Action 项目目录中已存在的 SKILL.md 文件。
 */
export function findExistingSingleSkillMd(
  projectRoot: string,
  explicitPath?: string,
  pkgSlug?: string
): string | undefined {
  if (explicitPath && existsSync(explicitPath)) {
    try {
      if (statSync(explicitPath).isFile()) return resolve(explicitPath);
    } catch {
      // 忽略文件属性读取异常
    }
  }

  const candidates = [
    join(projectRoot, "SKILL.md"),
    join(projectRoot, "skill.md"),
    join(projectRoot, "skills", "SKILL.md"),
    join(projectRoot, "skills", "skill.md"),
  ];

  if (pkgSlug) {
    candidates.push(
      join(projectRoot, "skills", pkgSlug, "SKILL.md"),
      join(projectRoot, "skills", pkgSlug, "skill.md")
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return resolve(candidate);
      } catch {
        // 忽略文件属性读取异常
      }
    }
  }

  return undefined;
}

/**
 * 检索复合套件工作区中已存在的 SKILL.md 文件。
 */
export function findExistingCompositeSkillMd(
  options: CompositeSkillExportOptions
): string | undefined {
  if (options.skillMdPath && existsSync(options.skillMdPath)) {
    try {
      if (statSync(options.skillMdPath).isFile()) return resolve(options.skillMdPath);
    } catch {
      // 忽略文件属性读取异常
    }
  }

  const bundleSlug = getPackageSlug(options.bundleName);
  const searchDirs = new Set<string>();

  if (options.workspaceRoot && existsSync(options.workspaceRoot)) {
    searchDirs.add(resolve(options.workspaceRoot));
  }
  searchDirs.add(process.cwd());

  for (const root of options.projectRoots) {
    const absRoot = resolve(root);
    // 仅搜索父目录（工作区根）一级；祖父目录搜索可能命中毫不相关的全局 SKILL.md 并复制进产物
    searchDirs.add(dirname(absRoot));
  }

  const candidateRelativePaths = [
    join("skills", options.bundleName, "SKILL.md"),
    join("skills", bundleSlug, "SKILL.md"),
    join("skills", "SKILL.md"),
    "SKILL.md",
    join("skills", options.bundleName, "skill.md"),
    join("skills", bundleSlug, "skill.md"),
    join("skills", "skill.md"),
    "skill.md",
  ];

  for (const dir of searchDirs) {
    for (const rel of candidateRelativePaths) {
      const fullPath = join(dir, rel);
      if (existsSync(fullPath)) {
        try {
          if (statSync(fullPath).isFile()) return fullPath;
        } catch {
          // 忽略文件属性读取异常
        }
      }
    }
  }

  return undefined;
}

/**
 * 解析复合技能自定义说明书：显式 customMdPath 优先（缺失即报错），
 * 否则按 `SKILL.custom.md` 约定名在工作区根目录与当前目录自动发现。
 */
export function resolveCustomSkillDeclaration(
  options: CompositeSkillExportOptions
): (CompositeCustomDeclaration & { file: string }) | undefined {
  let filePath: string | undefined;

  if (options.customMdPath) {
    if (!existsSync(options.customMdPath)) {
      throw new BuilderError(
        `Custom skill declaration file not found: '${options.customMdPath}'`
      );
    }
    filePath = resolve(options.customMdPath);
  } else {
    const searchDirs = [options.workspaceRoot, process.cwd()].filter(Boolean) as string[];
    for (const dir of searchDirs) {
      const candidate = join(resolve(dir), COMPOSITE_CUSTOM_DECLARATION_FILE);
      if (existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
  }

  if (!filePath) {
    return undefined;
  }

  return {
    file: filePath,
    ...parseCustomSkillDeclaration(readFileSync(filePath, "utf-8")),
  };
}

/**
 * 复制或生成 SKILL.md 到目标目录。
 * 返回实际复用的已有 SKILL.md 路径（若发生复用）。
 */
export function writeSkillMd(
  root: string,
  destDir: string,
  plan: SelectionPlan,
  options: { skipSkillMd?: boolean; skillMdPath?: string; pkgSlug: string },
  generate: () => string
): string | undefined {
  const existingSkill = options.skipSkillMd
    ? undefined
    : findExistingSingleSkillMd(root, options.skillMdPath, options.pkgSlug);

  if (existingSkill) {
    const destSkillMd = join(destDir, "SKILL.md");
    if (resolve(existingSkill) !== resolve(destSkillMd)) {
      copyFileSync(existingSkill, destSkillMd);
    }
    return existingSkill;
  }

  if (!options.skipSkillMd) {
    writeFileSync(join(destDir, "SKILL.md"), generate(), "utf-8");
  }
  return undefined;
}

/**
 * 构造模板生成所需的 ProjectConfig 视图。
 */
export function buildConfigForTemplates(
  plan: SelectionPlan,
  actionsDir: string,
  playbooksDir: string
): ProjectConfig {
  return {
    id: plan.packageId,
    name: plan.packageName,
    version: plan.version,
    description: plan.description,
    actionsDir,
    playbooksDir,
    // 声明性配置字典在规划侧为宽松结构，模板仅透传展示
    config: plan.configDefs as ProjectConfig["config"],
  };
}
