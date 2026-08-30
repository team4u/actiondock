import type { ServerRuntimeRegistry } from "./runtime-registry";

export interface ServerOptions {
  port?: number;
  host?: string;
  token?: string;
  projectRoot?: string;
  customHome?: string;
  allowInsecureNoAuth?: boolean;
  corsOrigins?: string[];
  maxBodyBytes?: number;
  exposeDebugInfo?: boolean;
}

export interface ActionDockServerInstance {
  port: number;
  host: string;
  url: string;
  runtimeRegistry?: ServerRuntimeRegistry;
  stop: () => Promise<void> | void;
}

