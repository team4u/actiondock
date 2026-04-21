import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  RocketOutlined,
  SaveOutlined
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, createScript, getScript, publishScript, updateScript, validateScript } from "../api";
import type { ScriptDefinition } from "../types";
import { formatDateTime, parseJsonText, prettyJson } from "../utils";

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

export function ScriptEditorPage({ mode }: ScriptEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm<ScriptFormValues>();
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [sourceText, setSourceText] = useState(DEFAULT_SOURCE);
  const [inputSchemaText, setInputSchemaText] = useState(prettyJson({ type: "object", properties: {} }));
  const [outputSchemaText, setOutputSchemaText] = useState(prettyJson({ type: "object", properties: {} }));
  const [currentScript, setCurrentScript] = useState<ScriptDefinition | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

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
      setInputSchemaText(prettyJson(script.inputSchema));
      setOutputSchemaText(prettyJson(script.outputSchema));
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
      setInputSchemaText(prettyJson({ type: "object", properties: {} }));
      setOutputSchemaText(prettyJson({ type: "object", properties: {} }));
      setLoading(false);
      return;
    }
    if (id) {
      void loadScript(id);
    }
  }, [form, id, mode]);

  const buildPayload = async (): Promise<ScriptDefinition> => {
    const values = await form.validateFields();
    const inputSchema = parseJsonText(inputSchemaText, "输入结构");
    const outputSchema = parseJsonText(outputSchemaText, "输出结构");
    setInputSchemaText(prettyJson(inputSchema));
    setOutputSchemaText(prettyJson(outputSchema));

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
                <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingInline: 0 }} onClick={() => navigate("/scripts")}>
                  返回列表
                </Button>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {mode === "create" ? "新建脚本" : currentScript?.name ?? id}
                </Typography.Title>
                <Text type="secondary">使用 Ant Design 表单和 Monaco 编辑器维护脚本定义。</Text>
              </Space>
            </Col>
            <Col>
              <Space wrap>
                <Button icon={<CheckCircleOutlined />} onClick={() => void handleValidate()} loading={validating}>
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
                <Button icon={<SaveOutlined />} type="primary" onClick={() => void handleSave()} loading={saving}>
                  保存
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {currentScript && (
          <Card>
            <Descriptions size="small" column={4}>
              <Descriptions.Item label="状态">
                <Tag color={currentScript.status === "PUBLISHED" ? "green" : "gold"}>{currentScript.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="版本">{currentScript.version}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDateTime(currentScript.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDateTime(currentScript.updatedAt)}</Descriptions.Item>
            </Descriptions>
          </Card>
        )}

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
                    { pattern: /^[A-Za-z0-9_-]+$/, message: "仅支持字母、数字、下划线和中横线" }
                  ]}
                >
                  <Input disabled={mode === "edit"} placeholder="例如 hello-groovy" />
                </Form.Item>
                <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入脚本名称" }]}>
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
            <Card title="脚本内容" extra={<Text type="secondary">Groovy / JSON 结构由代码编辑器维护</Text>}>
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
                    children: (
                      <Editor
                        height="420px"
                        defaultLanguage="json"
                        language="json"
                        value={inputSchemaText}
                        onChange={(value) => setInputSchemaText(value ?? "{}")}
                        theme="vs-light"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 14,
                          formatOnPaste: true,
                          formatOnType: true,
                          scrollBeyondLastLine: false
                        }}
                      />
                    )
                  },
                  {
                    key: "output",
                    label: "outputSchema.json",
                    children: (
                      <Editor
                        height="420px"
                        defaultLanguage="json"
                        language="json"
                        value={outputSchemaText}
                        onChange={(value) => setOutputSchemaText(value ?? "{}")}
                        theme="vs-light"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 14,
                          formatOnPaste: true,
                          formatOnType: true,
                          scrollBeyondLastLine: false
                        }}
                      />
                    )
                  }
                ]}
              />
              <Space className="editor-footer">
                <CodeOutlined />
                <Text type="secondary">保存时会校验 JSON 结构并格式化，Groovy 语法通过后端校验接口确认。</Text>
              </Space>
            </Card>
          </Col>
        </Row>
      </Space>
    </>
  );
}
