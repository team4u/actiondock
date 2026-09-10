import {
  DefaultModuleLoader,
  NodeFileSystem,
  type EventSink,
  type FileSystem,
  type GlobalStorageFactoryOptions,
  type ModuleLoader,
  type RuntimePlatform,
  type RuntimeStorage,
  type StorageFactory,
  type StorageFactoryOptions,
} from "@actiondock/core";
import { FakeClock } from "./clock";
import { MockProcessExecutor } from "./process";
import { TestEventSink } from "./runtime";
import { MemoryStorage } from "./storage";

/**
 * 测试平台构建配置选项。
 */
export interface TestPlatformOptions {
  /** 可选注入的确定性虚拟时钟 */
  clock?: FakeClock;
  /** 可选注入的统一存储实例（若指定则所有 Package 存储均回退至该实例） */
  storage?: RuntimeStorage;
  /** 可选注入的跨 Package 全局存储实例 */
  globalStorage?: RuntimeStorage;
  /** 可选注入的模拟进程执行器 */
  process?: MockProcessExecutor;
  /** 可选注入的执行事件接收器 */
  eventSink?: EventSink;
  /** 可选注入的文件系统抽象驱动 */
  files?: FileSystem;
  /** 可选注入的源码模块加载器 */
  modules?: ModuleLoader;
}

/**
 * 测试运行时平台接口契约。
 * 完整实现 RuntimePlatform，并显式暴露测试组件类型。
 */
export interface TestPlatform extends RuntimePlatform {
  readonly name: "test";
  readonly clock: FakeClock;
  readonly files: FileSystem;
  readonly modules: ModuleLoader;
  readonly process: MockProcessExecutor;
  readonly storage: StorageFactory;
  readonly eventSink: EventSink;
}

/**
 * 创建纯内存确定性测试平台实例。
 * 组装测试核心组件：
 * - FakeClock 确定性虚拟时钟
 * - MockProcessExecutor 模拟进程执行器
 * - MemoryStorage 纯内存数据库存储
 * - TestEventSink 确定性事件接收器
 * - DefaultModuleLoader 动态模块加载器
 * - NodeFileSystem 文件系统
 *
 * @param options 测试平台配置选项
 */
export function createTestPlatform(options: TestPlatformOptions = {}): TestPlatform {
  const clock = options.clock ?? new FakeClock();
  const process = options.process ?? new MockProcessExecutor();
  const eventSink = options.eventSink ?? new TestEventSink();
  const files = options.files ?? new NodeFileSystem();
  const modules = options.modules ?? new DefaultModuleLoader();

  const packageStorages = new Map<string, RuntimeStorage>();
  let globalStorageInstance = options.globalStorage;

  const storageFactory: StorageFactory = {
    createStorage(packageId: string, _opts?: StorageFactoryOptions): RuntimeStorage {
      if (options.storage) {
        return options.storage;
      }
      let existing = packageStorages.get(packageId);
      if (!existing) {
        existing = new MemoryStorage({
          packageId,
          clock,
        });
        packageStorages.set(packageId, existing);
      }
      return existing;
    },
    createGlobalStorage(_opts?: GlobalStorageFactoryOptions): RuntimeStorage {
      if (globalStorageInstance) {
        return globalStorageInstance;
      }
      globalStorageInstance = new MemoryStorage({
        packageId: "__global__",
        clock,
      });
      return globalStorageInstance;
    },
  };

  return {
    name: "test",
    clock,
    files,
    modules,
    process,
    storage: storageFactory,
    eventSink,
  };
}
