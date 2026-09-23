import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  getPackageSlug,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
} from "@actiondock/core";
import { generateCompositeSkillMd, type CompositeSkillPackageInfo } from "./skill";
import { BuilderError } from "./errors";
import { collectRelativeFiles, getInternalDependencyVersion, replaceDirAtomic } from "./fs-utils";
import { assertNoFileProtocolDeps, resolveWorkspaceDepVersion } from "./manifest";
import { SelectionPlanner } from "./planner";
import {
  findExistingCompositeSkillMd,
  resolveCustomSkillDeclaration,
} from "./skill-md";
import { createArchive, resolveArchiveFormat } from "./export-archive";
import type {
  CompositeSkillExportOptions,
  CompositeSkillExportResult,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";

/**
 * 复合套件导出装配层。
 *
 * 职责：将多个包聚合为一个统一的复合技能目录（mini-workspace 形态），
 * 聚合各子包依赖生成复合根 package.json，并生成或复用复合 SKILL.md。
 */

/** 子包导出回调：由 SkillExporter 注入自身导出能力，避免模块间循环依赖 */
export type SubpackageExporter = (
  options: SkillExporterOptions
) => Promise<SkillExportResult>;

/**
 * 执行复合模式导出：将多个包聚合为一个统一的复合技能目录。
 */
export async function exportCompositeImpl(
  options: CompositeSkillExportOptions,
  exportSubpackage: SubpackageExporter
): Promise<CompositeSkillExportResult> {
  if (!options.projectRoots || options.projectRoots.length === 0) {
    throw new BuilderError("No project roots provided for composite skill export.");
  }
  if (!options.bundleName || !options.bundleName.trim()) {
    throw new BuilderError("bundleName is required for composite skill export.");
  }

  const skillMdOnly = options.skillMdOnly === true;
  const customDeclaration = resolveCustomSkillDeclaration(options);

  const bundleSlug = getPackageSlug(options.bundleName);
  const defaultSkillDir = join(process.cwd(), "dist", `${bundleSlug}-skill`);
  const targetSkillDir = resolve(options.outDir || defaultSkillDir);
  const parentDir = dirname(targetSkillDir);
  mkdirSync(parentDir, { recursive: true });

  const stagingDir = skillMdOnly
    ? null
    : join(
        parentDir,
        `.tmp-composite-${bundleSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
  if (stagingDir) {
    mkdirSync(stagingDir, { recursive: true });
  }
  const packagesDestDir = stagingDir ? join(stagingDir, "packages") : null;
  if (packagesDestDir) {
    mkdirSync(packagesDestDir, { recursive: true });
  }

  const packageInfos: CompositeSkillPackageInfo[] = [];
  const packageSummaries: Array<{ packageId: string; actions: string[]; playbooks: string[] }> = [];

  let existingSkillPath: string | undefined;

  try {
    // 收集并展开所有包含在依赖闭包中的外部项目根目录，确保 bundle 整包携带齐全部依赖
    const effectiveRoots = new Set<string>();
    for (const r of options.projectRoots) {
      effectiveRoots.add(resolve(r));
      if (!skillMdOnly) {
        try {
          const p = SelectionPlanner.plan({ projectRoot: r });
          if (p.externalProjectRoots) {
            for (const extRoot of p.externalProjectRoots) {
              effectiveRoots.add(resolve(extRoot));
            }
          }
        } catch {
          // 忽略规划解析异常，由主循环处理
        }
      }
    }

    const usedDirNames = new Set<string>();
    for (const projectRoot of effectiveRoots) {
      const config = loadProjectConfig(projectRoot);
      let pkgSlug: string;
      if (skillMdOnly) {
        // 就地生成：规程链接基于工作区实际子目录名
        pkgSlug = basename(resolve(projectRoot));
      } else {
        pkgSlug = getPackageSlug(config.id);
        if (usedDirNames.has(pkgSlug)) {
          pkgSlug = config.id.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
        }
        usedDirNames.add(pkgSlug);
      }

      let actionIds: string[];
      let playbookIds: string[];
      let manifest: ReturnType<typeof loadManifest>;
      if (skillMdOnly) {
        // 仅生成 SKILL.md：直接读取清单获取 Action 契约描述，不拷贝子包产物
        manifest = loadManifest(projectRoot);
        actionIds = manifest?.actions ? Object.keys(manifest.actions) : [];
        playbookIds = Array.from(loadPlaybooks(projectRoot, config.playbooksDir).keys());
      } else {
        const destPkgDir = join(packagesDestDir!, pkgSlug);

        const singleExport = await exportSubpackage({
          projectRoot,
          outDir: destPkgDir,
          archive: false,
          skipSkillMd: true,
          mode: "source",
          _isSubpackage: true,
        } as SkillExporterOptions);

        manifest = loadManifest(destPkgDir) || loadManifest(projectRoot);
        actionIds = singleExport.actions;
        playbookIds = singleExport.playbooks;
      }

      const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);

      const actionEntries = actionIds.map((actId) => ({
        id: actId,
        description: manifest?.actions?.[actId]?.description,
      }));

      packageInfos.push({
        config,
        actions: actionEntries,
        playbooks: Array.from(playbooks.values()),
        packageDir: pkgSlug,
      });

      packageSummaries.push({
        packageId: config.id,
        actions: actionIds,
        playbooks: playbookIds,
      });
    }

    existingSkillPath = skillMdOnly ? undefined : findExistingCompositeSkillMd(options);
    const description =
      options.description ||
      customDeclaration?.description ||
      `ActionDock 复合技能套件，聚合 ${packageInfos.map((p) => p.config.name).join("、")}`;
    const compositeSkillMd = generateCompositeSkillMd(
      options.bundleName,
      description,
      packageInfos,
      {
        customSections: customDeclaration?.sections,
        packagesBaseDir: skillMdOnly ? "." : "packages",
      }
    );

    if (skillMdOnly) {
      // 就地仅重生成 SKILL.md：始终重新生成（忽略已有 SKILL.md 复用逻辑），不产出完整套件目录
      const targetFile =
        options.outDir && options.outDir.toLowerCase().endsWith(".md")
          ? resolve(options.outDir)
          : resolve(options.outDir ? join(options.outDir, "SKILL.md") : join(process.cwd(), "SKILL.md"));
      mkdirSync(dirname(targetFile), { recursive: true });
      // 目标文件即将被覆盖时输出警告，避免无提示覆盖用户已有内容
      if (existsSync(targetFile)) {
        console.warn(`[WARN] Existing SKILL.md will be overwritten: ${targetFile}`);
      }
      writeFileSync(targetFile, compositeSkillMd, "utf-8");

      return {
        bundleName: options.bundleName,
        skillDir: dirname(targetFile),
        skillMdFile: targetFile,
        packagesCount: packageInfos.length,
        actionsCount: packageInfos.reduce((acc, p) => acc + p.actions.length, 0),
        playbooksCount: packageInfos.reduce((acc, p) => acc + p.playbooks.length, 0),
        packages: packageSummaries,
        files: [basename(targetFile)],
      };
    }

    if (existingSkillPath) {
      const destSkillMdPath = join(stagingDir!, "SKILL.md");
      if (resolve(existingSkillPath) !== resolve(destSkillMdPath)) {
        copyFileSync(existingSkillPath, destSkillMdPath);
      }
    } else {
      writeFileSync(join(stagingDir!, "SKILL.md"), compositeSkillMd, "utf-8");
    }

    // 聚合所有子包依赖生成复合根目录 package.json
    writeCompositePkgJson(stagingDir!, packagesDestDir!, packageInfos, bundleSlug, options);

    // 原子替换目标复合技能目录
    await replaceDirAtomic(stagingDir!, targetSkillDir);
  } finally {
    if (stagingDir && existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  let archivePath: string | undefined;
  if (options.archive) {
    archivePath = await createArchive(targetSkillDir, resolveArchiveFormat(options));
  }

  return {
    bundleName: options.bundleName,
    skillDir: targetSkillDir,
    archivePath,
    packagesCount: packageInfos.length,
    actionsCount: packageInfos.reduce((acc, p) => acc + p.actions.length, 0),
    playbooksCount: packageInfos.reduce((acc, p) => acc + p.playbooks.length, 0),
    packages: packageSummaries,
    files: collectRelativeFiles(targetSkillDir),
    // 复用中段已计算的路径，避免结尾重复扫描
    usedExistingSkillMd: existingSkillPath,
  };
}

/**
 * 复合套件聚合各子包依赖并生成复合根目录 package.json。
 */
function writeCompositePkgJson(
  stagingDir: string,
  packagesDestDir: string,
  packageInfos: CompositeSkillPackageInfo[],
  bundleSlug: string,
  options: CompositeSkillExportOptions
): void {
  const aggregatedDeps: Record<string, string> = {
    "@actiondock/sdk": getInternalDependencyVersion(),
  };
  for (const info of packageInfos) {
    const pkgJsonPath = join(packagesDestDir, info.packageDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (parsed.dependencies && typeof parsed.dependencies === "object") {
          assertNoFileProtocolDeps(parsed.dependencies, "exported skill packages");
          for (const [dep, ver] of Object.entries(parsed.dependencies)) {
            const verStr = String(ver);
            if (dep.startsWith("@actiondock/")) {
              aggregatedDeps[dep] = getInternalDependencyVersion();
            } else if (verStr.startsWith("workspace:")) {
              aggregatedDeps[dep] = resolveWorkspaceDepVersion(
                join(packagesDestDir, info.packageDir),
                dep,
                verStr
              );
            } else {
              aggregatedDeps[dep] = verStr;
            }
          }
        }
      } catch (err) {
        if (err instanceof BuilderError) throw err;
        // 复合导出缺依赖影响面大：读文件与解析失败必须显式报错，严禁静默吞掉导致聚合依赖缺失
        throw new BuilderError(
          `Failed to read or parse package.json of exported subpackage '${info.packageDir}' (${pkgJsonPath}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  const compositePkg = {
    name: `${bundleSlug}-composite-skill`,
    version: "0.1.0",
    description: options.description || `Composite Skill suite: ${options.bundleName}`,
    type: "module",
    workspaces: ["packages/*"],
    dependencies: aggregatedDeps,
  };
  writeFileSync(
    join(stagingDir, "package.json"),
    JSON.stringify(compositePkg, null, 2) + "\n",
    "utf-8"
  );
}
