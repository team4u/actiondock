import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
  SaveOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  clearExecutions,
  createScript,
  deleteExecution,
  deleteScript,
  executeScript,
  getExecution,
  getScript,
  listExecutions,
  publishScript,
  updateScript,
  validateScript
} from "../api";
import { getApiKey } from "../auth";
import { CodeEditor } from "../components/CodeEditor";
import { InfoHint } from "../components/InfoHint";
import {
  buildExecuteCliCommand,
  buildExecuteCurlCommand,
  buildExecutionInputFromValues,
  buildScriptContractCliCommand,
  buildScriptDetailCliCommand,
  buildScriptDetailCurlCommand,
  buildToolDetailCurlCommand,
  resolveExecutionCommandInput
} from "../commands";
import { SchemaBuilder } from "../components/SchemaBuilder";
import {
  createEmptySchemaEditorState,
  deserializeSchema,
  resolveSchemaFields,
  serializeSchemaEditorState
} from "../schema";
import {
  buildSchemaFieldRules,
  getSchemaFieldValuePropName,
  renderSchemaFieldInput
} from "../schemaForm";
import { isValidationErrorData } from "../schemaExecution";
import type {
  ExecutionRecord,
  ExecutionStatus,
  ScriptDefinition,
  SubmitMode,
  ValidationErrorData
} from "../types";
import type { SchemaEditorState, SchemaFieldDefinition } from "../schema";
import { copyText, formatDateTime, parseJsonText, prettyJson } from "../utils";

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface ScriptEditorPageProps {
  colorMode: "light" | "dark";
  mode: "create" | "edit";
}

interface ScriptFormValues {
  id: string;
  name: string;
  type: "GROOVY";
}

type ExecutionInputMode = "SCHEMA" | "JSON";

const DEFAULT_SOURCE = `def name = input.name ?: "World"
return [message: "Hello, " + name + "!"]`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortExecutions(records: ExecutionRecord[]): ExecutionRecord[] {
  return [...records].sort((left, right) =>
    (right.createdAt ?? "").localeCompare(left.createdAt ?? "")
  );
}

function getExecutionStatusColor(status: ExecutionStatus): string {
  switch (status) {
    case "SUCCESS":
      return "green";
    case "FAILED":
      return "red";
    case "RUNNING":
      return "processing";
    default:
      return "gold";
  }
}

function isExecutionActive(status: ExecutionStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}

function JsonPreview({
  title,
  value,
  emptyDescription
}: {
  title: string;
  value?: Record<string, unknown>;
  emptyDescription: string;
}) {
  const hasValue = Boolean(value && Object.keys(value).length > 0);

  return (
    <div className="execution-json-panel">
      <Text strong>{title}</Text>
      {hasValue ? (
        <pre className="json-preview">{prettyJson(value)}</pre>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
      )}
    </div>
  );
}

function SchemaFieldSummary({
  title,
  fields,
  unsupportedFields
}: {
  title: string;
  fields: SchemaFieldDefinition[];
  unsupportedFields: string[];
}) {
  if (fields.length === 0 && unsupportedFields.length === 0) {
    return null;
  }

  return (
    <div className="schema-contract">
      <Text strong>{title}</Text>
      {fields.length > 0 ? (
        <div className="schema-contract__list">
          {fields.map((field) => (
            <div key={field.name} className="schema-contract__item">
              <Space size={[8, 8]} wrap>
                <Text strong>{field.label}</Text>
                <Text code>{field.name}</Text>
                <Tag>{field.kind}</Tag>
                {field.required ? <Tag color="red">required</Tag> : <Tag>optional</Tag>}
              </Space>
              {field.enumValues && field.enumValues.length > 0 ? (
                <Text type="secondary">枚举值: {field.enumValues.join(", ")}</Text>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 schema 没有可提取的字段清单" />
      )}
      {unsupportedFields.length > 0 ? (
        <InfoHint
          label="存在未结构化展示的字段"
          content={`以下字段仅能通过 JSON 方式查看或传入：${unsupportedFields.join("、")}`}
        />
      ) : null}
    </div>
  );
}

function getCommandInputSourceLabel(source: "current-json" | "current-form" | "sample" | "empty"): string {
  switch (source) {
    case "current-json":
      return "当前 JSON 输入";
    case "current-form":
      return "当前表单输入";
    case "sample":
      return "示例请求体";
    default:
      return "空对象";
  }
}

function CommandPanel({
  command,
  onCopy,
  title
}: {
  command: string;
  onCopy: (value: string) => void;
  title: string;
}) {
  return (
    <div className="command-panel">
      <div className="command-panel__header">
        <Text strong>{title}</Text>
        <Button icon={<CopyOutlined />} onClick={() => onCopy(command)}>
          复制命令
        </Button>
      </div>
      <pre className="command-preview">
        <code>{command}</code>
      </pre>
    </div>
  );
}

export function ScriptEditorPage({ colorMode, mode }: ScriptEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<ScriptFormValues>();
  const [executionForm] = Form.useForm<Record<string, unknown>>();
  const watchedExecutionValues = Form.useWatch([], executionForm) as Record<string, unknown> | undefined;
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deletingScript, setDeletingScript] = useState(false);
  const [sourceText, setSourceText] = useState(DEFAULT_SOURCE);
  const [inputSchemaState, setInputSchemaState] = useState<SchemaEditorState>(
    createEmptySchemaEditorState()
  );
  const [outputSchemaState, setOutputSchemaState] = useState<SchemaEditorState>(
    createEmptySchemaEditorState()
  );
  const [currentScript, setCurrentScript] = useState<ScriptDefinition | null>(null);
  const [executionMode, setExecutionMode] = useState<SubmitMode>("SYNC");
  const [executionInputMode, setExecutionInputMode] = useState<ExecutionInputMode>("JSON");
  const [executionJsonInput, setExecutionJsonInput] = useState("{}");
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);
  const [currentExecution, setCurrentExecution] = useState<ExecutionRecord | null>(null);
  const [executionValidationError, setExecutionValidationError] = useState<ValidationErrorData | null>(null);
  const [deletingExecutionId, setDeletingExecutionId] = useState<string | null>(null);
  const [clearingExecutionHistory, setClearingExecutionHistory] = useState(false);
  const [pollingExecutionId, setPollingExecutionId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const pollingTimerRef = useRef<number | null>(null);

  const requestedTab = searchParams.get("tab");
  const activeTab =
    mode === "create"
      ? "definition"
      : requestedTab === "execution"
        ? "execution"
        : requestedTab === "commands"
          ? "commands"
          : "definition";
  const { supportedFields, unsupportedFields } = resolveSchemaFields(currentScript?.inputSchema);
  const { supportedFields: supportedOutputFields, unsupportedFields: unsupportedOutputFields } =
    resolveSchemaFields(currentScript?.outputSchema);
  const hasInputSchema = Boolean(currentScript?.inputSchema && Object.keys(currentScript.inputSchema).length > 0);
  const hasOutputSchema = Boolean(currentScript?.outputSchema && Object.keys(currentScript.outputSchema).length > 0);
  const outputValues = isRecord(currentExecution?.output) ? currentExecution.output : {};
  const supportsSchemaForm = supportedFields.length > 0;
  const hasActiveExecutionHistory = executionHistory.some((record) => isExecutionActive(record.status));
  const apiKey = getApiKey();
  const origin = window.location.origin;
  const commandInput = resolveExecutionCommandInput({
    fields: supportedFields,
    formValues: watchedExecutionValues,
    inputMode: executionInputMode,
    jsonInput: executionJsonInput
  });
  const detailCurlCommand = currentScript
    ? buildScriptDetailCurlCommand({
        apiKey,
        origin,
        scriptId: currentScript.id
      })
    : "";
  const detailCliCommand = currentScript ? buildScriptDetailCliCommand(currentScript.id) : "";
  const toolDetailCliCommand = currentScript ? buildScriptContractCliCommand(currentScript.id) : "";
  const toolDetailCurlCommand = currentScript
    ? buildToolDetailCurlCommand({
        apiKey,
        origin,
        scriptId: currentScript.id
      })
    : "";
  const executeCurlCommand = currentScript
    ? buildExecuteCurlCommand({
        apiKey,
        input: commandInput.value,
        mode: executionMode,
        origin,
        scriptId: currentScript.id
      })
    : "";
  const executeCliCommand = currentScript
    ? buildExecuteCliCommand({
        input: commandInput.value,
        mode: executionMode,
        scriptId: currentScript.id
      })
    : "";
  const toolContractResponseExample = currentScript
    ? {
        status: 0,
        msg: "处理成功",
        data: {
          ...(hasInputSchema ? { input: supportedFields } : {}),
          ...(hasOutputSchema ? { output: supportedOutputFields } : {})
        }
      }
    : undefined;

  const clearPolling = () => {
    if (pollingTimerRef.current !== null) {
      window.clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setPollingExecutionId(null);
  };

  const syncExecutionState = (records: ExecutionRecord[], preferredExecutionId?: string) => {
    const sorted = sortExecutions(records);
    setExecutionHistory(sorted);
    setCurrentExecution((previous) => {
      if (preferredExecutionId) {
        return sorted.find((item) => item.id === preferredExecutionId) ?? sorted[0] ?? null;
      }
      if (previous?.id) {
        return sorted.find((item) => item.id === previous.id) ?? sorted[0] ?? null;
      }
      return sorted[0] ?? null;
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

  const loadScript = async (scriptId: string) => {
    setLoading(true);
    try {
      const script = await getScript(scriptId);
      setCurrentScript(script);
      setExecutionValidationError(null);
      form.setFieldsValue({
        id: script.id,
        name: script.name,
        type: script.type
      });
      setSourceText(script.source);
      setInputSchemaState(deserializeSchema(script.inputSchema));
      setOutputSchemaState(deserializeSchema(script.outputSchema));
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载脚本失败";
      messageApi.error(detail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "create") {
      form.setFieldsValue({
        id: "",
        name: "",
        type: "GROOVY"
      });
      setCurrentScript(null);
      setExecutionValidationError(null);
      setSourceText(DEFAULT_SOURCE);
      setInputSchemaState(createEmptySchemaEditorState());
      setOutputSchemaState(createEmptySchemaEditorState());
      setLoading(false);
      return;
    }
    if (id) {
      void loadScript(id);
    }
  }, [form, id, mode]);

  useEffect(() => {
    clearPolling();
    executionForm.resetFields();
    setExecutionMode("SYNC");
    setExecutionJsonInput("{}");
    setExecutionInputMode(supportsSchemaForm ? "SCHEMA" : "JSON");

    if (!currentScript?.id) {
      setExecutionHistory([]);
      setCurrentExecution(null);
      return;
    }

    setExecutionHistory([]);
    setCurrentExecution(null);
    void loadExecutionHistory(currentScript.id);
  }, [currentScript?.id, executionForm, supportsSchemaForm]);

  useEffect(() => () => clearPolling(), []);

  const buildPayload = async (): Promise<ScriptDefinition> => {
    const values = await form.validateFields();
    const inputSchema = serializeSchemaEditorState(inputSchemaState, "输入结构");
    const outputSchema = serializeSchemaEditorState(outputSchemaState, "输出结构");

    return {
      id: values.id.trim(),
      name: values.name.trim(),
      type: "GROOVY",
      source: sourceText,
      inputSchema,
      outputSchema,
      status: currentScript?.status ?? "DRAFT",
      version: currentScript?.version ?? 1,
      createdAt: currentScript?.createdAt,
      updatedAt: currentScript?.updatedAt
    };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = await buildPayload();
      const saved = mode === "create" ? await createScript(payload) : await updateScript(payload.id, payload);
      messageApi.success("保存成功");
      setCurrentScript(saved);
      if (mode === "create") {
        navigate(`/scripts/${saved.id}`, { replace: true });
        return;
      }
      await loadScript(saved.id);
    } catch (error) {
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "保存失败";
      messageApi.error(detail);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }
    setValidating(true);
    try {
      await validateScript(currentScript.id);
      messageApi.success("校验通过");
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "校验失败";
      messageApi.error(detail);
    } finally {
      setValidating(false);
    }
  };

  const handleDeleteScript = async () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }

    setDeletingScript(true);
    try {
      clearPolling();
      await deleteScript(currentScript.id);
      messageApi.success("删除成功");
      navigate("/scripts", { replace: true });
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "删除脚本失败";
      messageApi.error(detail);
    } finally {
      setDeletingScript(false);
    }
  };

  const handlePublish = async () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }
    setPublishing(true);
    try {
      await publishScript(currentScript.id);
      messageApi.success("发布成功");
      await loadScript(currentScript.id);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "发布失败";
      messageApi.error(detail);
    } finally {
      setPublishing(false);
    }
  };

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
        messageApi.success("执行完成");
        await loadExecutionHistory(currentScript.id, response.id);
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

  const handleTabChange = (key: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (key === "execution" || key === "commands") {
      nextParams.set("tab", key);
    } else {
      nextParams.delete("tab");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleCopyCommand = async (command: string) => {
    try {
      await copyText(command);
      messageApi.success("命令已复制");
    } catch {
      messageApi.error("复制命令失败");
    }
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
    if (!currentScript?.id) {
      return;
    }

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

  const historyColumns: ColumnsType<ExecutionRecord> = [
    {
      title: "执行 ID",
      dataIndex: "id",
      key: "id",
      width: 280,
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: ExecutionRecord["status"]) => (
        <Tag color={getExecutionStatusColor(status)}>{status}</Tag>
      )
    },
    {
      title: "方式",
      dataIndex: "submitMode",
      key: "submitMode",
      width: 120
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "完成时间",
      dataIndex: "finishedAt",
      key: "finishedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, record) => (
        <Popconfirm
          title="确认删除这条执行记录？"
          okText="删除"
          cancelText="取消"
          onConfirm={() => void handleDeleteExecution(record)}
          disabled={isExecutionActive(record.status)}
        >
          <Button
            type="link"
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deletingExecutionId === record.id}
            disabled={isExecutionActive(record.status)}
            onClick={(event) => event.stopPropagation()}
          >
            删除
          </Button>
        </Popconfirm>
      )
    }
  ];

  if (loading) {
    return (
      <div className="page-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      {contextHolder}
      <Space className="script-editor-page" direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Row className="page-card-header" justify="space-between" align="middle" gutter={[16, 16]}>
            <Col>
              <Space direction="vertical" size={2}>
                <Button
                  type="link"
                  icon={<ArrowLeftOutlined />}
                  style={{ paddingInline: 0 }}
                  onClick={() => navigate("/scripts")}
                >
                  返回列表
                </Button>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {mode === "create" ? "新建脚本" : currentScript?.name ?? id}
                </Typography.Title>
                <Text type="secondary">使用 Ant Design 表单、Groovy 编辑器和 Schema 构建器维护脚本定义。</Text>
              </Space>
            </Col>
            <Col>
              <Space className="page-card-actions" wrap>
                {mode === "edit" && currentScript ? (
                  <Popconfirm
                    title="确认删除这个脚本？"
                    description="删除后不可恢复。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true, loading: deletingScript }}
                    onConfirm={() => void handleDeleteScript()}
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingScript}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button
                  icon={<CheckCircleOutlined />}
                  onClick={() => void handleValidate()}
                  loading={validating}
                >
                  校验
                </Button>
                <Button
                  icon={<RocketOutlined />}
                  type="primary"
                  ghost
                  onClick={() => void handlePublish()}
                  loading={publishing}
                >
                  发布
                </Button>
                <Button
                  icon={<SaveOutlined />}
                  type="primary"
                  onClick={() => void handleSave()}
                  loading={saving}
                >
                  保存
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {currentScript && (
          <Card>
            <Descriptions
              size="small"
              column={{
                xs: 1,
                sm: 2,
                lg: 4
              }}
            >
              <Descriptions.Item label="状态">
                <Tag color={currentScript.status === "PUBLISHED" ? "green" : "gold"}>
                  {currentScript.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="版本">{currentScript.version}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDateTime(currentScript.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDateTime(currentScript.updatedAt)}</Descriptions.Item>
            </Descriptions>
          </Card>
        )}

        <Card bodyStyle={{ paddingTop: 12 }}>
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={[
              {
                key: "definition",
                label: "脚本定义",
                children: (
                  <Row gutter={[20, 20]}>
                    <Col xs={24} xl={8}>
                      <Card title="基础信息">
                        <Form
                          form={form}
                          layout="vertical"
                          initialValues={{
                            id: "",
                            name: "",
                            type: "GROOVY"
                          }}
                        >
                          <Form.Item
                            label="脚本 ID"
                            name="id"
                            rules={[
                              { required: true, message: "请输入脚本 ID" },
                              {
                                pattern: /^[A-Za-z0-9_-]+$/,
                                message: "仅支持字母、数字、下划线和中横线"
                              }
                            ]}
                          >
                            <Input disabled={mode === "edit"} placeholder="例如 hello-groovy" />
                          </Form.Item>
                          <Form.Item
                            label="名称"
                            name="name"
                            rules={[{ required: true, message: "请输入脚本名称" }]}
                          >
                            <Input placeholder="例如 Hello Groovy" />
                          </Form.Item>
                          <Form.Item label="类型" name="type">
                            <Select
                              disabled
                              options={[
                                {
                                  value: "GROOVY",
                                  label: "GROOVY"
                                }
                              ]}
                            />
                          </Form.Item>
                        </Form>
                      </Card>
                    </Col>
                    <Col xs={24} xl={16}>
                      <Card
                        title="脚本内容"
                        extra={<Text type="secondary">Groovy 使用代码编辑器，输入输出结构支持 Builder 和 JSON 两种编辑方式</Text>}
                      >
                        <Tabs
                          items={[
                            {
                              key: "source",
                              label: "source.groovy",
                              children: (
                                <CodeEditor
                                  height="clamp(320px, 60vh, 420px)"
                                  language="groovy"
                                  value={sourceText}
                                  onChange={setSourceText}
                                  theme={editorTheme}
                                />
                              )
                            },
                            {
                              key: "input",
                              label: "inputSchema.json",
                              children: (
                                <SchemaBuilder
                                  label="输入结构"
                                  value={inputSchemaState}
                                  onChange={setInputSchemaState}
                                  theme={editorTheme}
                                />
                              )
                            },
                            {
                              key: "output",
                              label: "outputSchema.json",
                              children: (
                                <SchemaBuilder
                                  label="输出结构"
                                  value={outputSchemaState}
                                  onChange={setOutputSchemaState}
                                  theme={editorTheme}
                                />
                              )
                            }
                          ]}
                        />
                        <Space className="editor-footer">
                          <CodeOutlined />
                          <Text type="secondary">
                            保存时 Builder 模式会校验字段配置，JSON 模式会校验对象格式，Groovy 语法通过后端校验接口确认。
                          </Text>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                )
              },
              ...(currentScript
                ? [
                    {
                      key: "commands",
                      label: "调用命令",
                      children: (
                        <Space direction="vertical" size="large" style={{ width: "100%" }}>
                          <InfoHint
                            label="可直接执行的 REST API 与 CLI 命令"
                            content={
                              apiKey
                                ? `REST 命令已使用当前页面 origin ${origin} 并自动附带 Authorization 头。`
                                : `REST 命令已使用当前页面 origin ${origin}；当前未设置 API Key，因此不会附带 Authorization 头。`
                            }
                          />

                          <Tabs
                            items={[
                              {
                                key: "command-detail",
                                label: "查看详情",
                                children: (
                                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                                    <Text type="secondary">使用当前脚本 ID 生成</Text>
                                    <Tabs
                                      items={[
                                        {
                                          key: "detail-rest",
                                          label: "REST API",
                                          children: (
                                            <CommandPanel
                                              title="详情查询 cURL"
                                              command={detailCurlCommand}
                                              onCopy={(command) => void handleCopyCommand(command)}
                                            />
                                          )
                                        },
                                        {
                                          key: "detail-cli",
                                          label: "CLI",
                                          children: (
                                            <CommandPanel
                                              title="详情查询 CLI"
                                              command={detailCliCommand}
                                              onCopy={(command) => void handleCopyCommand(command)}
                                            />
                                          )
                                        }
                                      ]}
                                    />
                                  </Space>
                                )
                              },
                              {
                                key: "command-execute",
                                label: "执行脚本",
                                children: (
                                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                                    <Text type="secondary">跟随当前调试配置生成</Text>
                                    {commandInput.note && (
                                      <Alert
                                        type={commandInput.source === "sample" || commandInput.source === "empty" ? "warning" : "info"}
                                        showIcon
                                        message={commandInput.note}
                                      />
                                    )}
                                    <Descriptions size="small" column={isMobile ? 1 : 2}>
                                      <Descriptions.Item label="执行模式">
                                        {executionMode}
                                      </Descriptions.Item>
                                      <Descriptions.Item label="入参来源">
                                        {getCommandInputSourceLabel(commandInput.source)}
                                      </Descriptions.Item>
                                    </Descriptions>
                                    <Tabs
                                      items={[
                                        {
                                          key: "execute-rest",
                                          label: "REST API",
                                          children: (
                                            <CommandPanel
                                              title="执行脚本 cURL"
                                              command={executeCurlCommand}
                                              onCopy={(command) => void handleCopyCommand(command)}
                                            />
                                          )
                                        },
                                        {
                                          key: "execute-cli",
                                          label: "CLI",
                                          children: (
                                            <CommandPanel
                                              title="执行脚本 CLI"
                                              command={executeCliCommand}
                                              onCopy={(command) => void handleCopyCommand(command)}
                                            />
                                          )
                                        }
                                      ]}
                                    />
                                  </Space>
                                )
                              },
                              ...(hasInputSchema || hasOutputSchema
                                ? [
                                    {
                                      key: "command-contract",
                                      label: "Schema",
                                      children: (
                                        <Space direction="vertical" size="large" style={{ width: "100%" }}>
                                          <Text type="secondary">供模型与调用方查看输入输出定义</Text>
                                          <Tabs
                                            items={[
                                              {
                                                key: "contract-rest",
                                                label: "REST API",
                                                children: (
                                                  <CommandPanel
                                                    title="获取 Schema cURL"
                                                    command={toolDetailCurlCommand}
                                                    onCopy={(command) => void handleCopyCommand(command)}
                                                  />
                                                )
                                              },
                                              {
                                                key: "contract-cli",
                                                label: "CLI",
                                                children: (
                                                  <CommandPanel
                                                    title="获取 Schema CLI"
                                                    command={toolDetailCliCommand}
                                                    onCopy={(command) => void handleCopyCommand(command)}
                                                  />
                                                )
                                              }
                                            ]}
                                          />

                                          <JsonPreview
                                            title="Schema 响应示例"
                                            value={toolContractResponseExample}
                                            emptyDescription="当前没有可展示的 Schema 示例"
                                          />

                                          <Row gutter={[20, 20]}>
                                            {hasInputSchema ? (
                                              <Col xs={24} xl={12}>
                                                <SchemaFieldSummary
                                                  title="入参"
                                                  fields={supportedFields}
                                                  unsupportedFields={unsupportedFields}
                                                />
                                              </Col>
                                            ) : null}

                                            {hasOutputSchema ? (
                                              <Col xs={24} xl={12}>
                                                <SchemaFieldSummary
                                                  title="出参"
                                                  fields={supportedOutputFields}
                                                  unsupportedFields={unsupportedOutputFields}
                                                />
                                              </Col>
                                            ) : null}
                                          </Row>
                                        </Space>
                                      )
                                    }
                                  ]
                                : [])
                            ]}
                          />
                        </Space>
                      )
                    },
                    {
                      key: "execution",
                      label: "执行调试",
                      children: (
                        <Space direction="vertical" size="large" style={{ width: "100%" }}>
                          <Row gutter={[20, 20]}>
                            <Col xs={24} xl={10}>
                              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                                <Card
                                  type="inner"
                                  title="执行入参"
                                  extra={<Text type="secondary">根据 inputSchema 自动生成</Text>}
                                >
                                  <Space direction="vertical" size="large" style={{ width: "100%" }}>
                                    {executionValidationError && (
                                      <Alert
                                        type="error"
                                        showIcon
                                        message="参数校验失败"
                                        description={
                                          <div>
                                            {executionValidationError.fieldErrors.map((fieldError) => (
                                              <div key={`${fieldError.field}-${fieldError.reason}`}>
                                                <Text code>{fieldError.field}</Text>
                                                {" - "}
                                                {fieldError.message}
                                              </div>
                                            ))}
                                          </div>
                                        }
                                      />
                                    )}

                                    {hasInputSchema && (
                                      <SchemaFieldSummary
                                        title="参数清单"
                                        fields={supportedFields}
                                        unsupportedFields={unsupportedFields}
                                      />
                                    )}

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

                                    {supportedFields.length > 0 ? (
                                      <Tabs
                                        activeKey={executionInputMode}
                                        onChange={(key) => setExecutionInputMode(key as ExecutionInputMode)}
                                        items={[
                                          {
                                            key: "SCHEMA",
                                            label: "表单输入",
                                            children: (
                                              <Form form={executionForm} layout="vertical">
                                                {supportedFields.map((field) => {
                                                  return (
                                                    <Form.Item
                                                      key={field.name}
                                                      label={field.label}
                                                      name={field.name}
                                                      rules={buildSchemaFieldRules(field)}
                                                      valuePropName={getSchemaFieldValuePropName(field)}
                                                    >
                                                      {renderSchemaFieldInput(field)}
                                                    </Form.Item>
                                                  );
                                                })}
                                              </Form>
                                            )
                                          },
                                          {
                                            key: "JSON",
                                            label: "JSON 输入",
                                            children: (
                                              <Form layout="vertical">
                                                <Form.Item
                                                  label="执行入参 JSON"
                                                  extra="直接输入 JSON 对象执行，不依赖 inputSchema。"
                                                >
                                                  <CodeEditor
                                                    value={executionJsonInput}
                                                    onChange={setExecutionJsonInput}
                                                    placeholder='{"name":"Alice"}'
                                                    theme={editorTheme}
                                                  />
                                                </Form.Item>
                                              </Form>
                                            )
                                          }
                                        ]}
                                      />
                                    ) : (
                                      <Form layout="vertical">
                                        <Form.Item
                                          label="执行入参 JSON"
                                          extra="当前脚本没有可渲染的 inputSchema，请直接输入 JSON 对象。"
                                        >
                                          <CodeEditor
                                            value={executionJsonInput}
                                            onChange={setExecutionJsonInput}
                                            placeholder='{"name":"Alice"}'
                                            theme={editorTheme}
                                          />
                                        </Form.Item>
                                      </Form>
                                    )}

                                    <Button
                                      type="primary"
                                      icon={<PlayCircleOutlined />}
                                      onClick={() => void handleExecute()}
                                      loading={executing}
                                      block
                                    >
                                      执行脚本
                                    </Button>
                                  </Space>
                                </Card>

                                <Card
                                  type="inner"
                                  title="执行输出"
                                  extra={<Text type="secondary">根据 outputSchema 渲染</Text>}
                                >
                                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                                    {hasOutputSchema && (
                                      <SchemaFieldSummary
                                        title="输出字段清单"
                                        fields={supportedOutputFields}
                                        unsupportedFields={unsupportedOutputFields}
                                      />
                                    )}

                                    {!currentExecution ? (
                                      <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description="执行后将在这里查看输出结果"
                                      />
                                    ) : supportedOutputFields.length > 0 ? (
                                      <Form layout="vertical" disabled>
                                        {supportedOutputFields.map((field) => {
                                          const value = outputValues[field.name];

                                          if (field.kind === "enum") {
                                            return (
                                              <Form.Item key={field.name} label={field.label}>
                                                <Select
                                                  value={value}
                                                  options={(field.enumValues ?? []).map((item) => ({
                                                    value: item,
                                                    label: String(item)
                                                  }))}
                                                />
                                              </Form.Item>
                                            );
                                          }

                                          if (field.kind === "boolean") {
                                            return (
                                              <Form.Item key={field.name} label={field.label}>
                                                <Switch
                                                  checked={value === true}
                                                  checkedChildren="true"
                                                  unCheckedChildren="false"
                                                />
                                              </Form.Item>
                                            );
                                          }

                                          if (field.kind === "number" || field.kind === "integer") {
                                            return (
                                              <Form.Item key={field.name} label={field.label}>
                                                <InputNumber style={{ width: "100%" }} value={value as number | null} />
                                              </Form.Item>
                                            );
                                          }

                                          return (
                                            <Form.Item key={field.name} label={field.label}>
                                              <Input value={typeof value === "string" ? value : value == null ? "" : String(value)} />
                                            </Form.Item>
                                          );
                                        })}
                                      </Form>
                                    ) : (
                                      <JsonPreview
                                        title="输出 JSON 预览"
                                        value={currentExecution.output}
                                        emptyDescription="暂无输出结果"
                                      />
                                    )}

                                    {currentExecution &&
                                      supportedOutputFields.length > 0 &&
                                      unsupportedOutputFields.length > 0 && (
                                      <JsonPreview
                                        title="输出 JSON 预览"
                                        value={currentExecution.output}
                                        emptyDescription="暂无输出结果"
                                      />
                                    )}
                                  </Space>
                                </Card>
                              </Space>
                            </Col>

                            <Col xs={24} xl={14}>
                              <Card
                                type="inner"
                                title="最近一次执行"
                                extra={
                                  currentExecution ? (
                                    <Tag color={getExecutionStatusColor(currentExecution.status)}>
                                      {currentExecution.status}
                                    </Tag>
                                  ) : (
                                    <Text type="secondary">暂无结果</Text>
                                  )
                                }
                              >
                                {currentExecution ? (
                                  <Space direction="vertical" size="large" style={{ width: "100%" }}>
                                    <Descriptions
                                      size="small"
                                      column={{
                                        xs: 1,
                                        sm: 2,
                                        lg: 4
                                      }}
                                    >
                                      <Descriptions.Item label="执行 ID">
                                        <Text code>{currentExecution.id}</Text>
                                      </Descriptions.Item>
                                      <Descriptions.Item label="提交方式">
                                        {currentExecution.submitMode}
                                      </Descriptions.Item>
                                      <Descriptions.Item label="创建时间">
                                        {formatDateTime(currentExecution.createdAt)}
                                      </Descriptions.Item>
                                      <Descriptions.Item label="完成时间">
                                        {formatDateTime(currentExecution.finishedAt)}
                                      </Descriptions.Item>
                                    </Descriptions>

                                    {currentExecution.errorMessage && (
                                      <Alert
                                        type="error"
                                        showIcon
                                        message="执行失败"
                                        description={currentExecution.errorMessage}
                                      />
                                    )}

                                    <Tabs
                                      items={[
                                        {
                                          key: "input",
                                          label: "输入",
                                          children: (
                                            <JsonPreview
                                              title="提交参数"
                                              value={currentExecution.input}
                                              emptyDescription="该次执行没有输入参数"
                                            />
                                          )
                                        },
                                        {
                                          key: "display",
                                          label: "输出",
                                          children: (
                                            <JsonPreview
                                              title="执行结果"
                                              value={currentExecution.output}
                                              emptyDescription="暂无输出结果"
                                            />
                                          )
                                        }
                                      ]}
                                    />
                                  </Space>
                                ) : (
                                  <Empty description="执行后将在这里查看结果详情。" />
                                )}
                              </Card>
                            </Col>
                          </Row>

                          <Card
                            type="inner"
                            title="历史执行结果"
                            extra={
                              <Space className="history-card-actions" size="small" wrap>
                                {pollingExecutionId && (
                                  <Tag color="processing">轮询中: {pollingExecutionId.slice(0, 8)}</Tag>
                                )}
                                <Button
                                  icon={<ReloadOutlined />}
                                  onClick={() => void loadExecutionHistory(currentScript.id)}
                                  loading={historyLoading}
                                >
                                  刷新历史
                                </Button>
                                <Popconfirm
                                  title="确认清空当前脚本的历史执行结果？"
                                  okText="清空"
                                  cancelText="取消"
                                  onConfirm={() => void handleClearExecutionHistory()}
                                  disabled={executionHistory.length === 0 || hasActiveExecutionHistory}
                                >
                                  <Button
                                    danger
                                    icon={<DeleteOutlined />}
                                    loading={clearingExecutionHistory}
                                    disabled={executionHistory.length === 0 || hasActiveExecutionHistory}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    全部删除
                                  </Button>
                                </Popconfirm>
                              </Space>
                            }
                          >
                            <Table
                              className="execution-history-table"
                              rowKey="id"
                              loading={historyLoading}
                              columns={historyColumns}
                              dataSource={executionHistory}
                              pagination={{ pageSize: 5 }}
                              scroll={{ x: 900 }}
                              locale={{ emptyText: "当前脚本暂无执行记录" }}
                              onRow={(record) => ({
                                onClick: () => setCurrentExecution(record)
                              })}
                              rowClassName={(record) =>
                                record.id === currentExecution?.id
                                  ? "execution-history-row execution-history-row-active"
                                  : "execution-history-row"
                              }
                            />
                          </Card>
                        </Space>
                      )
                    }
                  ]
                : [])
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
