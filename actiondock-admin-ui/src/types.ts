export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY" | "PYTHON";
export type ScriptScope = "PERSONAL" | "REPOSITORY" | "FORK" | "DEVELOPMENT" | "SAMPLE";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";
export type ExecutionResponseView = "RESULT" | "DEBUG";
export type ExecutionTriggerSource = "MANUAL" | "SCHEDULED" | "AI_TOOL";
export type ExecutionLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type AiCapability = "CHAT" | "STRUCTURED_OUTPUT" | "EMBEDDING" | "AGENT_RUN";
export type AiProvider = "AGENTSCOPE";
export type AiModelProvider = "DASHSCOPE" | "OPENAI" | "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
export type AiToolPermission = "READ_ONLY" | "PROPOSE_CHANGE" | "CONTROLLED_ACTION" | "DANGEROUS_ACTION";
export type AiToolSourceType = "SYSTEM" | "SCRIPT" | "AGENT";
export type AiRunStatus = "RUNNING" | "SUCCESS" | "FAILED" | "WAITING_APPROVAL" | "CANCELLED" | "INTERRUPTED";
export type AiCallerType = "SCRIPT" | "PLUGIN" | "WORKBENCH" | "ADMIN_TEST" | "AGENT";
export type AiStepType = "MODEL_REASONING" | "TOOL_CALL" | "TOOL_RESULT" | "APPROVAL" | "INTERRUPT";
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
  aiDependencies?: AiDependency[];
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
  aiDependencies?: AiDependency[];
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

export interface AiDependency {
  capability: AiCapability;
  profile?: string;
  agentProfile?: string;
  required: boolean;
}

export interface AiMessage {
  role: string;
  content: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiModelProfile {
  id: string;
  name: string;
  provider: AiProvider;
  modelProvider: AiModelProvider;
  modelName: string;
  baseUrl?: string;
  apiKeyConfigKey?: string;
  defaultOptions: Record<string, unknown>;
  limits: Record<string, unknown>;
  capabilities: AiCapability[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiAgentProfile {
  id: string;
  name: string;
  description?: string;
  provider: AiProvider;
  modelProfileId: string;
  systemPrompt?: string;
  toolsetIds: string[];
  directToolNames: string[];
  directToolOptions: Record<string, Record<string, unknown>>;
  options: Record<string, unknown>;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiToolset {
  id: string;
  name: string;
  description?: string;
  toolNames: string[];
  toolOptions?: Record<string, Record<string, unknown>>;
  maxPermission: AiToolPermission;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiTool {
  name: string;
  displayName: string;
  sourceType: AiToolSourceType;
  sourceId: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permission: AiToolPermission;
  configurable?: boolean;
  configHelp?: string;
  configExample?: Record<string, unknown>;
}

export interface AiToolExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  errorMessage?: string;
  latencyMs?: number;
}

export interface AiChatRequest {
  modelProfile: string;
  messages: AiMessage[];
  options?: Record<string, unknown>;
}

export interface AiChatResponse {
  data: string;
  usage?: AiUsage;
  raw?: Record<string, unknown>;
}

export interface AiAgentRunRequest {
  agentProfile: string;
  messages: AiMessage[];
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface AiAgentRunResult {
  runId: string;
  status: AiRunStatus;
  data: Record<string, unknown>;
  steps: AiAgentStep[];
  usage?: AiUsage;
  errorMessage?: string;
}

export interface AiAgentRunSubmission {
  runId: string;
  status: AiRunStatus;
  agentProfile: string;
  startedAt?: string;
}

export interface AiAgentStep {
  id: string;
  runId: string;
  stepIndex: number;
  stepType: AiStepType;
  modelProfile?: string;
  toolName?: string;
  toolPermission?: AiToolPermission;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  status?: string;
  latencyMs?: number;
  errorMessage?: string;
  createdAt?: string;
}

export interface AiAgentRunRecord {
  id: string;
  agentProfile: string;
  status: AiRunStatus;
  callerType?: AiCallerType;
  scriptId?: string;
  executionId?: string;
  userId?: string;
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  totalModelCalls?: number;
  totalToolCalls?: number;
  totalTokens?: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface AiAgentRunSnapshot extends AiAgentRunRecord {
  steps: AiAgentStep[];
}

export type AiWorkbenchTaskType =
  | "GENERATE_SCRIPT"
  | "IMPROVE_SCRIPT"
  | "IMPROVE_SCHEMA"
  | "DIAGNOSE_EXECUTION"
  | "REVIEW_BEFORE_PUBLISH"
  | "GENERATE_RELEASE_NOTES";

export interface AiWorkbenchCommand {
  objective?: string;
  instructions?: string;
  agentProfile?: string;
  scriptId?: string;
  executionId?: string;
  context?: Record<string, unknown>;
}

export interface AiWorkbenchResult {
  taskType: AiWorkbenchTaskType;
  status: AiRunStatus;
  result: Record<string, unknown>;
  agentRunId?: string;
  steps: AiAgentStep[];
  rawOutput: Record<string, unknown>;
  errorMessage?: string;
}

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  status: ExecutionStatus;
  submitMode: SubmitMode;
  triggerSource: ExecutionTriggerSource;
  scheduleId?: string;
  agentRunId?: string;
  agentStepId?: string;
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
  agentRunId?: string;
  agentStepId?: string;
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

export type PluginReferenceSourceType = "INSTALLED" | "SYSTEM";

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
  fileName?: string;
  actions: PluginAction[];
}

export interface PluginReferenceView {
  pluginId: string;
  name: string;
  description: string;
  version?: string;
  sourceType: PluginReferenceSourceType;
  started: boolean;
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
  modelReferences: ConfigValueModelReference[];
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

export interface ConfigValueModelReference {
  modelId: string;
  modelName: string;
  modelProvider?: string | null;
  referenceType: string;
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
  aiDependencies?: AiDependency[];
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
