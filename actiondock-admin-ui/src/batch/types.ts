import type { SchemaFieldDefinition } from "../services/schema";
import type { ExecutionRecord, ExecutionResponse, SubmitMode } from "../shared/types";

export type BatchSurface = "editor" | "published";
export type BatchInputSource = "JSON_ARRAY" | "JSONL" | "CSV";
export type BatchFailStrategy = "CONTINUE" | "STOP_ON_FAILURE";
export type BatchSessionStatus = "IDLE" | "RUNNING" | "SUCCESS" | "PARTIAL_FAILED" | "FAILED" | "INTERRUPTED";
export type BatchItemStatus =
  | "VALID"
  | "INVALID"
  | "QUEUED"
  | "SUBMITTING"
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SUBMIT_FAILED"
  | "SKIPPED"
  | "INTERRUPTED";

export interface BatchDraftItem {
  id: string;
  rowIndex: number;
  input: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface BatchSessionItem extends BatchDraftItem {
  status: BatchItemStatus;
  attempt: number;
  executionId?: string;
  errorMessage?: string;
  backendValidationErrors?: string[];
  execution?: ExecutionRecord;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface BatchSession {
  id: string;
  surface: BatchSurface;
  scriptId: string;
  scriptName: string;
  batchName: string;
  sourceType: BatchInputSource;
  submitMode: SubmitMode;
  failStrategy: BatchFailStrategy;
  concurrency: number;
  status: BatchSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  sourceSessionId?: string;
  items: BatchSessionItem[];
}

export interface BatchSessionStats {
  total: number;
  valid: number;
  invalid: number;
  queued: number;
  submitting: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
  interrupted: number;
  finished: number;
}

export interface CsvSourceData {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export type CsvColumnMapping = Record<string, string | null>;

export interface BatchValidationIssue {
  field: string;
  message: string;
}

export interface BatchValidationResult {
  errors: string[];
  warnings: string[];
  issues: BatchValidationIssue[];
}

export interface BatchSourceSummary {
  totalCount: number;
  validCount: number;
  invalidCount: number;
  warningCount: number;
}

export interface BatchSourceDraft {
  items: BatchDraftItem[];
  summary: BatchSourceSummary;
}

export interface BatchExecutionSubmitter {
  (input: Record<string, unknown>, mode: SubmitMode): Promise<ExecutionResponse>;
}

export interface BatchExecutionFetcher {
  (id: string): Promise<ExecutionRecord>;
}

export interface BatchExecutionStartOptions {
  batchName: string;
  sourceType: BatchInputSource;
  submitMode: SubmitMode;
  failStrategy: BatchFailStrategy;
  concurrency: number;
  items: BatchDraftItem[];
  sourceSessionId?: string;
}

export interface BatchRetryOptions {
  batchName?: string;
  sourceType?: BatchInputSource;
  submitMode?: SubmitMode;
  failStrategy?: BatchFailStrategy;
  concurrency?: number;
  sourceSessionId?: string;
}

export interface BatchFieldSummary {
  fields: SchemaFieldDefinition[];
  unsupportedFields: string[];
}
