export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";
export type ExecutionResponseView = "RESULT" | "DEBUG";

export interface ScriptDefinition {
  id: string;
  name: string;
  type: ScriptType;
  source: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  status: ScriptStatus;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  status: ExecutionStatus;
  submitMode: SubmitMode;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  errorMessage?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
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
  output: Record<string, unknown>;
  errorMessage?: string;
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
