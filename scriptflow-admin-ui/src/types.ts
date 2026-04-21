export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
export type SubmitMode = "SYNC" | "ASYNC";

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

export interface ExecuteRequest {
  scriptId: string;
  input: Record<string, unknown>;
  mode: SubmitMode;
}

export interface ApiResponse<T> {
  status: number;
  msg?: string;
  data: T;
}

export interface ApiErrorPayload {
  status?: number;
  msg?: string;
}
