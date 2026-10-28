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
import { createConfigKeyProvider } from "../security/config-key";
import type { ConfigKeyProvider } from "../security/config-cipher";
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
  /**
   * 显式注入的配置加密密钥提供器：优先于由有效 customHome/dataDir 派生的默认提供器，
   * 显式注入时对内存库同样生效（供测试注入固定密钥）。
   */
  configKeyProvider?: ConfigKeyProvider;
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

  // - 配置加密密钥提供器按每次建库时的有效路径派生：密钥必须与数据库共享同一
  //   dataDir/customHome 域，禁止密钥落真实 home 而数据库在别处（或反向）。
  //   提供器懒加载：仅构造平台或读取普通配置不创建 keys 目录；
  //   内存库不注入派生提供器，由存储使用随机内存密钥，即使环境提供密钥也不触真实密钥源；
  //   显式注入的测试提供器对内存库保留生效。
  const resolveConfigKeyProvider = (
    dbPath: string,
    effectiveCustomHome: string | undefined,
    effectiveDataDir: string | undefined
  ): ConfigKeyProvider | undefined => {
    if (options.configKeyProvider) {
      return options.configKeyProvider;
    }
    if (dbPath === ":memory:") {
      return undefined;
    }
    return createConfigKeyProvider({
      customHome: effectiveCustomHome,
      dataDir: effectiveDataDir,
    });
  };

  // - 自建驱动构造失败时释放句柄：SqliteRuntimeStorage 将注入 driver 视为外部资源，
  //   构造抛出不会代为关闭，此处回收驱动，避免锁泄漏后原样透传错误
  const createStorageWithDriverCleanup = (
    build: (driver: SqliteDriver) => RuntimeStorage,
    dbPath: string
  ): RuntimeStorage => {
    const driver = createDriver(dbPath);
    try {
      return build(driver);
    } catch (err) {
      try {
        driver.close();
      } catch {
        // 忽略清理阶段副异常，确保原始错误优先透传
      }
      throw err;
    }
  };

  const storage: StorageFactory = options.storage ?? {
    createStorage(packageId: string, opts?: StorageFactoryOptions): RuntimeStorage {
      // 显式 opts 中的 undefined 不得覆盖平台级路径：密钥与数据库必须解析同一有效路径
      const effectiveCustomHome = opts?.customHome ?? options.customHome;
      const effectiveDataDir = opts?.dataDir ?? options.dataDir;
      const mergedOpts = {
        customHome: effectiveCustomHome,
        dataDir: effectiveDataDir,
        inMemory: opts?.inMemory,
        projectRoot: opts?.projectRoot,
      };
      const dbPath = resolveDatabasePath(packageId, mergedOpts);
      ensureDirectoryForDb(dbPath);
      const configKeyProvider = resolveConfigKeyProvider(
        dbPath,
        effectiveCustomHome,
        effectiveDataDir
      );
      return createStorageWithDriverCleanup((driver) => new SqliteRuntimeStorage({
        dbPath,
        packageId,
        clock,
        driver,
        recoverOrphans: opts?.recoverOrphans === true,
        retentionPolicy: opts?.retentionPolicy,
        logger: options.logger,
        ...(configKeyProvider ? { configKeyProvider } : {}),
        ...(opts?.configDeclarations?.length ? { configDeclarations: opts.configDeclarations } : {}),
      }), dbPath);
    },
    createGlobalStorage(opts?: GlobalStorageFactoryOptions): RuntimeStorage {
      const effectiveCustomHome = opts?.customHome ?? options.customHome;
      const effectiveDataDir = opts?.dataDir ?? options.dataDir;
      const inMemory = Boolean(opts?.inMemory);
      const dbPath = inMemory
        ? ":memory:"
        : resolveGlobalDatabasePath({ dataDir: effectiveDataDir, customHome: effectiveCustomHome });
      ensureDirectoryForDb(dbPath);
      const configKeyProvider = resolveConfigKeyProvider(
        dbPath,
        effectiveCustomHome,
        effectiveDataDir
      );
      return createStorageWithDriverCleanup((driver) => new SqliteRuntimeStorage({
        dbPath,
        packageId: "__global__",
        clock,
        driver,
        recoverOrphans: opts?.recoverOrphans === true,
        logger: options.logger,
        ...(configKeyProvider ? { configKeyProvider } : {}),
        ...(opts?.configDeclarations?.length ? { configDeclarations: opts.configDeclarations } : {}),
      }), dbPath);
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
