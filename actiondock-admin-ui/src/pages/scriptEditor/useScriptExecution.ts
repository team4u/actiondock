import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  clearExecutions,
  deleteExecution,
  executeScript,
  getExecution,
  listExecutions
} from "../../api";
import {
  buildExecutionInputFromValues
} from "../../commands";
import {
  buildSchemaObjectEditorJsonText,
  parseSchemaObjectEditorJsonText
} from "../../schemaObjectEditorSupport";
import {
  buildSchemaFieldInitialState,
  isValidationErrorData
} from "../../schemaExecution";
import { resolveSchemaFields } from "../../schema";
import { isExecutionActive, parseJsonText } from "../../utils";
import type { ExecutionRecord, ScriptDefinition, SubmitMode, ValidationErrorData } from "../../types";
import type { ExecutionInputMode } from "./types";

export interface UseScriptExecutionParams {
  currentScript: ScriptDefinition | null;
  executionForm: FormInstance<Record<string, unknown>>;
  messageApi: MessageInstance;
}

export interface ScriptExecutionContext {
  executionMode: SubmitMode;
  setExecutionMode: (mode: SubmitMode) => void;
  executionInputMode: ExecutionInputMode;
  executionJsonInput: string;
  setExecutionJsonInput: (text: string) => void;
  executionHistory: ExecutionRecord[];
  currentExecution: ExecutionRecord | null;
  setCurrentExecution: React.Dispatch<React.SetStateAction<ExecutionRecord | null>>;
  executing: boolean;
  historyLoading: boolean;
  deletingExecutionId: string | null;
  clearingExecutionHistory: boolean;
  pollingExecutionId: string | null;
  executionValidationError: ValidationErrorData | null;
  supportedFields: ReturnType<typeof resolveSchemaFields>["supportedFields"];
  unsupportedFields: ReturnType<typeof resolveSchemaFields>["unsupportedFields"];
  supportedOutputFields: ReturnType<typeof resolveSchemaFields>["supportedFields"];
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  hasActiveExecutionHistory: boolean;
  supportsSchemaForm: boolean;
  executionInitialState: ReturnType<typeof buildSchemaFieldInitialState>;
  handleExecute: () => Promise<void>;
  handleDeleteExecution: (record: ExecutionRecord) => Promise<void>;
  handleClearExecutionHistory: () => Promise<void>;
  handleExecutionInputModeChange: (nextMode: string) => void;
  handleResetExecutionInput: () => void;
  loadExecutionHistory: (scriptId: string, preferredExecutionId?: string) => Promise<void>;
}

export function useScriptExecution({
  currentScript,
  executionForm,
  messageApi
}: UseScriptExecutionParams): ScriptExecutionContext {
  const [executionMode, setExecutionMode] = useState<SubmitMode>("SYNC");
  const [executionInputMode, setExecutionInputMode] = useState<ExecutionInputMode>("JSON");
  const [executionJsonInput, setExecutionJsonInput] = useState("{}");
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);
  const [currentExecution, setCurrentExecution] = useState<ExecutionRecord | null>(null);
  const [executionValidationError, setExecutionValidationError] = useState<ValidationErrorData | null>(null);
  const [executing, setExecuting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deletingExecutionId, setDeletingExecutionId] = useState<string | null>(null);
  const [clearingExecutionHistory, setClearingExecutionHistory] = useState(false);
  const [pollingExecutionId, setPollingExecutionId] = useState<string | null>(null);
  const pollingTimerRef = useRef<number | null>(null);

  const { supportedFields, unsupportedFields } = useMemo(
    () => resolveSchemaFields(currentScript?.inputSchema),
    [currentScript?.inputSchema]
  );
  const { supportedFields: supportedOutputFields } = useMemo(
    () => resolveSchemaFields(currentScript?.outputSchema),
    [currentScript?.outputSchema]
  );
  const executionInitialState = useMemo(
    () => buildSchemaFieldInitialState(supportedFields),
    [supportedFields]
  );
  const hasInputSchema = Boolean(currentScript?.inputSchema && Object.keys(currentScript.inputSchema).length > 0);
  const hasOutputSchema = Boolean(currentScript?.outputSchema && Object.keys(currentScript.outputSchema).length > 0);
  const supportsSchemaForm = supportedFields.length > 0;
  const hasActiveExecutionHistory = executionHistory.some((record) => isExecutionActive(record.status));

  const clearPolling = () => {
    if (pollingTimerRef.current !== null) {
      window.clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setPollingExecutionId(null);
  };

  const sortExecutions = (records: ExecutionRecord[]): ExecutionRecord[] =>
    [...records].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));

  const syncExecutionState = (records: ExecutionRecord[], preferredExecutionId?: string) => {
    const sorted = sortExecutions(records);
    setExecutionHistory(sorted);
    setCurrentExecution((previous) => {
      if (preferredExecutionId) {
        return sorted.find((item) => item.id === preferredExecutionId) ?? null;
      }
      if (previous?.id) {
        return sorted.find((item) => item.id === previous.id) ?? null;
      }
      return null;
    });
  };

  const loadExecutionHistory = async (scriptId: string, preferredExecutionId?: string) => {
    setHistoryLoading(true);
    try {
      const records = await listExecutions(scriptId);
      syncExecutionState(records, preferredExecutionId);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载执行历史失败";
      messageApi.error(detail);
    } finally {
      setHistoryLoading(false);
    }
  };

  const pollExecution = async (executionId: string, scriptId: string) => {
    try {
      const record = await getExecution(executionId);
      setCurrentExecution((previous) => (previous?.id === executionId ? record : previous));
      setExecutionHistory((previous) =>
        sortExecutions([record, ...previous.filter((item) => item.id !== record.id)])
      );

      if (isExecutionActive(record.status)) {
        setPollingExecutionId(executionId);
        pollingTimerRef.current = window.setTimeout(() => {
          void pollExecution(executionId, scriptId);
        }, 2000);
        return;
      }

      clearPolling();
      await loadExecutionHistory(scriptId, executionId);
    } catch (error) {
      clearPolling();
      const detail = error instanceof ApiError ? error.message : "查询执行结果失败";
      messageApi.error(detail);
    }
  };

  const startPolling = (executionId: string, scriptId: string) => {
    clearPolling();
    setPollingExecutionId(executionId);
    pollingTimerRef.current = window.setTimeout(() => {
      void pollExecution(executionId, scriptId);
    }, 2000);
  };

  useEffect(() => {
    clearPolling();
    executionForm.resetFields();
    executionForm.setFieldsValue(executionInitialState.formValues as Record<string, any>);
    setExecutionMode("SYNC");
    setExecutionJsonInput(executionInitialState.jsonText);
    setExecutionInputMode(supportsSchemaForm ? "SCHEMA" : "JSON");
    setExecutionValidationError(null);

    if (!currentScript?.id) {
      setExecutionHistory([]);
      setCurrentExecution(null);
      return;
    }

    setExecutionHistory([]);
    setCurrentExecution(null);
    void loadExecutionHistory(currentScript.id);
  }, [currentScript?.id, executionForm, executionInitialState, supportsSchemaForm]);

  useEffect(() => () => clearPolling(), []);

  const handleExecute = async () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }

    setExecuting(true);
    try {
      const input =
        executionInputMode === "SCHEMA" && supportsSchemaForm
          ? buildExecutionInputFromValues(
              supportedFields,
              (await executionForm.validateFields()) as Record<string, unknown>
            )
          : parseJsonText(executionJsonInput, "执行入参");
      const response = await executeScript({
        scriptId: currentScript.id,
        input,
        mode: executionMode
      });
      setExecutionValidationError(null);

      if (response.submitMode === "ASYNC" && isExecutionActive(response.status)) {
        messageApi.success("异步执行已提交");
        await loadExecutionHistory(currentScript.id, response.id);
        startPolling(response.id, currentScript.id);
      } else {
        clearPolling();
        await loadExecutionHistory(currentScript.id, response.id);
        if (response.status === "SUCCESS") {
          messageApi.success("执行完成");
        } else if (response.status === "FAILED") {
          messageApi.error(response.errorMessage || "执行失败");
        } else {
          messageApi.info(`当前状态: ${response.status}`);
        }
      }
    } catch (error) {
      if (error instanceof ApiError && isValidationErrorData(error.data)) {
        setExecutionValidationError(error.data);
      } else {
        setExecutionValidationError(null);
      }
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "执行失败";
      messageApi.error(detail);
    } finally {
      setExecuting(false);
    }
  };

  const handleExecutionInputModeChange = (nextMode: string) => {
    if (nextMode === "JSON") {
      try {
        const formInput = buildExecutionInputFromValues(
          supportedFields,
          executionForm.getFieldsValue(true) as Record<string, unknown>
        );
        setExecutionJsonInput(buildSchemaObjectEditorJsonText(executionJsonInput, "执行入参", formInput));
        setExecutionInputMode("JSON");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "切换到 JSON 模式失败";
        messageApi.error(detail);
      }
      return;
    }

    try {
      const parsed = parseSchemaObjectEditorJsonText(executionJsonInput, "执行入参");
      executionForm.setFieldsValue(parsed as Record<string, any>);
      setExecutionInputMode("SCHEMA");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "当前 JSON 不是合法执行入参";
      messageApi.error(detail);
    }
  };

  const handleResetExecutionInput = () => {
    executionForm.resetFields();
    executionForm.setFieldsValue(executionInitialState.formValues as Record<string, any>);
    setExecutionJsonInput(executionInitialState.jsonText);
    setExecutionValidationError(null);
  };

  const handleDeleteExecution = async (record: ExecutionRecord) => {
    setDeletingExecutionId(record.id);
    try {
      if (pollingExecutionId === record.id) {
        clearPolling();
      }
      await deleteExecution(record.id);
      syncExecutionState(executionHistory.filter((item) => item.id !== record.id));
      messageApi.success("删除成功");
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "删除执行记录失败";
      messageApi.error(detail);
    } finally {
      setDeletingExecutionId(null);
    }
  };

  const handleClearExecutionHistory = async () => {
    if (!currentScript?.id) return;

    setClearingExecutionHistory(true);
    try {
      clearPolling();
      await clearExecutions(currentScript.id);
      syncExecutionState([]);
      messageApi.success("历史执行结果已清空");
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "清空执行历史失败";
      messageApi.error(detail);
    } finally {
      setClearingExecutionHistory(false);
    }
  };

  return {
    executionMode,
    setExecutionMode,
    executionInputMode,
    executionJsonInput,
    setExecutionJsonInput,
    executionHistory,
    currentExecution,
    setCurrentExecution,
    executing,
    historyLoading,
    deletingExecutionId,
    clearingExecutionHistory,
    pollingExecutionId,
    executionValidationError,
    supportedFields,
    unsupportedFields,
    supportedOutputFields,
    hasInputSchema,
    hasOutputSchema,
    hasActiveExecutionHistory,
    supportsSchemaForm,
    executionInitialState,
    handleExecute,
    handleDeleteExecution,
    handleClearExecutionHistory,
    handleExecutionInputModeChange,
    handleResetExecutionInput,
    loadExecutionHistory
  };
}
