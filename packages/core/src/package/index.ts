/**
 * ActionDock 包级运行时必要门面与契约。
 *
 * 遵循 Minimal 暴露准则：仅对外输出 PackageRuntime、PackageRuntimeOptions、
 * createPackageRuntime 以及包与动作元数据契约（PackageInfo、ActionSpec、ActionSummary、
 * PlaybookSpec、PlaybookSummary）。
 * 底层存储驱动、独立分发器与平台大对象统一由核心根入口导出。
 */

export {
  createPackageRuntime,
  DefaultPackageRuntime,
} from "./runtime";
export type {
  PackageRuntime,
  PackageRuntimeOptions,
  PackageInfo,
  ActionSpec,
  ActionSummary,
  PlaybookSpec,
  PlaybookSummary,
} from "./types";

// 运行时平台与进程驱动契约
export type {
  RuntimePlatform,
  FileSystem,
  StorageFactory,
  StorageFactoryOptions,
  GlobalStorageFactoryOptions,
} from "../platform/types";
export {
  type Clock,
  SystemClock,
} from "../runtime/clock";
export type { ModuleLoader } from "../node/module-loader";
export {
  InMemoryEventSink,
  type EventSink,
} from "../runtime/events";
export {
  ProcessManager,
  type ProcessOwner,
} from "../process/process-manager";
export type { ProcessExecutor } from "../runtime/process";
export type {
  ProcessDriver,
  ProcessDriverCallbacks,
  ProcessDriverHandle,
  ProcessHandle,
  ProcessObserver,
} from "../process/driver";

// 存储契约与驱动
export {
  createStorage,
  resolveDatabasePath,
} from "../storage/index";
export { SqliteRuntimeStorage } from "../storage/sqlite";
export type {
  RuntimeStorage,
  SqliteDriver,
  StateEntry,
} from "../storage/types";
