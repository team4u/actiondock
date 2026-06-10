import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Form, Input, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import { CodeOutlined, SaveOutlined, PlayCircleOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState, type ChangeEvent, type Key } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createAiAgent,
  createAiModel,
  getAiAgent,
  getAiRun,
  getAiModel,
  listAiModels,
  listAiTools,
  listAiToolsets,
  startAiAgentRun,
  testAiTool,
  testAiModel,
  updateAiAgent,
  updateAiModel
} from "../../ai/api";
import { listConfigValues } from "../../settings/api";
import { listSkills } from "../../skills/api";
import { buildToolOptionsPayload, cloneToolConfigMap, resolveAgentToolSelection, type ResolvedAgentToolView, type ToolConfigMap } from "../../../services/aiAgentTools";
import { AiRunStatusTag } from "../../../components/ai/AiTags";
import { AiStepTracePanel } from "../../../components/ai/AiStepTracePanel";
import { JsonPreview } from "../../../components/common/JsonPreview";
import { PageHeader } from "../../../components/common/PageHeader";
import { Col } from "../../../components/common/SafeCol";
import { ApiError } from "../../../shared/api/httpClient";
import { AiToolPickerTable, ToolConfigWorkspace, filterAiToolsForPicker } from "./AiToolsetDetailPage";
import { buildSystemSettingsSearch } from "../../../services/settingsRouting";
import { buildAgentWrapperScriptPreset, writeScriptCreatePreset } from "../../../services/scriptCreatePreset";
import type {
  AiAgentProfile,
  AiAgentRunSnapshot,
  AiCapability,
  AiMessage,
  AiModelProfile,
  AiModelProvider,
  AiTool,
  AiToolExecutionResult,
  AiToolset,
  ConfigValue,
  Skill
} from "../../../shared/types";
import { formatDateTime, parseJsonText, prettyJson } from "../../../services/utils";

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
  skillIds: string[];
  enabled: boolean;
  optionsJson: string;
}

export function AiModelProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = !id;
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
  const isCreate = !id;
  const isManagedAgent = Boolean(id && (id.startsWith("pkg.") || id.startsWith("cap.")));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<AgentFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [directToolNames, setDirectToolNames] = useState<string[]>([]);
  const [directToolOptions, setDirectToolOptions] = useState<ToolConfigMap>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [draftToolsetIds, setDraftToolsetIds] = useState<string[]>([]);
  const [draftDirectToolNames, setDraftDirectToolNames] = useState<string[]>([]);
  const [draftDirectToolOptions, setDraftDirectToolOptions] = useState<ToolConfigMap>({});
  const [toolQuery, setToolQuery] = useState("");
  const [configToolName, setConfigToolName] = useState<string | null>(null);
  const [configDraftText, setConfigDraftText] = useState(prettyJson({}));
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testInputByTool, setTestInputByTool] = useState<Record<string, string>>({});
  const [testResultByTool, setTestResultByTool] = useState<Record<string, AiToolExecutionResult | null>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("返回一句简短问候。");
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<AiAgentRunSnapshot | null>(null);
  const activeTab = searchParams.get("tab") === "test" ? "test" : "config";
  const watchedToolsetIds = Form.useWatch("toolsetIds", form) ?? [];
  const watchedSkillIds = Form.useWatch("skillIds", form) ?? [];

  useEffect(() => {
    void Promise.all([listAiModels(), listAiToolsets(), listAiTools(), listSkills()])
      .then(([nextModels, nextToolsets, nextTools, nextSkills]) => {
        setModels(nextModels);
        setToolsets(nextToolsets);
        setTools(nextTools);
        setSkills(nextSkills);
      })
      .catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载 Agent 配置元数据失败"));
  }, [messageApi]);

  useEffect(() => {
    if (isCreate) {
      form.setFieldsValue({
        id: "",
        name: "",
        description: "",
        modelProfileId: "",
        toolsetIds: [],
        skillIds: [],
        enabled: true,
        optionsJson: prettyJson({ maxIters: 6, timeoutSeconds: 120 })
      });
      setDirectToolNames([]);
      setDirectToolOptions({});
      setDraftToolsetIds([]);
      setDraftDirectToolNames([]);
      setDraftDirectToolOptions({});
      setToolQuery("");
      setConfigToolName(null);
      setConfigDraftText(prettyJson({}));
      setManagerOpen(false);
      setTestInputByTool({});
      setTestResultByTool({});
      setTestingTool(null);
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
        skillIds: profile.skillIds ?? [],
        enabled: profile.enabled,
        optionsJson: prettyJson(profile.options)
      });
      setDirectToolNames(profile.directToolNames ?? []);
      setDirectToolOptions(cloneToolConfigMap(profile.directToolOptions));
      setDraftToolsetIds(profile.toolsetIds ?? []);
      setDraftDirectToolNames(profile.directToolNames ?? []);
      setDraftDirectToolOptions(cloneToolConfigMap(profile.directToolOptions));
      setToolQuery("");
      setConfigToolName(null);
      setConfigDraftText(prettyJson({}));
      setManagerOpen(false);
      setTestInputByTool({});
      setTestResultByTool({});
      setTestingTool(null);
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
  const skillOptions = useMemo(
    () => skills.map((item) => ({
      value: item.skillId,
      label: `${item.skillId}${item.displayName ? ` (${item.displayName})` : ""}${item.enabledTargetCount > 0 ? "" : " - 未启用"}`,
      disabled: item.enabledTargetCount <= 0
    })),
    [skills]
  );
  const missingSkillIds = useMemo(
    () => watchedSkillIds.filter((skillId) => !skills.some((skill) => skill.skillId === skillId)),
    [skills, watchedSkillIds]
  );
  const disabledSkillIds = useMemo(
    () => watchedSkillIds.filter((skillId) => skills.some((skill) => skill.skillId === skillId && skill.enabledTargetCount <= 0)),
    [skills, watchedSkillIds]
  );
  const filteredTools = useMemo(() => filterAiToolsForPicker(tools, toolQuery), [toolQuery, tools]);
  const resolution = useMemo(
    () => resolveAgentToolSelection({
      toolsetIds: watchedToolsetIds,
      directToolNames,
      directToolOptions
    }, toolsets, tools),
    [directToolNames, directToolOptions, toolsets, tools, watchedToolsetIds]
  );
  const configuredDirectToolCount = useMemo(
    () => directToolNames.filter((name) => Object.keys(directToolOptions[name] ?? {}).length > 0).length,
    [directToolNames, directToolOptions]
  );
  const draftResolution = useMemo(
    () => resolveAgentToolSelection({
      toolsetIds: draftToolsetIds,
      directToolNames: draftDirectToolNames,
      directToolOptions: draftDirectToolOptions
    }, toolsets, tools),
    [draftDirectToolNames, draftDirectToolOptions, draftToolsetIds, toolsets, tools]
  );
  const draftInvalidDirectToolNames = useMemo(
    () => draftDirectToolNames.filter((name) => !tools.some((tool) => tool.name === name)),
    [draftDirectToolNames, tools]
  );
  const draftConfiguredDirectToolCount = useMemo(
    () => draftDirectToolNames.filter((name) => Object.keys(draftDirectToolOptions[name] ?? {}).length > 0).length,
    [draftDirectToolNames, draftDirectToolOptions]
  );
  const draftSelectionDisabledByName = useMemo(
    () => draftResolution.selectedToolsetToolNames.reduce<Record<string, string | undefined>>((result, toolName) => {
      if (!draftDirectToolNames.includes(toolName)) {
        result[toolName] = "已由工具集提供";
      }
      return result;
    }, {}),
    [draftDirectToolNames, draftResolution.selectedToolsetToolNames]
  );
  const configTool = useMemo(() => tools.find((tool) => tool.name === configToolName) ?? null, [configToolName, tools]);
  const effectiveToolColumns: ColumnsType<ResolvedAgentToolView> = [
    {
      title: "工具",
      dataIndex: "toolName",
      width: 420,
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Typography.Text strong>{item.tool?.displayName ?? item.toolName}</Typography.Text>
            {item.sources.length > 1 ? <Tag color="green">已合并</Tag> : null}
          </Space>
          {item.tool?.displayName !== item.toolName ? <Typography.Text code>{item.toolName}</Typography.Text> : null}
          {item.tool?.description ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.tool.description}</Typography.Text> : null}
        </Space>
      )
    },
    {
      title: "来源",
      width: 260,
      render: (_, item) => <Space size={[4, 4]} wrap>{item.sources.map((source) => <Tag key={`${item.toolName}-${source.label}`}>{source.label}</Tag>)}</Space>
    },
    {
      title: "配置",
      width: 140,
      render: (_, item) => <Tag color={Object.keys(item.config).length > 0 ? "green" : "default"}>{Object.keys(item.config).length > 0 ? "已配置" : "默认"}</Tag>
    }
  ];

  const openToolManager = () => {
    setDraftToolsetIds(watchedToolsetIds);
    setDraftDirectToolNames(directToolNames);
    setDraftDirectToolOptions(cloneToolConfigMap(directToolOptions));
    setToolQuery("");
    setConfigToolName(null);
    setConfigDraftText(prettyJson({}));
    setTestInputByTool({});
    setTestResultByTool({});
    setTestingTool(null);
    setManagerOpen(true);
  };

  const closeToolManager = () => {
    setManagerOpen(false);
  };

  const openToolConfig = (toolName: string) => {
    const tool = tools.find((item) => item.name === toolName) ?? null;
    if (!tool) return;
    setConfigToolName(toolName);
    setConfigDraftText(prettyJson(draftDirectToolOptions[toolName]));
  };

  const applyToolConfig = () => {
    if (!configTool) return;
    try {
      const config = parseJsonText(configDraftText, "工具配置");
      setDraftDirectToolOptions((current) => {
        const next = { ...current };
        if (Object.keys(config).length === 0) {
          delete next[configTool.name];
        } else {
          next[configTool.name] = config;
        }
        return next;
      });
      messageApi.success("直接工具配置已应用");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工具配置不是合法 JSON");
    }
  };

  const clearToolConfig = () => {
    if (!configTool) return;
    setDraftDirectToolOptions((current) => {
      const next = { ...current };
      delete next[configTool.name];
      return next;
    });
    setConfigDraftText(prettyJson({}));
    messageApi.success("直接工具配置已清空");
  };

  const handleDirectToolSelectionChange = (names: Key[]) => {
    setDraftDirectToolNames([...draftInvalidDirectToolNames, ...names.map(String)]);
  };

  const handleToolTestInputChange = (toolName: string, value: string) => {
    setTestInputByTool((current) => ({ ...current, [toolName]: value }));
  };

  const handleToolTest = async (toolName: string) => {
    setTestingTool(toolName);
    setTestResultByTool((current) => ({ ...current, [toolName]: null }));
    try {
      const input = parseJsonText(testInputByTool[toolName] ?? "{}", "测试输入");
      const result = await testAiTool(toolName, input);
      setTestResultByTool((current) => ({ ...current, [toolName]: result }));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工具测试失败");
    } finally {
      setTestingTool(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      if (resolution.missingToolsetIds.length > 0 || resolution.missingToolNames.length > 0) {
        throw new Error("当前 Agent 工具引用不完整，请先处理缺失工具或工具集");
      }
      if (resolution.conflicts.length > 0) {
        throw new Error("当前 Agent 工具存在冲突，请先处理后再保存");
      }
      if (missingSkillIds.length > 0 || disabledSkillIds.length > 0) {
        throw new Error("当前 Agent Skill 引用不可用，请先处理缺失或未启用的 Skill");
      }
      const profile: AiAgentProfile = {
        id: values.id.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        provider: "AGENTSCOPE",
        modelProfileId: values.modelProfileId,
        systemPrompt: values.systemPrompt,
        toolsetIds: values.toolsetIds ?? [],
        directToolNames: Array.from(new Set(directToolNames)),
        directToolOptions: buildToolOptionsPayload(Array.from(new Set(directToolNames)), directToolOptions),
        skillIds: Array.from(new Set(values.skillIds ?? [])),
        enabled: values.enabled,
        options: parseJsonText(values.optionsJson, "运行参数")
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

  const applyToolManager = () => {
    form.setFieldValue("toolsetIds", draftToolsetIds);
    setDirectToolNames(draftDirectToolNames);
    setDirectToolOptions(buildToolOptionsPayload(draftDirectToolNames, draftDirectToolOptions));
    setManagerOpen(false);
  };

  const handleGenerateScript = () => {
    if (!id) return;
    writeScriptCreatePreset(buildAgentWrapperScriptPreset({
      id,
      name: form.getFieldValue("name") || id,
      description: form.getFieldValue("description")
    }));
    navigate("/scripts/new");
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title={isCreate ? "新建 Agent Profile" : "Agent Profile"}
        meta={isCreate ? "配置模型、工具集、直接工具和策略" : id}
        onBack={() => navigate("/ai/agents")}
        actions={(
          <Space>
            {!isCreate && !isManagedAgent ? (
              <Button onClick={() => navigate(`/packages/publish?source=AGENT&sourceId=${encodeURIComponent(id)}`)}>发布能力包</Button>
            ) : null}
            {!isCreate ? (
              <Button icon={<CodeOutlined />} onClick={handleGenerateScript}>生成脚本</Button>
            ) : null}
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>
          </Space>
        )}
      />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams(key === "test" ? { tab: "test" } : {}, { replace: true })}
        items={[
          {
            key: "config",
            label: "配置",
            children: (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card>
                  <Form form={form} layout="vertical">
                    <Form.Item name="id" label="ID" rules={[{ required: true }]}><Input disabled={!isCreate} /></Form.Item>
                    <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                    <Form.Item name="modelProfileId" label="模型 Profile" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={modelOptions} /></Form.Item>
                    <Form.Item name="toolsetIds" hidden><Select mode="multiple" optionFilterProp="label" options={toolsetOptions} /></Form.Item>
                    <Row gutter={12} align="bottom">
                      <Col xs={24} md={6}>
                        <Form.Item label="工具">
                          <Button block onClick={openToolManager}>管理工具</Button>
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={18}>
                        <Form.Item name="skillIds" label="Skills">
                          <Select
                            mode="multiple"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder="选择已安装且启用的 Skill"
                            options={skillOptions}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    {missingSkillIds.length > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="存在缺失 Skill"
                        description={<Space size={[8, 8]} wrap>{missingSkillIds.map((skillId) => <Tag key={skillId}>{skillId}</Tag>)}</Space>}
                      />
                    ) : null}
                    {disabledSkillIds.length > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="存在未启用 Skill"
                        description={<Space size={[8, 8]} wrap>{disabledSkillIds.map((skillId) => <Tag key={skillId}>{skillId}</Tag>)}</Space>}
                      />
                    ) : null}
                    <Form.Item name="systemPrompt" label="System Prompt"><Input.TextArea rows={6} /></Form.Item>
                    <Form.Item name="optionsJson" label="运行参数 JSON"><Input.TextArea rows={5} /></Form.Item>
                  </Form>
                </Card>
                <Drawer
                  title="管理工具"
                  open={managerOpen}
                  width={1080}
                  onClose={closeToolManager}
                  destroyOnClose={false}
                  footer={(
                    <Space style={{ justifyContent: "flex-end", width: "100%" }}>
                      <Button onClick={closeToolManager}>取消</Button>
                      <Button type="primary" onClick={applyToolManager}>应用</Button>
                    </Space>
                  )}
                >
                  <Tabs
                    items={[
                      {
                        key: "summary",
                        label: "摘要",
                        children: (
                          <Space direction="vertical" size={12} style={{ width: "100%" }}>
                            <Descriptions size="small" column={{ xs: 1, md: 4 }} bordered>
                              <Descriptions.Item label="工具集">{draftToolsetIds.length}</Descriptions.Item>
                              <Descriptions.Item label="生效工具">{draftResolution.effectiveTools.length}</Descriptions.Item>
                              <Descriptions.Item label="直接工具">{Array.from(new Set(draftDirectToolNames)).length}</Descriptions.Item>
                              <Descriptions.Item label="已配置直选">{draftConfiguredDirectToolCount}</Descriptions.Item>
                              <Descriptions.Item label="自动合并">{draftResolution.mergedToolCount}</Descriptions.Item>
                            </Descriptions>
                            {draftResolution.missingToolsetIds.length > 0 ? (
                              <Alert
                                type="warning"
                                showIcon
                                message="存在缺失工具集"
                                description={<Space size={[8, 8]} wrap>{draftResolution.missingToolsetIds.map((toolsetId) => <Tag key={toolsetId}>{toolsetId}</Tag>)}</Space>}
                              />
                            ) : null}
                            {draftResolution.missingToolNames.length > 0 ? (
                              <Alert
                                type="warning"
                                showIcon
                                message="存在缺失工具"
                                description={<Space size={[8, 8]} wrap>{draftResolution.missingToolNames.map((toolName) => <Tag key={toolName}>{toolName}</Tag>)}</Space>}
                              />
                            ) : null}
                            {draftResolution.conflicts.length > 0 ? (
                              <Alert
                                type="error"
                                showIcon
                                message="工具配置冲突会阻止保存和运行"
                                description={(
                                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                    {draftResolution.conflicts.map((conflict) => (
                                      <div key={`${conflict.reason}-${conflict.toolName}`}>
                                        <Typography.Text strong>{conflict.toolName}</Typography.Text>
                                        <Space size={[6, 6]} wrap style={{ marginLeft: 8 }}>
                                          {conflict.sources.map((source) => <Tag key={`${conflict.toolName}-${source.label}`}>{source.label}</Tag>)}
                                        </Space>
                                      </div>
                                    ))}
                                  </Space>
                                )}
                              />
                            ) : null}
                            <Table
                              rowKey="toolName"
                              size="small"
                              pagination={false}
                              dataSource={draftResolution.effectiveTools}
                              columns={effectiveToolColumns}
                              scroll={{ x: "max-content" }}
                              locale={{ emptyText: "当前没有生效工具" }}
                            />
                          </Space>
                        )
                      },
                      {
                        key: "selection",
                        label: "选择/配置",
                        children: (
                          <Space direction="vertical" size={16} style={{ width: "100%" }}>
                            <Alert type="info" showIcon message="工具集用于复用；直接工具用于补充单个工具。相同工具且配置一致会自动合并，配置不一致会报冲突。" />
                            <div>
                              <Typography.Text strong>工具集</Typography.Text>
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                                这里选择会参与当前 Agent 的工具集来源。
                              </Typography.Paragraph>
                              <Select
                                mode="multiple"
                                allowClear
                                style={{ width: "100%" }}
                                optionFilterProp="label"
                                placeholder="选择工具集"
                                value={draftToolsetIds}
                                options={toolsetOptions}
                                onChange={setDraftToolsetIds}
                              />
                            </div>
                            {draftInvalidDirectToolNames.length > 0 ? (
                              <Alert
                                type="warning"
                                showIcon
                                message="当前直接工具中包含已失效工具，请移除后再保存。"
                                description={<Space size={[8, 8]} wrap>{draftInvalidDirectToolNames.map((toolName) => <Tag key={toolName}>{toolName}</Tag>)}</Space>}
                              />
                            ) : null}
                            <Input.Search
                              allowClear
                              placeholder="搜索工具名、显示名、来源、说明或权限"
                              value={toolQuery}
                              onChange={(event: ChangeEvent<HTMLInputElement>) => setToolQuery(event.target.value)}
                            />
                            <AiToolPickerTable
                              tools={filteredTools}
                              selectedNames={draftDirectToolNames}
                              toolOptionsByName={draftDirectToolOptions}
                              selectionDisabledByName={draftSelectionDisabledByName}
                              testingTool={testingTool}
                              testInputByTool={testInputByTool}
                              testResultByTool={testResultByTool}
                              onSelectionChange={handleDirectToolSelectionChange}
                              onOpenConfig={openToolConfig}
                              onTestInputChange={handleToolTestInputChange}
                              onTest={(toolName) => void handleToolTest(toolName)}
                            />
                            {configTool ? (
                              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                                <Alert
                                  type="info"
                                  showIcon
                                  message={draftResolution.selectedToolsetToolNames.includes(configTool.name) ? "该工具已被所选工具集覆盖；若保留直选，需与工具集配置完全一致。" : "这里编辑的是 Agent 级直接工具配置。"}
                                />
                                <ToolConfigWorkspace
                                  tool={configTool}
                                  selected={draftDirectToolNames.includes(configTool.name)}
                                  configStatus={{
                                    label: Object.keys(draftDirectToolOptions[configTool.name] ?? {}).length > 0 ? "已配置" : "未配置",
                                    color: Object.keys(draftDirectToolOptions[configTool.name] ?? {}).length > 0 ? "green" : "gold"
                                  }}
                                  draftText={configDraftText}
                                  testInputText={testInputByTool[configTool.name] ?? "{}"}
                                  testResult={testResultByTool[configTool.name] ?? null}
                                  testing={testingTool === configTool.name}
                                  onDraftChange={setConfigDraftText}
                                  onApply={applyToolConfig}
                                  onClear={clearToolConfig}
                                  onTestInputChange={handleToolTestInputChange}
                                  onTest={(toolName) => void handleToolTest(toolName)}
                                />
                              </Space>
                            ) : null}
                          </Space>
                        )
                      }
                    ]}
                  />
                </Drawer>
              </Space>
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
