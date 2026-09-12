import { isAbsolute, join, relative, resolve } from "node:path";
import { assertValidPackageId, getActionDockHome } from "../utils";
import { SqliteRuntimeStorage } from "./sqlite";
import type { RuntimeStorage } from "./types";

export {
  DataDirLock,
  type DataDirLockInfo,
  isProcessAlive,
} from "./data-dir-lock";
export * from "./driver";
export * from "./lazy";
export * from "./mask";
export * from "./params";
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
    const rootDir = resolve(options.dataDir);
    const dbPath = resolve(rootDir, safePkgPath, "runtime.db");
    const rel = relative(rootDir, dbPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`'database dataDir path' escapes boundary '${rootDir}': ${dbPath}`);
    }
    return dbPath;
  }

  // 统一数据存储路径: ~/.actiondock/data/<package-id>/runtime.db
  const rootDir = resolve(join(getActionDockHome(options.customHome), ".actiondock", "data"));
  const dbPath = resolve(rootDir, safePkgPath, "runtime.db");
  const rel = relative(rootDir, dbPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`'database storage path' escapes boundary '${rootDir}': ${dbPath}`);
  }
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
 * 解析全局共享数据库（global.db）文件的绝对路径。
 *
 * 单一事实源：core 与各运行时平台适配层（如 runtime-node）
 * 统一调用本函数计算 global.db 路径，禁止在适配层内重复拼接过
 * 路径规则，避免双实现漂移。
 *
 * 优先级规则：
 * - 显式指定 dataDir -> 返回 `<dataDir>/global.db`
 * - 默认路径 -> 返回 `~/.actiondock/global.db`
 */
export function resolveGlobalDatabasePath(
  options: { dataDir?: string; customHome?: string } = {}
): string {
  return options.dataDir
    ? join(options.dataDir, "global.db")
    : join(getActionDockHome(options.customHome), ".actiondock", "global.db");
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

  const dbPath = resolveGlobalDatabasePath({ dataDir, customHome });
  return new SqliteRuntimeStorage({ dbPath, packageId: "__global__" });
}

