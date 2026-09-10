import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  ACTIONDOCK_VERSION,
  getPackageSlug,
  type ProjectConfig,
} from "@actiondock/core";
import { createZipArchiveAsync } from "./archive";
import { BuilderError } from "./errors";
import { SelectionPlanner } from "./planner";
import type { BuildOptions, BuildResult, ExternalDependency } from "./types";

/**
 * 跨文件系统/分区的原子移动目录辅助函数。
 */
const TRANSIENT_MOVE_ERROR_CODES = new Set(["EXDEV", "EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
const MOVE_RETRY_ATTEMPTS = 5;

async function moveDirAtomic(src: string, dest: string): Promise<void> {
  for (let attempt = 1; attempt <= MOVE_RETRY_ATTEMPTS; attempt++) {
    try {
      renameSync(src, dest);
      return;
    } catch (err: any) {
      if (!TRANSIENT_MOVE_ERROR_CODES.has(err?.code)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
  cpSync(src, dest, { recursive: true });
  rmSync(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * 递归收集目录内全部文件的相对路径（正斜杠分隔，名称排序）。
 */
function collectRelativeFiles(dir: string, baseDir = dir): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectRelativeFiles(fullPath, baseDir));
    } else if (stat.isFile()) {
      results.push(relative(baseDir, fullPath).split(sep).join("/"));
    }
  }
  return results;
}

/**
 * 获取内部依赖版本约束。
 */
function getInternalDepVersion(): string {
  if (ACTIONDOCK_VERSION.includes("-")) {
    return ACTIONDOCK_VERSION;
  }
  return `^${ACTIONDOCK_VERSION}`;
}

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
      resolve(__dirname, "../../../node_modules", dep.name, "package.json"),
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
        } catch {
          // 忽略单个依赖解析异常
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
 * 生成独立 Node.js 启动入口脚本源码。
 */
function generateNodeEntrySource(
  plan: ReturnType<typeof SelectionPlanner.prototype.plan>,
  relativeActionPaths: string[]
): string {
  const imports = relativeActionPaths
    .map((relPath, idx) => `import action_${idx} from ${JSON.stringify(relPath)};`)
    .join("\n");

  const actionItems = plan.actions
    .map((a, idx) => {
      const entryObj = `{
      ...(typeof action_${idx} === "function" ? { run: action_${idx} } : action_${idx}),
      id: action_${idx}?.id || ${JSON.stringify(a.id)},
      description: action_${idx}?.description || ${JSON.stringify(a.description || "")},
      inputSchema: action_${idx}?.inputSchema ?? ${JSON.stringify(a.inputSchema ?? null)},
      outputSchema: action_${idx}?.outputSchema ?? ${JSON.stringify(a.outputSchema ?? null)},
      tags: action_${idx}?.tags || ${JSON.stringify(a.tags || [])},
      annotations: action_${idx}?.annotations || ${JSON.stringify(a.annotations || {})},
    }`;
      return entryObj;
    })
    .join(",\n    ");

  return `#!/usr/bin/env node
// AUTO-GENERATED ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import { createStandaloneRuntime } from "@actiondock/core";
${imports}

// 独立入口拒绝异步启动语义
if (process.argv.includes("--async")) {
  const isJson = process.argv.includes("--json");
  if (isJson) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: "STANDALONE_ASYNC_UNSUPPORTED",
            message:
              "Async execution is not supported in standalone single-execution binaries. Use 'ad serve' or remote target.",
          },
        },
        null,
        2
      )
    );
  } else {
    console.error(
      "Error [STANDALONE_ASYNC_UNSUPPORTED]: Async execution is not supported in standalone single-execution binaries."
    );
  }
  process.exit(1);
}

const app = createStandaloneRuntime({
  packageId: ${JSON.stringify(plan.packageId)},
  version: ${JSON.stringify(plan.version)},
  description: ${JSON.stringify(plan.description || "")},
  config: ${JSON.stringify(plan.configDefs || {})},
  actions: [
    ${actionItems}
  ],
});

app.run(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

/**
 * 构建 Node.js 目录型交付产物。
 *
 * @param options 构建选项
 * @returns 构建产物结果描述
 */
export async function buildProject(options: BuildOptions): Promise<BuildResult> {
  // 彻底删除原有单文件二进制输出语义，明确拒绝并报错
  if (options.target !== undefined || options.bytecode !== undefined) {
    throw new BuilderError(
      "Unsupported build mode: '--target' and '--bytecode' standalone single-file binary compilation have been removed in ActionDock 2.0. Directory-based Node.js builds are now the standard distribution format.",
      "UNSUPPORTED_BUILD_MODE"
    );
  }

  const root = resolve(options.projectRoot);
  const plan = SelectionPlanner.plan({
    projectRoot: root,
    config: options.config,
    manifest: options.manifest,
    actions: options.actions,
    playbooks: options.playbooks,
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

  try {
    // 拷贝 Action 源码文件，保留相对路径
    const relativeActionImports: string[] = [];
    for (const act of plan.actions) {
      if (existsSync(act.resolvedPath)) {
        const destFile = join(stagingDir, act.entry);
        mkdirSync(dirname(destFile), { recursive: true });
        copyFileSync(act.resolvedPath, destFile);
        relativeActionImports.push(`./${act.entry.replace(/\\/g, "/")}`);
      }
    }

    // 拷贝 Playbook 规程文件
    if (plan.playbooks.length > 0) {
      const playbooksDir = plan.playbooksDir || "playbooks";
      const playbooksDestDir = join(stagingDir, playbooksDir);
      mkdirSync(playbooksDestDir, { recursive: true });
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          const destPb = join(playbooksDestDir, basename(pb.filePath));
          copyFileSync(pb.filePath, destPb);
        }
      }
    }

    // 拷贝声明的代码文件与静态资产
    for (const dep of plan.dependencies.modulesAndAssets) {
      if (
        (dep.type === "asset" || dep.type === "module" || dep.type === "file") &&
        existsSync(dep.resolvedPath)
      ) {
        const destPath = join(stagingDir, dep.path);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(dep.resolvedPath, destPath);
      }
    }

    // 生成裁剪后的 actiondock.json
    const exportedConfig: Record<string, unknown> = {
      id: plan.packageId,
      name: plan.packageName,
      version: plan.version,
      description: plan.description,
      actionsDir: plan.actionsDir || "actions",
      playbooksDir: plan.playbooksDir || "playbooks",
      config: plan.configDefs || {},
    };
    if (plan.files && plan.files.length > 0) {
      exportedConfig.files = plan.files;
    }
    if (plan.assets && plan.assets.length > 0) {
      exportedConfig.assets = plan.assets;
    }
    writeFileSync(
      join(stagingDir, "actiondock.json"),
      JSON.stringify(exportedConfig, null, 2) + "\n",
      "utf-8"
    );

    // 生成裁剪后的 actiondock.manifest.json
    const manifestActions: Record<string, unknown> = {};
    for (const act of plan.actions) {
      manifestActions[act.id] = {
        entry: act.entry,
        description: act.description,
        inputSchema: act.inputSchema,
        outputSchema: act.outputSchema,
        uses: act.uses,
        tags: act.tags,
        annotations: act.annotations,
      };
    }
    const exportedManifest: Record<string, unknown> = {
      schemaVersion: 1,
      actions: manifestActions,
      assets: plan.assets,
    };
    if (plan.files && plan.files.length > 0) {
      exportedManifest.files = plan.files;
    }
    writeFileSync(
      join(stagingDir, "actiondock.manifest.json"),
      JSON.stringify(exportedManifest, null, 2) + "\n",
      "utf-8"
    );

    // 准备锁定的生产依赖
    const productionDependencies: Record<string, string> = {
      "@actiondock/core": getInternalDepVersion(),
    };
    for (const ext of plan.dependencies.external) {
      if (!ext.isDev) {
        productionDependencies[ext.name] = ext.versionRange || "*";
      }
    }

    // 生成部署用 package.json
    const deploymentPkg: Record<string, unknown> = {
      name: pkgSlug,
      version: plan.version,
      description: plan.description,
      type: "module",
      main: "./entry.mjs",
      bin: {
        [pkgSlug]: "./entry.mjs",
      },
      engines: {
        node: ">=22.13.0",
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

    // 生成启动入口 entry.mjs
    const entryCode = generateNodeEntrySource(plan, relativeActionImports);
    const entryPath = join(stagingDir, "entry.mjs");
    writeFileSync(entryPath, entryCode, "utf-8");
    try {
      chmodSync(entryPath, 0o755);
    } catch {
      // 忽略部分平台权限设置异常
    }

    // 若开启 options.vendorDeps，物化锁定生产依赖
    let platformInfo: { os: string; arch: string; nodeAbi: string } | undefined;
    if (options.vendorDeps) {
      platformInfo = {
        os: process.platform,
        arch: process.arch,
        nodeAbi: process.versions.modules,
      };

      const destNodeModules = join(stagingDir, "node_modules");
      mkdirSync(destNodeModules, { recursive: true });

      // 尝试复制本地已解析的生产依赖
      const sourceCandidates = [
        join(root, "node_modules"),
        resolve(__dirname, "../../../node_modules"),
      ];

      const copyVendorPackage = (srcDir: string, destDir: string): void => {
        if (!existsSync(srcDir)) return;
        mkdirSync(destDir, { recursive: true });
        const entries = readdirSync(srcDir);
        for (const entry of entries) {
          if (
            entry === "node_modules" ||
            entry === ".git" ||
            entry === ".actiondock" ||
            entry === "test" ||
            entry === "tests"
          ) {
            continue;
          }
          const srcPath = join(srcDir, entry);
          const destPath = join(destDir, entry);
          try {
            const stat = statSync(srcPath);
            if (stat.isDirectory()) {
              copyVendorPackage(srcPath, destPath);
            } else if (stat.isFile()) {
              copyFileSync(srcPath, destPath);
            }
          } catch {
            // 忽略无法读取的文件或死链接
          }
        }
      };

      for (const dep of plan.dependencies.external) {
        if (dep.isDev) continue;
        for (const baseModules of sourceCandidates) {
          const srcDep = join(baseModules, dep.name);
          if (existsSync(srcDep)) {
            const targetDep = join(destNodeModules, dep.name);
            mkdirSync(dirname(targetDep), { recursive: true });
            copyVendorPackage(srcDep, targetDep);
            break;
          }
        }
      }

      // 复制 ActionDock 内部依赖
      for (const internalPkg of ["@actiondock/core", "@actiondock/sdk", "@actiondock/runtime-node"]) {
        for (const baseModules of sourceCandidates) {
          const srcDep = join(baseModules, internalPkg);
          if (existsSync(srcDep)) {
            const targetDep = join(destNodeModules, internalPkg);
            mkdirSync(dirname(targetDep), { recursive: true });
            copyVendorPackage(srcDep, targetDep);
            break;
          }
        }
      }
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
        node: ">=22.13.0",
      },
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
    if (existsSync(outputDir)) {
      const backupDir = `${outputDir}.old-${Date.now()}`;
      try {
        await moveDirAtomic(outputDir, backupDir);
        await moveDirAtomic(stagingDir, outputDir);
        rmSync(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        rmSync(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        await moveDirAtomic(stagingDir, outputDir);
      }
    } else {
      await moveDirAtomic(stagingDir, outputDir);
    }
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
  const finalEntrypoint = join(outputDir, "entry.mjs");
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
