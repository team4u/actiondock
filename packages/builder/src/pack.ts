import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { getPackageSlug, loadProjectConfig } from "@actiondock/core";
import { BuilderError } from "./errors";
import {
  assertNoFileProtocolDeps,
  assertValidManifestActionIds,
  normalizePkgExportsAndEngines,
  readPackageJson,
  serializePlanManifest,
} from "./manifest";
import { collectRelativeFiles } from "./fs-utils";
import { SelectionPlanner } from "./planner";
import type { ActionDependency, PackOptions, PackResult, SelectionPlan } from "./types";

/**
 * 对 Action Package 执行打包并生成标准 npm Action 压缩包（.tgz）。
 *
 * 职责：
 * - 调用项目本地 TypeScript 编译（Node 执行），输出声明文件（.d.ts）与纯 JavaScript ESM 产物到临时暂存目录。
 * - 严格校验导出的 Manifest（入口全部指向编译后的 .js/.mjs，不得包含 actionsDir 或 playbooksDir 等废弃目录字段）。
 * - 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz），严禁使用正则替换与自建 tar 压缩。
 *
 * @param options 打包参数选项
 * @returns 打包结果元数据
 */
export async function packProject(options: PackOptions): Promise<PackResult> {
  const root = resolve(options.projectRoot);
  const pkgConfig = options.config || loadProjectConfig(root);
  const plan = SelectionPlanner.plan({
    projectRoot: root,
    config: pkgConfig,
    manifest: options.manifest,
  });

  if (plan.actions.length === 0) {
    throw new BuilderError("No actions resolved for packing");
  }

  const pkgSlug = getPackageSlug(plan.packageId);
  const pkgJsonPath = join(root, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new BuilderError(`package.json not found in project root: ${root}`);
  }

  const sourcePkgJson = readPackageJson(pkgJsonPath);

  // 校验生产依赖合法性（禁止 file: 本地协议）
  assertNoFileProtocolDeps(sourcePkgJson.dependencies, "packed packages");

  // 创建干净临时目录，确保不改写源工程
  const tempBase = mkdtempSync(join(tmpdir(), "ad-pack-"));
  const stagingPkgDir = join(tempBase, "package");
  mkdirSync(stagingPkgDir, { recursive: true });

  try {
    await compileTypeScript(root, stagingPkgDir, plan);
    stageSources(root, stagingPkgDir, plan);
    writeManifestAndPkgJson(stagingPkgDir, plan, sourcePkgJson);

    // 收集打包文件相对清单与摘要
    const relativeFiles = collectRelativeFiles(stagingPkgDir);
    const manifestSummary = {
      actionsCount: plan.actions.length,
      actions: plan.actions.map((a) => a.id),
      assetsCount: plan.assets.length,
      filesCount: relativeFiles.length,
    };

    const tarballName = `${pkgSlug}-${plan.version}.tgz`;
    const targetOutDir = resolve(options.outDir || join(root, "dist"));

    if (options.dryRun) {
      return {
        packageId: plan.packageId,
        packageName: plan.packageName,
        version: plan.version,
        tarballName,
        sizeBytes: 0,
        sha256: "",
        files: relativeFiles,
        manifestSummary,
      };
    }

    mkdirSync(targetOutDir, { recursive: true });

    // 优先使用 npm pack 返回的实名产物（保证与压缩包内 package.json name 一致），
    // 移动而非复制改名；仅当无法获取实名时回退到本地拼接名
    const generatedTarball = await runNpmPack(stagingPkgDir, tempBase, tarballName);
    let finalTarballPath: string;
    let finalTarballName: string;
    if (basename(generatedTarball) === tarballName) {
      finalTarballPath = join(targetOutDir, tarballName);
      finalTarballName = tarballName;
      if (existsSync(finalTarballPath)) {
        rmSync(finalTarballPath, { force: true });
      }
      renameSync(generatedTarball, finalTarballPath);
    } else {
      finalTarballName = basename(generatedTarball);
      finalTarballPath = join(targetOutDir, finalTarballName);
      if (existsSync(finalTarballPath)) {
        rmSync(finalTarballPath, { force: true });
      }
      try {
        renameSync(generatedTarball, finalTarballPath);
      } catch {
        // 跨设备 rename 失败时回退为复制后删除源文件
        copyFileSync(generatedTarball, finalTarballPath);
        rmSync(generatedTarball, { force: true });
      }
    }

    const stat = statSync(finalTarballPath);
    const fileBuf = readFileSync(finalTarballPath);
    const sha256 = createHash("sha256").update(fileBuf).digest("hex");

    return {
      packageId: plan.packageId,
      packageName: plan.packageName,
      version: plan.version,
      tarballPath: finalTarballPath,
      tarballName: finalTarballName,
      sizeBytes: stat.size,
      sha256,
      files: relativeFiles,
      manifestSummary,
    };
  } finally {
    if (existsSync(tempBase)) {
      rmSync(tempBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

/**
 * 判断文件路径是否为 TypeScript 源码。
 */
function isTypeScriptSource(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".mts");
}

/**
 * 解析项目本地 TypeScript 编译器（回退到打包工具自身依赖）。
 */
async function resolveTypeScriptCompiler(root: string): Promise<any> {
  try {
    const req = createRequire(join(root, "package.json"));
    const tsPath = req.resolve("typescript");
    const imported = await import(tsPath);
    return imported.default || imported;
  } catch {
    try {
      const imported = await import("typescript");
      return imported.default || imported;
    } catch {
      throw new BuilderError(
        `TypeScript is required to pack TypeScript Action packages, but 'typescript' could not be resolved from ${root}.`
      );
    }
  }
}

/**
 * 在暂存目录内执行 TypeScript 编译，产出 .js 与 .d.ts。
 * 仅在存在 TypeScript 源码时执行。
 */
async function compileTypeScript(
  root: string,
  stagingPkgDir: string,
  plan: SelectionPlan
): Promise<void> {
  const hasTypeScript =
    plan.actions.some((a) => isTypeScriptSource(a.entry)) ||
    plan.dependencies.modulesAndAssets.some(
      (m) => (m.type === "module" || m.type === "file") && isTypeScriptSource(m.path)
    );
  if (!hasTypeScript) {
    return;
  }

  const ts = await resolveTypeScriptCompiler(root);

  const tsSourceFiles = new Set<string>();
  for (const act of plan.actions) {
    if (act.isExternal || act.id.includes("/")) continue;
    if (isTypeScriptSource(act.entry)) {
      tsSourceFiles.add(act.resolvedPath);
    }
  }
  for (const mod of plan.dependencies.modulesAndAssets) {
    if ((mod.type === "module" || mod.type === "file") && isTypeScriptSource(mod.path)) {
      tsSourceFiles.add(mod.resolvedPath);
    }
  }

  const compilerOptions: any = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    declaration: true,
    emitDeclarationOnly: false,
    rewriteRelativeImportExtensions: true,
    rootDir: root,
    outDir: stagingPkgDir,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowJs: true,
  };

  const tsconfigPath = join(root, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
        // tsc 不会改写 import 说明符：paths 路径别名在产物中无法解析，必须显式拒绝而非静默编译出坏产物
        if (parsedConfig.options.paths && Object.keys(parsedConfig.options.paths).length > 0) {
          throw new BuilderError(
            `tsconfig.json 'paths' aliases are not supported in packed output: TypeScript does not rewrite import specifiers, so the packed artifact would contain unresolvable module specifiers. Replace path aliases with relative imports, or pre-build the project and pack the compiled output instead.`,
            "PATHS_ALIAS_UNSUPPORTED"
          );
        }
        Object.assign(compilerOptions, parsedConfig.options, {
          outDir: stagingPkgDir,
          rootDir: root,
          declaration: true,
          emitDeclarationOnly: false,
          rewriteRelativeImportExtensions: true,
          noEmit: false,
        });
      }
    } catch (err) {
      if (err instanceof BuilderError) {
        throw err;
      }
      // 忽略 tsconfig 解析失败，回退到标准 compilerOptions
    }
  }

  const host = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram(Array.from(tsSourceFiles), compilerOptions, host);
  const emitResult = program.emit();

  const preEmitDiagnostics = ts.getPreEmitDiagnostics(program);
  const allDiagnostics = [...preEmitDiagnostics, ...emitResult.diagnostics];
  const errors = allDiagnostics.filter(
    (d: any) => d.category === ts.DiagnosticCategory.Error
  );

  if (errors.length > 0 || emitResult.emitSkipped) {
    const diagnosticsToFormat = errors.length > 0 ? errors : allDiagnostics;
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnosticsToFormat, {
      getCanonicalFileName: (f: string) => f,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    });
    throw new BuilderError(`TypeScript compilation failed during pack:\n${formatted}`);
  }
}

/**
 * 拷贝声明的非 TypeScript 模块、静态资产、原生 JavaScript 入口、Playbook 与基础文档到暂存目录。
 */
function stageSources(root: string, stagingPkgDir: string, plan: SelectionPlan): void {
  // 拷贝声明的非 TypeScript 模块与静态资产
  for (const dep of plan.dependencies.modulesAndAssets) {
    if (
      (dep.type === "asset" || dep.type === "module" || dep.type === "file") &&
      existsSync(dep.resolvedPath)
    ) {
      if (isTypeScriptSource(dep.path)) {
        continue; // 已由 TypeScript 编译生成 .js 与 .d.ts
      }
      const destPath = join(stagingPkgDir, dep.path);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(dep.resolvedPath, destPath);
    }
  }

  // 拷贝原生 JavaScript Action 入口（若存在）
  for (const act of plan.actions) {
    if (!isTypeScriptSource(act.entry)) {
      const destPath = join(stagingPkgDir, act.entry);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(act.resolvedPath, destPath);
    }
  }

  // 拷贝 Playbook 规程文件
  for (const pb of plan.playbooks) {
    if (existsSync(pb.filePath)) {
      const destPb = join(stagingPkgDir, relative(root, pb.filePath));
      mkdirSync(dirname(destPb), { recursive: true });
      copyFileSync(pb.filePath, destPb);
    }
  }

  // 拷贝 README 等基础文档（若存在）
  for (const doc of ["README.md", "readme.md", "LICENSE", "license"]) {
    const srcDoc = join(root, doc);
    if (existsSync(srcDoc)) {
      copyFileSync(srcDoc, join(stagingPkgDir, doc));
    }
  }
}

/**
 * 计算编译后的 Action 入口相对路径（.ts 转 .js、.mts 转 .mjs）。
 */
function compiledEntryFor(action: ActionDependency): string {
  if (action.entry.endsWith(".ts")) {
    return action.entry.slice(0, -3) + ".js";
  }
  if (action.entry.endsWith(".mts")) {
    return action.entry.slice(0, -4) + ".mjs";
  }
  return action.entry;
}

/**
 * 生成并写入严格校验后的 actiondock.json 与规范化 package.json。
 */
function writeManifestAndPkgJson(
  stagingPkgDir: string,
  plan: SelectionPlan,
  sourcePkgJson: Record<string, any>
): void {
  // 构建编译后的 Action 清单字典并严格校验入口扩展名
  const compiledEntries = new Map<string, string>();
  for (const act of plan.actions) {
    if (act.isExternal || act.id.includes("/")) continue;
    const destEntry = compiledEntryFor(act);
    if (!destEntry.endsWith(".js") && !destEntry.endsWith(".mjs")) {
      throw new BuilderError(
        `Action '${act.id}' entry '${destEntry}' must point to compiled .js or .mjs`
      );
    }
    if (!existsSync(join(stagingPkgDir, destEntry))) {
      throw new BuilderError(`Compiled action entry file not found: ${destEntry}`);
    }
    compiledEntries.set(act.id, destEntry);
  }

  // 严格生成与校验 actiondock.json（严禁包含废弃 actionsDir 或 playbooksDir 字段）
  const packedConfig = serializePlanManifest(plan, {
    includeSchema: true,
    configBeforeActions: true,
    includePlaybooks: false,
    actionEntryOverride: (act) => compiledEntries.get(act.id)!,
  });

  if ("actionsDir" in packedConfig || "playbooksDir" in packedConfig) {
    throw new BuilderError(
      "Packed manifest must not contain deprecated fields 'actionsDir' or 'playbooksDir'."
    );
  }

  if (packedConfig.actions && typeof packedConfig.actions === "object") {
    assertValidManifestActionIds(packedConfig.actions as Record<string, unknown>);
  }

  writeFileSync(
    join(stagingPkgDir, "actiondock.json"),
    JSON.stringify(packedConfig, null, 2) + "\n",
    "utf-8"
  );

  // 规范化 package.json：导出 ./actiondock.json，设定 node 引擎约束与 ESM 类型
  const normalizedPkg = normalizePkgExportsAndEngines(sourcePkgJson);
  writeFileSync(
    join(stagingPkgDir, "package.json"),
    JSON.stringify(normalizedPkg, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz）。
 * 优先解析 --json 结构化输出，失败时回退到尾部行文件名解析。
 * Windows 兼容：npm 是 .cmd 脚本，无 shell 直接 spawn 会 ENOENT/EINVAL。
 */
async function runNpmPack(
  stagingPkgDir: string,
  packDestination: string,
  fallbackName: string
): Promise<string> {
  const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", packDestination],
        {
          cwd: stagingPkgDir,
          shell: process.platform === "win32",
        }
      );
      let stdoutBuf = "";
      let stderrBuf = "";
      child.stdout.on("data", (chunk) => (stdoutBuf += chunk));
      child.stderr.on("data", (chunk) => (stderrBuf += chunk));
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise({ stdout: stdoutBuf, stderr: stderrBuf });
        } else {
          rejectPromise(
            new BuilderError(
              `npm pack exited with code ${code}. Output:\n${stdoutBuf}\n${stderrBuf}`
            )
          );
        }
      });
    }
  );

  // 优先解析 --json 结构化输出中的压缩包文件名
  let generatedName: string | undefined;
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const filename = items[0]?.filename;
      if (typeof filename === "string" && filename.length > 0) {
        generatedName = filename;
      }
    } catch {
      // 回退到尾部行解析
    }
  }

  if (!generatedName) {
    const packLines = trimmed.split("\n");
    generatedName = packLines.pop()?.trim() || fallbackName;
  }

  const generatedTarball = join(packDestination, generatedName);
  if (!existsSync(generatedTarball)) {
    throw new BuilderError(
      `npm pack did not produce expected tarball at ${generatedTarball}. Output:\n${stdout}`
    );
  }
  return generatedTarball;
}
