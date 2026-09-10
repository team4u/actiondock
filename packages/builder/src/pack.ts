import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { getPackageSlug, loadProjectConfig } from "@actiondock/core";
import { createTarGzArchiveAsync } from "./archive";
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
 * 改写源码中的相对 TypeScript 导入路径（.ts -> .js，.mts -> .mjs）。
 */
function rewriteTypeScriptImports(source: string): string {
  return source
    .replace(/(from\s+['"][^'"]+?)\.ts(['"])/g, "$1.js$2")
    .replace(/(from\s+['"][^'"]+?)\.mts(['"])/g, "$1.mjs$2")
    .replace(/(import\s*\(\s*['"][^'"]+?)\.ts(['"]\s*\))/g, "$1.js$2")
    .replace(/(import\s*\(\s*['"][^'"]+?)\.mts(['"]\s*\))/g, "$1.mjs$2");
}

/**
 * 将 TypeScript 源码转译为标准 ESM JavaScript。
 */
async function transpileTypeScriptFile(filePath: string): Promise<string> {
  const content = readFileSync(filePath, "utf-8");
  const rewritten = rewriteTypeScriptImports(content);

  let ts: any;
  try {
    const imported = await import("typescript");
    ts = imported.default || imported;
  } catch {
    // 若未加载到 TypeScript 则保留改写后的文本
    return rewritten;
  }

  if (!ts || typeof ts.transpileModule !== "function") {
    return rewritten;
  }

  const result = ts.transpileModule(rewritten, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      esModuleInterop: true,
      removeComments: false,
    },
  });

  return result.outputText;
}

/**
 * 对 Action Package 执行打包并生成标准 npm Action 压缩包。
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

  // 校验生产依赖合法性
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
    // 拷贝声明的代码文件与静态资产
    for (const dep of plan.dependencies.modulesAndAssets) {
      if (
        (dep.type === "asset" || dep.type === "module" || dep.type === "file") &&
        existsSync(dep.resolvedPath)
      ) {
        const destPath = join(stagingPkgDir, dep.path);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(dep.resolvedPath, destPath);
      }
    }

    // 拷贝 Playbook 规程文件
    if (plan.playbooks.length > 0) {
      const pbDir = plan.playbooksDir || "playbooks";
      const destPbDir = join(stagingPkgDir, pbDir);
      mkdirSync(destPbDir, { recursive: true });
      for (const pb of plan.playbooks) {
        if (existsSync(pb.filePath)) {
          copyFileSync(pb.filePath, join(destPbDir, basename(pb.filePath)));
        }
      }
    }

    // 拷贝 Action 入口并转译 TypeScript 为标准 ESM JavaScript
    const jsActions: Record<string, unknown> = {};
    for (const act of plan.actions) {
      if (!existsSync(act.resolvedPath)) {
        throw new BuilderError(`Action entry file not found: ${act.resolvedPath}`);
      }

      const isTs = act.entry.endsWith(".ts") || act.entry.endsWith(".mts");
      let destEntry = act.entry;
      if (isTs) {
        destEntry = act.entry.endsWith(".mts")
          ? act.entry.slice(0, -4) + ".mjs"
          : act.entry.slice(0, -3) + ".js";
      }

      const destFilePath = join(stagingPkgDir, destEntry);
      mkdirSync(dirname(destFilePath), { recursive: true });

      if (isTs) {
        const jsCode = await transpileTypeScriptFile(act.resolvedPath);
        writeFileSync(destFilePath, jsCode, "utf-8");
      } else {
        copyFileSync(act.resolvedPath, destFilePath);
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

    // 拷贝 README 等基础文档（若存在）
    for (const doc of ["README.md", "readme.md", "LICENSE", "license"]) {
      const srcDoc = join(root, doc);
      if (existsSync(srcDoc)) {
        copyFileSync(srcDoc, join(stagingPkgDir, doc));
      }
    }

    // 生成指向 JavaScript 的临时 actiondock.json
    const packedConfig: Record<string, unknown> = {
      id: plan.packageId,
      name: plan.packageName,
      version: plan.version,
      description: plan.description,
      actionsDir: plan.actionsDir || "actions",
      playbooksDir: plan.playbooksDir || "playbooks",
      config: plan.configDefs || {},
    };
    if (plan.files && plan.files.length > 0) {
      packedConfig.files = plan.files;
    }
    if (plan.assets && plan.assets.length > 0) {
      packedConfig.assets = plan.assets;
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

    // 规范化 exports 字段
    let currentExports: Record<string, unknown> = {};
    if (typeof normalizedPkg.exports === "object" && normalizedPkg.exports !== null) {
      currentExports = { ...(normalizedPkg.exports as Record<string, unknown>) };
    } else if (typeof normalizedPkg.exports === "string") {
      currentExports["."] = normalizedPkg.exports;
    }
    currentExports["./actiondock.json"] = "./actiondock.json";
    normalizedPkg.exports = currentExports;

    // 规范化 engines 字段
    const currentEngines: Record<string, string> = {
      ...(typeof normalizedPkg.engines === "object" && normalizedPkg.engines !== null
        ? (normalizedPkg.engines as Record<string, string>)
        : {}),
    };
    if (!currentEngines.node) {
      currentEngines.node = ">=22.13.0";
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

    // 生成标准 npm tar.gz 压缩包（顶层目录为 package/）
    await createTarGzArchiveAsync(stagingPkgDir, finalTarballPath);

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
