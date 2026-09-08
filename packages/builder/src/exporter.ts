import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  generateCompositeSkillMd,
  generateSourceSkillMd,
  generateStandaloneEntrypoint,
  generateStandaloneSkillMd,
  getPackageSlug,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
  type CompositeSkillPackageInfo,
  type ProjectConfig,
} from "@actiondock/core";
import { createTarGzArchive, createZipArchive } from "./archive";
import { BunCompiler } from "./compiler";
import { BuilderError } from "./errors";
import { BuildPlanner } from "./planner";
import type {
  ArchiveFormat,
  BatchSkillExportOptions,
  BatchSkillExportResult,
  CompositeSkillExportOptions,
  CompositeSkillExportResult,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";

/**
 * 递归扫描生成目录中的所有相对文件路径。
 */
function scanRelativeFiles(dir: string, baseDir = dir): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...scanRelativeFiles(fullPath, baseDir));
    } else if (stat.isFile()) {
      results.push(relative(baseDir, fullPath));
    }
  }
  return results;
}

/**
 * 执行归档压缩操作（支持 .zip 与 .tar.gz）。
 *
 * 归档在进程内完成（见 archive.ts），不依赖宿主机的 zip / tar 命令行工具，
 * 保证 Windows 与最小化 Linux 环境下行为一致。
 */
function createArchive(
  skillDir: string,
  format: ArchiveFormat
): string {
  const parentDir = dirname(skillDir);
  const folderName = basename(skillDir);
  const archiveName = `${folderName}.${format === "tar.gz" ? "tar.gz" : "zip"}`;
  const archivePath = join(parentDir, archiveName);

  if (existsSync(archivePath)) {
    rmSync(archivePath, { force: true });
  }

  try {
    if (format === "tar.gz") {
      createTarGzArchive(skillDir, archivePath);
    } else {
      createZipArchive(skillDir, archivePath);
    }
  } catch (err: any) {
    throw new BuilderError(`Failed to create ${format} archive: ${err?.message || String(err)}`);
  }

  return archivePath;
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
        // 忽略
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
      // 忽略
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
          // 忽略
        }
      }
    }
  }

  return undefined;
}

/**
 * Agent Skill 导出器。
 * 负责源码型 Skill 与独立二进制型 Skill 的构建、打包与归档分发。
 */
export class SkillExporter {
  /**
   * 导出 Skill 产物包。
   * 
   * @param options 导出配置
   * @returns 导出产物详细描述
   */
  public async export(options: SkillExporterOptions): Promise<SkillExportResult> {
    const root = resolve(options.projectRoot);
    const mode: "source" | "standalone" =
      options.standalone || options.mode === "standalone" ? "standalone" : "source";
    const target = options.target ? String(options.target) : "host";

    // 1. 调用 BuildPlanner 执行纯声明式构建规划与依赖闭包裁剪
    const planner = new BuildPlanner({ projectRoot: root });
    const plan = planner.plan({
      projectRoot: root,
      config: options.config,
      manifest: options.manifest,
      actions: options.actions,
      playbooks: options.playbooks,
    });

    const pkgSlug = getPackageSlug(plan.packageId);
    const targetSuffix = mode === "standalone" && target !== "host" && target !== "bun" ? `-${target}` : "";
    const defaultFolderName = `${pkgSlug}-skill${targetSuffix}`;
    const defaultSkillDir = join(root, "dist", defaultFolderName);
    const skillDir = resolve(options.outDir || defaultSkillDir);

    mkdirSync(skillDir, { recursive: true });

    const actionsDir = plan.actionsDir || "actions";
    const playbooksDir = plan.playbooksDir || "playbooks";
    const playbooksDestDir = join(skillDir, playbooksDir);
    if (plan.playbooks.length > 0) {
      mkdirSync(playbooksDestDir, { recursive: true });
    }

    const configForTemplates: ProjectConfig = {
      id: plan.packageId,
      name: plan.packageName,
      version: plan.version,
      description: plan.description,
      actionsDir,
      playbooksDir,
      config: plan.configDefs as any,
    };

    let usedExistingSkillMd: string | undefined;

    if (mode === "source") {
      // ----------------------------------------------------
      // 源码 Skill 导出 (Source Skill Export)
      // 优先复用当前动作目录下已有的 SKILL.md；若不存在且未显式跳过，则动态生成
      const existingSkill = !options.skipSkillMd
        ? findExistingSingleSkillMd(root, options.skillMdPath, pkgSlug)
        : undefined;

      if (existingSkill) {
        usedExistingSkillMd = existingSkill;
        const destSkillMd = join(skillDir, "SKILL.md");
        if (resolve(existingSkill) !== resolve(destSkillMd)) {
          copyFileSync(existingSkill, destSkillMd);
        }
      } else if (!options.skipSkillMd) {
        const skillMd = generateSourceSkillMd(
          configForTemplates,
          plan.actions as any,
          plan.playbooks as any
        );
        writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");
      }

      // - 导出精简后的 actiondock.manifest.json 清单
      const manifestActions: Record<string, unknown> = {};
      for (const a of plan.actions) {
        manifestActions[a.id] = {
          entry: a.entry,
          description: a.description,
          inputSchema: a.inputSchema,
          outputSchema: a.outputSchema,
          uses: a.uses,
          tags: a.tags,
          annotations: a.annotations,
        };
        if (a.id.includes("/")) {
          const shortId = a.id.slice(a.id.lastIndexOf("/") + 1);
          if (!manifestActions[shortId]) {
            manifestActions[shortId] = manifestActions[a.id];
          }
        }
      }
      const exportedManifest = {
        schemaVersion: 1,
        actions: manifestActions,
        assets: plan.assets,
      };
      writeFileSync(
        join(skillDir, "actiondock.manifest.json"),
        JSON.stringify(exportedManifest, null, 2) + "\n",
        "utf-8"
      );

      // - 导出精简后的 actiondock.json 项目配置
      const exportedConfig = {
        id: plan.packageId,
        name: plan.packageName,
        version: plan.version,
        description: plan.description,
        actionsDir,
        playbooksDir,
        config: plan.configDefs,
      };
      writeFileSync(
        join(skillDir, "actiondock.json"),
        JSON.stringify(exportedConfig, null, 2) + "\n",
        "utf-8"
      );

      // - 导出 package.json
      const projectPkgPath = join(root, "package.json");
      let exportedPkg: any;
      if (existsSync(projectPkgPath)) {
        try {
          const raw = readFileSync(projectPkgPath, "utf-8");
          const parsed = JSON.parse(raw);
          exportedPkg = {
            name: parsed.name || pkgSlug,
            version: plan.version || parsed.version || "0.1.0",
            description: plan.description || parsed.description,
            type: "module",
            dependencies: parsed.dependencies || {
              "@actiondock/sdk": "^2.0.0",
            },
            devDependencies: parsed.devDependencies,
          };
        } catch {
          exportedPkg = {
            name: pkgSlug,
            version: plan.version,
            description: plan.description,
            type: "module",
            dependencies: { "@actiondock/sdk": "^2.0.0" },
          };
        }
      } else {
        exportedPkg = {
          name: pkgSlug,
          version: plan.version,
          description: plan.description,
          type: "module",
          dependencies: { "@actiondock/sdk": "^2.0.0" },
        };
      }
      writeFileSync(
        join(skillDir, "package.json"),
        JSON.stringify(exportedPkg, null, 2) + "\n",
        "utf-8"
      );

      // - 拷贝 tsconfig.json（若存在）
      const tsconfigPath = join(root, "tsconfig.json");
      if (existsSync(tsconfigPath)) {
        copyFileSync(tsconfigPath, join(skillDir, "tsconfig.json"));
      }

      // - 拷贝 Action 源码文件，完整保留相对路径
      for (const act of plan.actions) {
        if (existsSync(act.resolvedPath)) {
          const destFile = join(skillDir, act.entry);
          mkdirSync(dirname(destFile), { recursive: true });
          copyFileSync(act.resolvedPath, destFile);
        }
      }

      // - 拷贝静态资产与代码模块文件，完整保留相对路径
      for (const dep of plan.dependencies.modulesAndAssets) {
        if ((dep.type === "asset" || dep.type === "module") && existsSync(dep.resolvedPath)) {
          const destAsset = join(skillDir, dep.path);
          mkdirSync(dirname(destAsset), { recursive: true });
          copyFileSync(dep.resolvedPath, destAsset);
        }
      }

      // - 拷贝 Playbook 规程文件
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          const destPb = join(playbooksDestDir, basename(pb.filePath));
          copyFileSync(pb.filePath, destPb);
        }
      }
    } else {
      // ----------------------------------------------------
      // 独立二进制 Skill 导出 (Standalone Binary Skill Export)
      // 包含: SKILL.md, bin/<binary>, playbooks/*, assets/*
      // ----------------------------------------------------
      const binDir = join(skillDir, "bin");
      mkdirSync(binDir, { recursive: true });

      const binaryName = pkgSlug;
      const binaryPath = join(binDir, binaryName);

      // 动态构造 Standalone 编译入口文件
      const buildDir = join(root, ".actiondock", ".build");
      mkdirSync(buildDir, { recursive: true });

      const entryCode = generateStandaloneEntrypoint(
        plan.packageId,
        plan.version,
        plan.description,
        plan.actions.map((a) => ({ id: a.id, filePath: a.resolvedPath })),
        plan.configDefs
      );

      const entryFileName = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`;
      const entryPath = join(buildDir, entryFileName);
      writeFileSync(entryPath, entryCode, "utf-8");

      let compileRes;
      try {
        compileRes = await BunCompiler.compile({
          entrypoint: entryPath,
          outfile: binaryPath,
          target: options.target,
          minify: options.minify,
          bytecode: options.bytecode,
          cwd: root,
          packageId: plan.packageId,
          version: plan.version,
          actions: plan.actions.map((a) => a.id),
        });
      } finally {
        if (existsSync(entryPath)) {
          rmSync(entryPath, { force: true });
        }
      }

      const actualBinaryName = basename(compileRes.executablePath);

      // - 生成独立模式 SKILL.md（若未显式跳过）
      const existingSkill = !options.skipSkillMd
        ? findExistingSingleSkillMd(root, options.skillMdPath, pkgSlug)
        : undefined;

      if (existingSkill) {
        usedExistingSkillMd = existingSkill;
        const destSkillMd = join(skillDir, "SKILL.md");
        if (resolve(existingSkill) !== resolve(destSkillMd)) {
          copyFileSync(existingSkill, destSkillMd);
        }
      } else if (!options.skipSkillMd) {
        const skillMd = generateStandaloneSkillMd(
          configForTemplates,
          plan.actions as any,
          plan.playbooks as any,
          `./bin/${actualBinaryName}`
        );
        writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");
      }

      // - 拷贝 Playbook 规程文件
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          const destPb = join(playbooksDestDir, basename(pb.filePath));
          copyFileSync(pb.filePath, destPb);
        }
      }

      // - 拷贝静态资产
      for (const dep of plan.dependencies.modulesAndAssets) {
        if (dep.type === "asset" && existsSync(dep.resolvedPath)) {
          const destAsset = join(skillDir, dep.path);
          mkdirSync(dirname(destAsset), { recursive: true });
          copyFileSync(dep.resolvedPath, destAsset);
        }
      }
    }

    // 归档压缩处理
    let archivePath: string | undefined;
    if (options.archive) {
      let format: ArchiveFormat = "zip";
      if (options.archiveFormat === "tar.gz" || options.archive === "tar.gz") {
        format = "tar.gz";
      } else if (options.archiveFormat === "zip" || options.archive === "zip") {
        format = "zip";
      }
      archivePath = createArchive(skillDir, format);
    }

    const files = scanRelativeFiles(skillDir);

    return {
      packageId: plan.packageId,
      version: plan.version,
      mode,
      target,
      skillDir,
      archivePath,
      actionsCount: plan.actions.length,
      playbooksCount: plan.playbooks.length,
      actions: plan.actions.map((a) => a.id),
      playbooks: plan.playbooks.map((p) => p.id),
      files,
      usedExistingSkillMd,
    };
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
   */
  public static async exportBatch(options: BatchSkillExportOptions): Promise<BatchSkillExportResult> {
    const exporter = new SkillExporter();
    return exporter.exportBatch(options);
  }

  /**
   * 复合模式导出：将多个包聚合为一个统一的复合技能目录。
   */
  public async exportComposite(options: CompositeSkillExportOptions): Promise<CompositeSkillExportResult> {
    if (!options.projectRoots || options.projectRoots.length === 0) {
      throw new BuilderError("No project roots provided for composite skill export.");
    }
    if (!options.bundleName || !options.bundleName.trim()) {
      throw new BuilderError("bundleName is required for composite skill export.");
    }

    const bundleSlug = getPackageSlug(options.bundleName);
    const defaultSkillDir = join(process.cwd(), "dist", `${bundleSlug}-skill`);
    const skillDir = resolve(options.outDir || defaultSkillDir);

    mkdirSync(skillDir, { recursive: true });
    const packagesDestDir = join(skillDir, "packages");
    mkdirSync(packagesDestDir, { recursive: true });

    const packageInfos: CompositeSkillPackageInfo[] = [];
    const packageSummaries: Array<{ packageId: string; actions: string[]; playbooks: string[] }> = [];

    const usedDirNames = new Set<string>();
    for (const projectRoot of options.projectRoots) {
      const config = loadProjectConfig(projectRoot);
      let pkgSlug = getPackageSlug(config.id);
      if (usedDirNames.has(pkgSlug)) {
        pkgSlug = config.id.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
      }
      usedDirNames.add(pkgSlug);

      const destPkgDir = join(packagesDestDir, pkgSlug);

      const singleExport = await this.export({
        projectRoot,
        outDir: destPkgDir,
        archive: false,
        skipSkillMd: true,
      });

      const manifest = loadManifest(destPkgDir) || loadManifest(projectRoot);
      const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);

      const actionEntries = singleExport.actions.map((actId) => ({
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
        actions: singleExport.actions,
        playbooks: singleExport.playbooks,
      });
    }

    const existingSkillPath = findExistingCompositeSkillMd(options);
    if (existingSkillPath) {
      const destSkillMdPath = join(skillDir, "SKILL.md");
      if (resolve(existingSkillPath) !== resolve(destSkillMdPath)) {
        copyFileSync(existingSkillPath, destSkillMdPath);
      }
    } else {
      const description =
        options.description ||
        `ActionDock 复合技能套件，聚合 ${packageInfos.map((p) => p.config.name).join("、")}`;
      const compositeSkillMd = generateCompositeSkillMd(options.bundleName, description, packageInfos);
      writeFileSync(join(skillDir, "SKILL.md"), compositeSkillMd, "utf-8");
    }

    let archivePath: string | undefined;
    if (options.archive) {
      let format: ArchiveFormat = "zip";
      if (options.archiveFormat === "tar.gz" || options.archive === "tar.gz") {
        format = "tar.gz";
      } else if (options.archiveFormat === "zip" || options.archive === "zip") {
        format = "zip";
      }
      archivePath = createArchive(skillDir, format);
    }

    const files = scanRelativeFiles(skillDir);
    const totalActions = packageSummaries.reduce((sum, p) => sum + p.actions.length, 0);
    const totalPlaybooks = packageSummaries.reduce((sum, p) => sum + p.playbooks.length, 0);

    return {
      bundleName: options.bundleName,
      skillDir,
      archivePath,
      packagesCount: packageInfos.length,
      actionsCount: totalActions,
      playbooksCount: totalPlaybooks,
      packages: packageSummaries,
      files,
      usedExistingSkillMd: existingSkillPath,
    };
  }

  /**
   * 静态辅助调用复合导出方法。
   */
  public static async exportComposite(options: CompositeSkillExportOptions): Promise<CompositeSkillExportResult> {
    const exporter = new SkillExporter();
    return exporter.exportComposite(options);
  }

  /**
   * 静态辅助调用方法。
   */
  public static async export(options: SkillExporterOptions): Promise<SkillExportResult> {
    const exporter = new SkillExporter();
    return exporter.export(options);
  }
}

/**
 * 快捷导出 Skill 产物函数。
 */
export async function exportSkill(options: SkillExporterOptions): Promise<SkillExportResult> {
  return SkillExporter.export(options);
}

/**
 * 快捷批量导出多个 Skill 产物函数。
 */
export async function exportSkillBatch(options: BatchSkillExportOptions): Promise<BatchSkillExportResult> {
  return SkillExporter.exportBatch(options);
}

/**
 * 快捷复合模式导出 Skill 产物函数。
 */
export async function exportCompositeSkill(options: CompositeSkillExportOptions): Promise<CompositeSkillExportResult> {
  return SkillExporter.exportComposite(options);
}

