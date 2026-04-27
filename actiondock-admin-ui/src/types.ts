export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY" | "PYTHON";
export type ScriptScope = "PERSONAL" | "REPOSITORY" | "FORK" | "DEVELOPMENT" | "SAMPLE";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";
export type ExecutionResponseView = "RESULT" | "DEBUG";
export type ExecutionTriggerSource = "MANUAL" | "SCHEDULED";
export type ExecutionLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type RepositoryType = "GIT" | "HTTP" | "LOCAL_DIR";
export type RepositoryTrustLevel = "TRUSTED" | "UNTRUSTED";
export type RepositoryUsage = "DISTRIBUTION" | "DEVELOPMENT";
export type DevelopmentSyncState = "SYNCED" | "LOCAL_CHANGES" | "REMOTE_CHANGES" | "DIVERGED";

export interface ForkFormValues {
  id: string;
  name: string;
}

export interface PublishedScriptSnapshot {
  name: string;
  type: ScriptType;
  source: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ScriptDefinition {
  id: string;
  name: string;
  type: ScriptType;
  source: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  status: ScriptStatus;
  version: number;
  scope?: ScriptScope;
  repositoryId?: string;
  repositoryToolId?: string;
  repositoryVersion?: string;
  sourcePath?: string;
  sourceCommit?: string;
  sourceDigest?: string;
  sourceSyncedAt?: string;
  dirty?: boolean;
  editable?: boolean;
  owner?: string;
  description?: string;
  tags?: string[];
  pluginDependencies?: PluginDependency[];
  publishedSnapshot?: PublishedScriptSnapshot;
  hasUnpublishedChanges?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PluginDependency {
  pluginId: string;
  versionRange?: string;
  requiredActions: string[];
}

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  status: ExecutionStatus;
  submitMode: SubmitMode;
  triggerSource: ExecutionTriggerSource;
  scheduleId?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  logs: ExecutionLogEntry[];
  errorMessage?: string;
  errorDetail?: ErrorDetail;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExecutionLogEntry {
  level: ExecutionLogLevel;
  message: string;
  createdAt?: string;
}

export interface ErrorDetail {
  type: string;
  stackTrace: string;
}

export interface ExecutionResponseDebug {
  input: Record<string, unknown>;
  rawOutput: Record<string, unknown>;
}

export interface ExecutionResponse {
  id: string;
  scriptId: string;
  status: ExecutionStatus;
  submitMode: SubmitMode;
  triggerSource: ExecutionTriggerSource;
  scheduleId?: string;
  output: Record<string, unknown>;
  logs: ExecutionLogEntry[];
  errorMessage?: string;
  errorDetail?: ErrorDetail;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  debug?: ExecutionResponseDebug;
}

export interface ExecuteRequest {
  scriptId: string;
  input: Record<string, unknown>;
  mode: SubmitMode;
  responseView?: ExecutionResponseView;
}

export interface ScriptSchedule {
  id: string;
  scriptId: string;
  name: string;
  cronExpression: string;
  input: Record<string, unknown>;
  enabled: boolean;
  editable?: boolean;
  repositoryId?: string;
  repositoryToolId?: string;
  repositoryVersion?: string;
  nextRunAt?: string;
  lastTriggeredAt?: string;
  lastExecutionId?: string;
  lastExecutionStatus?: ExecutionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScriptScheduleUpsertRequest {
  scriptId: string;
  name: string;
  cronExpression: string;
  input: Record<string, unknown>;
  enabled: boolean;
}

export interface ApiResponse<T> {
  status: number;
  msg?: string;
  data: T;
}

export interface ValidationFieldError {
  field: string;
  reason: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationErrorData {
  code: string;
  scriptId: string;
  fieldErrors: ValidationFieldError[];
}

export interface ApiErrorPayload {
  status?: number;
  msg?: string;
  data?: unknown;
}

export function isErrorDetail(value: unknown): value is ErrorDetail {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as ErrorDetail).type === "string" &&
    typeof (value as ErrorDetail).stackTrace === "string"
  );
}

export interface PluginAction {
  action: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  exampleArgs: Record<string, unknown>;
}

export interface PluginView {
  pluginId: string;
  name: string;
  description: string;
  version: string;
  repositoryId?: string;
  repositoryPluginId?: string;
  repositoryVersion?: string;
  state: string;
  started: boolean;
  configurable: boolean;
  actions: PluginAction[];
}

export interface PluginConfigView {
  pluginId: string;
  configSchema: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface PluginInvokeDebug {
  args: Record<string, unknown>;
  scriptInput: Record<string, unknown>;
}

export interface PluginInvokeResponse {
  pluginId: string;
  action: string;
  result: Record<string, unknown>;
  debug?: PluginInvokeDebug;
}

export interface PluginInvokeRequest {
  args: Record<string, unknown>;
  scriptInput: Record<string, unknown>;
  responseView?: ExecutionResponseView;
}

export interface ConfigValue {
  key: string;
  value?: string | null;
  valueMasked?: string | null;
  hasValue?: boolean;
  description?: string;
  secret?: boolean;
  repositoryId?: string;
  repositoryToolId?: string;
  repositoryVersion?: string;
  publishMode?: string;
  managed?: boolean;
  overridden?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConfigValueDetail extends ConfigValue {
  usage: ConfigValueUsage;
  impactedScripts: ConfigValueImpactScript[];
  origin?: ConfigValueOrigin | null;
  availableActions: ConfigValueAvailableActions;
}

export interface ConfigValueUsage {
  configReferences: ConfigValueReference[];
  scriptReferences: ConfigValueScriptReference[];
  scheduleReferences: ConfigValueScheduleReference[];
  pluginConfigReferences: ConfigValuePluginConfigReference[];
  templateDeclarations: ConfigValueTemplateDeclaration[];
}

export interface ConfigValueReference {
  key: string;
  description?: string | null;
}

export interface ConfigValueScriptReference {
  scriptId: string;
  scriptName: string;
  scope?: string | null;
  repositoryId?: string | null;
  repositoryToolId?: string | null;
  repositoryVersion?: string | null;
}

export interface ConfigValueScheduleReference {
  scheduleId: string;
  scheduleName: string;
  scriptId: string;
  scriptName: string;
}

export interface ConfigValuePluginConfigReference {
  pluginId: string;
  pluginName: string;
  dependentScriptCount: number;
}

export interface ConfigValueTemplateDeclaration {
  repositoryId: string;
  repositoryName?: string | null;
  toolId: string;
  toolName: string;
  version?: string | null;
  label?: string | null;
  secret: boolean;
  publishMode: string;
  defaultValue?: string | null;
}

export interface ConfigValueImpactScript {
  scriptId: string;
  scriptName: string;
  scope?: string | null;
  repositoryId?: string | null;
  repositoryToolId?: string | null;
  repositoryVersion?: string | null;
  reasons: string[];
}

export interface ConfigValueOrigin {
  repositoryId?: string | null;
  repositoryName?: string | null;
  toolId?: string | null;
  toolName?: string | null;
  version?: string | null;
}

export interface ConfigValueAvailableActions {
  canCopyAsLocalOverride: boolean;
  canRestoreRepositoryDefault: boolean;
}

export interface ConfigValueRequest {
  key: string;
  value: string;
  description?: string;
  secret?: boolean;
  preserveValue?: boolean;
}

export interface AccessToken {
  id: string;
  name: string;
  tokenPreview: string;
  enabled: boolean;
  tokenValue?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

export interface AccessTokenRequest {
  name: string;
}

export interface RepositoryDefinition {
  id: string;
  name: string;
  type: RepositoryType;
  url: string;
  branch?: string;
  enabled: boolean;
  trustLevel: RepositoryTrustLevel;
  usage?: RepositoryUsage;
  description?: string;
  lastSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RepositoryToolDescriptor {
  repositoryId: string;
  toolId: string;
  installedScriptId: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string;
  owner?: string;
  tags: string[];
  type: ScriptType;
  sourcePath: string;
  inputSchemaPath?: string;
  outputSchemaPath?: string;
  configTemplatePath?: string;
  scheduleTemplatePath?: string;
  digest?: string;
  riskLevel?: string;
  pluginDependencies: PluginDependency[];
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  trusted: boolean;
  repositoryUsage?: RepositoryUsage;
  developmentScriptId?: string;
  developmentDirty?: boolean;
  developmentRemoteChanged?: boolean;
  developmentSyncState?: DevelopmentSyncState;
}

export interface RepositoryConfigTemplateItem {
  key: string;
  label?: string;
  type: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
}

export interface RepositoryScheduleTemplateItem {
  id: string;
  name: string;
  cronExpression: string;
  input: Record<string, unknown>;
  enabledByDefault: boolean;
}

export interface RepositoryToolDetail {
  descriptor: RepositoryToolDescriptor;
  source: string;
  configTemplate: RepositoryConfigTemplateItem[];
  scheduleTemplate: RepositoryScheduleTemplateItem[];
}

export interface RepositoryInstallRequest {
  installSchedules: boolean;
  installPluginDependencies?: boolean;
  forcePluginUpgrade?: boolean;
}

export interface RepositoryPluginDescriptor {
  repositoryId: string;
  pluginId: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string;
  owner?: string;
  tags: string[];
  artifact: PluginArtifactRef;
  riskLevel?: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  trusted: boolean;
  dependentToolCount: number;
}

export interface RepositoryPluginDetail {
  descriptor: RepositoryPluginDescriptor;
  plugin: Record<string, unknown>;
}

export interface RepositoryPluginInstallResult {
  plugin: PluginView;
  conflicts: RepositoryPluginConflict[];
}

export interface RepositoryPluginConflict {
  scriptId: string;
  scriptName?: string;
  requiredVersionRange?: string;
}

export interface RepositoryPluginInstallRequest {
  force: boolean;
}

export interface PluginArtifactRef {
  uri: string;
  sha256?: string;
  fileName?: string;
  size?: number;
}

export interface RepositoryPluginPublishRequest {
  pluginId: string;
  displayName: string;
  version: string;
  owner?: string;
  description?: string;
  releaseNotes?: string;
  tags?: string[];
  riskLevel?: string;
  artifact: PluginArtifactRef;
}

export interface RepositoryPublishConfigItem {
  key: string;
  publishMode: "INLINE" | "PLACEHOLDER";
}

export interface RepositoryPublishRequest {
  scriptId: string;
  toolId: string;
  displayName: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
  tags?: string[];
  scheduleIds?: string[];
  configItems?: RepositoryPublishConfigItem[];
  force?: boolean;
}

export interface DevelopmentStatus {
  scriptId: string;
  repositoryId: string;
  repositoryToolId: string;
  repositoryVersion?: string;
  localCommit?: string;
  remoteCommit?: string;
  baseDigest?: string;
  localDigest?: string;
  remoteDigest?: string;
  dirty: boolean;
  remoteChanged: boolean;
  syncState: DevelopmentSyncState;
  remoteVersion?: string;
  sourceSyncedAt?: string;
}

export interface ExecutionPreset {
  id: string;
  scriptId: string;
  name: string;
  input: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExecutionPresetUpsertRequest {
  name: string;
  input: Record<string, unknown>;
}
