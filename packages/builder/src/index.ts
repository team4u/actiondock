/**
 * @actiondock/builder 公共导出面。
 * 专注于暴露核心构建主接口与必要契约，低层内部工具作为包内模块封装。
 */

// 错误模型
export { BuilderError, PlannerError } from "./errors";

// 构建、打包与导出主接口
export { buildProject, buildProjectWithPlan } from "./build";
export { packProject } from "./pack";
export {
  exportCompositeSkill,
  exportSkill,
  SkillExporter,
} from "./exporter";
export { allocatePackageDirName } from "./manifest";

// 构建规划器
export { SelectionPlanner } from "./planner";

// 技能说明书自定义契约与解析
export {
  COMPOSITE_CUSTOM_DECLARATION_FILE,
  COMPOSITE_CUSTOM_SLOTS,
  SKILL_CUSTOM_DECLARATION_FILE,
  SKILL_CUSTOM_SLOTS,
  parseCustomSections,
  parseCustomSkillDeclaration,
} from "./skill";
export type {
  CompositeCustomDeclaration,
  CompositeCustomSection,
  CompositeCustomSlot,
  SkillCustomDeclaration,
  SkillCustomSection,
  SkillCustomSlot,
} from "./skill";

// 公共契约与配置类型
export type {
  ArchiveFormat,
  BuildOptions,
  BuildPlan,
  BuildProjectWithPlanOptions,
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
