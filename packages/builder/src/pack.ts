import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { compileProjectTypescript, isTypeScriptSource } from "./ts-compiler";
import { runNpmPack } from "./npm-pack";
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
import { loadProjectConfig } from "@actiondock/core";
import { getPackageSlug } from "@actiondock/core/project";
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
import { isOwnAction } from "./types";
import { copyPlanEntries } from "./stage-sources";
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
    await compileProjectTypescript({ root, stagingPkgDir, plan });
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
 * 拷贝声明的非 TypeScript 模块、静态资产、原生 JavaScript 入口、Playbook 与基础文档到暂存目录。
 * 拷贝内核统一复用 stage-sources 的 copyPlanEntries，仅通过谓词分化编译排除差异。
 */
function stageSources(root: string, stagingPkgDir: string, plan: SelectionPlan): void {
  copyPlanEntries(stagingPkgDir, plan, {
    // TypeScript 入口已由编译阶段生成 .js 与 .d.ts，不重复物化源文件
    copyAction: (act) => !isTypeScriptSource(act.entry),
    copyModule: (dep) => !isTypeScriptSource(dep.path),
    // pack 产物保留源工程相对路径（与编译输出的目录结构一致）
    playbookRelPath: (pb) => relative(root, pb.filePath),
  });

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
    if (!isOwnAction(act)) continue;
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


