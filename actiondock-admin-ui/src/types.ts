export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY" | "PYTHON";
export type ScriptPackaging = "TOOL" | "FLOW";
export type ScriptScope = "PERSONAL" | "REPOSITORY" | "FORK" | "DEVELOPMENT" | "SAMPLE";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";
export type ExecutionResponseView = "RESULT" | "DEBUG";
export type ExecutionTriggerSource = "MANUAL" | "SCHEDULED" | "AI_TOOL" | "EVENT";
export type ExecutionLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type AiCapability = "CHAT" | "STRUCTURED_OUTPUT" | "EMBEDDING" | "AGENT_RUN";
export type AiProvider = "AGENTSCOPE";
export type AiModelProvider = "DASHSCOPE" | "OPENAI" | "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
export type AiToolPermission = "READ_ONLY" | "PROPOSE_CHANGE" | "CONTROLLED_ACTION" | "DANGEROUS_ACTION";
export type AiToolSourceType = "SYSTEM" | "SCRIPT" | "AGENT";
export type AiRunStatus = "RUNNING" | "SUCCESS" | "FAILED" | "WAITING_APPROVAL" | "CANCELLED" | "INTERRUPTED";
export type AiCallerType = "SCRIPT" | "PLUGIN" | "ADMIN_TEST" | "AGENT";
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
  packaging: ScriptPackaging;
  source: string;
  pythonRequirements?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  scriptDependencies?: ScriptDependency[];
  aiDependencies?: AiDependency[];
}

export interface ScriptDefinition {
  id: string;
  name: string;
  type: ScriptType;
  packaging: ScriptPackaging;
  source: string;
  pythonRequirements?: string;
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
  scriptDependencies?: ScriptDependency[];
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

export interface ScriptDependency {
  scriptId: string;
  repositoryId: string;
  toolId: string;
  versionRange?: string;
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

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  status: ExecutionStatus;
  submitMode: SubmitMode;
  triggerSource: ExecutionTriggerSource;
  scheduleId?: string;
  agentRunId?: string;
  agentStepId?: string;
  eventSourceId?: string;
  eventTriggerId?: string;
  eventRecordId?: string;
  eventDispatchId?: string;
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
  details?: Record<string, unknown>;
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
  eventSourceId?: string;
  eventTriggerId?: string;
  eventRecordId?: string;
  eventDispatchId?: string;
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

export type ProcessorMode = "JSON_PATH" | "TEMPLATE" | "SCRIPT_REF" | "INLINE_CODE" | "PLUGIN_REF";
export type EventSourceTransportType = "HTTP_WEBHOOK";
export type EventSourceAuthMode = "NONE" | "HEADER_TOKEN" | "QUERY_TOKEN" | "HMAC_SHA256";
export type EventRecordStatus = "RECEIVED" | "AUTH_FAILED" | "NORMALIZED" | "IGNORED" | "DUPLICATE" | "DISPATCHED" | "FAILED";
export type EventDispatchStatus =
  | "FILTERED_OUT"
  | "DUPLICATE"
  | "MAPPING_FAILED"
  | "VALIDATION_FAILED"
  | "EXECUTION_CREATED"
  | "EXECUTION_FAILED";

export interface JsonPathProcessorConfig {
  fields: Record<string, string>;
}

export interface TemplateProcessorConfig {
  engine: "MUSTACHE";
  template: Record<string, unknown>;
}

export interface ScriptRefProcessorConfig {
  scriptId: string;
  versionMode: "PUBLISHED";
}

export interface ProcessorDefinition {
  mode: ProcessorMode;
  jsonPath?: JsonPathProcessorConfig;
  template?: TemplateProcessorConfig;
  scriptRef?: ScriptRefProcessorConfig;
  outputSchema?: Record<string, unknown>;
  description?: string;
}

export interface EventSourceTransport {
  type: EventSourceTransportType;
  endpointPath?: string;
  contentTypes?: string[];
}

export interface EventSourceAuthConfig {
  mode: EventSourceAuthMode;
  tokenHeader?: string;
  tokenQueryParam?: string;
  signatureHeader?: string;
  signaturePrefix?: string;
  signaturePayload?: "RAW_BODY" | "TIMESTAMP_DOT_RAW_BODY";
  timestampHeader?: string;
  maxSkewSeconds?: number;
  secretConfigKey?: string;
}

export interface NormalizedEvent {
  id?: string;
  sourceId?: string;
  sourceKey?: string;
  eventType?: string;
  eventId?: string;
  actor?: string;
  subject?: string;
  timestamp?: string;
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  receivedAt?: string;
}

export interface EventSourceDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  transport: EventSourceTransport;
  auth?: EventSourceAuthConfig;
  normalizationProcessor?: ProcessorDefinition;
  sampleContext?: Record<string, unknown>;
  lastReceivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventTrigger {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  sourceId: string;
  targetScriptId: string;
  filterProcessor?: ProcessorDefinition;
  idempotencyProcessor?: ProcessorDefinition;
  inputProcessor?: ProcessorDefinition;
  submitMode: SubmitMode;
  responseView?: ExecutionResponseView;
  lastEventId?: string;
  lastTriggeredAt?: string;
  lastExecutionId?: string;
  lastExecutionStatus?: ExecutionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventRecord {
  id: string;
  sourceId: string;
  sourceKey: string;
  status: EventRecordStatus;
  eventType?: string;
  eventId?: string;
  actor?: string;
  subject?: string;
  rawHeaders: Record<string, unknown>;
  rawQuery: Record<string, unknown>;
  rawBody: Record<string, unknown>;
  normalizedEvent?: NormalizedEvent;
  errorMessage?: string;
  createdAt?: string;
}

export interface EventDispatchRecord {
  id: string;
  eventId: string;
  sourceId: string;
  triggerId: string;
  targetScriptId: string;
  status: EventDispatchStatus;
  filterMatched?: boolean;
  idempotencyKey?: string;
  mappedInput?: Record<string, unknown>;
  executionId?: string;
  executionStatus?: ExecutionStatus;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IncomingEventPayload {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  rawBody?: string;
  contentType?: string;
}

export interface ProcessorTestRequest {
  processor: ProcessorDefinition;
  context: {
    event?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    source?: Record<string, unknown>;
    trigger?: Record<string, unknown>;
    variables?: Record<string, unknown>;
  };
  expectedOutputSchema?: Record<string, unknown>;
}

export interface ProcessorTestResult {
  success: boolean;
  output?: Record<string, unknown>;
  errorMessage?: string;
  logs?: ExecutionLogEntry[];
  durationMs?: number;
  schemaValid?: boolean;
  fieldErrors?: ValidationFieldError[];
}

export interface EventTriggerTestRequest {
  event: NormalizedEvent;
  execute?: boolean;
}

export interface EventTriggerTestResult {
  event: NormalizedEvent;
  filterMatched: boolean;
  filterResult?: ProcessorTestResult;
  idempotencyResult?: ProcessorTestResult;
  idempotencyKey?: string;
  inputResult?: ProcessorTestResult;
  mappedInput?: Record<string, unknown>;
  schemaValid: boolean;
  fieldErrors?: ValidationFieldError[];
  execution?: ExecutionRecord;
}

export interface EventIngestionResponse {
  event: EventRecord;
  dispatches: EventDispatchRecord[];
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

export interface SharedStateSummary {
  namespace: string;
  key: string;
  secret: boolean;
  version?: number;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastWriterScriptId?: string | null;
  lastWriterExecutionId?: string | null;
}

export interface SharedStateDetail extends SharedStateSummary {
  value?: unknown;
}

export interface SharedStateRequest {
  namespace: string;
  key: string;
  value: unknown;
  secret?: boolean;
  expiresAt?: string | null;
}

export interface SharedStateCompareAndSetRequest extends SharedStateRequest {
  expectedVersion: number;
}

export interface SharedStateCompareAndSetResult {
  updated: boolean;
  entry?: SharedStateDetail | null;
  current?: SharedStateDetail | null;
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
  packaging: ScriptPackaging;
  sourcePath: string;
  pythonRequirementsPath?: string;
  inputSchemaPath?: string;
  outputSchemaPath?: string;
  configTemplatePath?: string;
  scheduleTemplatePath?: string;
  digest?: string;
  riskLevel?: string;
  scriptDependencies: ScriptDependency[];
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
  scriptId: string;
  name: string;
  cronExpression: string;
  input: Record<string, unknown>;
  enabledByDefault: boolean;
}

export interface RepositoryToolDetail {
  descriptor: RepositoryToolDescriptor;
  source: string;
  pythonRequirements?: string;
  configTemplate: RepositoryConfigTemplateItem[];
  scheduleTemplate: RepositoryScheduleTemplateItem[];
}

export interface RepositoryAiPackageDependency {
  assetType: "AI_PACKAGE" | "TOOL" | string;
  repositoryId: string;
  assetId: string;
  version: string;
}

export interface RepositoryAiPackageModelFile {
  id: string;
  name: string;
  provider?: AiProvider;
  modelProvider?: AiModelProvider;
  modelName: string;
  baseUrl?: string;
  apiKeyConfigKey?: string;
  defaultOptions: Record<string, unknown>;
  limits: Record<string, unknown>;
  capabilities: AiCapability[];
  enabled: boolean;
}

export interface RepositoryAiPackageToolsetFile {
  id: string;
  name: string;
  description?: string;
  toolNames: string[];
  toolOptions?: Record<string, Record<string, unknown>>;
  maxPermission?: AiToolPermission;
  enabled: boolean;
}

export interface RepositoryAiPackageAgentFile {
  id: string;
  name: string;
  description?: string;
  provider?: AiProvider;
  modelProfileId: string;
  systemPrompt?: string;
  toolsetIds: string[];
  directToolNames: string[];
  directToolOptions: Record<string, Record<string, unknown>>;
  options: Record<string, unknown>;
  enabled: boolean;
}

export interface RepositoryAiPackageScriptFile {
  id: string;
  name: string;
  type: ScriptType;
  packaging: ScriptPackaging;
  description?: string;
  tags: string[];
  source: string;
  pythonRequirements?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  pluginDependencies: PluginDependency[];
  aiDependencies: AiDependency[];
}


export type CapabilityPackageSource = "AGENT" | "SCRIPT" | "MANUAL";
export type CapabilityPackageEntryType = "AGENT" | "SCRIPT";
export type CapabilityPackageCheckSeverity = "BLOCKER" | "WARNING" | "INFO";

export interface CapabilityPackageEntryFile {
  type: CapabilityPackageEntryType;
  id: string;
  displayName: string;
  target: string;
}

export interface CapabilityPackagePresetTemplate {
  id: string;
  scriptId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CapabilityPackageDescriptor {
  repositoryId: string;
  packageId: string;
  installationId: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string;
  owner?: string;
  tags: string[];
  riskLevel?: string;
  entries: CapabilityPackageEntryFile[];
  manifestPath: string;
  releasePath: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  trusted: boolean;
  repositoryUsage?: RepositoryUsage;
}

export interface CapabilityPackageReleaseFile {
  schemaVersion: number;
  packageId: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string;
  owner?: string;
  tags: string[];
  riskLevel?: string;
  sourceType: CapabilityPackageSource;
  entries: CapabilityPackageEntryFile[];
  models: RepositoryAiPackageModelFile[];
  toolsets: RepositoryAiPackageToolsetFile[];
  agents: RepositoryAiPackageAgentFile[];
  scripts: RepositoryAiPackageScriptFile[];
  externalDependencies: RepositoryAiPackageDependency[];
  configTemplatePath?: string;
  scheduleTemplatePath?: string;
  presetTemplatePath?: string;
}

export interface CapabilityPackageDetail {
  descriptor: CapabilityPackageDescriptor;
  configTemplate: RepositoryConfigTemplateItem[];
  scheduleTemplate: RepositoryScheduleTemplateItem[];
  presetTemplate: CapabilityPackagePresetTemplate[];
  releaseFile: CapabilityPackageReleaseFile;
}

export interface CapabilityPackageEntrySelection {
  type: CapabilityPackageEntryType;
  targetId: string;
  displayName?: string;
}

export interface CapabilityPackagePublishPreviewRequest {
  packageId: string;
  displayName?: string;
  version: string;
  owner?: string;
  description?: string;
  releaseNotes?: string;
  tags?: string[];
  riskLevel?: string;
  source: CapabilityPackageSource;
  primaryEntry: CapabilityPackageEntrySelection;
  scriptIds?: string[];
  agentIds?: string[];
  modelIds?: string[];
  toolsetIds?: string[];
}

export interface CapabilityPackagePublishRequest extends CapabilityPackagePublishPreviewRequest {}

export interface CapabilityPackageCheck {
  severity: CapabilityPackageCheckSeverity;
  code: string;
  message: string;
}

export interface CapabilityPackageDiffSummary {
  comparisonMode: "INITIAL" | "COMPARE";
  addedEntries: string[];
  removedEntries: string[];
  changedAssets: string[];
}

export interface CapabilityPackagePublishPreview {
  packageId: string;
  version: string;
  entries: CapabilityPackageEntryFile[];
  modelIds: string[];
  toolsetIds: string[];
  agentIds: string[];
  scriptIds: string[];
  configTemplate: RepositoryConfigTemplateItem[];
  scheduleTemplate: RepositoryScheduleTemplateItem[];
  presetTemplate: CapabilityPackagePresetTemplate[];
  externalDependencies: RepositoryAiPackageDependency[];
  checks: CapabilityPackageCheck[];
  diff: CapabilityPackageDiffSummary;
}

export interface CapabilityPackageInstallResult {
  installation: {
    installationId: string;
    repositoryId: string;
    packageId: string;
    name: string;
    version: string;
    latestVersion?: string;
    entryAgentId?: string;
    owner?: string;
    description?: string;
    modelIds: string[];
    toolsetIds: string[];
    agentIds: string[];
    scriptIds: string[];
    scheduleIds: string[];
    presetIds: string[];
    installedAt?: string;
    updatedAt?: string;
  };
  resolvedDependencies: RepositoryAiPackageDependency[];
}

export interface RepositoryInstallRequest {
  installSchedules: boolean;
  installScriptDependencies?: boolean;
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

export interface RepositorySkillDescriptor {
  repositoryId: string;
  skillId: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string | null;
  owner?: string;
  tags: string[];
  manifestPath: string;
  entrypointPath: string;
  digest?: string;
  riskLevel?: string;
  trusted: boolean;
  repositoryUsage?: RepositoryUsage;
}

export interface RepositorySkillDetail {
  descriptor: RepositorySkillDescriptor;
  content: string;
}

export interface SkillDeployment {
  targetId: string;
  targetPath: string;
  installedPath: string;
  enabled: boolean;
  installedAt?: string;
  updatedAt?: string;
}

export interface Skill {
  skillId: string;
  repositoryId?: string;
  version: string;
  digest: string;
  displayName?: string;
  description?: string;
  enabledTargetCount: number;
  disabledTargetCount: number;
  targets: SkillDeployment[];
  installedAt?: string;
  updatedAt?: string;
}

export interface SkillSyncResult {
  skillId: string;
  targetId: string;
  status: "SUCCESS" | "SKIPPED" | "FAILED" | string;
  message: string;
  createdDeployment?: SkillDeployment;
}

export interface SkillSyncResponse {
  targetId: string;
  results: SkillSyncResult[];
}

export interface GithubSkillScanItem {
  skillId: string;
  displayName: string;
  version?: string;
  description?: string;
  path: string;
  digest?: string;
  warnings: string[];
}

export interface GithubSkillScanResponse {
  sourceUrl: string;
  owner: string;
  repo: string;
  ref: string;
  rootPath: string;
  skills: GithubSkillScanItem[];
}

export interface GithubSkillInstallResult {
  path: string;
  skillId?: string;
  status: "SUCCESS" | "SKIPPED" | "FAILED" | string;
  message: string;
  skill?: Skill;
}

export interface GithubSkillInstallResponse {
  sourceUrl: string;
  owner: string;
  repo: string;
  ref: string;
  rootPath: string;
  results: GithubSkillInstallResult[];
}

export interface SkillDetail {
  skill: Skill;
  managedPath: string;
  files: SkillFileNode[];
}

export interface SkillFileNode {
  name: string;
  path: string;
  directory: boolean;
  size?: number;
  children: SkillFileNode[];
}

export type SkillFilePreviewType = "TEXT" | "MARKDOWN" | "IMAGE" | "DIRECTORY" | "UNSUPPORTED";

export interface SkillFilePreview {
  path: string;
  name: string;
  directory: boolean;
  contentType: string;
  size: number;
  previewType: SkillFilePreviewType;
  language?: string;
  textContent?: string;
  dataUrl?: string;
  truncated: boolean;
}

export interface SkillTarget {
  id: string;
  name: string;
  type: "CODEX" | "CLAUDE" | "GEMINI" | "CODEBUDDY" | "CUSTOM" | "ACTIONDOCK_AGENT" | string;
  rootPath: string;
  enabled: boolean;
  writable: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillScanItem {
  id: string;
  path: string;
  name?: string;
  description?: string;
  managed: boolean;
  skillId?: string;
  enabled?: boolean;
  version?: string;
}

export interface SkillScanDetail {
  id: string;
  path: string;
  name?: string;
  description?: string;
  managed: boolean;
  skillId?: string;
  enabled?: boolean;
  version?: string;
  files: SkillFileNode[];
}

export interface SkillValidationResult {
  skillId: string;
  displayName: string;
  version: string;
  description: string;
  owner?: string;
  tags: string[];
  riskLevel?: string;
  entrypointPath: string;
  digest: string;
  warnings: string[];
  manifestPresent?: boolean;
}

export interface SkillPackageResult {
  validation: SkillValidationResult;
  directory: string;
}

export interface SkillArchiveEntry {
  path: string;
  directory: boolean;
  size?: number;
  contentType?: string;
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

export interface RepositoryPublishConfigPreviewRequest {
  scriptId: string;
  source: string;
  scheduleIds?: string[];
}

export interface RepositoryPublishConfigCandidate {
  key: string;
  label?: string;
  secret: boolean;
}

export interface RepositoryPublishConfigPreview {
  items: RepositoryPublishConfigCandidate[];
  missingKeys: string[];
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
  scriptDependencies?: ScriptDependency[];
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
  managed?: boolean;
  editable?: boolean;
  repositoryId?: string;
  repositoryPackageId?: string;
  repositoryVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExecutionPresetUpsertRequest {
  name: string;
  input: Record<string, unknown>;
}
