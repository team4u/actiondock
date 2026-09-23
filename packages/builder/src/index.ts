/**
 * @actiondock/builder 公共导出面。
 * 专注于暴露核心构建主接口与必要契约，低层内部工具作为包内模块封装。
 */

// 错误模型
export { BuilderError, PlannerError } from "./errors";

// 构建、打包与导出主接口
export { buildProject } from "./build";
export { packProject } from "./pack";
export {
  exportCompositeSkill,
  exportSkill,
  exportSkillBatch,
  SkillExporter,
} from "./exporter";

// 构建规划器
export { SelectionPlanner } from "./planner";

// 公共契约与配置类型
export type {
  ArchiveFormat,
  BatchSkillExportOptions,
  BatchSkillExportResult,
  BuildOptions,
  BuildPlan,
  BuildResult,
  CompositeSkillExportOptions,
  CompositeSkillExportResult,
  ExportSkillOptions,
  ExportSkillResult,
  PackOptions,
  PackResult,
  SelectionPlan,
  SelectionPlannerOptions,
  SkillExporterOptions,
  SkillExportResult,
} from "./types";
