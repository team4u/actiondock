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
