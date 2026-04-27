import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Switch, Tabs, Typography, message } from "antd";
import { SaveOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  createAiAgent,
  createAiModel,
  getAiAgent,
  getAiModel,
  listAiModels,
  listAiToolsets,
  testAiAgent,
  testAiModel,
  updateAiAgent,
  updateAiModel
} from "../../api";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import type { AiAgentProfile, AiAgentRunResult, AiCapability, AiMessage, AiModelProfile, AiModelProvider, AiToolset } from "../../types";
import { parseJsonText, prettyJson } from "../../utils";

const MODEL_PROVIDERS: AiModelProvider[] = ["DASHSCOPE", "OPENAI", "OPENAI_COMPATIBLE", "ANTHROPIC", "GEMINI", "OLLAMA"];
const CAPABILITIES: AiCapability[] = ["CHAT", "STRUCTURED_OUTPUT", "EMBEDDING"];

interface ModelFormValues {
  id: string;
  name: string;
  modelProvider: AiModelProvider;
  modelName: string;
  baseUrl?: string;
  apiKeyConfigKey?: string;
  capabilities: AiCapability[];
  enabled: boolean;
  defaultOptionsJson: string;
  limitsJson: string;
}

interface AgentFormValues {
  id: string;
  name: string;
  modelProfileId: string;
  systemPrompt?: string;
  toolsetIds: string[];
  enabled: boolean;
  optionsJson: string;
  policyJson: string;
}

export function AiModelProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = id === "new";
  const navigate = useNavigate();
  const [form] = Form.useForm<ModelFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("用一句话回复：ActionDock AI Runtime 已连接。");
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (isCreate) {
      form.setFieldsValue({
        id: "",
        name: "",
        modelProvider: "DASHSCOPE",
        modelName: "",
        capabilities: ["CHAT", "STRUCTURED_OUTPUT"],
        enabled: true,
        defaultOptionsJson: prettyJson({ temperature: 0.2, maxTokens: 4000, timeoutSeconds: 60 }),
        limitsJson: prettyJson({ maxInputCharacters: 20000, maxOutputTokens: 4000 })
      });
      return;
    }
    if (!id) return;
    void getAiModel(id).then((profile) => {
      form.setFieldsValue({
        id: profile.id,
        name: profile.name,
        modelProvider: profile.modelProvider,
        modelName: profile.modelName,
        baseUrl: profile.baseUrl,
        apiKeyConfigKey: profile.apiKeyConfigKey,
        capabilities: profile.capabilities,
        enabled: profile.enabled,
        defaultOptionsJson: prettyJson(profile.defaultOptions),
        limitsJson: prettyJson(profile.limits)
      });
    }).catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载模型 Profile 失败"));
  }, [form, id, isCreate, messageApi]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const profile: AiModelProfile = {
        id: values.id.trim(),
        name: values.name.trim(),
        provider: "AGENTSCOPE",
        modelProvider: values.modelProvider,
        modelName: values.modelName.trim(),
        baseUrl: values.baseUrl?.trim() || undefined,
        apiKeyConfigKey: values.apiKeyConfigKey?.trim() || undefined,
        capabilities: values.capabilities,
        enabled: values.enabled,
        defaultOptions: parseJsonText(values.defaultOptionsJson, "默认参数"),
        limits: parseJsonText(values.limitsJson, "限制")
      };
      const saved = isCreate ? await createAiModel(profile) : await updateAiModel(values.id, profile);
      messageApi.success("模型 Profile 已保存");
      if (isCreate) navigate(`/ai/models/${saved.id}`, { replace: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存模型 Profile 失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const values = await form.validateFields(["id"]);
      const response = await testAiModel(values.id, {
        modelProfile: values.id,
        messages: [{ role: "user", content: testPrompt }],
        options: {}
      });
      setTestResult(response as unknown as Record<string, unknown>);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "模型测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title={isCreate ? "新建模型 Profile" : "模型 Profile"}
        meta={isCreate ? "配置模型供应商、能力和运行限制" : id}
        onBack={() => navigate("/ai/models")}
        actions={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>}
      />
      <Tabs
        items={[
          {
            key: "config",
            label: "配置",
            children: (
              <Card>
                <Form form={form} layout="vertical">
                  <Form.Item name="id" label="ID" rules={[{ required: true }]}><Input disabled={!isCreate} /></Form.Item>
                  <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="modelProvider" label="模型供应商" rules={[{ required: true }]}><Select options={MODEL_PROVIDERS.map((value) => ({ value, label: value }))} /></Form.Item>
                  <Form.Item name="modelName" label="模型名" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="baseUrl" label="Base URL"><Input /></Form.Item>
                  <Form.Item name="apiKeyConfigKey" label="API Key 配置项引用"><Input placeholder="ai.dashscope.api_key" /></Form.Item>
                  <Form.Item name="capabilities" label="能力"><Checkbox.Group options={CAPABILITIES} /></Form.Item>
                  <Form.Item name="defaultOptionsJson" label="默认参数 JSON"><Input.TextArea rows={6} /></Form.Item>
                  <Form.Item name="limitsJson" label="限制 JSON"><Input.TextArea rows={5} /></Form.Item>
                </Form>
              </Card>
            )
          },
          {
            key: "test",
            label: "测试",
            children: (
              <Card>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input.TextArea rows={4} value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} />
                  <Button icon={<PlayCircleOutlined />} loading={testing} onClick={() => void handleTest()}>运行测试</Button>
                  {testResult ? <JsonPreview title="测试结果" value={testResult} emptyDescription="暂无结果" /> : null}
                </Space>
              </Card>
            )
          }
        ]}
      />
    </Space>
  );
}

export function AiAgentProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = id === "new";
  const navigate = useNavigate();
  const [form] = Form.useForm<AgentFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("返回一句简短问候。");
  const [testResult, setTestResult] = useState<AiAgentRunResult | null>(null);

  useEffect(() => {
    void Promise.all([listAiModels(), listAiToolsets()]).then(([nextModels, nextToolsets]) => {
      setModels(nextModels);
      setToolsets(nextToolsets);
    });
  }, []);

  useEffect(() => {
    if (isCreate) {
      form.setFieldsValue({
        id: "",
        name: "",
        modelProfileId: "",
        toolsetIds: [],
        enabled: true,
        optionsJson: prettyJson({ maxIters: 6, timeoutSeconds: 120 }),
        policyJson: prettyJson({ maxToolPermission: "PROPOSE_CHANGE" })
      });
      return;
    }
    if (!id) return;
    void getAiAgent(id).then((profile) => {
      form.setFieldsValue({
        id: profile.id,
        name: profile.name,
        modelProfileId: profile.modelProfileId,
        systemPrompt: profile.systemPrompt,
        toolsetIds: profile.toolsetIds,
        enabled: profile.enabled,
        optionsJson: prettyJson(profile.options),
        policyJson: prettyJson(profile.policy)
      });
    }).catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载 Agent Profile 失败"));
  }, [form, id, isCreate, messageApi]);

  const modelOptions = useMemo(() => models.map((item) => ({ value: item.id, label: `${item.id} (${item.modelName})` })), [models]);
  const toolsetOptions = useMemo(() => toolsets.map((item) => ({ value: item.id, label: item.id })), [toolsets]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const profile: AiAgentProfile = {
        id: values.id.trim(),
        name: values.name.trim(),
        provider: "AGENTSCOPE",
        modelProfileId: values.modelProfileId,
        systemPrompt: values.systemPrompt,
        toolsetIds: values.toolsetIds ?? [],
        enabled: values.enabled,
        options: parseJsonText(values.optionsJson, "运行参数"),
        policy: parseJsonText(values.policyJson, "策略")
      };
      const saved = isCreate ? await createAiAgent(profile) : await updateAiAgent(values.id, profile);
      messageApi.success("Agent Profile 已保存");
      if (isCreate) navigate(`/ai/agents/${saved.id}`, { replace: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存 Agent Profile 失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const values = await form.validateFields(["id"]);
      const messages: AiMessage[] = [{ role: "user", content: testPrompt }];
      setTestResult(await testAiAgent(values.id, { agentProfile: values.id, messages, input: {}, options: {} }));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Agent 测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title={isCreate ? "新建 Agent Profile" : "Agent Profile"}
        meta={isCreate ? "配置模型、工具集和策略" : id}
        onBack={() => navigate("/ai/agents")}
        actions={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>}
      />
      <Tabs
        items={[
          {
            key: "config",
            label: "配置",
            children: (
              <Card>
                <Form form={form} layout="vertical">
                  <Form.Item name="id" label="ID" rules={[{ required: true }]}><Input disabled={!isCreate} /></Form.Item>
                  <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="modelProfileId" label="模型 Profile" rules={[{ required: true }]}><Select options={modelOptions} /></Form.Item>
                  <Form.Item name="toolsetIds" label="工具集"><Select mode="multiple" options={toolsetOptions} /></Form.Item>
                  <Form.Item name="systemPrompt" label="System Prompt"><Input.TextArea rows={6} /></Form.Item>
                  <Form.Item name="optionsJson" label="运行参数 JSON"><Input.TextArea rows={5} /></Form.Item>
                  <Form.Item name="policyJson" label="策略 JSON"><Input.TextArea rows={5} /></Form.Item>
                  <Alert type="info" showIcon message="脚本运行时默认最多允许 PROPOSE_CHANGE；DANGEROUS_ACTION 不会对脚本开放。" />
                </Form>
              </Card>
            )
          },
          {
            key: "test",
            label: "运行测试",
            children: (
              <Card>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input.TextArea rows={4} value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} />
                  <Button icon={<PlayCircleOutlined />} loading={testing} onClick={() => void handleTest()}>运行测试</Button>
                  {testResult ? (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text type="secondary">Run ID: {testResult.runId}</Typography.Text>
                      <JsonPreview title="测试结果" value={testResult as unknown as Record<string, unknown>} emptyDescription="暂无结果" />
                    </Space>
                  ) : null}
                </Space>
              </Card>
            )
          }
        ]}
      />
    </Space>
  );
}
