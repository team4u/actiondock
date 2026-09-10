import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getPackageSlug, loadProjectConfig } from "@actiondock/core";
import { BuilderError } from "./errors";
import { SelectionPlanner } from "./planner";
import type { PackOptions, PackResult } from "./types";

/**
 * 递归扫描目录中全部相对路径。
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
 * 对 Action Package 执行打包并生成标准 npm Action 压缩包（.tgz）。
 * 
 * 职责：
 * 1. 调用项目本地 TypeScript 编译（Node 执行），输出声明文件（.d.ts）与纯 JavaScript ESM 产物到临时暂存目录。
 * 2. 严格校验导出的 Manifest（入口全部指向编译后的 .js/.mjs，不得包含 actionsDir 或 playbooksDir 等废弃目录字段）。
 * 3. 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz），严禁使用正则替换与自建 tar 压缩。
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

  let sourcePkgJson: any;
  try {
    sourcePkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch (err: any) {
    throw new BuilderError(`Invalid package.json in ${root}: ${err?.message || String(err)}`);
  }

  // 校验生产依赖合法性（禁止 file: 本地协议）
  if (sourcePkgJson.dependencies && typeof sourcePkgJson.dependencies === "object") {
    for (const [depName, depVer] of Object.entries(sourcePkgJson.dependencies)) {
      const verStr = String(depVer);
      if (verStr.startsWith("file:")) {
        throw new BuilderError(
          `Unsupported file: dependency for '${depName}'. Runtime dependencies must not use file: protocol in packed packages.`
        );
      }
    }
  }

  // 创建干净临时目录，确保不改写源工程
  const tempBase = mkdtempSync(join(tmpdir(), "ad-pack-"));
  const stagingPkgDir = join(tempBase, "package");
  mkdirSync(stagingPkgDir, { recursive: true });

  try {
    // 检查是否存在需要编译的 TypeScript 源码
    const hasTypeScript =
      plan.actions.some((a) => a.entry.endsWith(".ts") || a.entry.endsWith(".mts")) ||
      plan.dependencies.modulesAndAssets.some(
        (m) =>
          (m.type === "module" || m.type === "file") &&
          (m.path.endsWith(".ts") || m.path.endsWith(".mts"))
      );

    if (hasTypeScript) {
      // 解析项目本地 TypeScript 编译器
      let ts: any;
      try {
        const req = createRequire(join(root, "package.json"));
        const tsPath = req.resolve("typescript");
        const imported = await import(tsPath);
        ts = imported.default || imported;
      } catch {
        try {
          const imported = await import("typescript");
          ts = imported.default || imported;
        } catch {
          throw new BuilderError(
            `TypeScript is required to pack TypeScript Action packages, but 'typescript' could not be resolved from ${root}.`
          );
        }
      }

      const tsSourceFiles = new Set<string>();
      for (const act of plan.actions) {
        if (act.entry.endsWith(".ts") || act.entry.endsWith(".mts")) {
          tsSourceFiles.add(act.resolvedPath);
        }
      }
      for (const mod of plan.dependencies.modulesAndAssets) {
        if (
          (mod.type === "module" || mod.type === "file") &&
          (mod.path.endsWith(".ts") || mod.path.endsWith(".mts"))
        ) {
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
        strict: false,
        noImplicitAny: false,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        allowJs: true,
      };

      const tsconfigPath = join(root, "tsconfig.json");
      if (existsSync(tsconfigPath)) {
        try {
          const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
          if (!configFile.error) {
            const parsedConfig = ts.parseJsonConfigFileContent(
              configFile.config,
              ts.sys,
              root
            );
            Object.assign(compilerOptions, parsedConfig.options, {
              outDir: stagingPkgDir,
              rootDir: root,
              declaration: true,
              emitDeclarationOnly: false,
              rewriteRelativeImportExtensions: true,
              noEmit: false,
              strict: false,
              noImplicitAny: false,
            });
          }
        } catch {
          // 忽略 tsconfig 解析失败，回退到标准 compilerOptions
        }
      }

      const host = ts.createCompilerHost(compilerOptions);
      const program = ts.createProgram(Array.from(tsSourceFiles), compilerOptions, host);
      const emitResult = program.emit();

      if (emitResult.emitSkipped) {
        const errors = emitResult.diagnostics.filter(
          (d: any) => d.category === ts.DiagnosticCategory.Error
        );
        const formatted = ts.formatDiagnosticsWithColorAndContext(errors, {
          getCanonicalFileName: (f: string) => f,
          getCurrentDirectory: () => root,
          getNewLine: () => "\n",
        });
        throw new BuilderError(`TypeScript compilation failed during pack:\n${formatted}`);
      }
    }

    // 拷贝声明的非 TypeScript 模块与静态资产
    for (const dep of plan.dependencies.modulesAndAssets) {
      if (
        (dep.type === "asset" || dep.type === "module" || dep.type === "file") &&
        existsSync(dep.resolvedPath)
      ) {
        if (dep.path.endsWith(".ts") || dep.path.endsWith(".mts")) {
          continue; // 已由 TypeScript 编译生成 .js 与 .d.ts
        }
        const destPath = join(stagingPkgDir, dep.path);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(dep.resolvedPath, destPath);
      }
    }

    // 拷贝原生 JavaScript Action 入口（若存在）
    for (const act of plan.actions) {
      if (!act.entry.endsWith(".ts") && !act.entry.endsWith(".mts")) {
        const destPath = join(stagingPkgDir, act.entry);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(act.resolvedPath, destPath);
      }
    }

    // 拷贝 Playbook 规程文件
    if (plan.playbooks.length > 0) {
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          const relPath = relative(root, pb.filePath);
          const destPb = join(stagingPkgDir, relPath);
          mkdirSync(dirname(destPb), { recursive: true });
          copyFileSync(pb.filePath, destPb);
        }
      }
    }

    // 拷贝 README 等基础文档（若存在）
    for (const doc of ["README.md", "readme.md", "LICENSE", "license"]) {
      const srcDoc = join(root, doc);
      if (existsSync(srcDoc)) {
        copyFileSync(srcDoc, join(stagingPkgDir, doc));
      }
    }

    // 构建编译后的 Action 清单字典并严格校验入口扩展名
    const jsActions: Record<string, unknown> = {};
    for (const act of plan.actions) {
      let destEntry = act.entry;
      if (act.entry.endsWith(".ts")) {
        destEntry = act.entry.slice(0, -3) + ".js";
      } else if (act.entry.endsWith(".mts")) {
        destEntry = act.entry.slice(0, -4) + ".mjs";
      }

      if (!destEntry.endsWith(".js") && !destEntry.endsWith(".mjs")) {
        throw new BuilderError(
          `Action '${act.id}' entry '${destEntry}' must point to compiled .js or .mjs`
        );
      }

      const destFilePath = join(stagingPkgDir, destEntry);
      if (!existsSync(destFilePath)) {
        throw new BuilderError(`Compiled action entry file not found: ${destEntry}`);
      }

      jsActions[act.id] = {
        entry: destEntry,
        description: act.description,
        inputSchema: act.inputSchema,
        outputSchema: act.outputSchema,
        uses: act.uses,
        tags: act.tags,
        annotations: act.annotations,
      };
    }

    // 严格生成与校验 actiondock.json（严禁包含废弃 actionsDir 或 playbooksDir 字段）
    const packedConfig: Record<string, unknown> = {
      $schema: "https://actiondock.dev/schema/v2.json",
      schemaVersion: 2,
      id: plan.packageId,
      name: plan.packageName,
      version: plan.version,
      description: plan.description,
      config: plan.configDefs || {},
      actions: jsActions,
    };
    if (plan.files && plan.files.length > 0) {
      packedConfig.files = plan.files;
    }
    if (plan.assets && plan.assets.length > 0) {
      packedConfig.assets = plan.assets;
    }

    if ("actionsDir" in packedConfig || "playbooksDir" in packedConfig) {
      throw new BuilderError(
        "Packed manifest must not contain deprecated fields 'actionsDir' or 'playbooksDir'."
      );
    }

    writeFileSync(
      join(stagingPkgDir, "actiondock.json"),
      JSON.stringify(packedConfig, null, 2) + "\n",
      "utf-8"
    );

    // 规范化 package.json：导出 ./actiondock.json，设定 node 引擎约束与 ESM 类型
    const normalizedPkg: Record<string, unknown> = {
      ...sourcePkgJson,
      type: "module",
    };

    let currentExports: Record<string, unknown> = {};
    if (typeof normalizedPkg.exports === "object" && normalizedPkg.exports !== null) {
      currentExports = { ...(normalizedPkg.exports as Record<string, unknown>) };
    } else if (typeof normalizedPkg.exports === "string") {
      currentExports["."] = normalizedPkg.exports;
    }
    currentExports["./actiondock.json"] = "./actiondock.json";
    normalizedPkg.exports = currentExports;

    const currentEngines: Record<string, string> = {
      ...(typeof normalizedPkg.engines === "object" && normalizedPkg.engines !== null
        ? (normalizedPkg.engines as Record<string, string>)
        : {}),
    };
    if (!currentEngines.node) {
      currentEngines.node = ">=24.12.0";
    }
    normalizedPkg.engines = currentEngines;

    writeFileSync(
      join(stagingPkgDir, "package.json"),
      JSON.stringify(normalizedPkg, null, 2) + "\n",
      "utf-8"
    );

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
    const finalTarballPath = join(targetOutDir, tarballName);

    if (existsSync(finalTarballPath)) {
      rmSync(finalTarballPath, { force: true });
    }

    // 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz）
    const packOutput = execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", tempBase],
      {
        cwd: stagingPkgDir,
        encoding: "utf-8",
      }
    );

    const packLines = packOutput.trim().split("\n");
    const generatedName = packLines.pop()?.trim() || `${pkgSlug}-${plan.version}.tgz`;
    const generatedTarball = join(tempBase, generatedName);

    if (!existsSync(generatedTarball)) {
      throw new BuilderError(
        `npm pack did not produce expected tarball at ${generatedTarball}. Output:\n${packOutput}`
      );
    }

    copyFileSync(generatedTarball, finalTarballPath);
    rmSync(generatedTarball, { force: true });

    const stat = statSync(finalTarballPath);
    const fileBuf = readFileSync(finalTarballPath);
    const sha256 = createHash("sha256").update(fileBuf).digest("hex");

    return {
      packageId: plan.packageId,
      packageName: plan.packageName,
      version: plan.version,
      tarballPath: finalTarballPath,
      tarballName,
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
