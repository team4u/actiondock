import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  generateSkillJson,
  generateSourceSkillMd,
  generateStandaloneEntrypoint,
  generateStandaloneSkillMd,
  getPackageSlug,
  type ProjectConfig,
} from "@actiondock/core";
import { BunCompiler } from "./compiler";
import { BuilderError } from "./errors";
import { BuildPlanner } from "./planner";
import type { ArchiveFormat, SkillExporterOptions, SkillExportResult } from "./types";

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

  let proc;
  if (format === "tar.gz") {
    proc = Bun.spawnSync(["tar", "-czf", archivePath, folderName], {
      cwd: parentDir,
      stdout: "pipe",
      stderr: "pipe",
    });
  } else {
    proc = Bun.spawnSync(["zip", "-r", archivePath, folderName], {
      cwd: parentDir,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  if (proc.exitCode !== 0) {
    const errText = proc.stderr?.toString() || `Exit code ${proc.exitCode}`;
    throw new BuilderError(`Failed to create ${format} archive: ${errText}`);
  }

  return archivePath;
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

    const playbooksDestDir = join(skillDir, "playbooks");
    if (plan.playbooks.length > 0) {
      mkdirSync(playbooksDestDir, { recursive: true });
    }

    const configForTemplates: ProjectConfig = {
      id: plan.packageId,
      name: plan.packageName,
      version: plan.version,
      description: plan.description,
      actionsDir: "actions",
      playbooksDir: "playbooks",
      config: plan.configDefs as any,
    };

    if (mode === "source") {
      // ----------------------------------------------------
      // 源码 Skill 导出 (Source Skill Export)
      // 包含: SKILL.md, actiondock.skill.json, actiondock.manifest.json, actiondock.json, package.json, 源码与资产
      // ----------------------------------------------------

      // 1. 生成 SKILL.md
      const skillMd = generateSourceSkillMd(
        configForTemplates,
        plan.actions as any,
        plan.playbooks as any
      );
      writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

      // 2. 生成 actiondock.skill.json 工具清单
      const skillJsonContent = {
        schemaVersion: "2.0.0",
        packageId: plan.packageId,
        name: plan.packageName,
        version: plan.version,
        description: plan.description,
        mode: "source",
        actions: plan.actions.map((a) => ({
          id: a.id,
          entry: a.entry,
          description: a.description,
          inputSchema: a.inputSchema,
          outputSchema: a.outputSchema,
          uses: a.uses,
          tags: a.tags,
        })),
        playbooks: plan.playbooks.map((p) => ({
          id: p.id,
          description: p.description,
          entry: `playbooks/${basename(p.filePath)}`,
        })),
        exportedAt: new Date().toISOString(),
      };
      writeFileSync(
        join(skillDir, "actiondock.skill.json"),
        JSON.stringify(skillJsonContent, null, 2) + "\n",
        "utf-8"
      );

      // 3. 导出精简后的 actiondock.manifest.json 清单
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

      // 4. 导出精简后的 actiondock.json 项目配置
      const exportedConfig = {
        id: plan.packageId,
        name: plan.packageName,
        version: plan.version,
        description: plan.description,
        actionsDir: "actions",
        playbooksDir: "playbooks",
        config: plan.configDefs,
      };
      writeFileSync(
        join(skillDir, "actiondock.json"),
        JSON.stringify(exportedConfig, null, 2) + "\n",
        "utf-8"
      );

      // 5. 导出 package.json
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

      // 6. 拷贝 tsconfig.json（若存在）
      const tsconfigPath = join(root, "tsconfig.json");
      if (existsSync(tsconfigPath)) {
        copyFileSync(tsconfigPath, join(skillDir, "tsconfig.json"));
      }

      // 7. 拷贝 Action 源码文件，完整保留相对路径
      for (const act of plan.actions) {
        if (existsSync(act.resolvedPath)) {
          const destFile = join(skillDir, act.entry);
          mkdirSync(dirname(destFile), { recursive: true });
          copyFileSync(act.resolvedPath, destFile);
        }
      }

      // 8. 拷贝静态资产文件，完整保留相对路径
      for (const dep of plan.dependencies.modulesAndAssets) {
        if (dep.type === "asset" && existsSync(dep.resolvedPath)) {
          const destAsset = join(skillDir, dep.path);
          mkdirSync(dirname(destAsset), { recursive: true });
          copyFileSync(dep.resolvedPath, destAsset);
        }
      }

      // 9. 拷贝 Playbook 文件
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          const destPb = join(playbooksDestDir, basename(pb.filePath));
          copyFileSync(pb.filePath, destPb);
        }
      }
    } else {
      // ----------------------------------------------------
      // 独立二进制 Skill 导出 (Standalone Binary Skill Export)
      // 包含: SKILL.md, actiondock.skill.json, bin/<binary>, playbooks/*, assets/*
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

      // 1. 生成独立模式 SKILL.md
      const skillMd = generateStandaloneSkillMd(
        configForTemplates,
        plan.actions as any,
        plan.playbooks as any,
        `./bin/${actualBinaryName}`
      );
      writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

      // 2. 生成 actiondock.skill.json
      const rawSkillJson = generateSkillJson(
        configForTemplates,
        plan.actions as any,
        actualBinaryName,
        target
      );
      const parsedSkillJson = JSON.parse(rawSkillJson);
      parsedSkillJson.mode = "standalone";
      writeFileSync(
        join(skillDir, "actiondock.skill.json"),
        JSON.stringify(parsedSkillJson, null, 2) + "\n",
        "utf-8"
      );

      // 3. 拷贝 Playbook
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          const destPb = join(playbooksDestDir, basename(pb.filePath));
          copyFileSync(pb.filePath, destPb);
        }
      }

      // 4. 拷贝静态资产
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
    };
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
