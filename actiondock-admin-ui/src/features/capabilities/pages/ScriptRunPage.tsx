import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Form,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { executeCapability, getPublishedCapability } from "../api";
import { getExecution } from "../../executions/api";
import { BatchRunPanel } from "../../../components/execution/BatchRunPanel";
import { ExecutionPresetBar } from "../../../components/execution/ExecutionPresetBar";
import { ExecutionResultCard } from "../../../components/execution/ExecutionResultCard";
import { usePollingExecution } from "../../../shared/hooks/usePollingExecution";
import { resolveSchemaFields } from "../../../services/schema";
import {
  buildSchemaExecutionInput,
  buildSchemaFieldInitialState,
  buildSchemaFieldRefillState,
  formatSchemaFieldSupplement,
  isValidationErrorData
} from "../../../services/schemaExecution";
import {
  buildSchemaFieldRules,
  getSchemaFieldValuePropName,
  renderSchemaFieldInput
} from "../../../services/schemaForm";
import type {
  ExecutionResponse,
  ScriptDefinition,
  SubmitMode,
  ValidationErrorData
} from "../../../shared/types";
import { ApiError } from "../../../shared/api/httpClient";
import { getErrorMessage, isExecutionActive } from "../../../services/utils";
import { isScriptPublished } from "../../../services/scriptPublication";

const { Text, Title } = Typography;

interface PageStateError {
  title: string;
  description: string;
}

function StatusCallout({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="run-status-card" bordered={false}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div className="run-status-card__kicker">Script Runtime</div>
        <Title level={3} className="run-status-card__title">
          {title}
        </Title>
        <Text className="run-status-card__description">{description}</Text>
        {action ? <div>{action}</div> : null}
      </Space>
    </Card>
  );
}

export function ScriptRunPage() {
  const { id } = useParams<{ id: string }>();
  const colorMode = useColorMode();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [script, setScript] = useState<ScriptDefinition | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResponse | null>(null);
  const [executedInput, setExecutedInput] = useState<Record<string, unknown> | null>(null);
  const [validationError, setValidationError] = useState<ValidationErrorData | null>(null);
  const [pageError, setPageError] = useState<PageStateError | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [executionMode, setExecutionMode] = useState<SubmitMode>("SYNC");
  const { pollingExecutionId, startPolling, clearPolling } = usePollingExecution({
    onPollResult: (record) => setExecutionResult(record),
    onCompleted: () => messageApi.success("执行完成"),
    onFailed: (record) => messageApi.error(record.errorMessage || "执行失败"),
    onError: (error) => messageApi.error(getErrorMessage(error, "查询执行结果失败"))
  });

  const { supportedFields: supportedInputFields, unsupportedFields: unsupportedInputFields } = useMemo(
    () => resolveSchemaFields(script?.inputSchema),
    [script?.inputSchema]
  );
  const { supportedFields: outputFields } = useMemo(
    () => resolveSchemaFields(script?.outputSchema),
    [script?.outputSchema]
  );
  const executionInitialState = useMemo(
    () => buildSchemaFieldInitialState(supportedInputFields),
    [supportedInputFields]
  );
  const canExecute = Boolean(isScriptPublished(script) && unsupportedInputFields.length === 0);
  const canBatchExecute = Boolean(isScriptPublished(script));
  const backPath = "/scripts";

  const watchedFormValues = Form.useWatch([], form) as Record<string, unknown> | undefined;

  const currentRunInput = useMemo(() => {
    if (!script || supportedInputFields.length === 0) return null;
    try {
      return buildSchemaExecutionInput(supportedInputFields, form.getFieldsValue(true) as Record<string, unknown>);
    } catch {
      return null;
    }
  }, [script, supportedInputFields, watchedFormValues]);

  const handleLoadPreset = (input: Record<string, unknown>) => {
    const refillState = buildSchemaFieldRefillState(supportedInputFields, input);
    form.resetFields();
    form.setFieldsValue(refillState.formValues as Record<string, unknown>);
    setValidationError(null);
    messageApi.success("已加载预设");
  };

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setPageError({
        title: "缺少脚本标识",
        description: "请在地址栏提供脚本 ID。"
      });
      return;
    }

    let disposed = false;

    const load = async () => {
      setLoading(true);
      setPageError(null);
      setExecutionResult(null);
      setExecutedInput(null);
      setValidationError(null);
      setScript(null);
      form.resetFields();

      try {
        const loadedScript = await getPublishedCapability(id);
        if (disposed) {
          return;
        }

        setScript(loadedScript);
      } catch (error) {
        if (disposed) {
          return;
        }

        const detail = error instanceof ApiError ? error.message : "加载正式使用页失败";
        if (detail.toLowerCase().includes("not published")) {
          setPageError({
            title: "脚本尚未发布",
            description: "请先在管理台发布脚本。"
          });
          return;
        }
        setPageError({
          title: detail.toLowerCase().includes("not found") ? "脚本不存在" : "暂时无法打开正式页",
          description: detail
        });
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [form, id]);

  useEffect(() => {
    if (!script) {
      return;
    }
    form.resetFields();
    form.setFieldsValue(executionInitialState.formValues);
  }, [executionInitialState.formValues, form, script]);

  const handleExecute = async () => {
    if (!script?.id || !canExecute) {
      return;
    }

    setExecuting(true);
    setValidationError(null);
    form.setFields(
      supportedInputFields.map((field) => ({
        name: field.name,
        errors: []
      }))
    );

    try {
      const values = (await form.validateFields()) as Record<string, unknown>;
      const input = buildSchemaExecutionInput(supportedInputFields, values);
      const response = await executeCapability(script.id, {
        input,
        mode: executionMode
      });
      setExecutedInput(input);

      if (response.submitMode === "ASYNC" && isExecutionActive(response.status)) {
        messageApi.success("异步执行已提交");
        setExecutionResult(response);
        startPolling(response.id);
      } else {
        clearPolling();
        setExecutionResult(response);
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
        setValidationError(error.data);
        const formFieldNames = new Set(supportedInputFields.map((field) => field.name));
        form.setFields(
          error.data.fieldErrors
            .filter((fieldError) => formFieldNames.has(fieldError.field))
            .map((fieldError) => ({
              name: fieldError.field,
              errors: [fieldError.message]
            }))
        );
      } else {
        setValidationError(null);
      }

      const detail = error instanceof ApiError || error instanceof Error ? error.message : "执行失败";
      messageApi.error(detail);
    } finally {
      setExecuting(false);
    }
  };

  const handleReset = () => {
    clearPolling();
    form.resetFields();
    form.setFieldsValue(executionInitialState.formValues);
    setValidationError(null);
    setExecutionResult(null);
    setExecutedInput(null);
  };

  if (loading) {
    return (
      <div className="page-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (pageError && !script) {
    return (
      <>
        {contextHolder}
        <div className={`run-page run-page--${colorMode}`}>
          <div className="run-page__topbar">
            <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(backPath)}>
              返回列表
            </Button>
          </div>
          <StatusCallout
            title={pageError.title}
            description={pageError.description}
            action={
              <Button type="primary" onClick={() => navigate(backPath)}>
                返回
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {contextHolder}
      <div className={`run-page run-page--${colorMode}`}>
        <div className="run-page__topbar">
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(backPath)}>
            返回列表
          </Button>
        </div>

        <header className="run-page__headline">
          <Title className="run-page__title">{script?.name ?? id}</Title>
        </header>

        {pageError ? (
          <StatusCallout title={pageError.title} description={pageError.description} />
        ) : null}

        <Tabs
          defaultActiveKey="single"
          items={[
            {
              key: "single",
              label: "单次运行",
              children: (
                <div className="run-page__layout">
                  <Card
                    className="run-panel run-panel--input"
                    title={<Space>输入 <Tooltip title="字符串输入支持 ${config.xxx}；脚本内部也可通过只读变量 config 读取全局配置值。"><QuestionCircleOutlined style={{ color: "#1677ff", fontSize: 14 }} /></Tooltip></Space>}
                  >
                    {unsupportedInputFields.length > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="当前脚本含复杂输入结构"
                        description={`正式页暂不支持这些字段类型：${unsupportedInputFields.join("、")}`}
                        style={{ marginBottom: 14 }}
                      />
                    ) : null}

                    {validationError ? (
                      <Alert
                        type="error"
                        showIcon
                        message="输入参数校验失败"
                        description={validationError.fieldErrors.map((item) => item.message).join("；")}
                        style={{ marginBottom: 14 }}
                      />
                    ) : null}

                    <div className="script-editor-page__execution-toolbar" style={{ marginBottom: 16 }}>
                      <Space size={12} wrap className="script-editor-page__execution-actions">
                        <Button icon={<ReloadOutlined />} onClick={handleReset}>
                          重置
                        </Button>
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={executing}
                          disabled={!canExecute}
                          onClick={() => void handleExecute()}
                        >
                          执行
                        </Button>
                      </Space>
                    </div>

                    <Divider style={{ margin: '0 0 16px 0' }} />

                    {supportedInputFields.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <ExecutionPresetBar
                          scriptId={script?.id}
                          inputSchema={script?.inputSchema}
                          currentInput={currentRunInput}
                          onLoadPreset={handleLoadPreset}
                        />
                      </div>
                    )}

                    <Checkbox
                      checked={executionMode === "ASYNC"}
                      onChange={(event) => setExecutionMode(event.target.checked ? "ASYNC" : "SYNC")}
                      style={{ marginBottom: 16 }}
                    >
                      异步执行
                    </Checkbox>

                    {supportedInputFields.length === 0 ? (
                      <div className="run-panel__empty">
                        <Text strong>该脚本无需输入参数</Text>
                        <Text type="secondary">点击“执行”后会以空对象提交。</Text>
                      </div>
                    ) : (
                      <Form form={form} layout="vertical" className="run-form">
                        {supportedInputFields.map((field) => {
                          const supplement = formatSchemaFieldSupplement(field);

                          return (
                            <div key={field.name} className="run-field">
                              <div className="run-field__header">
                                <div>
                                  <Text className="run-field__label">{field.label}</Text>
                                  <Text className="run-field__name">{field.name}</Text>
                                </div>
                                {field.required ? <Tag color="red">必填</Tag> : <Tag>选填</Tag>}
                              </div>
                              <Form.Item
                                name={field.name}
                                rules={buildSchemaFieldRules(field)}
                                valuePropName={getSchemaFieldValuePropName(field)}
                                extra={supplement ?? undefined}
                                style={{ marginBottom: 0 }}
                              >
                                {renderSchemaFieldInput(field, {
                                  booleanLabels: {
                                    checked: "是",
                                    unchecked: "否"
                                  }
                                })}
                              </Form.Item>
                            </div>
                          );
                        })}
                      </Form>
                    )}
                  </Card>

                  {executionResult ? (
                    <ExecutionResultCard
                      execution={executionResult}
                      inputSchema={script?.inputSchema}
                      outputSchema={script?.outputSchema}
                      inputOverride={executedInput ?? undefined}
                      pollingExecutionId={pollingExecutionId}
                      title="结果"
                    />
                  ) : (
                    <Card className="run-panel run-panel--output" title="结果">
                      <div className="run-panel__empty">
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="执行后这里会显示正式输出"
                        />
                      </div>
                    </Card>
                  )}
                </div>
              )
            },
            {
              key: "batch",
              label: "批量运行",
              children: script ? (
                <BatchRunPanel
                  surface="published"
                  scriptId={script.id}
                  scriptName={script.name}
                  inputSchema={script.inputSchema}
                  outputSchema={script.outputSchema}
                  supportedFields={supportedInputFields}
                  supportedOutputFields={outputFields}
                  unsupportedFields={unsupportedInputFields}
                  editorTheme={colorMode === "dark" ? "vs-dark" : "vs-light"}
                  messageApi={messageApi}
                  submitExecution={(input, mode) =>
                    executeCapability(script.id, {
                      input,
                      mode,
                      responseView: "RESULT"
                    })
                  }
                  fetchExecution={getExecution}
                  canExecute={canBatchExecute}
                  disabledReason={!canBatchExecute ? "当前脚本尚未发布" : undefined}
                />
              ) : (
                <Empty description="脚本加载后可进行批量运行" />
              )
            }
          ]}
        />
      </div>
    </>
  );
}
