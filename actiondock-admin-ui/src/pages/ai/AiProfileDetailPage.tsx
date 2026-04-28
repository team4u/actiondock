import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Select, Space, Switch, Tabs, Typography, message } from "antd";
import { SaveOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  createAiAgent,
  createAiModel,
  getAiAgent,
  getAiRun,
  getAiModel,
  listConfigValues,
  listAiModels,
  listAiToolsets,
  startAiAgentRun,
  testAiModel,
  updateAiAgent,
  updateAiModel
} from "../../api";
import { AiRunStatusTag } from "../../components/ai/AiTags";
import { AiStepTracePanel } from "../../components/ai/AiStepTracePanel";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import { buildSystemSettingsSearch } from "../../settingsRouting";
import type { AiAgentProfile, AiAgentRunSnapshot, AiCapability, AiMessage, AiModelProfile, AiModelProvider, AiToolset, ConfigValue } from "../../types";
import { formatDateTime, parseJsonText, prettyJson } from "../../utils";

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
  description?: string;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<ModelFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [configValues, setConfigValues] = useState<ConfigValue[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("用一句话回复：ActionDock AI Runtime 已连接。");
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const activeTab = searchParams.get("tab") === "test" ? "test" : "config";

  useEffect(() => {
    void listConfigValues()
      .then(setConfigValues)
      .catch((error) => messageApi.warning(error instanceof ApiError ? error.message : "加载配置值失败，API Key 配置项需手动输入"));
  }, [messageApi]);

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
    if (isCreate) {
      messageApi.warning("保存模型 Profile 后再运行测试");
      return;
    }
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

  const configValueOptions = useMemo(
    () => configValues.map((item) => ({
      value: item.key,
      label: `${item.key}${item.description ? ` - ${item.description}` : ""}`
    })),
    [configValues]
  );

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
        activeKey={activeTab}
        onChange={(key) => setSearchParams(key === "test" ? { tab: "test" } : {}, { replace: true })}
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
                  <Form.Item name="apiKeyConfigKey" label="API Key 配置项引用">
                    <Select
                      allowClear
                      showSearch
                      placeholder="选择配置值，例如 ai.dashscope.api_key"
                      optionFilterProp="label"
                      options={configValueOptions}
                    />
                  </Form.Item>
                  <Alert
                    type="info"
                    showIcon
                    message="API Key 只保存配置值引用；密钥内容请在系统配置的配置值中维护。"
                    action={<Button size="small" onClick={() => navigate(`/settings${buildSystemSettingsSearch("config-values")}`)}>配置值</Button>}
                  />
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
                  <Input.TextArea rows={4} value={testPrompt} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setTestPrompt(event.target.value)} />
                  <Button icon={<PlayCircleOutlined />} loading={testing} disabled={isCreate} onClick={() => void handleTest()}>运行测试</Button>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<AgentFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("返回一句简短问候。");
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<AiAgentRunSnapshot | null>(null);
  const activeTab = searchParams.get("tab") === "test" ? "test" : "config";

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
        description: "",
        modelProfileId: "",
        toolsetIds: [],
        enabled: true,
        optionsJson: prettyJson({ maxIters: 6, timeoutSeconds: 120 }),
        policyJson: prettyJson({ maxToolPermission: "PROPOSE_CHANGE" })
      });
      setTestRunId(null);
      setTestRun(null);
      return;
    }
    if (!id) return;
    void getAiAgent(id).then((profile) => {
      form.setFieldsValue({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        modelProfileId: profile.modelProfileId,
        systemPrompt: profile.systemPrompt,
        toolsetIds: profile.toolsetIds,
        enabled: profile.enabled,
        optionsJson: prettyJson(profile.options),
        policyJson: prettyJson(profile.policy)
      });
      setTestRunId(null);
      setTestRun(null);
    }).catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载 Agent Profile 失败"));
  }, [form, id, isCreate, messageApi]);

  useEffect(() => {
    if (!testRunId) return;
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await getAiRun(testRunId);
        if (!active) return;
        setTestRun(next);
        if (next.status === "RUNNING" || next.status === "WAITING_APPROVAL") {
          timer = window.setTimeout(() => void poll(), 1500);
        }
      } catch (error) {
        if (active) {
          messageApi.error(error instanceof ApiError ? error.message : "加载 Agent Run 失败");
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [messageApi, testRunId]);

  const modelOptions = useMemo(
    () => models.map((item) => ({
      value: item.id,
      label: `${item.id} (${item.modelName})${item.enabled ? "" : " - 禁用"}`,
      disabled: !item.enabled
    })),
    [models]
  );
  const toolsetOptions = useMemo(
    () => toolsets.map((item) => ({
      value: item.id,
      label: `${item.id}${item.enabled ? "" : " - 禁用"}`,
      disabled: !item.enabled
    })),
    [toolsets]
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const profile: AiAgentProfile = {
        id: values.id.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
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
    if (isCreate) {
      messageApi.warning("保存 Agent Profile 后再运行测试");
      return;
    }
    setTesting(true);
    setTestRunId(null);
    setTestRun(null);
    try {
      const values = await form.validateFields(["id"]);
      const messages: AiMessage[] = [{ role: "user", content: testPrompt }];
      const submission = await startAiAgentRun({ agentProfile: values.id, messages, input: {}, options: {} });
      setTestRunId(submission.runId);
      setTestRun({
        id: submission.runId,
        agentProfile: submission.agentProfile,
        status: submission.status,
        inputSummary: { messageCount: messages.length },
        outputSummary: {},
        startedAt: submission.startedAt,
        steps: []
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Agent 测试失败");
    } finally {
      setTesting(false);
    }
  };

  const testRunText = typeof testRun?.outputSummary?.text === "string" ? testRun.outputSummary.text : "";
  const testRunActive = testRun?.status === "RUNNING" || testRun?.status === "WAITING_APPROVAL";

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
        activeKey={activeTab}
        onChange={(key) => setSearchParams(key === "test" ? { tab: "test" } : {}, { replace: true })}
        items={[
          {
            key: "config",
            label: "配置",
            children: (
              <Card>
                <Form form={form} layout="vertical">
                  <Form.Item name="id" label="ID" rules={[{ required: true }]}><Input disabled={!isCreate} /></Form.Item>
                  <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                  <Form.Item name="modelProfileId" label="模型 Profile" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={modelOptions} /></Form.Item>
                  <Form.Item name="toolsetIds" label="工具集"><Select mode="multiple" optionFilterProp="label" options={toolsetOptions} /></Form.Item>
                  <Form.Item name="systemPrompt" label="System Prompt"><Input.TextArea rows={6} /></Form.Item>
                  <Form.Item name="optionsJson" label="运行参数 JSON"><Input.TextArea rows={5} /></Form.Item>
                  <Form.Item name="policyJson" label="策略 JSON"><Input.TextArea rows={5} /></Form.Item>
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
                  <Input.TextArea rows={4} value={testPrompt} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setTestPrompt(event.target.value)} />
                  <Button icon={<PlayCircleOutlined />} loading={testing} disabled={isCreate} onClick={() => void handleTest()}>运行测试</Button>
                  {testRun ? (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {testRunActive ? <Alert type="info" showIcon message="测试运行中，页面会自动刷新当前 Run 进度。" /> : null}
                      <Space wrap>
                        <AiRunStatusTag status={testRun.status} />
                        <Typography.Text type="secondary">Run ID: {testRun.id}</Typography.Text>
                        <Button size="small" onClick={() => navigate(`/ai/runs/${testRun.id}`)}>Run 详情</Button>
                      </Space>
                      <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
                        <Descriptions.Item label="Agent">{testRun.agentProfile}</Descriptions.Item>
                        <Descriptions.Item label="状态"><AiRunStatusTag status={testRun.status} /></Descriptions.Item>
                        <Descriptions.Item label="开始">{formatDateTime(testRun.startedAt)}</Descriptions.Item>
                        <Descriptions.Item label="结束">{formatDateTime(testRun.finishedAt)}</Descriptions.Item>
                      </Descriptions>
                      {testRunText ? (
                        <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "展开" }} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                          {testRunText}
                        </Typography.Paragraph>
                      ) : null}
                      <AiStepTracePanel steps={testRun.steps} />
                      {!testRunText ? (
                        <JsonPreview title="输出摘要" value={testRun.outputSummary} emptyDescription="暂无结果" />
                      ) : null}
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
