import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getActionDockHome,
  NodeFileSystem,
  resolveDatabasePath,
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
import { NodeModuleLoader, TsxModuleLoader } from "./module-loader";
import { ExecaProcessExecutor, NodeProcessExecutor } from "./process-executor";
import { NodeSqliteDriver, WorkerSqliteDriver } from "./sqlite-driver";

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
  /** 是否启用专用工作线程存储驱动（默认为 true，可在生产环境启用 worker_threads 非阻塞存储） */
  useWorker?: boolean;
  /** 自定义 SQLite 驱动工厂函数（默认实例化 NodeSqliteDriver 或 WorkerSqliteDriver） */
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
 * - NodeSqliteDriver 持久化存储驱动
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

  const useWorker = options.useWorker ?? true;
  const createDriver =
    options.driverFactory ??
    ((dbPath: string) =>
      useWorker ? new WorkerSqliteDriver(dbPath) : new NodeSqliteDriver(dbPath));

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
        : mergedOpts.dataDir
        ? join(mergedOpts.dataDir, "global.db")
        : join(getActionDockHome(mergedOpts.customHome), ".actiondock", "global.db");
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
