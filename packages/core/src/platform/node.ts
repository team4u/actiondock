import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger, ProcessAPI } from "@actiondock/sdk";
import { ActionDockError, STORAGE_INIT_FAILED } from "../errors";
import { SystemClock, type Clock } from "../storage/clock";
import { NodeModuleLoader, type ModuleLoader } from "./module-loader";
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
import type { EventSink } from "../runtime/events";
import type {
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
  /**
   * 历史兼容保留属性（已废弃：文件系统抽象已由原生模块接管）。
   * @deprecated 文件系统抽象已清理，该字段已无实际效果。
   */
  rootDir?: string;
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
  /** 自定义时钟驱动（默认实例化 SystemClock） */
  clock?: Clock;
  /** 自定义存储工厂（默认基于 NodeSqliteDriver 构造） */
  storage?: StorageFactory;
  /** 可选注入的执行事件接收器 */
  eventSink?: EventSink;
  /** 可选注入的统一日志记录器 */
  logger?: Logger;
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
        throw new ActionDockError(
          STORAGE_INIT_FAILED,
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
 * - SystemClock 系统时钟
 *
 * 资源按需装配原则：
 * - clock 与存储工厂可立即创建（存储工厂本身不打开任何数据库）；
 * - process 与 modules 采用缓存访问器，首次真正访问时才装配默认驱动，
 *   静态发现等旁观路径不触发进程管理器与模块加载钩子的创建成本；
 * - 模块加载钩子注册收敛至 NodeModuleLoader 构造内部，不再在平台工厂入口执行。
 *
 * @param options 平台配置选项
 */
export function createNodePlatform(options: NodePlatformOptions = {}): RuntimePlatform {
  const platformName: "node" | "test" = options.name ?? "node";
  const clock: Clock = options.clock ?? new SystemClock();

  // - 进程接口缓存访问器：显式注入直接透传；缺省时按需装配一次默认驱动链
  let cachedProcess: ProcessAPI | undefined;
  const resolveProcess = (): ProcessAPI => {
    if (options.process) {
      return options.process;
    }
    if (!cachedProcess) {
      const processDriver = options.processDriver ?? new NodeProcessDriver();
      const processManager = options.processManager ?? new ProcessManager({ driver: processDriver });
      cachedProcess = processManager.forOwner({
        tenantId: "default",
        principalId: "default",
        packageInstanceId: "default",
        generationId: "default",
      });
    }
    return cachedProcess;
  };

  // - 模块加载器缓存访问器：首次访问时才创建默认加载器（构造内部注册加载钩子）
  let cachedModules: ModuleLoader | undefined;
  const resolveModules = (): ModuleLoader => {
    if (options.modules) {
      return options.modules;
    }
    if (!cachedModules) {
      cachedModules = new NodeModuleLoader();
    }
    return cachedModules;
  };

  const createDriver = options.driverFactory ?? ((dbPath: string) => new NodeSqliteDriver(dbPath));

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
        retentionPolicy: opts?.retentionPolicy,
        logger: options.logger,
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
        logger: options.logger,
      });
    },
  };

  const platform: RuntimePlatform = {
    name: platformName,
    clock,
    eventSink: options.eventSink,
    get process(): ProcessAPI {
      return resolveProcess();
    },
    get modules(): ModuleLoader {
      return resolveModules();
    },
    storage,
  };
  return platform;
}
