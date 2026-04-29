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
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  publishedSnapshot?: {
    name?: string;
    type?: string;
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
