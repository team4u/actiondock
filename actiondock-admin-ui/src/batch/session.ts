import { isExecutionActive } from "../services/utils";
import type {
  BatchDraftItem,
  BatchInputSource,
  BatchItemStatus,
  BatchSession,
  BatchSessionStats,
  BatchSessionStatus,
  BatchSurface
} from "./types";

const ACTIVE_BATCH_ITEM_STATUSES = new Set<BatchItemStatus>(["SUBMITTING", "PENDING", "RUNNING"]);
const FINISHED_BATCH_ITEM_STATUSES = new Set<BatchItemStatus>([
  "SUCCESS",
  "FAILED",
  "SUBMIT_FAILED",
  "SKIPPED",
  "INTERRUPTED",
  "INVALID"
]);

export function createBatchSessionStorageKey(surface: BatchSurface, scriptId: string): string {
  return `actiondock:batch-session:${surface}:${scriptId}`;
}

export function createBatchSessionId(now = new Date()): string {
  return `batch_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createBatchSession(args: {
  id?: string;
  surface: BatchSurface;
  scriptId: string;
  scriptName: string;
  batchName: string;
  sourceType: BatchInputSource;
  submitMode: BatchSession["submitMode"];
  failStrategy: BatchSession["failStrategy"];
  concurrency: number;
  items: BatchDraftItem[];
  sourceSessionId?: string;
  now?: string;
}): BatchSession {
  const timestamp = args.now ?? new Date().toISOString();
  const items = args.items.map((item) => {
    const status: BatchSession["items"][number]["status"] = item.errors.length > 0 ? "INVALID" : "QUEUED";
    return {
      ...item,
      status,
      attempt: 1,
      queuedAt: timestamp
    };
  });
  const session: BatchSession = {
    id: args.id ?? createBatchSessionId(),
    surface: args.surface,
    scriptId: args.scriptId,
    scriptName: args.scriptName,
    batchName: args.batchName,
    sourceType: args.sourceType,
    submitMode: args.submitMode,
    failStrategy: args.failStrategy,
    concurrency: Math.max(1, Math.floor(args.concurrency) || 1),
    status: "IDLE",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    sourceSessionId: args.sourceSessionId,
    items
  };

  return finalizeBatchSessionStatus(session);
}

export function finalizeBatchSessionStatus(session: BatchSession): BatchSession {
  const status = deriveBatchSessionStatus(session.items);
  const finishedAt =
    status === "RUNNING" || status === "IDLE"
      ? undefined
      : session.finishedAt ?? new Date().toISOString();
  return {
    ...session,
    status,
    finishedAt
  };
}

export function deriveBatchSessionStatus(items: BatchSession["items"]): BatchSessionStatus {
  if (items.length === 0) {
    return "IDLE";
  }

  const hasQueued = items.some((item) => item.status === "QUEUED");
  const hasActive = items.some((item) => ACTIVE_BATCH_ITEM_STATUSES.has(item.status));
  if (hasQueued || hasActive) {
    return "RUNNING";
  }

  const successCount = items.filter((item) => item.status === "SUCCESS").length;
  const interruptedCount = items.filter((item) => item.status === "INTERRUPTED").length;
  const failureCount = items.filter((item) =>
    item.status === "FAILED" ||
    item.status === "SUBMIT_FAILED" ||
    item.status === "INVALID"
  ).length;
  const skippedCount = items.filter((item) => item.status === "SKIPPED").length;

  if (successCount === items.length) {
    return "SUCCESS";
  }
  if (interruptedCount > 0 && successCount === 0 && failureCount === 0 && skippedCount === 0) {
    return "INTERRUPTED";
  }
  if (successCount === 0 && failureCount + interruptedCount + skippedCount === items.length) {
    return interruptedCount > 0 ? "INTERRUPTED" : "FAILED";
  }
  return "PARTIAL_FAILED";
}

export function buildBatchSessionStats(session: BatchSession | null): BatchSessionStats {
  const stats: BatchSessionStats = {
    total: 0,
    valid: 0,
    invalid: 0,
    queued: 0,
    submitting: 0,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    interrupted: 0,
    finished: 0
  };

  if (!session) {
    return stats;
  }

  for (const item of session.items) {
    stats.total += 1;
    if (item.errors.length > 0) {
      stats.invalid += 1;
    } else {
      stats.valid += 1;
    }

    switch (item.status) {
      case "QUEUED":
        stats.queued += 1;
        break;
      case "SUBMITTING":
        stats.submitting += 1;
        break;
      case "PENDING":
        stats.pending += 1;
        break;
      case "RUNNING":
        stats.running += 1;
        break;
      case "SUCCESS":
        stats.success += 1;
        stats.finished += 1;
        break;
      case "FAILED":
      case "SUBMIT_FAILED":
        stats.failed += 1;
        stats.finished += 1;
        break;
      case "SKIPPED":
        stats.skipped += 1;
        stats.finished += 1;
        break;
      case "INTERRUPTED":
        stats.interrupted += 1;
        stats.finished += 1;
        break;
      case "INVALID":
        stats.invalid += 0;
        stats.failed += 1;
        stats.finished += 1;
        break;
      default:
        break;
    }
  }

  return stats;
}

export function isBatchItemFinished(status: BatchItemStatus): boolean {
  return FINISHED_BATCH_ITEM_STATUSES.has(status) || status === "VALID";
}

export function isBatchItemActive(status: BatchItemStatus): boolean {
  return ACTIVE_BATCH_ITEM_STATUSES.has(status);
}

export function rehydrateBatchSession(session: BatchSession): BatchSession {
  const normalizedItems = session.items.map((item) => {
    if (item.status === "SUBMITTING") {
      return {
        ...item,
        status: "INTERRUPTED" as const,
        errorMessage: item.errorMessage ?? "页面刷新时提交状态未知，请按需重试。",
        finishedAt: item.finishedAt ?? new Date().toISOString()
      };
    }

    if ((item.status === "PENDING" || item.status === "RUNNING") && item.execution && !isExecutionActive(item.execution.status)) {
      return {
        ...item,
        status: item.execution.status,
        finishedAt: item.finishedAt ?? item.execution.finishedAt ?? new Date().toISOString()
      };
    }

    return item;
  });

  return finalizeBatchSessionStatus({
    ...session,
    items: normalizedItems
  });
}

export function summarizeBatchObject(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return "-";
  }

  return Object.entries(value)
    .slice(0, 3)
    .map(([key, entryValue]) => `${key}=${formatSummaryValue(entryValue)}`)
    .join(", ");
}

function formatSummaryValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 32 ? `${value.slice(0, 29)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "-";
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 32 ? `${serialized.slice(0, 29)}...` : serialized;
  } catch {
    return String(value);
  }
}
