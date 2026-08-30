import { homedir } from "node:os";
import { join } from "node:path";
import { SqliteRuntimeStorage } from "./sqlite";
import type { RuntimeStorage, StorageOptions } from "./types";

export * from "./mask";
export * from "./sqlite";
export * from "./types";

/**
 * 解析并计算目标 SQLite 数据库文件的绝对路径。
 * 
 * 优先级规则：
 * 1. inMemory: true -> 返回 ":memory:"
 * 2. 显式指定 dataDir -> 返回 `<dataDir>/<packageId>/runtime.db`
 * 3. 显式指定 projectRoot（开发态项目） -> 返回 `<projectRoot>/.actiondock/runtime.db`
 * 4. 默认独立二进制存储路径 -> 返回 `~/.actiondock/data/<packageId>/runtime.db`
 * 
 * @param packageId 所属 Package ID
 * @param options 路径解析选项
 */
export function resolveDatabasePath(
  packageId: string,
  options: { projectRoot?: string; dataDir?: string; inMemory?: boolean } = {}
): string {
  if (options.inMemory) {
    return ":memory:";
  }
  if (options.dataDir) {
    return join(options.dataDir, packageId, "runtime.db");
  }
  if (options.projectRoot) {
    return join(options.projectRoot, ".actiondock", "runtime.db");
  }
  // 独立执行二进制默认存储路径: ~/.actiondock/data/<package-id>/runtime.db
  return join(homedir(), ".actiondock", "data", packageId, "runtime.db");
}

/**
 * 工厂函数：为指定 Package 创建或连接 RuntimeStorage 实例。
 * 
 * @param packageId 目标 Package ID
 * @param options 存储配置参数（支持 projectRoot, dataDir, inMemory）
 */
export function createStorage(
  packageId: string,
  options: { projectRoot?: string; dataDir?: string; inMemory?: boolean } = {}
): RuntimeStorage {
  const dbPath = resolveDatabasePath(packageId, options);
  return new SqliteRuntimeStorage({ dbPath, packageId });
}

/**
 * 工厂函数：创建或连接 ActionDock 全局共享数据库（~/.actiondock/global.db）。
 * 用于跨 Package 共享的全局配置项存储。
 * 
 * @param customHome 自定义家目录路径（可选）
 */
export function createGlobalStorage(customHome?: string): RuntimeStorage {
  const baseDir = customHome || process.env.ACTIONDOCK_HOME || homedir();
  const dbPath = join(baseDir, ".actiondock", "global.db");
  return new SqliteRuntimeStorage({ dbPath, packageId: "__global__" });
}

