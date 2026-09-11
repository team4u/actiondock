/**
 * @actiondock/builder 公共导出面。
 * 采用显式命名导出替代全量 export *，保证公开 API 边界清晰可控。
 */

// 错误类型
export { BuilderError, PlannerError } from "./errors";

// 共享基础设施（内部复用的通用能力，随包公开便于下游校验）
export {
  collectRelativeFiles,
  getInternalDependencyVersion,
  moveDirAtomic,
  replaceDirAtomic,
} from "./fs-utils";

// 清单组装与依赖协议校验
export {
  assertNoFileProtocolDeps,
  serializeManifestAction,
  serializeManifestPlaybooks,
  serializePlanManifest,
} from "./manifest";
export type { SerializePlanManifestOptions } from "./manifest";

// 归档压缩
export {
  createTarGzArchive,
  createTarGzArchiveAsync,
  createZipArchive,
  createZipArchiveAsync,
} from "./archive";

// 构建规划
export { BuildPlanner, buildPlan, SelectionPlanner, selectionPlan } from "./planner";

// 相对依赖完整性校验
export {
  assertRelativeDependenciesIntegrity,
  extractRelativeSpecifiers,
  resolveRelativeModule,
} from "./dependency-check";

// 目录型构建与 npm 打包
export { buildProject } from "./build";
export { packProject } from "./pack";

// Skill 导出
export {
  exportCompositeSkill,
  exportSkill,
  exportSkillBatch,
  findExistingCompositeSkillMd,
  findExistingSingleSkillMd,
  SkillExporter,
} from "./exporter";

// 公共类型定义
export type {
  ActionDependency,
  ArchiveFormat,
  AssetDependency,
  BatchSkillExportOptions,
  BatchSkillExportResult,
  BuildOptions,
  BuildPlan,
  BuildPlanDependencies,
  BuildPlannerOptions,
  BuildResult,
  CompositeSkillExportOptions,
  CompositeSkillExportResult,
  ExternalDependency,
  LockfileInfo,
  PackOptions,
  PackResult,
  PlaybookPlanEntry,
  ProjectConfigWithDeclarations,
  SelectionPlan,
  SelectionPlannerOptions,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";
