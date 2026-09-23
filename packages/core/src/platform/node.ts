import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ProcessAPI } from "@actiondock/sdk";
import { SystemClock, type Clock } from "../runtime/clock";
import { NodeModuleLoader, type ModuleLoader } from "../node/module-loader";
import { NodeProcessDriver } from "../process/process-driver";
import { ProcessManager } from "../process/process-manager";
import type { ProcessDriver } from "../process/driver";
import { NodeSqliteDriver } from "../storage/sqlite-driver";
import {
  resolveDatabasePath,
  resolveGlobalDatabasePath,
  SqliteRuntimeStorage,
  type RuntimeStorage,
  type SqliteDriver,
} from "../storage";
import { NodeFileSystem } from "./node-fs";
import type {
  FileSystem,
  GlobalStorageFactoryOptions,
  RuntimePlatform,
  StorageFactory,
  StorageFactoryOptions,
} from "./types";

/**
 * Node 平台构建配置选项。
 */
export interface NodePlatformOptions {
  /** 平台名称覆盖（默认使用 node） */
  name?: "node" | "test";
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
  /** 自定义进程执行驱动（默认依托基于 NodeProcessDriver 的 ProcessManager） */
  process?: ProcessAPI;
  /** 可选注入的底层进程驱动 */
  processDriver?: ProcessDriver;
  /** 可选注入的受管进程管理器 */
  processManager?: ProcessManager;
  /** 自定义源码加载驱动（默认实例化 NodeModuleLoader） */
  modules?: ModuleLoader;
  /** 自定义文件系统实现（默认实例化 NodeFileSystem） */
  files?: FileSystem;
  /** 自定义时钟驱动（默认实例化 SystemClock） */
  clock?: Clock;
  /** 自定义存储工厂（默认基于 NodeSqliteDriver 构造） */
  storage?: StorageFactory;
}

function ensureDirectoryForDb(dbPath: string): void {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch (err: any) {
        if (err?.code === "EEXIST" || err?.code === "EISDIR") {
          return;
        }
        throw new Error(
          `Failed to create data directory '${dir}' for database '${dbPath}': ${
            err?.message || String(err)
          }`,
          { cause: err }
        );
      }
    }
  }
}

/**
 * 创建 Node 运行时平台实例。
 * 组装 Node 原生核心组件：
 * - NodeSqliteDriver 同步持久化存储驱动
 * - NodeProcessDriver 原生进程驱动与 ProcessManager 受管进程引擎
 * - NodeModuleLoader 原生源码加载器
 * - NodeFileSystem 文件系统
 * - SystemClock 系统时钟
 *
 * @param options 平台配置选项
 */
export function createNodePlatform(options: NodePlatformOptions = {}): RuntimePlatform {
  const platformName: "node" | "test" = options.name ?? "node";
  const clock: Clock = options.clock ?? new SystemClock();
  const files: FileSystem = options.files ?? new NodeFileSystem({ rootDir: options.rootDir });
  const modules: ModuleLoader = options.modules ?? new NodeModuleLoader();
  const processDriver = options.processDriver ?? new NodeProcessDriver();
  const processManager = options.processManager ?? new ProcessManager({ driver: processDriver });
  const process: ProcessAPI =
    options.process ??
    processManager.forOwner({
      tenantId: "default",
      principalId: "default",
      packageInstanceId: "default",
      generationId: "default",
    });

  const createDriver = options.driverFactory ?? ((dbPath: string) => new NodeSqliteDriver(dbPath));

  if (options.useWorker) {
    console.warn(
      "[createNodePlatform] useWorker is deprecated: WorkerSqliteDriver is async and no longer satisfies the sync SqliteDriver contract; falling back to NodeSqliteDriver."
    );
  }

  const storage: StorageFactory = options.storage ?? {
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
        recoverOrphans: opts?.recoverOrphans === true,
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
        recoverOrphans: opts?.recoverOrphans === true,
      });
    },
  };

  return {
    name: platformName,
    clock,
    files,
    modules,
    process,
    storage,
  };
}
