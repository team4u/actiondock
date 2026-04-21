export type ScriptStatus = "DRAFT" | "PUBLISHED";
export type ScriptType = "GROOVY";

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

export interface ApiResponse<T> {
  status: number;
  msg?: string;
  data: T;
}

export interface ApiErrorPayload {
  status?: number;
  msg?: string;
}
