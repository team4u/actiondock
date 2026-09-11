import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  NodeFileSystem,
  resolveDatabasePath,
  resolveGlobalDatabasePath,
  SqliteRuntimeStorage,
  SystemClock,
  type Clock,
  type FileSystem,
  type GlobalStorageFactoryOptions,
  type ModuleLoader,
  type RuntimePlatform,
  type RuntimeStorage,
  type SqliteDriver,
  type StorageFactory,
  type StorageFactoryOptions,
} from "@actiondock/core";
import { NodeModuleLoader } from "./module-loader";
import { NodeProcessExecutor } from "./process-executor";
import { NodeSqliteDriver } from "./sqlite-driver";

/**
 * Node 平台构建配置选项。
 */
export interface NodePlatformOptions {
  /** 自定义全局数据存储目录 */
  dataDir?: string;
  /** 自定义家目录路径 */
  customHome?: string;
  /** 文件系统安全沙箱根路径 */
  rootDir?: string;
  /** 【已废弃】WorkerSqliteDriver 为异步驱动，不再兼容存储层的同步 SqliteDriver 契约，保留选项仅为兼容旧参数，任何非假值均回落到同步驱动并告警 */
  useWorker?: boolean;
  /** 自定义 SQLite 驱动工厂函数（必须返回满足同步契约的 SqliteDriver，默认实例化 NodeSqliteDriver） */
  driverFactory?: (dbPath: string) => SqliteDriver;
}

function ensureDirectoryForDb(dbPath: string): void {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch {
        // 忽略目录已存在或权限异常
      }
    }
  }
}

/**
 * 创建 Node 运行时平台实例。
 * 组装 Node 原生核心组件：
 * - NodeSqliteDriver 同步持久化存储驱动
 * - NodeProcessExecutor 原生进程执行器
 * - NodeHttpServer 网络服务驱动
 * - NodeModuleLoader 原生源码加载器
 * - NodeFileSystem 文件系统
 * - SystemClock 系统时钟
 *
 * @param options 平台配置选项
 */
export function createNodePlatform(options: NodePlatformOptions = {}): RuntimePlatform {
  const clock: Clock = new SystemClock();
  const files: FileSystem = new NodeFileSystem({ rootDir: options.rootDir });
  const modules: ModuleLoader = new NodeModuleLoader();
  const process = new NodeProcessExecutor();

  const createDriver = options.driverFactory ?? ((dbPath: string) => new NodeSqliteDriver(dbPath));

  // 异步 WorkerSqliteDriver 不再兼容存储层的同步 SqliteDriver 契约：
  // 传入 useWorker 时回落到同步驱动并告警，避免静默注入造成语义错乱。
  if (options.useWorker) {
    console.warn(
      "[createNodePlatform] useWorker is deprecated: WorkerSqliteDriver is async and no longer satisfies the sync SqliteDriver contract; falling back to NodeSqliteDriver."
    );
  }

  const storage: StorageFactory = {
    createStorage(packageId: string, opts?: StorageFactoryOptions): RuntimeStorage {
      const mergedOpts = {
        customHome: options.customHome,
        dataDir: options.dataDir,
        ...opts,
      };
      const dbPath = resolveDatabasePath(packageId, mergedOpts);
      ensureDirectoryForDb(dbPath);
      return new SqliteRuntimeStorage({
        dbPath,
        packageId,
        clock,
        driver: createDriver(dbPath),
      });
    },
    createGlobalStorage(opts?: GlobalStorageFactoryOptions): RuntimeStorage {
      const mergedOpts = {
        customHome: options.customHome,
        dataDir: options.dataDir,
        ...opts,
      };
      const dbPath = mergedOpts.inMemory
        ? ":memory:"
        : resolveGlobalDatabasePath({ dataDir: mergedOpts.dataDir, customHome: mergedOpts.customHome });
      ensureDirectoryForDb(dbPath);
      return new SqliteRuntimeStorage({
        dbPath,
        packageId: "__global__",
        clock,
        driver: createDriver(dbPath),
      });
    },
  };

  return {
    name: "node",
    clock,
    files,
    modules,
    process,
    storage,
  };
}
