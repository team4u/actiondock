export interface ApiEnvelope<T> {
  status: number;
  msg: string;
  data: T;
}

export interface HealthView {
  ok: boolean;
  server: string;
  status?: string;
  details?: unknown;
}

export interface ScriptDefinition {
  id: string;
  name?: string;
  type?: string;
  packaging?: string;
  scope?: string;
  version?: number;
  description?: string;
  owner?: string;
  tags?: string[];
  source?: string;
  pythonRequirements?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  published?: PublishedScriptRevision | null;
  publication?: ScriptPublicationState;
}

export interface PublishedScriptRevision {
  scriptId: string;
  revisionId: string;
  version: number;
  publishedAt?: string;
  name?: string;
  type?: string;
  packaging?: string;
  source?: string;
  pythonRequirements?: string;
  owner?: string;
  description?: string;
  tags?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scriptDependencies?: unknown[];
  pluginDependencies?: unknown[];
  aiDependencies?: unknown[];
}

export interface ScriptPublicationState {
  published: boolean;
  dirty: boolean;
  publishedVersion?: number;
  publishedAt?: string;
}

export interface ExecutionResponse {
  id?: string;
  scriptId?: string;
  status?: string;
  submitMode?: string;
  triggerSource?: string;
  scheduleId?: string;
  agentRunId?: string;
  agentStepId?: string;
  webhookId?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorMessage?: string;
  errorDetail?: unknown;
  logs?: unknown[];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  debug?: {
    input?: unknown;
    rawOutput?: unknown;
  };
}

export interface ScriptScheduleView {
  id: string;
  scriptId: string;
  name?: string;
  cronExpression?: string;
  input?: Record<string, unknown>;
  enabled?: boolean;
  nextRunAt?: string | null;
  lastTriggeredAt?: string | null;
  lastExecutionId?: string | null;
  lastExecutionStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ScriptScheduleUpsertRequest {
  scriptId: string;
  name: string;
  cronExpression: string;
  input: Record<string, unknown>;
  enabled: boolean;
}

export interface ExecutionPresetView {
  id: string;
  scriptId: string;
  name: string;
  input: Record<string, unknown>;
  managed?: boolean;
  editable?: boolean;
  repositoryId?: string | null;
  repositoryPackageId?: string | null;
  repositoryVersion?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ExecutionPresetUpsertRequest {
  name: string;
  input: Record<string, unknown>;
}

export type PlaybookRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type PlaybookPhase = "ROUTE" | "BOUND" | "EQUIP" | "INVESTIGATE" | "ACT" | "HANDOFF";

export interface PlaybookKnowledgeRef {
  type: "NOTE" | "FILE";
  repositoryId: string;
  path?: string;
  markdown?: string;
}

export interface PlaybookScriptRef {
  scriptId: string;
  purpose?: string | null;
}

export interface PlaybookAgentSkillRef {
  skillId: string;
  purpose?: string | null;
  required?: boolean;
}

export type PlaybookRelatedRefRelation = "RELATED" | "FOLLOW_UP" | "FALLBACK";

export interface PlaybookRelatedRef {
  playbookId: string;
  relation?: PlaybookRelatedRefRelation | null;
  purpose?: string | null;
}

export interface Playbook {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  riskLevel?: PlaybookRiskLevel | null;
  repositoryIds?: string[];
  knowledgeRefs?: PlaybookKnowledgeRef[];
  scriptRefs?: PlaybookScriptRef[];
  agentSkillRefs?: PlaybookAgentSkillRef[];
  relatedPlaybookRefs?: PlaybookRelatedRef[];
  guideMarkdown: string;
  stopConditions?: string[];
  enabled?: boolean;
  managed?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PlaybookListItemSummary {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  riskLevel?: PlaybookRiskLevel | null;
  repositoryIds?: string[];
  enabled?: boolean;
  managed?: boolean;
}

export interface WebhookTransport {
  type?: string;
  endpointPath?: string;
  contentTypes?: string[];
}

export interface WebhookSampleRequest {
  method?: string;
  headers?: Record<string, string[]>;
  query?: Record<string, string[]>;
  rawBody?: string;
  contentType?: string;
}

export interface WebhookRequest extends WebhookSampleRequest {
  path?: string;
}

export interface WebhookResponsePayload {
  status: number;
  headers?: Record<string, string[]>;
  body?: unknown;
}

export interface WebhookExecutionResult {
  request?: Record<string, unknown>;
  execution?: ExecutionResponse;
  webhookResponse?: WebhookResponsePayload;
}

export interface WebhookInvokeResult {
  status: number;
  headers: Record<string, string[]>;
  body?: unknown;
}

export interface WebhookDefinition {
  id: string;
  key?: string;
  name?: string;
  description?: string;
  scope?: string;
  repositoryId?: string;
  repositoryWebhookId?: string;
  repositoryVersion?: string;
  sourcePath?: string;
  sourceCommit?: string;
  sourceDigest?: string;
  sourceSyncedAt?: string;
  dirty?: boolean;
  editable?: boolean;
  enabled?: boolean;
  transport?: WebhookTransport;
  webhookScriptId?: string;
  sampleRequest?: WebhookSampleRequest;
  lastReceivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScriptDependency {
  scriptId: string;
  repositoryId: string;
  repositoryScriptId: string;
  versionRange?: string;
}

export interface RepositoryDefinition {
  id: string;
  name: string;
  type: string;
  purpose?: string;
  url: string;
  branch?: string;
  enabled: boolean;
  trustLevel: string;
  description?: string;
  lastSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectRepositoryResolution {
  repositoryId: string;
  type: string;
  purpose: string;
  root: string;
  entryPath: string;
  enabled: boolean;
  exists: boolean;
  content: string;
}

export interface RepositoryInstallRequest {
  installSchedules: boolean;
  installScriptDependencies?: boolean;
  installPluginDependencies?: boolean;
  forcePluginUpgrade?: boolean;
}

export interface RepositoryScriptDescriptor {
  repositoryId: string;
  scriptId: string;
  installedScriptId?: string;
  displayName: string;
  version: string;
  description?: string;
  releaseNotes?: string;
  owner?: string;
  tags: string[];
  type?: string;
  packaging?: string;
  sourcePath?: string;
  pythonRequirementsPath?: string;
  inputSchemaPath?: string;
  outputSchemaPath?: string;
  configTemplatePath?: string;
  scheduleTemplatePath?: string;
  digest?: string;
  riskLevel?: string;
  scriptDependencies: ScriptDependency[];
  pluginDependencies?: unknown[];
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  trusted: boolean;
  workingCopyId?: string;
  upstreamDirty?: boolean;
  upstreamRemoteChanged?: boolean;
  upstreamSyncState?: string;
}

export interface RepositoryScriptDetail {
  descriptor: RepositoryScriptDescriptor;
  source?: string;
  pythonRequirements?: string;
  configTemplate: RepositoryConfigTemplateItem[];
  scheduleTemplate: unknown[];
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
  syncState: string;
  remoteVersion?: string;
  lastSyncedAt?: string;
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

export interface RepositoryLocalAssetState {
  mode: "LOCKED" | "TRACKED";
  localAssetId: string;
  version?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  syncState?: string;
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
    transport?: WebhookTransport;
    webhookScriptId?: string;
    sampleRequest?: WebhookSampleRequest;
    scriptDependencies: ScriptDependency[];
    configTemplatePath?: string;
  };
  configTemplate: RepositoryConfigTemplateItem[];
}

export interface RepositoryPublishConfigItem {
  key: string;
  publishMode: "INLINE" | "PLACEHOLDER";
}

export interface RepositoryWebhookPublishDependencyDraft {
  scriptId: string;
  repositoryId?: string;
  repositoryScriptId?: string;
  versionRange?: string;
  state: string;
}

export interface RepositoryWebhookPublishPreview {
  items: RepositoryPublishConfigItem[];
  missingKeys: string[];
  scriptDependencies: ScriptDependency[];
  dependencyDrafts: RepositoryWebhookPublishDependencyDraft[];
}

export interface RepositoryWebhookPublishPreviewRequest {
  sourceId: string;
  repositoryId?: string;
  scriptDependencies?: ScriptDependency[];
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

export interface ResourceLifecycleOperationView<TResult = unknown> {
  resourceType: string;
  operation: string;
  repositoryId?: string;
  resourceId?: string;
  status: string;
  result: TResult;
}

export interface PluginActionDefinition {
  action: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  exampleArgs?: Record<string, unknown>;
}

export interface PluginView {
  pluginId: string;
  name?: string;
  description?: string;
  version?: string;
  state?: string;
  sourceType?: string;
  started?: boolean;
  configurable?: boolean;
  fileName?: string;
  actions: PluginActionDefinition[];
}

export interface PluginSummaryView {
  pluginId: string;
  name?: string;
  description?: string;
  version?: string;
  state?: string;
  sourceType?: string;
  started?: boolean;
  configurable?: boolean;
  fileName?: string;
  actionCount: number;
}

export interface PluginReferenceView {
  pluginId: string;
  name?: string;
  description?: string;
  version?: string;
  sourceType?: string;
  started?: boolean;
  actions: PluginActionDefinition[];
}

export interface PluginConfigView {
  pluginId: string;
  configName?: string;
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface PluginDownload {
  filename: string;
  content: Buffer;
}

export interface PluginInvokeRequest {
  args: Record<string, unknown>;
  scriptInput: Record<string, unknown>;
  responseView?: "RESULT" | "DEBUG";
  configName?: string;
}

export interface PluginInvokeResponse {
  pluginId: string;
  action: string;
  result: unknown;
  debug?: {
    args?: Record<string, unknown>;
    scriptInput?: Record<string, unknown>;
  };
}

export interface SharedStateDetail {
  namespace: string;
  key: string;
  value?: unknown;
  secret?: boolean;
  version?: number | null;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastWriterScriptId?: string | null;
  lastWriterExecutionId?: string | null;
}

export interface SharedStateSummary {
  namespace: string;
  key: string;
  secret?: boolean;
  version?: number | null;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastWriterScriptId?: string | null;
  lastWriterExecutionId?: string | null;
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

export interface ConfigValueView {
  key: string;
  value?: string | null;
  valueMasked?: string | null;
  hasValue?: boolean;
  description?: string | null;
  secret?: boolean;
  repositoryId?: string | null;
  repositoryScriptId?: string | null;
  repositoryVersion?: string | null;
  publishMode?: string | null;
  managed?: boolean;
  overridden?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ConfigValueDetailView extends ConfigValueView {
  usage?: unknown;
  impactedScripts?: unknown[];
  origin?: unknown;
  availableActions?: {
    canCopyAsLocalOverride?: boolean;
    canRestoreRepositoryDefault?: boolean;
  };
}

export interface ConfigValueRequest {
  key?: string;
  value?: string;
  description?: string;
  secret?: boolean;
  preserveValue?: boolean;
}

export interface AccessTokenView {
  id: string;
  name?: string;
  tokenPreview?: string;
  enabled?: boolean;
  tokenValue?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastUsedAt?: string | null;
}

export interface SchemaFieldDescriptor {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  description?: string;
  enumValues: string[];
  defaultValue?: unknown;
  examples: unknown[];
  supportsFlag: boolean;
}

export interface ConfigProfile {
  serverUrl?: string;
  token?: string;
}

export interface ConfigFile {
  currentProfile?: string;
  profiles?: Record<string, ConfigProfile>;
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
  configTemplatePath?: string;
}

export interface RepositoryKnowledgeDetail {
  descriptor: RepositoryKnowledgeDescriptor;
  knowledge: KnowledgeFile;
  configTemplate: RepositoryConfigTemplateItem[];
}
