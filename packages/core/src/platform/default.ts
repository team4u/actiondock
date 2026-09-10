import type { ProcessAPI } from "@actiondock/sdk";
import { type Clock, SystemClock } from "../runtime/clock";
import { DefaultModuleLoader, type ModuleLoader } from "../runtime/module-loader";
import { DefaultProcessExecutor } from "../runtime/process";
import { launchHttpServer as coreLaunchHttpServer } from "../server/server";
import {
  createGlobalStorage as coreCreateGlobalStorage,
  createStorage as coreCreateStorage,
} from "../storage";
import type { RuntimeStorage } from "../storage/types";
import { NodeFileSystem } from "./node-fs";
import type {
  FileSystem,
  GlobalStorageFactoryOptions,
  HttpServerFactory,
  RuntimePlatform,
  StorageFactory,
  StorageFactoryOptions,
} from "./types";

/**
 * 默认运行时平台构建选项。
 */
export interface DefaultPlatformOptions {
  /** 平台名称覆盖（默认使用 node） */
  name?: "node" | "test";
  /** 自定义文件系统实现（默认使用 NodeFileSystem） */
  files?: FileSystem;
  /** 自定义时间与时钟驱动（默认使用 SystemClock） */
  clock?: Clock;
  /** 自定义进程执行驱动（默认使用 DefaultProcessExecutor） */
  process?: ProcessAPI;
  /** 自定义源码加载驱动（默认使用 DefaultModuleLoader） */
  modules?: ModuleLoader;
  /** 自定义存储工厂（默认基于 core/storage 构造） */
  storage?: StorageFactory;
  /** 自定义 HTTP 服务工厂（默认使用 core/server launchHttpServer） */
  http?: HttpServerFactory;
  /** 自定义 ActionDock 家目录 */
  customHome?: string;
  /** 自定义全局数据存储目录 */
  dataDir?: string;
  /** 文件系统沙箱根目录 */
  rootDir?: string;
}

/**
 * 创建默认 RuntimePlatform 平台实例。
 * 直接基于 Node 原生与 Core 内核能力组装平台，禁止任何全局单例状态。
 */
export function createDefaultPlatform(options: DefaultPlatformOptions = {}): RuntimePlatform {
  const platformName: "node" | "test" = options.name ?? "node";

  const clock: Clock = options.clock ?? new SystemClock();
  const files: FileSystem = options.files ?? new NodeFileSystem({ rootDir: options.rootDir });
  const modules: ModuleLoader = options.modules ?? new DefaultModuleLoader();
  const process: ProcessAPI = options.process ?? new DefaultProcessExecutor();

  const storage: StorageFactory = options.storage ?? {
    createStorage(
      packageId: string,
      opts?: StorageFactoryOptions
    ): RuntimeStorage {
      return coreCreateStorage(packageId, {
        customHome: options.customHome,
        dataDir: options.dataDir,
        ...opts,
      });
    },
    createGlobalStorage(
      opts?: GlobalStorageFactoryOptions
    ): RuntimeStorage {
      return coreCreateGlobalStorage({
        customHome: options.customHome,
        dataDir: options.dataDir,
        ...opts,
      });
    },
  };

  const http: HttpServerFactory = options.http ?? {
    launchHttpServer(serverOptions: any, ...rest: any[]): Promise<any> {
      if (
        typeof serverOptions === "object" &&
        serverOptions !== null &&
        !Array.isArray(serverOptions) &&
        ("port" in serverOptions || "host" in serverOptions || "fetch" in serverOptions || "fetchHandler" in serverOptions)
      ) {
        const port = serverOptions.port ?? 5177;
        const host = serverOptions.host ?? "127.0.0.1";
        const fetchHandler = serverOptions.fetch || serverOptions.fetchHandler;
        return coreLaunchHttpServer(port, host, fetchHandler);
      }
      return (coreLaunchHttpServer as any)(serverOptions, ...rest);
    },
  };

  return {
    name: platformName,
    clock,
    files,
    modules,
    process,
    storage,
    http,
  };
}
