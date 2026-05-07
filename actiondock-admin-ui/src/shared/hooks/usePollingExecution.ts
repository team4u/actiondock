import { useCallback, useEffect, useRef, useState } from "react";
import { getExecution } from "../../features/executions/api";
import type { ExecutionRecord } from "../../shared/types";
import { isExecutionActive } from "../../services/utils";

export interface UsePollingExecutionOptions {
  interval?: number;
  onPollResult?: (record: ExecutionRecord) => void;
  onCompleted?: (record: ExecutionRecord) => void;
  onFailed?: (record: ExecutionRecord) => void;
  onFinished?: (record: ExecutionRecord) => void;
  onError?: (error: unknown) => void;
}

export function usePollingExecution(options: UsePollingExecutionOptions = {}) {
  const [pollingExecutionId, setPollingExecutionId] = useState<string | null>(null);
  const pollingTimerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearPolling = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      window.clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setPollingExecutionId(null);
  }, []);

  const pollExecution = useCallback(
    async (executionId: string) => {
      try {
        const record = await getExecution(executionId);
        optionsRef.current.onPollResult?.(record);

        if (isExecutionActive(record.status)) {
          setPollingExecutionId(executionId);
          pollingTimerRef.current = window.setTimeout(() => {
            void pollExecution(executionId);
          }, optionsRef.current.interval ?? 2000);
          return;
        }

        clearPolling();
        optionsRef.current.onFinished?.(record);
        if (record.status === "SUCCESS") {
          optionsRef.current.onCompleted?.(record);
        } else if (record.status === "FAILED") {
          optionsRef.current.onFailed?.(record);
        }
      } catch (error) {
        clearPolling();
        optionsRef.current.onError?.(error);
      }
    },
    [clearPolling]
  );

  const startPolling = useCallback(
    (executionId: string) => {
      clearPolling();
      setPollingExecutionId(executionId);
      pollingTimerRef.current = window.setTimeout(() => {
        void pollExecution(executionId);
      }, optionsRef.current.interval ?? 2000);
    },
    [clearPolling, pollExecution]
  );

  useEffect(() => clearPolling, [clearPolling]);

  return { pollingExecutionId, startPolling, clearPolling };
}
