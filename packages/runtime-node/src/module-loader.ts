import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
];

const INDEX_CANDIDATES = [
  "index.ts",
  "index.tsx",
  "index.mts",
  "index.cts",
  "index.js",
  "index.mjs",
  "index.cjs",
];

/**
 * 解包模块的默认导出对象，优先获取 default 或 action，自动解开嵌套互操作对象。
 */
export function unwrapDefaultExport<T = any>(moduleExports: any): T {
  if (moduleExports === null || moduleExports === undefined) {
    return moduleExports;
  }

  let target =
    moduleExports.default !== undefined
      ? moduleExports.default
      : moduleExports.action !== undefined
        ? moduleExports.action
        : moduleExports;

  if (
    target &&
    typeof target === "object" &&
    "default" in target &&
    Object.keys(target).length === 1
  ) {
    target = target.default;
  }

  return target as T;
}

/**
 * 基于 tsx 的 TypeScript 源码模块加载器。
 * 支持 .ts、.tsx、.mts、.cts 等 TypeScript 文件在 Node.js 与 Bun 环境下的无缝加载。
 */
export class TsxModuleLoader {
  /**
   * 解析模块标识符与路径，支持相对路径、文件后缀省略以及目录索引文件补全。
   */
  resolve(specifier: string, parentPath?: string): string {
    let target = specifier;

    if (target.startsWith("file://")) {
      target = fileURLToPath(target);
    }

    let baseDir = process.cwd();
    if (parentPath) {
      try {
        const p = parentPath.startsWith("file://")
          ? fileURLToPath(parentPath)
          : parentPath;
        if (existsSync(p)) {
          const stat = statSync(p);
          baseDir = stat.isDirectory() ? resolve(p) : dirname(resolve(p));
        } else {
          baseDir = dirname(resolve(p));
        }
      } catch {
        baseDir = process.cwd();
      }
    }

    const candidateBasePath = isAbsolute(target) ? target : resolve(baseDir, target);

    // 1. 尝试直接匹配或补齐候选扩展名
    for (const ext of CANDIDATE_EXTENSIONS) {
      const fullPath = ext ? `${candidateBasePath}${ext}` : candidateBasePath;
      if (existsSync(fullPath)) {
        try {
          if (statSync(fullPath).isFile()) {
            return fullPath;
          }
        } catch {
          // 忽略访问异常
        }
      }
    }

    // 2. 若目标为目录，尝试匹配目录下的 index.* 文件
    if (existsSync(candidateBasePath)) {
      try {
        if (statSync(candidateBasePath).isDirectory()) {
          for (const indexName of INDEX_CANDIDATES) {
            const indexFilePath = join(candidateBasePath, indexName);
            if (existsSync(indexFilePath) && statSync(indexFilePath).isFile()) {
              return indexFilePath;
            }
          }
        }
      } catch {
        // 忽略访问异常
      }
    }

    // 3. 尝试使用 tsx 的 require.resolve 机制解析
    try {
      const { require: tsxRequire } = require("tsx/cjs/api");
      const resolved = tsxRequire.resolve(target, { paths: [baseDir] });
      if (resolved) {
        return resolved;
      }
    } catch {
      // 忽略 tsx 解析失败
    }

    throw new Error(
      `Cannot resolve TypeScript module '${specifier}' from '${parentPath || process.cwd()}'`
    );
  }

  /**
   * 动态加载 TypeScript 模块并返回其全量导出对象。
   */
  async load<T = any>(specifier: string, parentPath?: string): Promise<T> {
    const resolvedPath = this.resolve(specifier, parentPath);
    const parentUrl = parentPath
      ? parentPath.startsWith("file://")
        ? parentPath
        : pathToFileURL(resolve(parentPath)).href
      : pathToFileURL(join(process.cwd(), "index.js")).href;

    const isBun = typeof (globalThis as any).Bun !== "undefined";

    if (isBun) {
      try {
        return (await import(pathToFileURL(resolvedPath).href)) as T;
      } catch (bunImportErr) {
        try {
          const { require: tsxRequire } = require("tsx/cjs/api");
          return tsxRequire(resolvedPath, parentUrl) as T;
        } catch {
          throw bunImportErr;
        }
      }
    }

    // Node.js 环境下优先使用 tsx 的 ESM 动态导入
    try {
      const { tsImport } = await import("tsx/esm/api");
      return (await tsImport(resolvedPath, parentUrl)) as T;
    } catch (esmErr) {
      try {
        const { require: tsxRequire } = require("tsx/cjs/api");
        return tsxRequire(resolvedPath, parentUrl) as T;
      } catch {
        try {
          return (await import(pathToFileURL(resolvedPath).href)) as T;
        } catch {
          throw esmErr;
        }
      }
    }
  }

  /**
   * 加载 TypeScript 模块并解包其默认导出（default 或 action）。
   */
  async loadDefault<T = any>(specifier: string, parentPath?: string): Promise<T> {
    const mod = await this.load(specifier, parentPath);
    return unwrapDefaultExport<T>(mod);
  }

  /**
   * 静态快捷方法：解析模块路径。
   */
  static resolve(specifier: string, parentPath?: string): string {
    return new TsxModuleLoader().resolve(specifier, parentPath);
  }

  /**
   * 静态快捷方法：动态加载模块。
   */
  static async load<T = any>(specifier: string, parentPath?: string): Promise<T> {
    return new TsxModuleLoader().load<T>(specifier, parentPath);
  }

  /**
   * 静态快捷方法：动态加载模块默认导出。
   */
  static async loadDefault<T = any>(specifier: string, parentPath?: string): Promise<T> {
    return new TsxModuleLoader().loadDefault<T>(specifier, parentPath);
  }
}
