import type { FormInstance } from "antd";
import type { MenuProps } from "antd";
import type {
  PluginDependency,
  AiDependency,
  PluginReferenceView,
  PluginSummaryView,
  UpstreamStatus,
  RepositoryScriptDescriptor,
  ScriptDefinition,
  ScriptPackaging,
  ScriptType
} from "../../../../shared/types";
import type { SchemaEditorState } from "../../../../services/schema";
import type { ScriptEditorHeaderActionModel } from "./scriptEditorHeaderActions";
export type {
  RepositoryPublishVersionResolution,
  RepositoryPublishVersionSuggestion
} from "../../../../services/repositoryPublish";
export {
  resolveRepositoryPublishVersion,
  suggestNextRepositoryVersion
} from "../../../../services/repositoryPublish";

export interface ScriptEditorPageProps {
  colorMode: "light" | "dark";
  mode: "create" | "edit";
}

export interface ScriptEditorFormValues {
  id: string;
  name: string;
  type: ScriptType;
  packaging: ScriptPackaging;
  description?: string;
  pythonRequirements?: string;
  maxExecutionRecords?: number;
}

export interface PublishToRepositoryFormValues {
  repositoryId: string;
  repositoryScriptId: string;
  displayName: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
  tags?: string[];
  scheduleIds?: string[];
}

export interface PublishScriptDependencyDraft {
  scriptId: string;
  repositoryId?: string;
  repositoryScriptId?: string;
  versionRange?: string;
  state: "AUTO" | "MANUAL" | "UNRESOLVED";
}

export type { ForkFormValues } from "../../../../shared/types";

export type ExecutionInputMode = "SCHEMA" | "JSON";

export const DEFAULT_SOURCES: Record<ScriptType, string> = {
  GROOVY: `def name = input.name ?: "World"
return [message: "Hello, " + name + "!"]`,
  PYTHON: `name = input.get("name") or "World"
return {"message": f"Hello, {name}!"}`
};

export function getDefaultSource(type: ScriptType): string {
  return DEFAULT_SOURCES[type];
}

export function getSourceFileName(type: ScriptType): string {
  return type === "PYTHON" ? "source.py" : "source.groovy";
}

export function getSourceLanguage(type: ScriptType): string {
  return type === "PYTHON" ? "python" : "groovy";
}

export function getScriptContentHint(type: ScriptType): string {
  if (type === "PYTHON") {
    return "Python 脚本会被当作函数体执行，可直接访问 input 并 return JSON 可序列化结果。";
  }
  return "Groovy 使用代码编辑器，输入输出结构支持 Builder 和 JSON 两种编辑方式。";
}

export function getEditorFooterHint(type: ScriptType): string {
  if (type === "PYTHON") {
    return "保存时校验 requirements 格式，脚本语法和依赖安装由运行时校验。";
  }
  return "保存时校验配置格式，Groovy 语法通过后端校验。";
}

export function toTagOptions(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((item) => item.trim().length > 0);
}

export interface ScriptEditorContext {
  form: FormInstance<ScriptEditorFormValues>;
  currentScript: ScriptDefinition | null;
  sourceText: string;
  setSourceText: (text: string) => void;
  inputSchemaState: SchemaEditorState;
  setInputSchemaState: (state: SchemaEditorState) => void;
  outputSchemaState: SchemaEditorState;
  setOutputSchemaState: (state: SchemaEditorState) => void;
  selectedScriptType: ScriptType;
  isReadOnlyScript: boolean;
  hasUnpublishedChanges: boolean;
  canPublishToRepository: boolean;
  canImportGeneratedScript: boolean;
  copiedFromScript: { id: string; name: string } | null;
  availableScripts: ScriptDefinition[];
  scriptsLoading: boolean;
  availablePlugins: PluginSummaryView[];
  availablePluginReferences: PluginReferenceView[];
  pluginsLoading: boolean;
  headerActionModel: ScriptEditorHeaderActionModel;
  loading: boolean;
  saving: boolean;
  publishing: boolean;
  handleSave: () => Promise<void>;
  handlePublish: () => Promise<void>;
  handleValidate: () => Promise<void>;
  handleScriptTypeChange: (type: ScriptType) => void;
  handleImportGeneratedScript: (text: string) => void;
  ensureCurrentScriptPublished: (successMessage?: string) => Promise<ScriptDefinition>;
  loadScriptReferences: () => Promise<void>;
  publishMenuItems: MenuProps["items"];
  moreMenuItems: MenuProps["items"];
  openDeleteScriptConfirm: () => void;
  openDiscardDraftConfirm: () => void;
  deletingScript: boolean;
  discardingDraft: boolean;
  validating: boolean;
  detectedPluginDependencies: PluginDependency[];
  detectedAiDependencies: AiDependency[];
  developmentStatus: UpstreamStatus | null;
  developmentPulling: boolean;
  handlePullDevelopment: () => Promise<void>;
  modalContextHolder: React.ReactNode;
}
