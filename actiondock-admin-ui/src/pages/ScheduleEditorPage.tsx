import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlayCircleOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  createSchedule,
  deleteSchedule,
  executePublishedScript,
  getExecution,
  getSchedule,
  listScripts,
  updateSchedule
} from "../api";
import { buildExecutionInputFromValues, type ObjectInputMode } from "../commands";
import { ExecutionResultCard } from "../components/ExecutionResultCard";
import { InfoHint } from "../components/InfoHint";
import { SchemaObjectEditor } from "../components/SchemaObjectEditor";
import { resolveSchemaFields } from "../schema";
import { buildSchemaFieldInitialState, isValidationErrorData } from "../schemaExecution";
import {
  buildSchemaObjectEditorJsonText,
  parseSchemaObjectEditorJsonText
} from "../schemaObjectEditorSupport";
import type {
  ExecutionRecord,
  ExecutionResponse,
  ExecutionStatus,
  ScriptDefinition,
  ScriptSchedule,
  ScriptScheduleUpsertRequest,
  SubmitMode,
  ValidationErrorData
} from "../types";
import { formatDateTime, parseJsonText, prettyJson } from "../utils";

const { Text } = Typography;

interface ScheduleEditorPageProps {
  colorMode: "light" | "dark";
  mode: "create" | "edit";
}

interface ScheduleFormValues {
  scriptId: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
}

type ScheduleDebugResult = ExecutionRecord | ExecutionResponse;

function toPublishedScheduleScript(script: ScriptDefinition): ScriptDefinition | null {
  if (script.publishedSnapshot) {
    return {
      ...script,
      name: script.publishedSnapshot.name,
      type: script.publishedSnapshot.type,
      source: script.publishedSnapshot.source,
      inputSchema: script.publishedSnapshot.inputSchema,
      outputSchema: script.publishedSnapshot.outputSchema,
      status: "PUBLISHED"
    };
  }

  if (script.status === "PUBLISHED") {
    return script;
  }

  return null;
}

function getExecutionStatusColor(status?: ExecutionStatus): string {
  switch (status) {
    case "SUCCESS":
      return "green";
    case "FAILED":
      return "red";
    case "RUNNING":
      return "processing";
    case "PENDING":
      return "gold";
    default:
      return "default";
  }
}

function hasDebugPayload(
  result: ScheduleDebugResult | null
): result is ExecutionResponse & { debug?: NonNullable<ExecutionResponse["debug"]> } {
  return result !== null && "debug" in result;
}

function readDebugInput(result: ScheduleDebugResult): Record<string, unknown> {
  if (hasDebugPayload(result) && result.debug?.input) {
    return result.debug.input;
  }
  return "input" in result ? result.input : {};
}

export function ScheduleEditorPage({ colorMode, mode }: ScheduleEditorPageProps) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [executingDebug, setExecutingDebug] = useState(false);
  const [currentSchedule, setCurrentSchedule] = useState<ScriptSchedule | null>(null);
  const [debugResult, setDebugResult] = useState<ScheduleDebugResult | null>(null);
  const [debugValidationError, setDebugValidationError] = useState<ValidationErrorData | null>(null);
  const [executionMode, setExecutionMode] = useState<SubmitMode>("SYNC");
  const [pollingExecutionId, setPollingExecutionId] = useState<string | null>(null);
  const [form] = Form.useForm<ScheduleFormValues>();
  const [inputForm] = Form.useForm<Record<string, unknown>>();
  const [messageApi, contextHolder] = message.useMessage();
  const [scheduleInputMode, setScheduleInputMode] = useState<ObjectInputMode>("JSON");
  const [scheduleInputJson, setScheduleInputJson] = useState("{}");
  const pollingTimerRef = useRef<number | null>(null);
  const debugPanelRef = useRef<HTMLDivElement | null>(null);

  const publishedScripts = useMemo(
    () =>
      scripts
        .map(toPublishedScheduleScript)
        .filter((script): script is ScriptDefinition => script !== null)
        .sort((left, right) => left.id.localeCompare(right.id)),
    [scripts]
  );
  const scheduleFormValues = useMemo<ScheduleFormValues>(
    () =>
      mode === "edit" && currentSchedule
        ? {
            scriptId: currentSchedule.scriptId,
            name: currentSchedule.name,
            cronExpression: currentSchedule.cronExpression,
            enabled: currentSchedule.enabled
          }
        : {
            scriptId: publishedScripts[0]?.id ?? "",
            name: "",
            cronExpression: "0 */5 * * * *",
            enabled: true
          },
    [currentSchedule, mode, publishedScripts]
  );
  const selectedScriptId = Form.useWatch("scriptId", form);
  const selectedPublishedScript = useMemo(
    () => publishedScripts.find((script) => script.id === selectedScriptId) ?? null,
    [publishedScripts, selectedScriptId]
  );
  const selectedScript = useMemo(
    () =>
      selectedPublishedScript ??
      scripts.find((script) => script.id === selectedScriptId) ??
      null,
    [scripts, selectedPublishedScript, selectedScriptId]
  );
  const scheduleScriptOptions = useMemo(() => {
    const options = publishedScripts.map((script) => ({
      label: `${script.name} (${script.id})`,
      value: script.id
    }));

    if (mode !== "edit" || !currentSchedule || options.some((option) => option.value === currentSchedule.scriptId)) {
      return options;
    }

    return [
      {
        label: `${selectedScript?.name ?? currentSchedule.scriptId} (${currentSchedule.scriptId})`,
        value: currentSchedule.scriptId
      },
      ...options
    ];
  }, [currentSchedule, mode, publishedScripts, selectedScript?.name]);
  const showCreateEmptyState = mode === "create" && publishedScripts.length === 0;
  const showPublishedScriptWarning =
    mode === "edit" &&
    currentSchedule !== null &&
    selectedPublishedScript === null;
  const { supportedFields: supportedInputFields, unsupportedFields: unsupportedInputFields } = useMemo(
    () => resolveSchemaFields(selectedScript?.inputSchema),
    [selectedScript?.inputSchema]
  );
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";

  const clearPolling = () => {
    if (pollingTimerRef.current !== null) {
      window.clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setPollingExecutionId(null);
  };

  const clearDebugState = () => {
    clearPolling();
    setDebugResult(null);
    setDebugValidationError(null);
  };

  const resetInputEditor = (scriptId?: string, input?: Record<string, unknown>) => {
    const script =
      publishedScripts.find((item) => item.id === scriptId) ?? scripts.find((item) => item.id === scriptId);
    const { supportedFields } = resolveSchemaFields(script?.inputSchema);
    const initialState = buildSchemaFieldInitialState(supportedFields);
    const nextFormValues = input ?? initialState.formValues;

    inputForm.resetFields();
    inputForm.setFieldsValue(nextFormValues as Record<string, any>);
    setScheduleInputJson(prettyJson(input ?? initialState.formValues));
    setScheduleInputMode(supportedFields.length > 0 ? "SCHEMA" : "JSON");
  };

  const applyCreateDefaults = (availableScripts: ScriptDefinition[]) => {
    const defaultScriptId =
      availableScripts
        .map(toPublishedScheduleScript)
        .filter((script): script is ScriptDefinition => script !== null)
        .sort((left, right) => left.id.localeCompare(right.id))[0]?.id ?? "";

    setCurrentSchedule(null);
    clearDebugState();

    const script = availableScripts
      .map(toPublishedScheduleScript)
      .find((item): item is ScriptDefinition => item !== null && item.id === defaultScriptId);
    const { supportedFields } = resolveSchemaFields(script?.inputSchema);
    const initialState = buildSchemaFieldInitialState(supportedFields);
    setScheduleInputJson(initialState.jsonText);
    setScheduleInputMode(supportedFields.length > 0 ? "SCHEMA" : "JSON");
  };

  const applyLoadedSchedule = (schedule: ScriptSchedule, availableScripts: ScriptDefinition[]) => {
    setCurrentSchedule(schedule);

    const script = availableScripts
      .map(toPublishedScheduleScript)
      .find((item): item is ScriptDefinition => item !== null && item.id === schedule.scriptId);
    const { supportedFields } = resolveSchemaFields(script?.inputSchema);
    setScheduleInputJson(prettyJson(schedule.input));
    setScheduleInputMode(supportedFields.length > 0 ? "SCHEMA" : "JSON");
    clearDebugState();
  };

  useEffect(() => {
    let disposed = false;

    const loadPage = async () => {
      setLoading(true);
      try {
        if (mode === "create") {
          const scriptData = await listScripts();
          if (disposed) {
            return;
          }
          setScripts(scriptData);
          applyCreateDefaults(scriptData);
          return;
        }

        if (!id) {
          throw new Error("缺少定时任务 ID");
        }

        const [scriptData, schedule] = await Promise.all([listScripts(), getSchedule(id)]);
        if (disposed) {
          return;
        }
        setScripts(scriptData);
        applyLoadedSchedule(schedule, scriptData);
      } catch (error) {
        if (disposed) {
          return;
        }
        const detail = error instanceof ApiError || error instanceof Error ? error.message : "加载定时任务失败";
        messageApi.error(detail);
        if (mode === "edit") {
          navigate("/schedules", { replace: true });
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void loadPage();

    return () => {
      disposed = true;
      clearPolling();
    };
  }, [id, messageApi, mode, navigate]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (mode === "edit" && currentSchedule) {
      resetInputEditor(currentSchedule.scriptId, currentSchedule.input);
      return;
    }

    if (mode === "create") {
      resetInputEditor(scheduleFormValues.scriptId);
    }
  }, [currentSchedule, loading, mode, scheduleFormValues.scriptId, scripts]);

  useEffect(() => {
    if (!loading && searchParams.get("panel") === "debug") {
      window.setTimeout(() => {
        debugPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }, [loading, searchParams]);

  const isExecutionActive = (status: ExecutionStatus) => status === "PENDING" || status === "RUNNING";

  const pollExecution = async (executionId: string) => {
    try {
      const record = await getExecution(executionId);
      setDebugResult(record);

      if (isExecutionActive(record.status)) {
        setPollingExecutionId(executionId);
        pollingTimerRef.current = window.setTimeout(() => {
          void pollExecution(executionId);
        }, 2000);
        return;
      }

      clearPolling();
      if (record.status === "SUCCESS") {
        messageApi.success("调试执行完成");
      } else if (record.status === "FAILED") {
        messageApi.error(record.errorMessage || "调试执行失败");
      }
    } catch (error) {
      clearPolling();
      const detail = error instanceof ApiError ? error.message : "查询调试结果失败";
      messageApi.error(detail);
    }
  };

  const startPolling = (executionId: string) => {
    clearPolling();
    setPollingExecutionId(executionId);
    pollingTimerRef.current = window.setTimeout(() => {
      void pollExecution(executionId);
    }, 2000);
  };

  const buildCurrentInput = async (label: string): Promise<Record<string, unknown>> => {
    if (scheduleInputMode === "SCHEMA" && supportedInputFields.length > 0) {
      return buildExecutionInputFromValues(
        supportedInputFields,
        (await inputForm.validateFields()) as Record<string, unknown>
      );
    }
    return parseJsonText(scheduleInputJson, label);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload: ScriptScheduleUpsertRequest = {
        scriptId: values.scriptId,
        name: values.name.trim(),
        cronExpression: values.cronExpression.trim(),
        input: await buildCurrentInput("定时任务入参"),
        enabled: values.enabled
      };

      setSaving(true);
      const saved =
        mode === "edit" && currentSchedule
          ? await updateSchedule(currentSchedule.id, payload)
          : await createSchedule(payload);

      messageApi.success(mode === "edit" ? "定时任务已更新" : "定时任务已创建");

      if (mode === "create") {
        navigate(`/schedules/${saved.id}`, { replace: true });
        return;
      }

      setCurrentSchedule(saved);
      form.setFieldsValue({
        scriptId: saved.scriptId,
        name: saved.name,
        cronExpression: saved.cronExpression,
        enabled: saved.enabled
      });
      resetInputEditor(saved.scriptId, saved.input);
    } catch (error) {
      if (error instanceof Error && error.message.includes("定时任务入参")) {
        messageApi.error(error.message);
        return;
      }
      if (error instanceof ApiError) {
        messageApi.error(error.message);
        return;
      }
      if (typeof error === "object" && error && "errorFields" in error) {
        return;
      }
      messageApi.error(mode === "edit" ? "更新定时任务失败" : "创建定时任务失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentSchedule) {
      return;
    }

    setDeleting(true);
    try {
      await deleteSchedule(currentSchedule.id);
      messageApi.success("定时任务已删除");
      navigate("/schedules", { replace: true });
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "删除定时任务失败";
      messageApi.error(detail);
    } finally {
      setDeleting(false);
    }
  };

  const handleDebugExecute = async () => {
    if (!selectedPublishedScript?.id) {
      messageApi.warning("请先选择一个已发布脚本");
      return;
    }

    setExecutingDebug(true);
    setDebugValidationError(null);
    inputForm.setFields(
      supportedInputFields.map((field) => ({
        name: field.name,
        errors: []
      }))
    );

    try {
      const response = await executePublishedScript(selectedPublishedScript.id, {
        input: await buildCurrentInput("调试入参"),
        mode: executionMode,
        responseView: "DEBUG"
      });

      if (response.submitMode === "ASYNC" && isExecutionActive(response.status)) {
        setDebugResult(response);
        startPolling(response.id);
        messageApi.success("异步调试已提交");
      } else {
        clearPolling();
        setDebugResult(response);
        if (response.status === "SUCCESS") {
          messageApi.success("调试执行完成");
        } else if (response.status === "FAILED") {
          messageApi.error(response.errorMessage || "调试执行失败");
        } else {
          messageApi.info(`当前状态: ${response.status}`);
        }
      }
    } catch (error) {
      if (error instanceof ApiError && isValidationErrorData(error.data)) {
        setDebugValidationError(error.data);
        const formFieldNames = new Set(supportedInputFields.map((field) => field.name));
        inputForm.setFields(
          error.data.fieldErrors
            .filter((fieldError) => formFieldNames.has(fieldError.field))
            .map((fieldError) => ({
              name: fieldError.field,
              errors: [fieldError.message]
            }))
        );
      } else {
        setDebugValidationError(null);
      }

      const detail = error instanceof ApiError || error instanceof Error ? error.message : "调试执行失败";
      messageApi.error(detail);
    } finally {
      setExecutingDebug(false);
    }
  };

  const handleScheduleInputModeChange = (nextMode: string) => {
    if (nextMode === "JSON") {
      try {
        const formInput = buildExecutionInputFromValues(
          supportedInputFields,
          inputForm.getFieldsValue(true) as Record<string, unknown>
        );
        setScheduleInputJson(buildSchemaObjectEditorJsonText(scheduleInputJson, "定时任务入参", formInput));
        setScheduleInputMode("JSON");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "切换到 JSON 模式失败";
        messageApi.error(detail);
      }
      return;
    }

    try {
      const parsed = parseSchemaObjectEditorJsonText(scheduleInputJson, "定时任务入参");
      inputForm.setFieldsValue(parsed as Record<string, any>);
      setScheduleInputMode("SCHEMA");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "当前 JSON 不是合法定时任务入参";
      messageApi.error(detail);
    }
  };

  const handleScriptChange = (scriptId: string) => {
    resetInputEditor(scriptId);
    clearDebugState();
  };

  const handleReset = () => {
    if (currentSchedule) {
      applyLoadedSchedule(currentSchedule, scripts);
      return;
    }
    applyCreateDefaults(scripts);
  };

  return (
    <>
      {contextHolder}
      <Space className="script-editor-page" direction="vertical" size={16} style={{ width: "100%" }}>
        <Card>
          <Row className="page-card-header" justify="space-between" align="middle" gutter={[12, 12]}>
            <Col>
              <Space direction="vertical" size={2}>
                <Button
                  type="link"
                  icon={<ArrowLeftOutlined />}
                  style={{ paddingInline: 0 }}
                  onClick={() => navigate("/schedules")}
                >
                  返回列表
                </Button>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {mode === "create" ? "新建定时任务" : currentSchedule?.name ?? "定时任务明细"}
                </Typography.Title>
                {mode === "edit" && currentSchedule ? (
                  <Space size={8} wrap>
                    <Tag color={currentSchedule.enabled ? "green" : "default"}>
                      {currentSchedule.enabled ? "ENABLED" : "DISABLED"}
                    </Tag>
                    <Text type="secondary" code>
                      {currentSchedule.id}
                    </Text>
                    <Text type="secondary">
                      脚本: {selectedScript?.name ?? currentSchedule.scriptId} ({currentSchedule.scriptId})
                    </Text>
                  </Space>
                ) : null}
              </Space>
            </Col>
            <Col>
              <Space className="page-card-actions" wrap>
                {mode === "edit" && currentSchedule ? (
                  <Popconfirm
                    title="确认删除这个定时任务？"
                    description="删除后不可恢复。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true, loading: deleting }}
                    onConfirm={() => void handleDelete()}
                  >
                    <Button danger icon={<DeleteOutlined />} loading={deleting}>
                      删除
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button onClick={handleReset}>重置</Button>
                <Button type="primary" loading={saving} onClick={() => void handleSave()}>
                  {mode === "edit" ? "保存修改" : "创建任务"}
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {loading ? (
          <Card>
            <div className="page-loading">
              <Text type="secondary">加载中...</Text>
            </div>
          </Card>
        ) : showCreateEmptyState ? (
          <Card>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="请先发布脚本后再创建定时任务。"
            />
          </Card>
        ) : (
          <Card>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {showPublishedScriptWarning ? (
                <Alert
                  type="warning"
                  showIcon
                  message="当前任务关联脚本暂不可用于调试"
                  description="当前脚本无可用的已发布版本，调试已禁用。"
                />
              ) : null}

              <Row gutter={[16, 16]} align="stretch" className="equal-height-row">
                <Col xs={24} xl={11} className="equal-height-col">
                  <Card
                    type="inner"
                    className="equal-height-card"
                    title="任务配置"
                    extra={
                      mode === "create" ? (
                        <Text type="secondary">保存后由调度器使用这份固定输入</Text>
                      ) : currentSchedule ? (
                        <Text type="secondary">上次触发: {formatDateTime(currentSchedule.lastTriggeredAt)}</Text>
                      ) : null
                    }
                  >
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Form
                        key={mode === "edit" ? currentSchedule?.id ?? "schedule-edit" : `schedule-create-${scheduleFormValues.scriptId || "empty"}`}
                        form={form}
                        layout="vertical"
                        preserve={false}
                        initialValues={scheduleFormValues}
                      >
                        <Form.Item
                          label="所属脚本"
                          name="scriptId"
                          rules={[{ required: true, message: "请选择已发布脚本" }]}
                        >
                          <Select
                            disabled={mode === "edit"}
                            options={scheduleScriptOptions}
                            placeholder="选择一个已发布脚本"
                            onChange={handleScriptChange}
                          />
                        </Form.Item>
                        <Form.Item label="任务名称" name="name" rules={[{ required: true, message: "请输入任务名称" }]}>
                          <Input maxLength={80} placeholder="例如：每 5 分钟同步数据" />
                        </Form.Item>
                        <Form.Item
                          label={
                            <Space size={6}>
                              <span>Cron 表达式</span>
                              <InfoHint content="使用 Spring 6 段格式：秒 分 时 日 月 周；按服务端时区执行；同一任务若上次执行仍未完成，本次触发会跳过。" />
                            </Space>
                          }
                          name="cronExpression"
                          rules={[{ required: true, message: "请输入 Cron 表达式" }]}
                        >
                          <Input placeholder="例如：0 */5 * * * *" />
                        </Form.Item>
                        <Form.Item label="保存后启用" name="enabled" valuePropName="checked">
                          <Switch checkedChildren="启用" unCheckedChildren="停用" />
                        </Form.Item>
                      </Form>

                      <div>
                        <Text strong>固定输入</Text>
                        <div style={{ marginTop: 12 }}>
                          <Alert
                            type="info"
                            showIcon
                            message="固定输入中的字符串支持 ${config.xxx}；保存时会先解析并按脚本 inputSchema 校验。"
                            style={{ marginBottom: 12 }}
                          />
                          <SchemaObjectEditor
                            form={inputForm}
                            supportedFields={supportedInputFields}
                            unsupportedFields={unsupportedInputFields}
                            inputMode={scheduleInputMode}
                            onInputModeChange={handleScheduleInputModeChange}
                            jsonText={scheduleInputJson}
                            onJsonTextChange={setScheduleInputJson}
                            jsonLabel="定时任务入参 JSON"
                            jsonExtra="直接输入 JSON 对象保存或调试；需要复杂字段时也请切到这里维护。"
                            noSchemaExtra="当前脚本没有可渲染的 inputSchema，请直接输入 JSON 对象。"
                            editorTheme={editorTheme}
                          />
                        </div>
                      </div>
                    </Space>
                  </Card>
                </Col>

                <Col xs={24} xl={13} className="equal-height-col">
                  <div ref={debugPanelRef} style={{ width: "100%" }}>
                    <Card
                      type="inner"
                      className="equal-height-card"
                      title={
                        <Space size={6}>
                          <span>手工调试</span>
                          <InfoHint content="使用固定输入直接执行，不影响定时任务。" />
                        </Space>
                      }
                      extra={
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={executingDebug}
                          disabled={!selectedPublishedScript?.id}
                          onClick={() => void handleDebugExecute()}
                        >
                          执行调试
                        </Button>
                      }
                    >
                      <Space direction="vertical" size={16} style={{ width: "100%" }}>
                        {debugValidationError ? (
                          <Alert
                            type="error"
                            showIcon
                            message="调试入参校验失败"
                            description={debugValidationError.fieldErrors.map((item) => item.message).join("；")}
                          />
                        ) : null}

                        <Radio.Group
                          value={executionMode}
                          optionType="button"
                          buttonStyle="solid"
                          onChange={(event) => setExecutionMode(event.target.value as SubmitMode)}
                          options={[
                            { label: "同步执行", value: "SYNC" },
                            { label: "异步执行", value: "ASYNC" }
                          ]}
                        />

                        {!debugResult ? (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="点击「执行调试」后，这里会显示本次手工调试结果。"
                          />
                        ) : (
                          <ExecutionResultCard
                            execution={debugResult}
                            inputSchema={selectedScript?.inputSchema}
                            outputSchema={selectedScript?.outputSchema}
                            inputOverride={readDebugInput(debugResult)}
                            title="调试结果"
                            pollingExecutionId={pollingExecutionId}
                            errorTitle="调试执行失败"
                          />
                        )}
                      </Space>
                    </Card>
                  </div>
                </Col>
              </Row>
            </Space>
          </Card>
        )}
      </Space>
    </>
  );
}
