import { join } from "node:path";
import { assertPathWithinRoot, assertValidPackageId, getActionDockHome } from "../utils";
import { SqliteRuntimeStorage } from "./sqlite";
import type { RuntimeStorage, StorageOptions } from "./types";

export * from "./data-dir-lock";
export * from "./driver";
export * from "./mask";
export * from "./sqlite";
export * from "./types";

/**
 * 解析并计算目标 SQLite 数据库文件的绝对路径。
 * 
 * 优先级规则：
 * - inMemory: true -> 返回 ":memory:"
 * - 显式指定 dataDir -> 返回 `<dataDir>/<packageId>/runtime.db`
 * - 默认统一数据存储路径 -> 返回 `~/.actiondock/data/<packageId>/runtime.db`
 * 
 * @param packageId 所属 Package ID
 * @param options 路径解析选项
 */
export function resolveDatabasePath(
  packageId: string,
  options: { projectRoot?: string; dataDir?: string; inMemory?: boolean; customHome?: string } = {}
): string {
  if (options.inMemory) {
    return ":memory:";
  }
  assertValidPackageId(packageId);

  // 安全子路径（支持 @scope/pkg 规范，拒绝非法字符与相对回退）
  const safePkgPath = packageId.startsWith("@") ? packageId.slice(1) : packageId;

  if (options.dataDir) {
    const rootDir = options.dataDir;
    const dbPath = join(rootDir, safePkgPath, "runtime.db");
    assertPathWithinRoot(rootDir, dbPath, "database dataDir path");
    return dbPath;
  }

  // 统一数据存储路径: ~/.actiondock/data/<package-id>/runtime.db
  const rootDir = join(getActionDockHome(options.customHome), ".actiondock", "data");
  const dbPath = join(rootDir, safePkgPath, "runtime.db");
  assertPathWithinRoot(rootDir, dbPath, "database storage path");
  return dbPath;
}

/**
 * 工厂函数：为指定 Package 创建或连接 RuntimeStorage 实例。
 * 
 * @param packageId 目标 Package ID
 * @param options 存储配置参数（支持 dataDir, inMemory, customHome）
 */
export function createStorage(
  packageId: string,
  options: { projectRoot?: string; dataDir?: string; inMemory?: boolean; customHome?: string } = {}
): RuntimeStorage {
  const dbPath = resolveDatabasePath(packageId, options);
  return new SqliteRuntimeStorage({ dbPath, packageId });
}

/**
 * 工厂函数：创建或连接 ActionDock 全局共享数据库（~/.actiondock/global.db）。
 * 用于跨 Package 共享的全局配置项存储。
 * 
 * @param customHomeOrOptions 自定义家目录路径或配置对象（可选）
 * @param dataDirArg 自定义数据存储目录（可选）
 */
export function createGlobalStorage(
  customHomeOrOptions?: string | { customHome?: string; dataDir?: string; inMemory?: boolean },
  dataDirArg?: string
): RuntimeStorage {
  let customHome: string | undefined;
  let dataDir: string | undefined;
  let inMemory = false;

  if (typeof customHomeOrOptions === "object" && customHomeOrOptions !== null) {
    customHome = customHomeOrOptions.customHome;
    dataDir = customHomeOrOptions.dataDir;
    inMemory = Boolean(customHomeOrOptions.inMemory);
  } else {
    customHome = customHomeOrOptions;
    dataDir = dataDirArg;
  }

  if (inMemory) {
    return new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "__global__" });
  }

  const dbPath = dataDir
    ? join(dataDir, "global.db")
    : join(getActionDockHome(customHome), ".actiondock", "global.db");
  return new SqliteRuntimeStorage({ dbPath, packageId: "__global__" });
}

