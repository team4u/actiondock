import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DefaultModuleLoader,
  getActionDockHome,
  NodeFileSystem,
  resolveDatabasePath,
  SqliteRuntimeStorage,
  SystemClock,
  type Clock,
  type FileSystem,
  type GlobalStorageFactoryOptions,
  type HttpServerFactory,
  type ModuleLoader,
  type RuntimePlatform,
  type RuntimeStorage,
  type SqliteDriver,
  type StorageFactory,
  type StorageFactoryOptions,
} from "@actiondock/core";
import { BunHttpServer } from "./http-server";
import { BunProcessExecutor } from "./process-executor";
import { BunSqliteDriver } from "./sqlite-driver";

/**
 * Bun 平台构建配置选项。
 */
export interface BunPlatformOptions {
  /** 自定义全局数据存储目录 */
  dataDir?: string;
  /** 自定义家目录路径 */
  customHome?: string;
  /** 文件系统安全沙箱根路径 */
  rootDir?: string;
  /** 自定义 SQLite 驱动工厂函数（默认实例化 BunSqliteDriver） */
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
 * 创建 Bun 运行时平台实例。
 * 组装 Bun 原生核心组件：
 * - BunSqliteDriver 持久化存储驱动
 * - BunProcessExecutor 进程执行器
 * - BunHttpServer 网络服务驱动
 * - DefaultModuleLoader 源码加载器
 * - NodeFileSystem 文件系统
 * - SystemClock 系统时钟
 *
 * @param options 平台配置选项
 */
export function createBunPlatform(options: BunPlatformOptions = {}): RuntimePlatform {
  const clock: Clock = new SystemClock();
  const files: FileSystem = new NodeFileSystem({ rootDir: options.rootDir });
  const modules: ModuleLoader = new DefaultModuleLoader();
  const process = new BunProcessExecutor();

  const createDriver = options.driverFactory ?? ((dbPath: string) => new BunSqliteDriver(dbPath));

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

  const http: HttpServerFactory = {
    async launchHttpServer(serverOptions: any, ...rest: any[]): Promise<any> {
      let port = 5177;
      let host = "127.0.0.1";
      let fetchHandler: (req: Request, server: any) => Promise<Response> | Response;

      if (
        typeof serverOptions === "object" &&
        serverOptions !== null &&
        !Array.isArray(serverOptions)
      ) {
        port = serverOptions.port ?? 5177;
        host = serverOptions.host ?? serverOptions.hostname ?? "127.0.0.1";
        fetchHandler = serverOptions.fetch || serverOptions.fetchHandler;
      } else {
        port = typeof serverOptions === "number" ? serverOptions : 5177;
        host = typeof rest[0] === "string" ? rest[0] : "127.0.0.1";
        fetchHandler = typeof rest[1] === "function" ? rest[1] : rest[0];
      }

      const server = new BunHttpServer({
        port,
        hostname: host,
        fetch: fetchHandler,
        autoStart: true,
      });

      return {
        get port() {
          return server.port;
        },
        ready: Promise.resolve(),
        stop: async (closeActive?: boolean) => {
          server.stop(closeActive);
        },
        server,
      };
    },
  };

  return {
    name: "bun",
    clock,
    files,
    modules,
    process,
    storage,
    http,
  };
}
