import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildPlanner, BunCompiler } from "@actiondock/builder";
import { getPackageSlug } from "../utils";
import { generateStandaloneEntrypoint } from "./templates";

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
  /** 是否编译为 V8/JavaScriptCore 字节码（默认 true） */
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
 * @param options 构建参数
 * @returns 构建产物结果元数据
 */
export async function buildProject(options: BuildOptions): Promise<BuildResult> {
  const root = resolve(options.projectRoot);
  const plan = BuildPlanner.plan({
    projectRoot: root,
    actions: options.actions,
  });

  if (plan.actions.length === 0) {
    throw new Error("Could not map any action files for build");
  }

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

  const binaryName = getPackageSlug(plan.packageId);
  const defaultOutfile = join(root, "dist", binaryName);
  const outfile = resolve(options.outfile || defaultOutfile);

  try {
    const result = await BunCompiler.compile({
      entrypoint: entryPath,
      outfile,
      target: options.target,
      minify: options.minify,
      bytecode: options.bytecode,
      cwd: root,
      packageId: plan.packageId,
      version: plan.version,
      actions: plan.actions.map((a) => a.id),
    });

    return {
      packageId: result.packageId || plan.packageId,
      version: result.version || plan.version,
      target: result.target,
      executablePath: result.executablePath,
      metadataPath: result.metadataPath || "",
      actions: plan.actions.map((a) => a.id),
    };
  } finally {
    if (existsSync(entryPath)) {
      rmSync(entryPath, { force: true });
    }
  }
}

