import { pathToFileURL } from "node:url";

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
 * 基于标准 ECMAScript 动态 import 的默认模块加载器。
 */
export class DefaultModuleLoader implements ModuleLoader {
  async load<T = any>(specifier: string, _parentPath?: string): Promise<T> {
    const importSpecifier = specifier.startsWith("file://")
      ? specifier
      : pathToFileURL(specifier).href;
    return (await import(importSpecifier)) as T;
  }

  async loadDefault<T = any>(specifier: string, parentPath?: string): Promise<T> {
    const mod = await this.load<any>(specifier, parentPath);
    return (mod?.default !== undefined ? mod.default : mod?.action !== undefined ? mod.action : mod) as T;
  }
}

let globalModuleLoader: ModuleLoader | undefined;

/**
 * 注册全局模块加载器实现。
 */
export function setModuleLoader(loader: ModuleLoader): void {
  globalModuleLoader = loader;
}

/**
 * 获取当前全局模块加载器，若未显式注册则回退使用 DefaultModuleLoader。
 */
export function getModuleLoader(): ModuleLoader {
  if (!globalModuleLoader) {
    globalModuleLoader = new DefaultModuleLoader();
  }
  return globalModuleLoader;
}
