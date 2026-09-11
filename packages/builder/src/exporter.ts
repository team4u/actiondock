import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  COMPOSITE_CUSTOM_DECLARATION_FILE,
  generateCompositeSkillMd,
  generateSourceSkillMd,
  generateStandaloneSkillMd,
  getPackageSlug,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
  parseCustomSkillDeclaration,
  type CompositeCustomDeclaration,
  type CompositeSkillPackageInfo,
  type ProjectConfig,
  type SkillActionItem,
  type PlaybookDefinition,
} from "@actiondock/core";
import { createTarGzArchiveAsync, createZipArchiveAsync } from "./archive";
import { buildProject } from "./build";
import { BuilderError } from "./errors";
import {
  collectRelativeFiles,
  getInternalDependencyVersion,
  replaceDirAtomic,
} from "./fs-utils";
import {
  assertNoFileProtocolDeps,
  assertValidManifestActionIds,
  resolveWorkspaceDepVersion,
  serializePlanManifest,
} from "./manifest";
import { SelectionPlanner } from "./planner";
import type {
  ArchiveFormat,
  BatchSkillExportOptions,
  BatchSkillExportResult,
  CompositeSkillExportOptions,
  CompositeSkillExportResult,
  SelectionPlan,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";

/** 供模板生成使用的 SkillActionItem 兼容视图 */
type PlanActionView = SkillActionItem;

/**
 * 将规划产物中的 Action 列表适配为模板所需的 SkillActionItem 视图。
 */
function toSkillActionItems(actions: SelectionPlan["actions"]): PlanActionView[] {
  return actions;
}

/**
 * 将规划产物中的 Playbook 列表适配为模板所需的 PlaybookDefinition 视图。
 */
function toPlaybookDefinitions(playbooks: SelectionPlan["playbooks"]): PlaybookDefinition[] {
  return playbooks as unknown as PlaybookDefinition[];
}

/**
 * 执行归档压缩操作。
 */
async function createArchive(skillDir: string, format: ArchiveFormat): Promise<string> {
  const parentDir = dirname(skillDir);
  const folderName = basename(skillDir);
  const archiveName = `${folderName}.${format === "tar.gz" ? "tar.gz" : "zip"}`;
  const archivePath = join(parentDir, archiveName);

  if (existsSync(archivePath)) {
    rmSync(archivePath, { force: true });
  }

  try {
    if (format === "tar.gz") {
      await createTarGzArchiveAsync(skillDir, archivePath);
    } else {
      await createZipArchiveAsync(skillDir, archivePath);
    }
  } catch (err: any) {
    throw new BuilderError(`Failed to create ${format} archive: ${err?.message || String(err)}`);
  }

  return archivePath;
}

/**
 * 解析归档格式：显式 archiveFormat 优先，archive 字段直接携带格式时其次。
 */
function resolveArchiveFormat(options: {
  archive?: boolean | ArchiveFormat;
  archiveFormat?: ArchiveFormat;
}): ArchiveFormat {
  if (options.archiveFormat === "tar.gz" || options.archive === "tar.gz") {
    return "tar.gz";
  }
  return "zip";
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
    const parentDir = dirname(absRoot);
    searchDirs.add(parentDir);
    searchDirs.add(dirname(parentDir));
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
function resolveCustomSkillDeclaration(
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
function writeSkillMd(
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
function buildConfigForTemplates(
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

/**
 * 源码型 Skill 的暂存阶段：生成 SKILL.md、actiondock.json、package.json 并拷贝源码。
 */
function stageSourceSkill(
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
    if (act.isExternal || act.id.includes("/")) {
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
 * 生成源码型 Skill 的 package.json（含依赖协议校验与 workspace 版本解析）。
 */
function writeSourceSkillPkgJson(
  root: string,
  skillDir: string,
  plan: SelectionPlan,
  pkgSlug: string
): void {
  const sanitizeDependencies = (deps?: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    if (deps && typeof deps === "object") {
      for (const [k, v] of Object.entries(deps)) {
        const verStr = String(v);
        if (verStr.startsWith("file:")) {
          throw new BuilderError(
            `Unsupported file: dependency for '${k}'. Runtime dependencies must not use file: protocol in exported skill packages.`
          );
        }
        if (k.startsWith("@actiondock/")) {
          result[k] = getInternalDependencyVersion();
        } else if (verStr.startsWith("workspace:")) {
          result[k] = resolveWorkspaceDepVersion(root, k, verStr);
        } else {
          result[k] = verStr;
        }
      }
    }
    if (!result["@actiondock/sdk"]) {
      result["@actiondock/sdk"] = getInternalDependencyVersion();
    }
    return result;
  };

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
        dependencies: sanitizeDependencies(parsed.dependencies),
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
        const raw = readFileSync(pkgJsonPath, "utf-8");
        const parsed = JSON.parse(raw);
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

/**
 * Agent Skill 导出器。
 * 负责源码型 Skill 与 Node 目录型 Skill 的构建、打包与分发。
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
    // 彻底废弃旧的独立二进制编译分支与参数
    if (
      options.standalone ||
      (options.mode as string) === "standalone" ||
      options.target !== undefined ||
      options.bytecode !== undefined
    ) {
      throw new BuilderError(
        "The '--standalone' mode has been removed in ActionDock 2.0. Please use '--mode node' for self-contained Node.js directory skills, or '--mode source' for source-based skills.",
        "UNSUPPORTED_BUILD_MODE"
      );
    }

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

    // 单包源码导出如果依赖闭包含外部包，导成 mini-workspace 形态（packages/ 下带齐依赖包），和 bundle 统一成一个交付形状
    if (mode === "source" && !options._isSubpackage && hasExternalDeps) {
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
      return this.exportNodeSkill(root, targetSkillDir, plan, options, pkgSlug);
    }
    return this.exportSourceSkill(root, targetSkillDir, plan, options, pkgSlug);
  }

  /**
   * Node 目录型 Skill 导出：复用 Node 目录型构建，并在 Skill 内生成调用该入口的 SKILL.md。
   */
  private async exportNodeSkill(
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

    const ownActions = plan.actions.filter(
      (a) => !a.isExternal && !a.id.includes("/")
    );

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
   * 静态辅助调用单个 Skill 导出方法。
   * @deprecated 实例方法的历史便捷入口，请直接使用实例方法，将在两个版本后移除。
   */
  public static async export(options: SkillExporterOptions): Promise<SkillExportResult> {
    const exporter = new SkillExporter();
    return exporter.export(options);
  }

  /**
   * 批量导出多个 Skill。
   */
  public async exportBatch(options: BatchSkillExportOptions): Promise<BatchSkillExportResult> {
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

      const res = await this.export({
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

  /**
   * 静态辅助调用批量导出方法。
   * @deprecated 实例方法的历史便捷入口，请直接使用实例方法，将在两个版本后移除。
   */
  public static async exportBatch(options: BatchSkillExportOptions): Promise<BatchSkillExportResult> {
    const exporter = new SkillExporter();
    return exporter.exportBatch(options);
  }

  /**
   * 复合模式导出：将多个包聚合为一个统一的复合技能目录。
   */
  public async exportComposite(
    options: CompositeSkillExportOptions
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

          const singleExport = await this.export({
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
   * 静态辅助调用复合导出方法。
   * @deprecated 实例方法的历史便捷入口，请直接使用实例方法，将在两个版本后移除。
   */
  public static async exportComposite(
    options: CompositeSkillExportOptions
  ): Promise<CompositeSkillExportResult> {
    const exporter = new SkillExporter();
    return exporter.exportComposite(options);
  }
}

/**
 * 导出单个 Skill 产物的顶层便捷函数。
 * @deprecated SkillExporter 实例与静态方法之外的历史第三入口，请直接使用 SkillExporter 实例，将在两个版本后移除。
 */
export async function exportSkill(options: SkillExporterOptions): Promise<SkillExportResult> {
  const exporter = new SkillExporter();
  return exporter.export(options);
}

/**
 * 批量导出多个 Skill 产物的顶层便捷函数。
 * @deprecated SkillExporter 实例与静态方法之外的历史第三入口，请直接使用 SkillExporter 实例，将在两个版本后移除。
 */
export async function exportSkillBatch(
  options: BatchSkillExportOptions
): Promise<BatchSkillExportResult> {
  return SkillExporter.exportBatch(options);
}

/**
 * 导出复合技能套件的顶层便捷函数。
 * @deprecated SkillExporter 实例与静态方法之外的历史第三入口，请直接使用 SkillExporter 实例，将在两个版本后移除。
 */
export async function exportCompositeSkill(
  options: CompositeSkillExportOptions
): Promise<CompositeSkillExportResult> {
  return SkillExporter.exportComposite(options);
}
