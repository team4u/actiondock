import { existsSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ActionDockError, ACTION_LOAD_FAILED } from "../errors";
/**
 * 统一源码模块加载器接口。
 * 解耦 Action 与各类扩展模块的具体加载机制（如 ECMAScript 原生 import、tsx 动态转译加载等）。
 */
export interface ModuleLoader {
  /**
   * 解析模块标识符为绝对路径或完整 URL。
   *
   * @param specifier 模块规范说明符或物理路径
   * @param parentPath 发起解析的父级文件或目录路径
   */
  resolve?(specifier: string, parentPath?: string): string;

  /**
   * 动态加载模块并返回命名空间全量导出对象。
   *
   * @param specifier 模块规范说明符或物理路径
   * @param parentPath 发起加载的父级文件或目录路径
   */
  load<T = any>(specifier: string, parentPath?: string): Promise<T>;

  /**
   * 加载模块并解包其默认导出（default 或 action 属性）。
   *
   * @param specifier 模块规范说明符或物理路径
   * @param parentPath 发起加载的父级文件或目录路径
   */
  loadDefault?<T = any>(specifier: string, parentPath?: string): Promise<T>;
}

/**
 * Node 原生 TypeScript 与 ESM 模块支持的扩展名集合。
 */
const ALLOWED_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

/**
 * 解包模块的默认导出对象，优先获取 default 或 action，自动解开嵌套互操作对象。
 *
 * @param moduleExports 待解包的模块导出对象
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
 * 基于 Node.js 原生 ESM 动态 import 的源码模块加载器。
 * 遵循 Node 原生模块规范：
 * - 严格要求显式入口扩展名（.ts, .mts, .js, .mjs）
 * - 彻底拒绝无扩展名自动推断与 CommonJS 目录索引解析
 * - 完全移除第三方转译运行时依赖
 */
export class NodeModuleLoader implements ModuleLoader {
  /**
   * 解析模块标识符与路径，严格要求显式扩展名且拒绝目录补全。
   *
   * @param specifier 模块规范说明符或相对/绝对物理路径
   * @param parentPath 发起解析的父级文件或目录路径
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

    const ext = extname(candidateBasePath);
    if (!ext) {
      throw new Error(
        `Cannot resolve module '${specifier}' from '${parentPath || process.cwd()}': missing file extension. Explicit .ts, .mts, .js, or .mjs extension is required.`
      );
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(
        `Cannot resolve module '${specifier}' from '${parentPath || process.cwd()}': unsupported extension '${ext}'. Only .ts, .mts, .js, and .mjs are supported.`
      );
    }

    if (!existsSync(candidateBasePath)) {
      throw new Error(
        `Cannot resolve module '${specifier}' from '${parentPath || process.cwd()}': file not found`
      );
    }

    let stat;
    try {
      stat = statSync(candidateBasePath);
    } catch (err: any) {
      throw new ActionDockError(
        ACTION_LOAD_FAILED,
        `Cannot resolve module '${specifier}' from '${parentPath || process.cwd()}': ${err.message}`
      );
    }
    if (!stat.isFile()) {
      throw new ActionDockError(
        ACTION_LOAD_FAILED,
        `Cannot resolve module '${specifier}' from '${parentPath || process.cwd()}': path is not a file`
      );
    }

    return candidateBasePath;
  }

  /**
   * 基于 Node 原生 ESM 动态 import 加载模块并返回其全量导出对象。
   *
   * @param specifier 模块规范说明符或物理路径
   * @param parentPath 发起加载的父级文件或目录路径
   */
  async load<T = any>(specifier: string, parentPath?: string): Promise<T> {
    const resolvedPath = this.resolve(specifier, parentPath);
    const fileUrl = pathToFileURL(resolvedPath).href;
    return (await import(fileUrl)) as T;
  }

  /**
   * 加载模块并解包其默认导出（default 或 action）。
   *
   * @param specifier 模块规范说明符或物理路径
   * @param parentPath 发起加载的父级文件或目录路径
   */
  async loadDefault<T = any>(specifier: string, parentPath?: string): Promise<T> {
    const mod = await this.load(specifier, parentPath);
    return unwrapDefaultExport<T>(mod);
  }
}
