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
 * 生成 Host 子进程入口脚本源码（负责运行 ActionDockHost，通过 Node IPC 暴露 Target）。
 */
function generateNodeHostEntrySource(
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
// AUTO-GENERATED HOST ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import {
  createActionDockHost,
  createActionDockTarget,
  serveParentIpc,
} from "@actiondock/core";
import { createNodePlatform } from "@actiondock/runtime-node";
${imports}

let dataDir;
const configOverrides = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data-dir" && i + 1 < args.length) {
    dataDir = args[++i];
  } else if (args[i].startsWith("--data-dir=")) {
    dataDir = args[i].slice(11);
  } else if (args[i] === "--config" && i + 1 < args.length) {
    const raw = args[++i];
    const [k, ...v] = raw.split("=");
    if (k) configOverrides[k] = v.join("=");
  } else if (args[i].startsWith("--config=")) {
    const raw = args[i].slice(9);
    const [k, ...v] = raw.split("=");
    if (k) configOverrides[k] = v.join("=");
  }
}

const host = await createActionDockHost({
  dataDir,
  packages: [
    {
      dataDir,
      configOverrides,
      projectConfig: {
        id: ${JSON.stringify(plan.packageId)},
        name: ${JSON.stringify(plan.packageName)},
        version: ${JSON.stringify(plan.version)},
        description: ${JSON.stringify(plan.description || "")},
        config: ${JSON.stringify(plan.configDefs || {})},
      },
      actions: [
        ${actionItems}
      ],
    },
  ],
  platform: createNodePlatform({ dataDir }),
});

const target = await createActionDockTarget({ type: "local", host });
await serveParentIpc(target);
`;
}

/**
 * 生成轻量监督父进程脚本源码（负责参数解析、诊断日志限流、退出码管理与标准输出隔离）。
 */
function generateNodeSupervisorEntrySource(
  plan: ReturnType<typeof SelectionPlanner.prototype.plan>
): string {
  return `#!/usr/bin/env node
// AUTO-GENERATED SUPERVISOR ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  IpcActionDockTarget,
  StandaloneDispatcher,
  ExitCode,
} from "@actiondock/core";

const METADATA = {
  packageId: ${JSON.stringify(plan.packageId)},
  version: ${JSON.stringify(plan.version)},
  description: ${JSON.stringify(plan.description || "")},
};

const argv = process.argv.slice(2);

// 1. 监督进程接管参数校验，明确拒绝 --async
if (argv.includes("--async")) {
  const isJson = argv.includes("--json") || argv.includes("--envelope");
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
  process.exit(ExitCode.FAILURE);
}

// 2. 静态元数据快速返回
if (argv.includes("-v") || argv.includes("-V") || argv.includes("--version") || argv[0] === "version") {
  console.log(\`\${METADATA.packageId} v\${METADATA.version}\`);
  process.exit(ExitCode.SUCCESS);
}

if (argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
  console.log(\`\${METADATA.packageId} (v\${METADATA.version})\`);
  if (METADATA.description) console.log(METADATA.description + "\\n");
  console.log("Usage:");
  console.log("  <cmd> list [--json]                         List available actions");
  console.log("  <cmd> describe <id> [--json]                Show action details and schemas");
  console.log("  <cmd> run <id> [--input '<json>']           Execute action with JSON input");
  console.log("  <cmd> config list/get/set/delete            Manage package configuration");
  console.log("  <cmd> state list/get/set/delete             Manage shared state store");
  console.log("\\nGlobal options:");
  console.log("  --data-dir <path>                           Custom runtime database directory");
  console.log("  --config <KEY=val>                          Temporary config override");
  process.exit(ExitCode.SUCCESS);
}

// 3. 建立物理隔离监督边界，启动运行 ActionDockHost 的独立子进程
const hostScript = join(import.meta.dirname, "entry-host.js");
const child = spawn(process.execPath, [hostScript, ...argv], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe", "ipc"],
});

// 4. 标准输出通道物理隔离与受控限流排空
const target = new IpcActionDockTarget({
  childProcess: child,
  maxDiagnosticBytes: 512 * 1024,
  maxRateBytesPerSec: 64 * 1024,
  diagnosticTarget: process.stderr,
});

let cleanedUp = false;
const cleanup = async () => {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    await target.close();
  } catch {}
};

process.once("SIGINT", async () => {
  await cleanup();
  process.exit(ExitCode.SIGINT);
});

process.once("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const dispatcher = new StandaloneDispatcher({
  packageId: METADATA.packageId,
  version: METADATA.version,
  description: METADATA.description,
  target,
});

try {
  const exitCode = await dispatcher.dispatch(argv);
  await cleanup();
  process.exit(exitCode);
} catch (err) {
  if (err?.code === "HOST_PROCESS_EXITED") {
    console.error("[Supervisor] Host process exited unexpectedly:", err.message);
  } else {
    console.error("[Supervisor] Error:", err?.message || err);
  }
  await cleanup();
  process.exit(ExitCode.FAILURE);
}
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

    // 生成裁剪后的 actiondock.json（项目元数据与清单的单一事实源）
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
    const exportedConfig: Record<string, unknown> = {
      schemaVersion: 2,
      id: plan.packageId,
      name: plan.packageName,
      version: plan.version,
      description: plan.description,
      actions: manifestActions,
      config: plan.configDefs || {},
    };
    if (plan.actionsDir) {
      exportedConfig.actionsDir = plan.actionsDir;
    }
    if (plan.playbooksDir) {
      exportedConfig.playbooksDir = plan.playbooksDir;
    }
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

    // 准备锁定的生产依赖
    const productionDependencies: Record<string, string> = {
      "@actiondock/core": getInternalDepVersion(),
      "@actiondock/runtime-node": getInternalDepVersion(),
    };
    for (const ext of plan.dependencies.external) {
      if (!ext.isDev) {
        productionDependencies[ext.name] = ext.versionRange || "*";
      }
    }

    // 生成部署用 package.json（指向监督父进程双入口体系）
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

    // 生成 Host 子进程入口 entry-host.js
    const hostCode = generateNodeHostEntrySource(plan, relativeActionImports);
    const hostPath = join(stagingDir, "entry-host.js");
    writeFileSync(hostPath, hostCode, "utf-8");

    // 生成轻量监督父进程入口 entry-supervisor.js
    const supervisorCode = generateNodeSupervisorEntrySource(plan);
    const supervisorPath = join(stagingDir, "entry-supervisor.js");
    writeFileSync(supervisorPath, supervisorCode, "utf-8");

    // 生成兼容代理入口 entry.mjs，转接到 entry-supervisor.js
    const forwarderCode = `#!/usr/bin/env node\n// AUTO-GENERATED ENTRYPOINT FORWARDER BY ACTIONDOCK BUILDER. DO NOT EDIT.\nimport "./entry-supervisor.js";\n`;
    const forwarderPath = join(stagingDir, "entry.mjs");
    writeFileSync(forwarderPath, forwarderCode, "utf-8");

    try {
      chmodSync(hostPath, 0o755);
      chmodSync(supervisorPath, 0o755);
      chmodSync(forwarderPath, 0o755);
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
        resolve(import.meta.dirname, "../../../node_modules"),
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
