import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadActionFileMap, loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { getPackageSlug } from "../utils";
import { type ActionImport, generateStandaloneEntrypoint } from "./templates";

/**
 * 独立二进制可执行文件构建选项。
 */
export interface BuildOptions {
  /** 目标项目根目录 */
  projectRoot: string;
  /** 目标架构（如 "bun-linux-x64", "bun-darwin-arm64", "bun-windows-x64" 等） */
  target?: string;
  /** 输出可执行文件的目标路径（默认输出到 dist/ 目录） */
  outfile?: string;
  /** 是否开启代码压缩混淆（默认 true） */
  minify?: boolean;
  /** 是否编译为 V8/JavaScriptCore 字节码（默认 false） */
  bytecode?: boolean;
  /** 显式挑选打包的 Action ID 清单（用于按需子集打包） */
  actions?: string[];
}

/**
 * 独立二进制构建完成后的元数据结果对象。
 */
export interface BuildResult {
  /** 所属 Package ID */
  packageId: string;
  /** 打包的项目版本号 */
  version: string;
  /** 编译的目标平台架构 */
  target: string;
  /** 生成的独立二进制可执行文件绝对路径 */
  executablePath: string;
  /** 生成的 sidecar 元数据 JSON 文件绝对路径 */
  metadataPath: string;
  /** 打包内置的 Action ID 列表 */
  actions: string[];
}

/**
 * 调用 Bun 原生编译引擎（Bun.build --compile）将 Action Package 打包为零外部依赖的独立二进制可执行文件。
 * 
 * 构建过程：
 * 1. 动态生成 Standalone 入口点代码（包含 StandaloneRuntime 与 Action 注册）。
 * 2. 生成 sidecar metadata 文件（.actiondock-meta.json），包含 Package 元数据与 sha256 校验和。
 * 3. 执行 Bun.build({ compile: true, target, minify, bytecode })。
 * 
 * @param options 构建参数
 * @returns 构建产物结果元数据
 */
export async function buildProject(options: BuildOptions): Promise<BuildResult> {
  const root = resolve(options.projectRoot);
  const config = loadProjectConfig(root);
  const actionsMap = await loadActions(root, config.actionsDir);

  if (actionsMap.size === 0) {
    throw new Error(`No valid actions found in ${join(root, config.actionsDir || "actions")}`);
  }

  if (options.actions && options.actions.length > 0) {
    const requestedActions = new Set(options.actions);
    for (const reqId of requestedActions) {
      if (!actionsMap.has(reqId)) {
        throw new Error(`Action '${reqId}' requested in build options not found in project`);
      }
    }
    for (const id of Array.from(actionsMap.keys())) {
      if (!requestedActions.has(id)) {
        actionsMap.delete(id);
      }
    }
  }

  // Action imports list
  const actionFileMap = await loadActionFileMap(root, config.actionsDir);
  const actionImports: ActionImport[] = [];

  for (const [id, entry] of actionFileMap.entries()) {
    if (actionsMap.has(id)) {
      actionImports.push({
        id,
        filePath: entry.filePath,
      });
    }
  }

  if (actionImports.length === 0) {
    throw new Error("Could not map any action files for build");
  }

  // Create build dir
  const buildDir = join(root, ".actiondock", ".build");
  mkdirSync(buildDir, { recursive: true });

  const entryCode = generateStandaloneEntrypoint(
    config.id,
    config.version,
    config.description,
    actionImports,
    config.config
  );
  const entryPath = join(buildDir, "entry.ts");
  writeFileSync(entryPath, entryCode, "utf-8");

  // Determine target and outfile
  const target = options.target || "bun";
  const binaryName = getPackageSlug(config.id);

  const defaultOutfile = join(root, "dist", binaryName);
  const outfile = resolve(options.outfile || defaultOutfile);

  mkdirSync(dirname(outfile), { recursive: true });

  // Run bun build --compile --bytecode --minify
  const buildArgs = [
    "bun",
    "build",
    entryPath,
    "--compile",
    "--outfile",
    outfile,
  ];

  if (options.bytecode !== false) {
    buildArgs.push("--bytecode");
  }

  if (options.minify !== false) {
    buildArgs.push("--minify");
  }

  if (options.target && options.target !== "bun" && options.target !== "host") {
    // e.g. bun-linux-x64 or linux-x64
    const formattedTarget = options.target.startsWith("bun-")
      ? options.target
      : `bun-${options.target}`;
    buildArgs.push(`--target=${formattedTarget}`);
  }

  const proc = Bun.spawnSync(buildArgs, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const errText = proc.stderr.toString() || proc.stdout.toString();
    throw new Error(`Bun compile failed (exit code ${proc.exitCode}):\n${errText}`);
  }

  // Compile artifact resolution (on Windows bun compile automatically appends .exe)
  let artifactPath = outfile;
  if (!existsSync(artifactPath)) {
    const withExe = outfile + ".exe";
    if (existsSync(withExe)) {
      artifactPath = withExe;
    }
  }

  // Calculate build hash
  const binaryBuffer = readFileSync(artifactPath);
  const buildHash = createHash("sha256").update(binaryBuffer).digest("hex").slice(0, 16);

  // Calculate lockHash
  let lockHash = "none";
  const lockFiles = ["bun.lock", "bun.lockb", "package.json"];
  for (const lf of lockFiles) {
    const p = join(root, lf);
    if (existsSync(p)) {
      lockHash = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
      break;
    }
  }

  // Generate artifact.json metadata
  const metadata = {
    packageId: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    target: options.target || "host",
    actions: actionImports.map((a) => a.id),
    bunVersion: Bun.version,
    lockHash,
    buildHash,
    createdAt: new Date().toISOString(),
  };

  const metadataPath = join(dirname(artifactPath), "artifact.json");
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf-8");

  return {
    packageId: config.id,
    version: config.version,
    target: options.target || "host",
    executablePath: artifactPath,
    metadataPath,
    actions: metadata.actions,
  };
}
