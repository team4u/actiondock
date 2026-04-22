export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY" | "PYTHON";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";
export type ExecutionResponseView = "RESULT" | "DEBUG";
export type ExecutionTriggerSource = "MANUAL" | "SCHEDULED";
export type ExecutionLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

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
  publishedSnapshot?: PublishedScriptSnapshot;
  hasUnpublishedChanges?: boolean;
  createdAt?: string;
  updatedAt?: string;
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
