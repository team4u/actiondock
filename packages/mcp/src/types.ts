import type { ActionDefinition, ExecutionResult } from "@actiondock/sdk";

export interface ActionDockMcpOptions {
  projectRoot?: string;
  packageId?: string;
  customHome?: string;
  configOverrides?: Record<string, unknown>;
  timeoutMs?: number;
  actions?: Map<string, ActionDefinition>;
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
