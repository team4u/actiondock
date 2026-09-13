import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isPathOutsideBoundary } from "@actiondock/core";
import { BuilderError } from "./errors";
import type { SelectionPlan } from "./types";

/**
 * 移除源码中的单行与多行注释，防止注释内的相对路径字符串误触发依赖解析。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
}

/**
 * 从源码中快速提取以相对路径（./ 或 ../）引入的静态或动态导入说明符。
 */
export function extractRelativeSpecifiers(source: string): string[] {
  const cleanSource = stripComments(source);
  const specifiers = new Set<string>();

  // 1. 无 from 的直接副作用导入：import "./side-effect.js"
  const sideEffectRegex = /\bimport\s+['"](\.{1,2}(?:\/[^'"]*)?)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = sideEffectRegex.exec(cleanSource)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  // 2. 静态 import 与 export 携带 from 语句：import { x } from "./x.js", export * from "./y.js"
  const fromRegex =
    /\b(?:import|export)(?:\s+type)?\s+(?:[^;"']*?)\s+from\s+['"](\.{1,2}(?:\/[^'"]*)?)['"]/g;
  while ((match = fromRegex.exec(cleanSource)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  // 3. 动态 import() 与 require()
  const dynamicRegex = /\b(?:import|require)\s*\(\s*['"](\.{1,2}(?:\/[^'"]*)?)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(cleanSource)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  return Array.from(specifiers);
}

/**
 * 支持的候选扩展名列表。
 */
const RESOLUTION_EXTENSIONS = [
  "",
  ".ts",
  ".js",
  ".mts",
  ".mjs",
  ".tsx",
  ".jsx",
  ".cjs",
  ".cts",
  ".json",
];

/**
 * 将相对模块说明符解析为磁盘上的物理真实文件路径。
 */
export function resolveRelativeModule(
  fromDir: string,
  specifier: string
): string | undefined {
  const basePath = resolve(fromDir, specifier);

  // 1. 精确匹配文件
  if (existsSync(basePath) && statSync(basePath).isFile()) {
    try {
      return realpathSync(basePath);
    } catch {
      return basePath;
    }
  }

  // 2. ESM TypeScript 映射：导入写了 .js / .mjs / .cjs，但在源码中真实文件为 .ts / .mts / .cts
  if (specifier.endsWith(".js")) {
    const tsCandidate = basePath.slice(0, -3) + ".ts";
    if (existsSync(tsCandidate) && statSync(tsCandidate).isFile()) {
      try {
        return realpathSync(tsCandidate);
      } catch {
        return tsCandidate;
      }
    }
    const tsxCandidate = basePath.slice(0, -3) + ".tsx";
    if (existsSync(tsxCandidate) && statSync(tsxCandidate).isFile()) {
      try {
        return realpathSync(tsxCandidate);
      } catch {
        return tsxCandidate;
      }
    }
  } else if (specifier.endsWith(".mjs")) {
    const mtsCandidate = basePath.slice(0, -4) + ".mts";
    if (existsSync(mtsCandidate) && statSync(mtsCandidate).isFile()) {
      try {
        return realpathSync(mtsCandidate);
      } catch {
        return mtsCandidate;
      }
    }
  } else if (specifier.endsWith(".cjs")) {
    const ctsCandidate = basePath.slice(0, -4) + ".cts";
    if (existsSync(ctsCandidate) && statSync(ctsCandidate).isFile()) {
      try {
        return realpathSync(ctsCandidate);
      } catch {
        return ctsCandidate;
      }
    }
  }

  // 3. 补充扩展名尝试
  for (const ext of RESOLUTION_EXTENSIONS) {
    const cand = basePath + ext;
    if (existsSync(cand) && statSync(cand).isFile()) {
      try {
        return realpathSync(cand);
      } catch {
        return cand;
      }
    }
  }

  // 4. 目录默认 index 尝试
  for (const ext of RESOLUTION_EXTENSIONS) {
    if (ext === "") continue;
    const cand = join(basePath, `index${ext}`);
    if (existsSync(cand) && statSync(cand).isFile()) {
      try {
        return realpathSync(cand);
      } catch {
        return cand;
      }
    }
  }

  return undefined;
}

/**
 * 断言 Action 源码中引用的本地相对模块已全部纳入导出规划。
 * 若发现引用了未被 actions 或 files 声明收集的本地文件，直接抛出 BuilderError 终止构建。
 */
export function assertRelativeDependenciesIntegrity(
  projectRoot: string,
  plan: SelectionPlan
): void {
  const root = resolve(projectRoot);
  let realRoot: string;
  try {
    realRoot = existsSync(root) ? realpathSync(root) : root;
  } catch {
    realRoot = root;
  }

  // 收集已包含在构建规划中的全部文件物理绝对路径
  const collectedPaths = new Set<string>();

  for (const act of plan.actions) {
    if (act.resolvedPath) {
      try {
        const real = existsSync(act.resolvedPath)
          ? realpathSync(act.resolvedPath)
          : resolve(act.resolvedPath);
        collectedPaths.add(real);
      } catch {
        collectedPaths.add(resolve(act.resolvedPath));
      }
    }
  }

  for (const dep of plan.dependencies.modulesAndAssets) {
    if (dep.resolvedPath) {
      try {
        const real = existsSync(dep.resolvedPath)
          ? realpathSync(dep.resolvedPath)
          : resolve(dep.resolvedPath);
        collectedPaths.add(real);
      } catch {
        collectedPaths.add(resolve(dep.resolvedPath));
      }
    }
  }

  // 待校验文件队列（包括全部 Action 及其收集的 TS/JS 模块）
  const queue: Array<{ file: string; actionId: string }> = [];
  for (const act of plan.actions) {
    if (act.resolvedPath && existsSync(act.resolvedPath)) {
      try {
        queue.push({
          file: existsSync(act.resolvedPath)
            ? realpathSync(act.resolvedPath)
            : resolve(act.resolvedPath),
          actionId: act.id,
        });
      } catch {
        queue.push({
          file: resolve(act.resolvedPath),
          actionId: act.id,
        });
      }
    }
  }

  const visited = new Set<string>();

  while (queue.length > 0) {
    const { file, actionId } = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const specifiers = extractRelativeSpecifiers(content);
    for (const specifier of specifiers) {
      const resolvedTarget = resolveRelativeModule(dirname(file), specifier);

      if (!resolvedTarget) {
        // 相对路径对应的文件在磁盘上不存在
        const relFromFile = relative(realRoot, file).replace(/\\/g, "/");
        throw new BuilderError(
          `Action '${actionId}' (${relFromFile}) imports relative module '${specifier}', but the file does not exist on disk.`,
          "FILE_NOT_FOUND"
        );
      }

      // 检查目标文件是否越出项目根目录
      const relToRoot = relative(realRoot, resolvedTarget);
      if (isPathOutsideBoundary(relToRoot)) {
        // 区分「项目外路径」与「monorepo 相邻包」两种情形，给出针对性修复指引
        const resolvedParent = dirname(realRoot);
        const relToParent = relative(resolvedParent, resolvedTarget);
        const isSiblingPackage = !isPathOutsideBoundary(relToParent);
        const detail = isSiblingPackage
          ? `它位于项目根的父目录内，疑似 monorepo 相邻包。若确需依赖，请将其纳入本项目或改用包管理器依赖声明；若为本地辅助模块，请调整目录结构或将其声明进 files`
          : `它完全位于项目外部。导出的 Skill 产物不允许携带项目外部的相对路径依赖，请将所需模块移入项目内并声明进 files`;
        throw new BuilderError(
          `Action '${actionId}' 通过相对路径 '${specifier}' 引用了项目根之外的模块（解析到 '${resolvedTarget}'）。${detail}`,
          "EXTERNAL_LOCAL_DEPENDENCY"
        );
      }

      // 检查目标文件是否在构建收集集合中
      if (!collectedPaths.has(resolvedTarget)) {
        const normalizedRel = relToRoot.replace(/\\/g, "/");
        const fromRel = relative(realRoot, file).replace(/\\/g, "/");
        throw new BuilderError(
          `Action '${actionId}' (${fromRel}) imports relative module '${specifier}' (resolving to '${normalizedRel}'), which is not included in the export plan.\nTo fix this, declare '${normalizedRel}' or its parent directory in the 'files' field of actiondock.json.`,
          "UNMET_LOCAL_DEPENDENCY"
        );
      }

      // 如果引用的目标文件本身也是已收集的 TS/JS 代码文件，且尚未遍历过，加入队列递归检查
      if (
        (resolvedTarget.endsWith(".ts") ||
          resolvedTarget.endsWith(".js") ||
          resolvedTarget.endsWith(".mts") ||
          resolvedTarget.endsWith(".mjs") ||
          resolvedTarget.endsWith(".tsx") ||
          resolvedTarget.endsWith(".jsx")) &&
        !visited.has(resolvedTarget)
      ) {
        queue.push({ file: resolvedTarget, actionId });
      }
    }
  }
}
