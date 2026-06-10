import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../services/api";
import type { ExecutionRecord } from "../shared/types";
import { isValidationErrorData } from "../services/schemaExecution";
import { isExecutionActive } from "../services/utils";
import {
  buildBatchSessionStats,
  createBatchSession,
  createBatchSessionStorageKey,
  finalizeBatchSessionStatus,
  rehydrateBatchSession
} from "./session";
import type {
  BatchExecutionFetcher,
  BatchExecutionStartOptions,
  BatchExecutionSubmitter,
  BatchRetryOptions,
  BatchSession,
  BatchSessionItem,
  BatchSurface
} from "./types";

interface UseBatchExecutionOptions {
  surface: BatchSurface;
  scriptId: string;
  scriptName: string;
  submitExecution: BatchExecutionSubmitter;
  fetchExecution: BatchExecutionFetcher;
  pollInterval?: number;
  onSessionFinished?: (session: BatchSession) => void | Promise<void>;
}

interface RunController {
  sessionId: string | null;
  cancelled: boolean;
  stopDispatch: boolean;
}

function createExecutionRecordFromResponse(
  input: Record<string, unknown>,
  response: {
    id: string;
    scriptId: string;
    status: ExecutionRecord["status"];
    submitMode: ExecutionRecord["submitMode"];
    triggerSource: ExecutionRecord["triggerSource"];
    output: Record<string, unknown>;
    logs: ExecutionRecord["logs"];
    errorMessage?: string;
    errorDetail?: ExecutionRecord["errorDetail"];
    createdAt?: string;
    startedAt?: string;
    finishedAt?: string;
    scheduleId?: string;
  }
): ExecutionRecord {
  return {
    id: response.id,
    scriptId: response.scriptId,
    status: response.status,
    submitMode: response.submitMode,
    triggerSource: response.triggerSource,
    scheduleId: response.scheduleId,
    input,
    output: response.output,
    logs: response.logs,
    errorMessage: response.errorMessage,
    errorDetail: response.errorDetail,
    createdAt: response.createdAt,
    startedAt: response.startedAt,
    finishedAt: response.finishedAt
  };
}

function buildRetryItems(items: BatchSession["items"]): BatchExecutionStartOptions["items"] {
  return items.map((item) => ({
    id: `${item.id}_retry_${Math.random().toString(36).slice(2, 8)}`,
    rowIndex: item.rowIndex,
    input: item.input,
    errors: [],
    warnings: item.warnings
  }));
}

export function useBatchExecution({
  surface,
  scriptId,
  scriptName,
  submitExecution,
  fetchExecution,
  pollInterval = 2000,
  onSessionFinished
}: UseBatchExecutionOptions) {
  const storageKey = useMemo(
    () => createBatchSessionStorageKey(surface, scriptId),
    [scriptId, surface]
  );
  const [session, setSession] = useState<BatchSession | null>(null);
  const sessionRef = useRef<BatchSession | null>(null);
  const controllerRef = useRef<RunController>({ sessionId: null, cancelled: false, stopDispatch: false });
  const timersRef = useRef<Set<number>>(new Set());
  const finishNotifiedRef = useRef<string | null>(null);

  const commitSession = useCallback((updater: (current: BatchSession | null) => BatchSession | null) => {
    const next = updater(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
    return next;
  }, []);

  const clearTimers = useCallback(() => {
    for (const timerId of timersRef.current) {
      window.clearTimeout(timerId);
    }
    timersRef.current.clear();
  }, []);

  const stopActiveRun = useCallback(() => {
    controllerRef.current = {
      sessionId: null,
      cancelled: true,
      stopDispatch: true
    };
    clearTimers();
  }, [clearTimers]);

  const persistSession = useCallback((value: BatchSession | null) => {
    if (!value) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
  }, [storageKey]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      sessionRef.current = null;
      setSession(null);
      return;
    }

    try {
      const restored = rehydrateBatchSession(JSON.parse(raw) as BatchSession);
      sessionRef.current = restored;
      setSession(restored);
    } catch {
      window.sessionStorage.removeItem(storageKey);
      sessionRef.current = null;
      setSession(null);
    }

    return stopActiveRun;
  }, [storageKey, stopActiveRun]);

  useEffect(() => {
    persistSession(session);
  }, [persistSession, session]);

  const finalizeIfNeeded = useCallback(async (sessionId: string) => {
    const current = sessionRef.current;
    if (!current || current.id !== sessionId) {
      return;
    }

    const finalized = finalizeBatchSessionStatus({
      ...current,
      updatedAt: new Date().toISOString()
    });
    if (finalized.status === current.status && finalized.finishedAt === current.finishedAt) {
      return;
    }

    commitSession(() => finalized);
    if (finalized.status !== "RUNNING" && finishNotifiedRef.current !== finalized.id) {
      finishNotifiedRef.current = finalized.id;
      await onSessionFinished?.(finalized);
    }
  }, [commitSession, onSessionFinished]);

  const requestStopOnFailure = useCallback((sessionId: string) => {
    if (controllerRef.current.sessionId !== sessionId) {
      return;
    }
    controllerRef.current.stopDispatch = true;
    commitSession((current) => {
      if (!current || current.id !== sessionId) {
        return current;
      }
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        items: current.items.map((item) =>
          item.status === "QUEUED"
            ? {
                ...item,
                status: "SKIPPED",
                errorMessage: "因失败策略已停止后续提交",
                finishedAt: new Date().toISOString()
              }
            : item
        )
      };
    });
  }, [commitSession]);

  const updateItem = useCallback((sessionId: string, itemId: string, updater: (item: BatchSessionItem) => BatchSessionItem) => {
    commitSession((current) => {
      if (!current || current.id !== sessionId) {
        return current;
      }
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        items: current.items.map((item) => (item.id === itemId ? updater(item) : item))
      };
    });
  }, [commitSession]);

  const sleep = useCallback((ms: number) => new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      resolve();
    }, ms);
    timersRef.current.add(timer);
  }), []);

  const pollItem = useCallback(async (sessionId: string, itemId: string, executionId: string) => {
    while (controllerRef.current.sessionId === sessionId && !controllerRef.current.cancelled) {
      await sleep(pollInterval);
      if (controllerRef.current.sessionId !== sessionId) {
        return;
      }

      try {
        const record = await fetchExecution(executionId);
        updateItem(sessionId, itemId, (item) => ({
          ...item,
          status: record.status,
          executionId,
          execution: record,
          errorMessage: record.errorMessage,
          startedAt: item.startedAt ?? record.startedAt ?? new Date().toISOString(),
          finishedAt: isExecutionActive(record.status)
            ? item.finishedAt
            : record.finishedAt ?? new Date().toISOString()
        }));

        if (!isExecutionActive(record.status)) {
          const current = sessionRef.current;
          if (current?.id === sessionId && current.failStrategy === "STOP_ON_FAILURE" && record.status === "FAILED") {
            requestStopOnFailure(sessionId);
          }
          await finalizeIfNeeded(sessionId);
          return;
        }
      } catch (error) {
        updateItem(sessionId, itemId, (item) => ({
          ...item,
          status: "INTERRUPTED",
          errorMessage: error instanceof Error ? error.message : "轮询执行结果失败",
          finishedAt: new Date().toISOString()
        }));
        await finalizeIfNeeded(sessionId);
        return;
      }
    }
  }, [fetchExecution, finalizeIfNeeded, pollInterval, requestStopOnFailure, sleep, updateItem]);

  const executeItem = useCallback(async (sessionId: string, item: BatchSessionItem, submitMode: BatchSession["submitMode"]) => {
    try {
      const response = await submitExecution(item.input, submitMode);
      const execution = createExecutionRecordFromResponse(item.input, response);
      const nextStatus = response.status;

      updateItem(sessionId, item.id, (currentItem) => ({
        ...currentItem,
        status: nextStatus,
        executionId: response.id,
        execution,
        errorMessage: response.errorMessage,
        startedAt: currentItem.startedAt ?? response.startedAt ?? new Date().toISOString(),
        finishedAt: isExecutionActive(response.status)
          ? currentItem.finishedAt
          : response.finishedAt ?? new Date().toISOString()
      }));

      if (response.submitMode === "ASYNC" && isExecutionActive(response.status)) {
        await pollItem(sessionId, item.id, response.id);
      } else {
        const current = sessionRef.current;
        if (current?.id === sessionId && current.failStrategy === "STOP_ON_FAILURE" && response.status === "FAILED") {
          requestStopOnFailure(sessionId);
        }
        await finalizeIfNeeded(sessionId);
      }
    } catch (error) {
      const current = sessionRef.current;
      const backendValidationErrors =
        error instanceof ApiError && isValidationErrorData(error.data)
          ? error.data.fieldErrors.map((fieldError) => fieldError.message)
          : undefined;
      updateItem(sessionId, item.id, (currentItem) => ({
        ...currentItem,
        status: "SUBMIT_FAILED",
        errorMessage:
          backendValidationErrors?.join("；") ??
          (error instanceof Error ? error.message : "提交批量执行失败"),
        backendValidationErrors,
        finishedAt: new Date().toISOString()
      }));
      if (current?.id === sessionId && current.failStrategy === "STOP_ON_FAILURE") {
        requestStopOnFailure(sessionId);
      }
      await finalizeIfNeeded(sessionId);
    }
  }, [finalizeIfNeeded, pollItem, requestStopOnFailure, submitExecution, updateItem]);

  const acquireNextItem = useCallback((sessionId: string): BatchSessionItem | null => {
    const current = sessionRef.current;
    if (!current || current.id !== sessionId) {
      return null;
    }
    if (controllerRef.current.stopDispatch && current.failStrategy === "STOP_ON_FAILURE") {
      return null;
    }

    const nextItem = current.items.find((item) => item.status === "QUEUED");
    if (!nextItem) {
      return null;
    }

    updateItem(sessionId, nextItem.id, (item) => ({
      ...item,
      status: "SUBMITTING",
      startedAt: item.startedAt ?? new Date().toISOString()
    }));

    return {
      ...nextItem,
      status: "SUBMITTING",
      startedAt: nextItem.startedAt ?? new Date().toISOString()
    };
  }, [updateItem]);

  const runWorker = useCallback(async (sessionId: string) => {
    while (controllerRef.current.sessionId === sessionId) {
      const current = sessionRef.current;
      if (!current || current.id !== sessionId) {
        return;
      }
      const nextItem = acquireNextItem(sessionId);
      if (!nextItem) {
        await finalizeIfNeeded(sessionId);
        return;
      }
      await executeItem(sessionId, nextItem, current.submitMode);
    }
  }, [acquireNextItem, executeItem, finalizeIfNeeded]);

  const resumeSession = useCallback((targetSession: BatchSession) => {
    stopActiveRun();
    controllerRef.current = {
      sessionId: targetSession.id,
      cancelled: false,
      stopDispatch: false
    };

    for (const item of targetSession.items) {
      if ((item.status === "PENDING" || item.status === "RUNNING") && item.executionId) {
        void pollItem(targetSession.id, item.id, item.executionId);
      }
    }

    for (let index = 0; index < targetSession.concurrency; index += 1) {
      void runWorker(targetSession.id);
    }
  }, [pollItem, runWorker, stopActiveRun]);

  useEffect(() => {
    if (!session || session.status !== "RUNNING") {
      return;
    }
    if (controllerRef.current.sessionId === session.id) {
      return;
    }
    resumeSession(session);
  }, [resumeSession, session]);

  useEffect(() => () => stopActiveRun(), [stopActiveRun]);

  const startBatch = useCallback(async ({
    batchName,
    sourceType,
    submitMode,
    failStrategy,
    concurrency,
    items,
    sourceSessionId
  }: BatchExecutionStartOptions) => {
    stopActiveRun();
    finishNotifiedRef.current = null;
    const nextSession = createBatchSession({
      surface,
      scriptId,
      scriptName,
      batchName,
      sourceType,
      submitMode,
      failStrategy,
      concurrency,
      items,
      sourceSessionId
    });
    commitSession(() => nextSession);

    if (nextSession.status === "RUNNING") {
      resumeSession(nextSession);
    } else if (finishNotifiedRef.current !== nextSession.id) {
      finishNotifiedRef.current = nextSession.id;
      await onSessionFinished?.(nextSession);
    }
  }, [commitSession, onSessionFinished, resumeSession, scriptId, scriptName, stopActiveRun, surface]);

  const clearSession = useCallback(() => {
    stopActiveRun();
    finishNotifiedRef.current = null;
    commitSession(() => null);
  }, [commitSession, stopActiveRun]);

  const retryItems = useCallback(async (items: BatchSessionItem[], options: BatchRetryOptions = {}) => {
    const current = sessionRef.current;
    if (!current || items.length === 0) {
      return;
    }

    await startBatch({
      batchName: options.batchName ?? `${current.batchName}-retry`,
      sourceType: options.sourceType ?? current.sourceType,
      submitMode: options.submitMode ?? current.submitMode,
      failStrategy: options.failStrategy ?? current.failStrategy,
      concurrency: options.concurrency ?? current.concurrency,
      items: buildRetryItems(items),
      sourceSessionId: options.sourceSessionId ?? current.id
    });
  }, [startBatch]);

  const retryFailed = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const failedItems = current.items.filter((item) =>
      item.status === "FAILED" ||
      item.status === "SUBMIT_FAILED" ||
      item.status === "INTERRUPTED" ||
      item.status === "INVALID"
    );
    await retryItems(failedItems);
  }, [retryItems]);

  const retrySingle = useCallback(async (itemId: string) => {
    const current = sessionRef.current;
    const target = current?.items.find((item) => item.id === itemId);
    if (!target) {
      return;
    }
    await retryItems([target], {
      batchName: `${current?.batchName ?? scriptName}-row-${target.rowIndex}`
    });
  }, [retryItems, scriptName]);

  const stats = useMemo(() => buildBatchSessionStats(session), [session]);

  return {
    session,
    stats,
    running: session?.status === "RUNNING",
    startBatch,
    clearSession,
    retryItems,
    retryFailed,
    retrySingle
  };
}
