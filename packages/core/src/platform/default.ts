import type { ProcessAPI } from "@actiondock/sdk";
import { type Clock, SystemClock } from "../runtime/clock";
import { DefaultModuleLoader, type ModuleLoader } from "../runtime/module-loader";
import { ProcessError, UNSUPPORTED_CAPABILITY } from "../errors";
import { ProcessManager } from "../process/process-manager";
import type { ProcessDriver } from "../process/driver";
import {
  createGlobalStorage as coreCreateGlobalStorage,
  createStorage as coreCreateStorage,
} from "../storage";
import type { RuntimeStorage } from "../storage/types";
import { NodeFileSystem } from "./node-fs";
import type {
  FileSystem,
  GlobalStorageFactoryOptions,
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
  /** 自定义进程执行驱动（默认依托 ProcessManager 与对应驱动） */
  process?: ProcessAPI;
  /** 可选注入的底层进程驱动 */
  processDriver?: ProcessDriver;
  /** 可选注入的受管进程管理器 */
  processManager?: ProcessManager;
  /** 自定义源码加载驱动（默认使用 DefaultModuleLoader） */
  modules?: ModuleLoader;
  /** 自定义存储工厂（默认基于 core/storage 构造） */
  storage?: StorageFactory;
  /** 自定义 ActionDock 家目录 */
  customHome?: string;
  /** 自定义全局数据存储目录 */
  dataDir?: string;
  /** 文件系统沙箱根目录 */
  rootDir?: string;
}

/**
 * 构造不支持进程能力的 ProcessAPI：
 * 默认平台不含进程驱动，任何进程操作均抛出明确错误，
 * 指引调用方显式注入 processDriver 或改用 @actiondock/runtime-node 的 createNodePlatform。
 */
function createUnsupportedProcessApi(): ProcessAPI {
  const unsupported = (operation: string): Promise<never> =>
    Promise.reject(
      new ProcessError(
        UNSUPPORTED_CAPABILITY,
        `The default platform does not bundle a process driver, so process.${operation} is unavailable. ` +
          "Explicitly inject a processDriver (for example MemoryProcessDriver from @actiondock/core for testing) " +
          "or use createNodePlatform from @actiondock/runtime-node, which provides NodeProcessDriver."
      )
    );

  return {
    run: () => unsupported("run"),
    start: () => unsupported("start"),
    inspect: () => unsupported("inspect"),
    list: () => unsupported("list"),
    acquire: () => unsupported("acquire"),
    renew: () => unsupported("renew"),
    release: () => unsupported("release"),
    write: () => unsupported("write"),
    operation: () => unsupported("operation"),
    read: () => unsupported("read"),
    control: () => unsupported("control"),
    stop: () => unsupported("stop"),
  };
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

  // 未注入底层驱动时不静默回退内存模拟驱动：默认平台不提供可用进程能力，
  // 避免默认路径下的进程调用无声挂死或必然超时
  const processDriver: ProcessDriver | undefined = options.processDriver;
  const processManager: ProcessManager | undefined = options.processManager ??
    (processDriver ? new ProcessManager({ driver: processDriver }) : undefined);
  const process: ProcessAPI = options.process ??
    (processManager
      ? processManager.forOwner({
          tenantId: "default",
          principalId: "default",
          packageInstanceId: "default",
          generationId: "default",
        })
      : createUnsupportedProcessApi());

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

  return {
    name: platformName,
    clock,
    files,
    modules,
    process,
    storage,
  };
}
