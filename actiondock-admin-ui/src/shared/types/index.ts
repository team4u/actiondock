export type ScriptType = "GROOVY" | "PYTHON";
export type ScriptPackaging = "TOOL" | "FLOW";
export type ScriptScope = "PERSONAL" | "REPOSITORY" | "SAMPLE";
export type WebhookScope = "PERSONAL" | "REPOSITORY";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";
export type ExecutionResponseView = "RESULT" | "DEBUG";
export type ExecutionTriggerSource = "MANUAL" | "SCHEDULED" | "AI_TOOL" | "EVENT" | "WEBHOOK";
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
export type RepositoryPurpose = "CAPABILITY" | "PROJECT";
export type UpstreamSyncState = "SYNCED" | "LOCAL_CHANGES" | "REMOTE_CHANGES" | "DIVERGED";

export interface ForkFormValues {
  id: string;
  name: string;
}

export interface PublishedScriptRevision {
  scriptId: string;
  revisionId: string;
  version: number;
  publishedAt?: string;
  name: string;
  type: ScriptType;
  packaging: ScriptPackaging;
  source: string;
  pythonRequirements?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  owner?: string;
  description?: string;
  tags?: string[];
  scriptDependencies?: ScriptDependency[];
  pluginDependencies?: PluginDependency[];
  aiDependencies?: AiDependency[];
}

export interface ScriptPublicationState {
  published: boolean;
  dirty: boolean;
  publishedVersion?: number;
  publishedAt?: string;
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
  version: number;
  scope?: ScriptScope;
  repositoryId?: string;
  repositoryScriptId?: string;
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
  published?: PublishedScriptRevision | null;
  publication?: ScriptPublicationState;
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
  repositoryScriptId: string;
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
  skillIds: string[];
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
  webhookId?: string;
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
  type?: string;
  stackTrace?: string;
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
  webhookId?: string;
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
  draft?: boolean;
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
  repositoryScriptId?: string;
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

export type WebhookTransportType = "HTTP_WEBHOOK";

export interface WebhookTransport {
  type: WebhookTransportType;
  endpointPath?: string;
  contentTypes?: string[];
}

export interface WebhookSampleRequest {
  method: string;
  headers: Record<string, string[]>;
  query: Record<string, string[]>;
  rawBody?: string;
  contentType?: string;
}

export interface WebhookRequest extends WebhookSampleRequest {
  path?: string;
}

export interface WebhookResponsePayload {
  status: number;
  headers: Record<string, string[]>;
  body?: unknown;
}

export interface WebhookDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  scope?: WebhookScope;
  repositoryId?: string;
  repositoryWebhookId?: string;
  repositoryVersion?: string;
  sourcePath?: string;
  sourceCommit?: string;
  sourceDigest?: string;
  sourceSyncedAt?: string;
  dirty?: boolean;
  editable?: boolean;
  enabled: boolean;
  transport: WebhookTransport;
  webhookScriptId: string;
  sampleRequest?: WebhookSampleRequest;
  lastReceivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookTestResult {
  request: Record<string, unknown>;
  execution: ExecutionRecord;
  webhookResponse: WebhookResponsePayload;
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

export interface ApiErrorData {
  code: string;
  [key: string]: unknown;
}

export function isErrorDetail(value: unknown): value is ErrorDetail {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (typeof (value as ErrorDetail).type === "string" ||
      typeof (value as ErrorDetail).stackTrace === "string")
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
  sourceType: PluginReferenceSourceType;
  started: boolean;
  configurable: boolean;
  fileName?: string;
  actions: PluginAction[];
}

export interface PluginSummaryView {
  pluginId: string;
  name: string;
  description: string;
  version: string;
  repositoryId?: string;
  repositoryPluginId?: string;
  repositoryVersion?: string;
  state: string;
  sourceType: PluginReferenceSourceType;
  started: boolean;
  configurable: boolean;
  fileName?: string;
  actionCount: number;
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
  repositoryScriptId?: string;
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
  repositoryScriptId?: string | null;
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
  repositoryScriptId: string;
  scriptName: string;
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
  repositoryScriptId?: string | null;
  repositoryVersion?: string | null;
  reasons: string[];
}

export interface ConfigValueOrigin {
  repositoryId?: string | null;
  repositoryName?: string | null;
  repositoryScriptId?: string | null;
  scriptName?: string | null;
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
  purpose?: RepositoryPurpose;
  url: string;
  branch?: string;
  enabled: boolean;
  trustLevel: RepositoryTrustLevel;
  description?: string;
  lastSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectRepositoryResolution {
  repositoryId: string;
  type: RepositoryType;
  purpose: RepositoryPurpose;
  root: string;
  entryPath: string;
  enabled: boolean;
  exists: boolean;
  content: string;
}

export interface RepositoryScriptDescriptor {
  repositoryId: string;
  scriptId: string;
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
  trusted: boolean;
  localState?: RepositoryLocalAssetState;
}

export interface RepositoryLocalAssetState {
  mode: "LOCKED" | "TRACKED";
  localAssetId: string;
  version?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  syncState?: UpstreamSyncState;
  dirty?: boolean;
  remoteChanged?: boolean;
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

export interface RepositoryScriptDetail {
  descriptor: RepositoryScriptDescriptor;
  source: string;
  pythonRequirements?: string;
  configTemplate: RepositoryConfigTemplateItem[];
  scheduleTemplate: RepositoryScheduleTemplateItem[];
}

export interface RepositoryWebhookDescriptor {
  repositoryId: string;
  webhookId: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string;
  owner?: string;
  tags: string[];
  webhookPath: string;
  configTemplatePath?: string;
  digest?: string;
  scriptDependencies: ScriptDependency[];
  trusted: boolean;
  localState?: RepositoryLocalAssetState;
}

export interface RepositoryWebhookDetail {
  descriptor: RepositoryWebhookDescriptor;
  webhook: {
    schemaVersion: number;
    webhookId: string;
    displayName: string;
    version: string;
    description?: string;
    releaseNotes?: string;
    owner?: string;
    tags: string[];
    digest?: string;
    transport: WebhookTransport;
    webhookScriptId?: string;
    sampleRequest?: WebhookSampleRequest;
    scriptDependencies: ScriptDependency[];
    configTemplatePath?: string;
  };
  configTemplate: RepositoryConfigTemplateItem[];
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
  skillIds: string[];
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

export interface RepositoryLocalAssetRequest extends RepositoryInstallRequest {
  mode: "LOCKED" | "TRACKED";
  localAssetId?: string;
}

export interface RepositoryLocalAsset {
  id: string;
  assetType: "SCRIPT" | "WEBHOOK";
  localAssetId: string;
  repositoryId: string;
  upstreamAssetId: string;
  mode: "LOCKED" | "TRACKED";
  version?: string;
  latestVersion?: string;
  name?: string;
  owner?: string;
  description?: string;
  sourcePath?: string;
  baseCommit?: string;
  baseDigest?: string;
  lastSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ResourceLifecycleResourceType = "REPOSITORY_SCRIPT" | "REPOSITORY_WEBHOOK" | "REPOSITORY_PLUGIN" | "CAPABILITY_PACKAGE";
export type ResourceLifecycleOperation = "install" | "update" | "add-local" | "update-local" | "publish" | "preview" | "uninstall";

export interface ResourceLifecycleRequest<TPayload = Record<string, unknown>> {
  resourceType: ResourceLifecycleResourceType;
  operation: ResourceLifecycleOperation;
  repositoryId?: string;
  resourceId?: string;
  installedResourceId?: string;
  payload?: TPayload;
}

export interface ResourceLifecycleOperationView<TResult = unknown> {
  resourceType: ResourceLifecycleResourceType;
  operation: ResourceLifecycleOperation;
  repositoryId?: string;
  resourceId?: string;
  status: "COMPLETED" | string;
  result: TResult;
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
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  trusted: boolean;
}

export interface RepositorySkillDetail {
  descriptor: RepositorySkillDescriptor;
  content: string;
}

export interface KnowledgeSource {
  type: string;
  url: string;
  branch?: string;
  entryPath?: string;
}

export interface RepositoryKnowledgeDescriptor {
  repositoryId: string;
  knowledgeId: string;
  displayName: string;
  description?: string;
  tags: string[];
  knowledgePath: string;
  source: KnowledgeSource;
  installed: boolean;
  installedRepositoryId?: string;
  trusted: boolean;
}

export interface KnowledgeFile {
  schemaVersion: number;
  knowledgeId: string;
  displayName: string;
  description?: string;
  source: KnowledgeSource;
  tags: string[];
}

export interface RepositoryKnowledgeDetail {
  descriptor: RepositoryKnowledgeDescriptor;
  knowledge: KnowledgeFile;
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

export interface RepositoryWebhookPublishPreviewRequest {
  sourceId: string;
  repositoryId?: string;
  scriptDependencies?: ScriptDependency[];
}

export interface RepositoryWebhookPublishDependencyDraft {
  scriptId: string;
  repositoryId?: string;
  repositoryScriptId?: string;
  versionRange?: string;
  state: "AUTO" | "MANUAL" | "UNRESOLVED" | string;
}

export interface RepositoryWebhookPublishPreview {
  items: RepositoryPublishConfigCandidate[];
  missingKeys: string[];
  scriptDependencies: ScriptDependency[];
  dependencyDrafts: RepositoryWebhookPublishDependencyDraft[];
}

export interface RepositoryWebhookPublishRequest {
  sourceId: string;
  webhookId: string;
  displayName: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
  tags?: string[];
  configItems?: RepositoryPublishConfigItem[];
  scriptDependencies?: ScriptDependency[];
  publishScriptDependencies?: boolean;
  force?: boolean;
}

export interface RepositoryPublishRequest {
  scriptId: string;
  repositoryScriptId: string;
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

export interface UpstreamStatus {
  localAssetId: string;
  repositoryId: string;
  upstreamAssetId: string;
  upstreamVersion?: string;
  localCommit?: string;
  remoteCommit?: string;
  baseDigest?: string;
  localDigest?: string;
  remoteDigest?: string;
  dirty: boolean;
  remoteChanged: boolean;
  syncState: UpstreamSyncState;
  remoteVersion?: string;
  lastSyncedAt?: string;
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
