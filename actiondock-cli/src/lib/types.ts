export interface ApiEnvelope<T> {
  status: number;
  msg: string;
  data: T;
}

export interface ScriptDefinition {
  id: string;
  name?: string;
  type?: string;
  packaging?: string;
  scope?: string;
  status?: string;
  version?: number;
  description?: string;
  owner?: string;
  tags?: string[];
  source?: string;
  pythonRequirements?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  publishedSnapshot?: {
    name?: string;
    type?: string;
    pythonRequirements?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  } | null;
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
  eventSourceId?: string;
  eventTriggerId?: string;
  eventRecordId?: string;
  eventDispatchId?: string;
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

export interface JsonPathProcessorConfig {
  fields?: Record<string, string>;
}

export interface TemplateProcessorConfig {
  engine?: string;
  template?: Record<string, unknown>;
}

export interface ScriptRefProcessorConfig {
  scriptId?: string;
  versionMode?: string;
}

export interface ProcessorDefinition {
  mode?: string;
  jsonPath?: JsonPathProcessorConfig;
  template?: TemplateProcessorConfig;
  scriptRef?: ScriptRefProcessorConfig;
  outputSchema?: Record<string, unknown>;
  description?: string;
}

export interface EventSourceTransport {
  type?: string;
  endpointPath?: string;
  contentTypes?: string[];
}

export interface EventSourceAuthConfig {
  mode?: string;
  tokenHeader?: string;
  tokenQueryParam?: string;
  signatureHeader?: string;
  signaturePrefix?: string;
  signaturePayload?: string;
  timestampHeader?: string;
  maxSkewSeconds?: number;
  secretConfigKey?: string;
}

export interface IncomingEventPayload {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  rawBody?: string;
  contentType?: string;
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
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  receivedAt?: string;
}

export interface EventSourceDefinition {
  id: string;
  key?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  transport?: EventSourceTransport;
  auth?: EventSourceAuthConfig;
  normalizationProcessor?: ProcessorDefinition;
  sampleContext?: Record<string, unknown>;
  lastReceivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventTrigger {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  sourceId?: string;
  targetScriptId?: string;
  filterProcessor?: ProcessorDefinition;
  idempotencyProcessor?: ProcessorDefinition;
  inputProcessor?: ProcessorDefinition;
  submitMode?: string;
  responseView?: string;
  lastEventId?: string;
  lastTriggeredAt?: string;
  lastExecutionId?: string;
  lastExecutionStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventRecord {
  id: string;
  sourceId?: string;
  sourceKey?: string;
  status?: string;
  eventType?: string;
  eventId?: string;
  actor?: string;
  subject?: string;
  rawHeaders?: Record<string, unknown>;
  rawQuery?: Record<string, unknown>;
  rawBody?: Record<string, unknown>;
  normalizedEvent?: NormalizedEvent;
  errorMessage?: string;
  createdAt?: string;
}

export interface EventDispatchRecord {
  id: string;
  eventId?: string;
  sourceId?: string;
  triggerId?: string;
  targetScriptId?: string;
  status?: string;
  filterMatched?: boolean;
  idempotencyKey?: string;
  mappedInput?: Record<string, unknown>;
  executionId?: string;
  executionStatus?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProcessorContext {
  event?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  source?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}

export interface ProcessorTestRequest {
  processor: ProcessorDefinition;
  context?: ProcessorContext;
  expectedOutputSchema?: Record<string, unknown>;
}

export interface ProcessorTestResult {
  success?: boolean;
  output?: Record<string, unknown>;
  errorMessage?: string;
  logs?: unknown[];
  durationMs?: number;
  schemaValid?: boolean;
  fieldErrors?: unknown[];
}

export interface EventTriggerTestRequest {
  event?: NormalizedEvent;
  execute?: boolean;
}

export interface EventTriggerTestResult {
  event?: NormalizedEvent;
  filterMatched?: boolean;
  filterResult?: ProcessorTestResult;
  idempotencyResult?: ProcessorTestResult;
  idempotencyKey?: string;
  inputResult?: ProcessorTestResult;
  mappedInput?: Record<string, unknown>;
  schemaValid?: boolean;
  fieldErrors?: unknown[];
  execution?: ExecutionResponse;
}

export interface EventIngestionView {
  event?: EventRecord;
  dispatches?: EventDispatchRecord[];
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
  started?: boolean;
  configurable?: boolean;
  fileName?: string;
  actions: PluginActionDefinition[];
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
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface PluginInvokeRequest {
  args: Record<string, unknown>;
  scriptInput: Record<string, unknown>;
  responseView?: "RESULT" | "DEBUG";
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

export interface ConfigFile {
  serverUrl?: string;
  token?: string;
}
