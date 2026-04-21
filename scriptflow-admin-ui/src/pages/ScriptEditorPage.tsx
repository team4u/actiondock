import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
  SaveOutlined
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
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
  createScript,
  executeScript,
  getExecution,
  getScript,
  listExecutions,
  publishScript,
  updateScript,
  validateScript
} from "../api";
import { SchemaBuilder } from "../components/SchemaBuilder";
import {
  createEmptySchemaEditorState,
  deserializeSchema,
  resolveSchemaFields,
  serializeSchemaEditorState
} from "../schema";
import type {
  ExecutionRecord,
  ExecutionStatus,
  ScriptDefinition,
  SubmitMode
} from "../types";
import type { SchemaEditorState, SchemaFieldDefinition } from "../schema";
import { formatDateTime, prettyJson } from "../utils";

const { Text } = Typography;

interface ScriptEditorPageProps {
  mode: "create" | "edit";
}

interface ScriptFormValues {
  id: string;
  name: string;
  type: "GROOVY";
}

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

function buildExecutionInput(
  fields: SchemaFieldDefinition[],
  values: Record<string, unknown>
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    const value = values[field.name];
    if (value === undefined || value === null || value === "") {
      return result;
    }
    result[field.name] = value;
    return result;
  }, {});
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

export function ScriptEditorPage({ mode }: ScriptEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<ScriptFormValues>();
  const [executionForm] = Form.useForm<Record<string, unknown>>();
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sourceText, setSourceText] = useState(DEFAULT_SOURCE);
  const [inputSchemaState, setInputSchemaState] = useState<SchemaEditorState>(
    createEmptySchemaEditorState()
  );
  const [outputSchemaState, setOutputSchemaState] = useState<SchemaEditorState>(
    createEmptySchemaEditorState()
  );
  const [currentScript, setCurrentScript] = useState<ScriptDefinition | null>(null);
  const [executionMode, setExecutionMode] = useState<SubmitMode>("SYNC");
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);
  const [currentExecution, setCurrentExecution] = useState<ExecutionRecord | null>(null);
  const [pollingExecutionId, setPollingExecutionId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const pollingTimerRef = useRef<number | null>(null);

  const requestedTab = searchParams.get("tab");
  const activeTab =
    mode === "create" ? "definition" : requestedTab === "execution" ? "execution" : "definition";
  const { supportedFields, unsupportedFields } = resolveSchemaFields(currentScript?.inputSchema);
  const { supportedFields: supportedOutputFields, unsupportedFields: unsupportedOutputFields } =
    resolveSchemaFields(currentScript?.outputSchema);
  const outputValues = isRecord(currentExecution?.output) ? currentExecution.output : {};

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
        return sorted.find((item) => item.id === preferredExecutionId) ?? previous;
      }
      if (previous?.id) {
        return sorted.find((item) => item.id === previous.id) ?? previous;
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

    if (!currentScript?.id) {
      setExecutionHistory([]);
      setCurrentExecution(null);
      return;
    }

    setExecutionHistory([]);
    setCurrentExecution(null);
    void loadExecutionHistory(currentScript.id);
  }, [currentScript?.id, executionForm]);

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
      const formValues = (await executionForm.validateFields()) as Record<string, unknown>;
      const input = buildExecutionInput(supportedFields, formValues);
      const record = await executeScript({
        scriptId: currentScript.id,
        input,
        mode: executionMode
      });

      setCurrentExecution(record);
      setExecutionHistory((previous) =>
        sortExecutions([record, ...previous.filter((item) => item.id !== record.id)])
      );

      if (record.submitMode === "ASYNC" && isExecutionActive(record.status)) {
        messageApi.success("异步执行已提交");
        await loadExecutionHistory(currentScript.id, record.id);
        startPolling(record.id, currentScript.id);
      } else {
        clearPolling();
        messageApi.success("执行完成");
        await loadExecutionHistory(currentScript.id, record.id);
      }
    } catch (error) {
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "执行失败";
      messageApi.error(detail);
    } finally {
      setExecuting(false);
    }
  };

  const handleTabChange = (key: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (key === "execution") {
      nextParams.set("tab", "execution");
    } else {
      nextParams.delete("tab");
    }
    setSearchParams(nextParams, { replace: true });
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
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Row justify="space-between" align="middle" gutter={[16, 16]}>
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
              <Space wrap>
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
                        extra={<Text type="secondary">Groovy 使用代码编辑器，输入输出结构使用可视化构建器</Text>}
                      >
                        <Tabs
                          items={[
                            {
                              key: "source",
                              label: "source.groovy",
                              children: (
                                <Editor
                                  height="420px"
                                  defaultLanguage="groovy"
                                  language="groovy"
                                  value={sourceText}
                                  onChange={(value) => setSourceText(value ?? "")}
                                  theme="vs-light"
                                  options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    scrollBeyondLastLine: false
                                  }}
                                />
                              )
                            },
                            {
                              key: "input",
                              label: "inputSchema.json",
                              children: <SchemaBuilder label="输入结构" value={inputSchemaState} onChange={setInputSchemaState} />
                            },
                            {
                              key: "output",
                              label: "outputSchema.json",
                              children: <SchemaBuilder label="输出结构" value={outputSchemaState} onChange={setOutputSchemaState} />
                            }
                          ]}
                        />
                        <Space className="editor-footer">
                          <CodeOutlined />
                          <Text type="secondary">
                            保存时会校验 Schema 字段配置，Groovy 语法通过后端校验接口确认。
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
                      key: "execution",
                      label: "执行调试",
                      children: (
                        <Space direction="vertical" size="large" style={{ width: "100%" }}>
                          <div className="tab-toolbar">
                            <Space>
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
                            </Space>
                          </div>

                          {unsupportedFields.length > 0 && (
                            <Alert
                              type="info"
                              showIcon
                              message="部分输入字段暂不支持自动生成表单"
                              description={`以下字段不会出现在执行表单中：${unsupportedFields.join("、")}`}
                            />
                          )}

                          <Row gutter={[20, 20]}>
                            <Col xs={24} xl={10}>
                              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                                <Card
                                  type="inner"
                                  title="执行入参"
                                  extra={<Text type="secondary">根据 inputSchema 自动生成</Text>}
                                >
                                  <Space direction="vertical" size="large" style={{ width: "100%" }}>
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
                                      <Form form={executionForm} layout="vertical">
                                        {supportedFields.map((field) => {
                                          const rules = field.required
                                            ? [{ required: true, message: `请填写${field.label}` }]
                                            : undefined;

                                          if (field.kind === "enum") {
                                            return (
                                              <Form.Item
                                                key={field.name}
                                                label={field.label}
                                                name={field.name}
                                                rules={rules}
                                              >
                                                <Select
                                                  allowClear
                                                  placeholder={`请选择${field.label}`}
                                                  options={(field.enumValues ?? []).map((value) => ({
                                                    value,
                                                    label: String(value)
                                                  }))}
                                                />
                                              </Form.Item>
                                            );
                                          }

                                          if (field.kind === "boolean") {
                                            return (
                                              <Form.Item
                                                key={field.name}
                                                label={field.label}
                                                name={field.name}
                                                valuePropName="checked"
                                              >
                                                <Switch checkedChildren="true" unCheckedChildren="false" />
                                              </Form.Item>
                                            );
                                          }

                                          if (field.kind === "number" || field.kind === "integer") {
                                            return (
                                              <Form.Item
                                                key={field.name}
                                                label={field.label}
                                                name={field.name}
                                                rules={rules}
                                              >
                                                <InputNumber
                                                  style={{ width: "100%" }}
                                                  placeholder={`请输入${field.label}`}
                                                  precision={field.kind === "integer" ? 0 : undefined}
                                                />
                                              </Form.Item>
                                            );
                                          }

                                          return (
                                            <Form.Item
                                              key={field.name}
                                              label={field.label}
                                              name={field.name}
                                              rules={rules}
                                            >
                                              <Input placeholder={`请输入${field.label}`} />
                                            </Form.Item>
                                          );
                                        })}
                                      </Form>
                                    ) : (
                                      <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description="当前脚本没有可填写的输入字段，将以空对象提交。"
                                      />
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
                                    {unsupportedOutputFields.length > 0 && (
                                      <Alert
                                        type="info"
                                        showIcon
                                        message="部分输出字段暂不支持结构化渲染"
                                        description={`以下字段将仅在 JSON 预览中展示：${unsupportedOutputFields.join("、")}`}
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
                                      <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description="当前脚本没有可渲染的输出字段"
                                      />
                                    )}

                                    {currentExecution && unsupportedOutputFields.length > 0 && (
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

                          <Card type="inner" title="历史执行结果">
                            <Table
                              rowKey="id"
                              loading={historyLoading}
                              columns={historyColumns}
                              dataSource={executionHistory}
                              pagination={{ pageSize: 5 }}
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
