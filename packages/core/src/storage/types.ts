import type { RuntimeError, RunRecord } from "@actiondock/sdk";

export interface ConfigEntry {
  packageId: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface StateEntry {
  packageId: string;
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: string;
  expiresAt?: string;
}

export interface StorageOptions {
  dbPath?: string;
  packageId: string;
}

export type TerminalRunStatus = "success" | "failed" | "cancelled";

export interface RuntimeStorage {
  // Config
  getConfig<T = unknown>(key: string): T | undefined;
  listConfig(): Record<string, unknown>;
  setConfig(key: string, value: unknown): void;
  deleteConfig(key: string): boolean;

  // State
  getState<T = unknown>(namespace: string, key: string): Promise<T | undefined>;
  setState<T = unknown>(
    namespace: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void>;
  deleteState(namespace: string, key: string): Promise<void>;
  listStateKeys(namespace: string, prefix?: string): Promise<string[]>;

  // Runs
  createRun(record: RunRecord): void;
  updateRun(
    id: string,
    status: TerminalRunStatus,
    output?: unknown,
    error?: RuntimeError,
    finishedAt?: string
  ): void;
  getRun(id: string): RunRecord | null;
  listRuns(options?: { actionId?: string; limit?: number }): RunRecord[];

  close(): void;
}
