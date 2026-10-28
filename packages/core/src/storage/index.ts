import { join, relative, resolve } from "node:path";
import { assertValidPackageId, getActionDockHome, isPathOutsideBoundary } from "../utils";
import { ActionDockError, PATH_TRAVERSAL } from "../errors";
import type { ConfigItemDefinition } from "../project/types";
import { createConfigKeyProvider } from "../security/config-key";
import { SqliteRuntimeStorage } from "./sqlite";
import { redactConfigValueForDeclarations, type RedactResult } from "./mask";
import type { ConfigSnapshot, RuntimeStorage } from "./types";

export {
  DataDirLock,
  type DataDirLockInfo,
  isProcessAlive,
} from "./data-dir-lock";
export * from "./clock";
export { NodeSqliteDriver } from "./sqlite-driver";
export { normalizeSqliteParams } from "./params";
export * from "./sqlite-driver";
export * from "./mask";
export * from "./params";
export * from "./sqlite";
export * from "./types";
export * from "./utils";

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
    if (isPathOutsideBoundary(rel)) {
      throw new ActionDockError(PATH_TRAVERSAL, `'database dataDir path' escapes boundary '${rootDir}': ${dbPath}`);
    }
    return dbPath;
  }

  // 统一数据存储路径: ~/.actiondock/data/<package-id>/runtime.db
  const rootDir = resolve(join(getActionDockHome(options.customHome), ".actiondock", "data"));
  const dbPath = resolve(rootDir, safePkgPath, "runtime.db");
  const rel = relative(rootDir, dbPath);
  if (isPathOutsideBoundary(rel)) {
    throw new ActionDockError(PATH_TRAVERSAL, `'database storage path' escapes boundary '${rootDir}': ${dbPath}`);
  }
  return dbPath;
}

/**
 * 工厂函数：为指定 Package 创建或连接 RuntimeStorage 实例。
 *
 * 默认旁观打开：不收割库内遗留非终态运行（recoverOrphans 默认 false），
 * 供 CLI 查询类命令安全并发访问持有者进程正在写入的同一库文件；
 * 执行宿主路径应传入 recoverOrphans: true 或后续显式调用 recoverDeadSessionRuns。
 * 
 * @param packageId 目标 Package ID
 * @param options 存储配置参数（支持 dataDir, inMemory, customHome, recoverOrphans, configDeclarations）
 */
export function createStorage(
  packageId: string,
  options: {
    projectRoot?: string;
    dataDir?: string;
    inMemory?: boolean;
    customHome?: string;
    recoverOrphans?: boolean;
    retentionPolicy?: import("./types").RunsRetentionPolicy;
    configDeclarations?: readonly Record<string, ConfigItemDefinition>[];
  } = {}
): RuntimeStorage {
  const dbPath = resolveDatabasePath(packageId, options);
  return new SqliteRuntimeStorage({
    dbPath,
    packageId,
    recoverOrphans: options.recoverOrphans,
    retentionPolicy: options.retentionPolicy,
    ...(options.configDeclarations?.length ? { configDeclarations: options.configDeclarations } : {}),
    // 持久化库统一注入懒加载密钥提供器：密钥与数据库共享同一有效 dataDir/customHome 域；
    // 内存库不注入，由存储内部使用随机内存密钥，确保内存运行不触碰宿主密钥源
    ...(dbPath !== ":memory:"
      ? {
          configKeyProvider: createConfigKeyProvider({
            customHome: options.customHome,
            dataDir: options.dataDir,
          }),
        }
      : {}),
  });
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
  customHomeOrOptions?: string | {
    customHome?: string;
    dataDir?: string;
    inMemory?: boolean;
    configDeclarations?: readonly Record<string, ConfigItemDefinition>[];
  },
  dataDirArg?: string
): RuntimeStorage {
  let customHome: string | undefined;
  let dataDir: string | undefined;
  let inMemory = false;
  let configDeclarations: readonly Record<string, ConfigItemDefinition>[] | undefined;

  if (typeof customHomeOrOptions === "object" && customHomeOrOptions !== null) {
    customHome = customHomeOrOptions.customHome;
    dataDir = customHomeOrOptions.dataDir;
    inMemory = Boolean(customHomeOrOptions.inMemory);
    configDeclarations = customHomeOrOptions.configDeclarations;
  } else {
    customHome = customHomeOrOptions;
    dataDir = dataDirArg;
  }

  if (inMemory) {
    return new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "__global__" });
  }

  const dbPath = resolveGlobalDatabasePath({ dataDir, customHome });
  return new SqliteRuntimeStorage({
    dbPath,
    packageId: "__global__",
    configKeyProvider: createConfigKeyProvider({ customHome, dataDir }),
    ...(configDeclarations?.length ? { configDeclarations } : {}),
  });
}

/**
 * 读取配置值与配套历史保护声明的原子快照。
 *
 * 优先使用存储的 getConfigSnapshot 单次 SELECT 配对读取值与保护规则，
 * 消除先读值后读保护之间行被并发删除或改写造成的错配竞态；
 * 存储未提供快照能力（如 MemoryStorage 或外部旧实现）时回退为
 * 原值读取加可选保护读取的既有配对行为。
 */
export function readConfigWithProtection(
  storage: RuntimeStorage,
  key: string
): ConfigSnapshot | undefined {
  if (typeof storage.getConfigSnapshot === "function") {
    return storage.getConfigSnapshot(key);
  }
  const value = storage.getConfig(key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof storage.getConfigProtection === "function") {
    const protection = storage.getConfigProtection(key);
    return protection !== undefined ? { value, protection } : { value };
  }
  return { value };
}

/**
 * 依据当前声明与历史保护声明合并脱敏管理视图配置值。
 *
 * 仅在存在历史保护声明（值曾按敏感声明加密写入）时使用：当前声明与历史
 * 保护声明合并后取脱敏并集；合并后仍未产生任何脱敏结果时保守隐藏整项，
 * 杜绝加密值因声明变更或跨宿主加载差异重新外泄明文。
 * 无历史保护时由调用方沿用各自既有脱敏原语，保持行为不变。
 */
export function redactConfigValueWithProtection(
  value: unknown,
  items: readonly ConfigItemDefinition[],
  protection: readonly ConfigItemDefinition[] | undefined
): RedactResult {
  if (protection === undefined) {
    return redactConfigValueForDeclarations(value, [...items]);
  }
  const merged = [...items, ...protection];
  const result = redactConfigValueForDeclarations(value, merged);
  if (!result.secret) {
    return value === undefined
      ? { value: undefined, secret: true, redactedPaths: [] }
      : { value: undefined, secret: true, redactedPaths: [""] };
  }
  return result;
}

