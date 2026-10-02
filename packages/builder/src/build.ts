import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getPackageSlug } from "@actiondock/core/project";
import { createZipArchiveAsync } from "./archive";
import { BuilderError } from "./errors";
import { collectRelativeFiles, getInternalDependencyVersion, replaceDirAtomic } from "./fs-utils";
import { assertValidManifestActionIds, serializePlanManifest } from "./manifest";
import { SelectionPlanner } from "./planner";
import { copyPlanEntries } from "./stage-sources";
import { generateNodeHostEntrySource, generateNodeSupervisorEntrySource } from "./entry-generators";
import { vendorDependencies } from "./vendor";
import { generateStandaloneSkillMd } from "./skill/templates";
import {
  buildConfigForTemplates,
  toPlaybookDefinitions,
  toSkillActionItems,
  writeSkillMd,
} from "./skill-md";
import { createArchive, resolveArchiveFormat } from "./export-archive";
export { copyPlanEntries } from "./stage-sources";
import type {
  BuildOptions,
  BuildResult,
  ExternalDependency,
  SelectionPlan,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";

/**
 * 检查外部依赖中声明的生命周期安装脚本。
 */
function detectLifecycleScripts(
  root: string,
  dependencies: ExternalDependency[]
): Array<{ package: string; version: string; stage: string }> {
  const detected: Array<{ package: string; version: string; stage: string }> = [];
  const checked = new Set<string>();

  for (const dep of dependencies) {
    if (checked.has(dep.name)) continue;
    checked.add(dep.name);

    const candidates = [
      join(root, "node_modules", dep.name, "package.json"),
      resolve(import.meta.dirname, "../../../node_modules", dep.name, "package.json"),
    ];

    for (const cand of candidates) {
      if (existsSync(cand)) {
        try {
          const raw = readFileSync(cand, "utf-8");
          const pkg = JSON.parse(raw);
          const scripts = pkg.scripts || {};
          const lifecycleStages = ["preinstall", "install", "postinstall"];
          for (const stage of lifecycleStages) {
            if (typeof scripts[stage] === "string" && scripts[stage].trim().length > 0) {
              detected.push({
                package: dep.name,
                version: pkg.version || dep.versionRange || "*",
                stage,
              });
            }
          }
        } catch (err) {
          // 防御与透明：依赖生命周期解析失败透传警告日志
          console.warn(
            `[actiondock] Warning: Failed to inspect lifecycle scripts for dependency '${dep.name}': ${err instanceof Error ? err.message : String(err)}`
          );
        }
        break;
      }
    }
  }

  return detected;
}

/**
 * 计算目录内容规范化 SHA-256 摘要。
 */
function calculateDirectoryDigest(dir: string): string {
  const files = collectRelativeFiles(dir);
  const hasher = createHash("sha256");
  for (const file of files) {
    hasher.update(file);
    const fullPath = join(dir, file);
    hasher.update(readFileSync(fullPath));
  }
  return hasher.digest("hex");
}

/**
 * 拷贝 Action 源码、Playbook 规程与声明的代码文件/静态资产到暂存目录。
 * 拷贝内核统一复用 stage-sources 的 copyPlanEntries，无差异化调优时直接全量拷贝。
 */
function stageSources(stagingDir: string, plan: SelectionPlan): string[] {
  return copyPlanEntries(stagingDir, plan);
}

/**
 * 生成裁剪后的 actiondock.json（项目元数据与清单的单一事实源）。
 */
function writeManifest(stagingDir: string, plan: SelectionPlan): void {
  const exportedConfig = serializePlanManifest(plan);
  if (exportedConfig.actions && typeof exportedConfig.actions === "object") {
    assertValidManifestActionIds(exportedConfig.actions as Record<string, unknown>);
  }
  writeFileSync(
    join(stagingDir, "actiondock.json"),
    JSON.stringify(exportedConfig, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * 生成部署用 package.json（指向监督父进程双入口体系）并复制锁文件。
 */
function writePkgJsonAndLockfiles(
  root: string,
  stagingDir: string,
  plan: SelectionPlan,
  pkgSlug: string
): void {
  // 准备锁定的生产依赖
  const productionDependencies: Record<string, string> = {
    "@actiondock/core": getInternalDependencyVersion(),
    "@actiondock/sdk": getInternalDependencyVersion(),
  };
  for (const ext of plan.dependencies.external) {
    if (!ext.isDev) {
      productionDependencies[ext.name] = ext.versionRange || "*";
    }
  }

  const deploymentPkg: Record<string, unknown> = {
    name: pkgSlug,
    version: plan.version,
    description: plan.description,
    type: "module",
    main: "./entry-supervisor.js",
    bin: {
      [pkgSlug]: "./entry-supervisor.js",
    },
    engines: {
      node: ">=24.12.0",
    },
    dependencies: productionDependencies,
  };
  writeFileSync(
    join(stagingDir, "package.json"),
    JSON.stringify(deploymentPkg, null, 2) + "\n",
    "utf-8"
  );

  // 复制锁文件（若存在）
  if (plan.lockfile && existsSync(plan.lockfile.path)) {
    copyFileSync(plan.lockfile.path, join(stagingDir, plan.lockfile.name));
  }
  const actiondockLock = join(root, "actiondock.lock.json");
  if (existsSync(actiondockLock)) {
    copyFileSync(actiondockLock, join(stagingDir, "actiondock.lock.json"));
  }
}

/**
 * 生成三个入口脚本（Host 子进程、监督父进程与兼容代理转发入口）并设置可执行权限。
 */
function writeEntrypoints(stagingDir: string, plan: SelectionPlan): void {
  const hostCode = generateNodeHostEntrySource(plan);
  const hostPath = join(stagingDir, "entry-host.js");
  writeFileSync(hostPath, hostCode, "utf-8");

  const supervisorCode = generateNodeSupervisorEntrySource(plan);
  const supervisorPath = join(stagingDir, "entry-supervisor.js");
  writeFileSync(supervisorPath, supervisorCode, "utf-8");

  const forwarderCode = `#!/usr/bin/env node\n// AUTO-GENERATED ENTRYPOINT FORWARDER BY ACTIONDOCK BUILDER. DO NOT EDIT.\nimport "./entry-supervisor.js";\n`;
  const forwarderPath = join(stagingDir, "entry.mjs");
  writeFileSync(forwarderPath, forwarderCode, "utf-8");

  try {
    chmodSync(hostPath, 0o755);
    chmodSync(supervisorPath, 0o755);
    chmodSync(forwarderPath, 0o755);
  } catch (err) {
    // Windows 平台不支持类 Unix 权限模式；非 Windows 环境下输出预警
    if (process.platform !== "win32") {
      console.warn(
        `[actiondock] Warning: Failed to set executable permissions on entry scripts: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * 构建 Node.js 目录型交付产物。
 * 主流程仅做编排，各阶段职责由独立函数承担。
 *
 * @param options 构建选项
 * @returns 构建产物结果描述
 */
export async function buildProject(options: BuildOptions): Promise<BuildResult> {
  const root = resolve(options.projectRoot);
  const plan = SelectionPlanner.plan({
    projectRoot: root,
    config: options.config,
    manifest: options.manifest,
    actions: options.actions,
    playbooks: options.playbooks,
    skipDependencyValidation: options.skipDependencyValidation,
  });

  if (plan.actions.length === 0) {
    throw new BuilderError("No actions resolved for build");
  }

  // 检查依赖中的生命周期安装脚本
  const lifecycleScripts = detectLifecycleScripts(root, plan.dependencies.external);
  const requiresInstallScripts = lifecycleScripts.length > 0;

  // 可复现性校验：若要求可复现且必须执行安装脚本，在创建产物前报错
  if (options.requireReproducible && options.allowInstallScripts && requiresInstallScripts) {
    throw new BuilderError(
      "Cannot produce reproducible build when lifecycle install scripts are required to run.",
      "REPRODUCIBLE_BUILD_VIOLATION"
    );
  }

  const reproducible = !options.allowInstallScripts || !requiresInstallScripts;

  const pkgSlug = getPackageSlug(plan.packageId);
  const defaultOutDir = join(root, "dist", `${pkgSlug}-build`);
  const rawTargetOut = options.outDir || options.outfile || defaultOutDir;

  let outputDir: string;
  let shouldArchive = Boolean(options.archive);

  if (rawTargetOut.endsWith(".zip")) {
    shouldArchive = true;
    outputDir = resolve(rawTargetOut.slice(0, -4));
  } else {
    outputDir = resolve(rawTargetOut);
  }

  const parentDir = dirname(outputDir);
  mkdirSync(parentDir, { recursive: true });

  const stagingDir = join(
    parentDir,
    `.tmp-build-${basename(outputDir)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(stagingDir, { recursive: true });

  let platformInfo: { os: string; arch: string; nodeAbi: string } | undefined;

  try {
    stageSources(stagingDir, plan);
    writeManifest(stagingDir, plan);
    writePkgJsonAndLockfiles(root, stagingDir, plan, pkgSlug);
    writeEntrypoints(stagingDir, plan);

    // 若开启 options.vendorDeps，物化锁定生产依赖
    if (options.vendorDeps) {
      platformInfo = {
        os: process.platform,
        arch: process.arch,
        nodeAbi: process.versions.modules,
      };
      vendorDependencies(root, stagingDir, plan);
    }

    // 生成构建元数据 artifact.json
    const metadataObj: Record<string, unknown> = {
      schemaVersion: 2,
      packageId: plan.packageId,
      packageName: plan.packageName,
      version: plan.version,
      description: plan.description,
      actions: plan.actions.map((a) => a.id),
      playbooks: plan.playbooks.map((p) => p.id),
      engines: {
        node: ">=24.12.0",
      },
      entrypoint: "entry-supervisor.js",
      supervisorEntry: "entry-supervisor.js",
      hostEntry: "entry-host.js",
      vendorDeps: Boolean(options.vendorDeps),
      allowInstallScripts: Boolean(options.allowInstallScripts),
      installScriptsRun: options.allowInstallScripts ? lifecycleScripts : [],
      reproducible,
      platform: platformInfo,
      manifestDigest: plan.metadata?.lockfileDigest || "",
      lockfileDigest: plan.lockfile?.sha256,
      files: collectRelativeFiles(stagingDir),
    };

    writeFileSync(
      join(stagingDir, "artifact.json"),
      JSON.stringify(metadataObj, null, 2) + "\n",
      "utf-8"
    );

    // 原子移动至目标产物目录
    await replaceDirAtomic(stagingDir, outputDir);
  } finally {
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  // 归档处理
  let archivePath: string | undefined;
  if (shouldArchive) {
    const defaultArchive = `${outputDir}.zip`;
    archivePath = defaultArchive;
    if (existsSync(archivePath)) {
      rmSync(archivePath, { force: true });
    }
    await createZipArchiveAsync(outputDir, archivePath);
  }

  const sha256 = calculateDirectoryDigest(outputDir);
  const finalEntrypoint = join(outputDir, "entry-supervisor.js");
  const finalMetadata = join(outputDir, "artifact.json");

  return {
    packageId: plan.packageId,
    version: plan.version,
    outputDir,
    archivePath,
    entrypointPath: finalEntrypoint,
    executablePath: finalEntrypoint,
    metadataPath: finalMetadata,
    actions: plan.actions.map((a) => a.id),
    playbooks: plan.playbooks.map((p) => p.id),
    vendorDeps: Boolean(options.vendorDeps),
    reproducible,
    sha256,
  };
}

/**
 * 执行 Node 目录型 Skill 导出。
 * 复用 Node 目录型构建产出可执行交付目录，并在目录内生成调用该入口的 SKILL.md 说明书。
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

