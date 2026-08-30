import type { ExecutionManager, RuntimeStorage, ServerRuntimeRegistry } from "@actiondock/core";
import type { ActionDefinition, ExecutionResult, RunRecord, RunStatus } from "@actiondock/sdk";

export type McpTaskStatus = "working" | "completed" | "failed" | "cancelled";

export interface McpTaskPayload {
  taskId: string;
  status: McpTaskStatus;
  createdAt: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

export function toMcpTaskStatus(status: RunStatus): McpTaskStatus {
  switch (status) {
    case "running":
      return "working";
    case "success":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "working";
  }
}


export function toMcpTaskPayload(run: RunRecord): McpTaskPayload {
  return {
    taskId: run.id,
    status: toMcpTaskStatus(run.status),
    createdAt: run.startedAt,
    finishedAt: run.finishedAt,
    input: run.input,
    output: run.output,
    error: run.error,
  };
}

export interface ActionDockMcpOptions {
  projectRoot?: string;
  projectRoots?: string[];
  packageId?: string;
  packageIds?: string[];
  all?: boolean;
  customHome?: string;
  configOverrides?: Record<string, unknown>;
  timeoutMs?: number;
  actions?: Map<string, ActionDefinition>;
  storage?: RuntimeStorage;
  runtimeRegistry?: ServerRuntimeRegistry;
  executionManager?: ExecutionManager;
}

export interface HttpSecurityOptions {
  host?: string;
  port?: number;
  token?: string;
  allowInsecureNoAuth?: boolean;
  corsOrigins?: string[];
  maxBodyBytes?: number;
}

export interface ActionDockMcpHttpOptions extends ActionDockMcpOptions, HttpSecurityOptions {}

export interface ActionDockMcpHttpServerInstance {
  port: number;
  host: string;
  url: string;
  stop: () => void;
}

