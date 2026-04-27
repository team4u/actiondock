import { Alert, Button, Card, Descriptions, Drawer, Form, Input, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { EyeOutlined, PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import { useEffect, useMemo, useState, type ChangeEvent, type Key } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, createAiToolset, getAiToolset, listAiTools, testAiTool, updateAiToolset } from "../../api";
import { AiToolPermissionTag } from "../../components/ai/AiTags";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import type { AiTool, AiToolExecutionResult, AiToolPermission, AiToolset } from "../../types";
import { parseJsonText, prettyJson } from "../../utils";

const PERMISSIONS: AiToolPermission[] = ["READ_ONLY", "PROPOSE_CHANGE", "CONTROLLED_ACTION", "DANGEROUS_ACTION"];

type ToolConfigMap = Record<string, Record<string, unknown>>;

export interface ToolsetFormValues {
  id: string;
  name: string;
  description?: string;
  maxPermission: AiToolPermission;
  enabled: boolean;
}

function cloneToolConfigMap(source?: ToolConfigMap): ToolConfigMap {
  const next: ToolConfigMap = {};
  Object.entries(source ?? {}).forEach(([name, value]) => {
    if (value && Object.keys(value).length > 0) {
      next[name] = { ...value };
    }
  });
  return next;
}

function hasToolConfig(toolName: string, toolOptionsByName: ToolConfigMap): boolean {
  return Object.keys(toolOptionsByName[toolName] ?? {}).length > 0;
}

function getToolConfigStatus(tool: AiTool, toolOptionsByName: ToolConfigMap): { label: string; color: string } {
  if (!tool.configurable) {
    return { label: "无需配置", color: "default" };
  }
  return hasToolConfig(tool.name, toolOptionsByName)
    ? { label: "已配置", color: "green" }
    : { label: "未配置", color: "gold" };
}

function buildToolOptionsPayload(selectedNames: string[], toolOptionsByName: ToolConfigMap): ToolConfigMap {
  const payload: ToolConfigMap = {};
  selectedNames.forEach((name) => {
    const value = toolOptionsByName[name];
    if (value && Object.keys(value).length > 0) {
      payload[name] = { ...value };
    }
  });
  return payload;
}

export function filterAiToolsForPicker(tools: AiTool[], query: string): AiTool[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return tools;
  return tools.filter((tool) => [
    tool.name,
    tool.description,
    tool.permission
  ].some((value) => value.toLowerCase().includes(keyword)));
}

export function buildAiToolsetPayload(
  values: ToolsetFormValues,
  selectedNames: string[],
  toolOptionsByName: ToolConfigMap
): AiToolset {
  const toolNames = Array.from(new Set(selectedNames));
  return {
    id: values.id.trim(),
    name: values.name.trim(),
    description: values.description?.trim() || undefined,
    toolNames,
    toolOptions: buildToolOptionsPayload(toolNames, toolOptionsByName),
    maxPermission: values.maxPermission,
    enabled: values.enabled
  };
}

interface ToolConfigDrawerProps {
  tool: AiTool | null;
  open: boolean;
  selected: boolean;
  configStatus: { label: string; color: string };
  draftText: string;
  testInputText: string;
  testResult: AiToolExecutionResult | null;
  testing: boolean;
  onDraftChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
  onTestInputChange: (toolName: string, value: string) => void;
  onTest: (toolName: string) => void;
  onClose: () => void;
}

export function ToolConfigWorkspace({
  tool,
  selected,
  configStatus,
  draftText,
  testInputText,
  testResult,
  testing,
  onDraftChange,
  onApply,
  onClear,
  onTestInputChange,
  onTest
}: {
  tool: AiTool;
  selected: boolean;
  configStatus: { label: string; color: string };
  draftText: string;
  testInputText: string;
  testResult: AiToolExecutionResult | null;
  testing: boolean;
  onDraftChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
  onTestInputChange: (toolName: string, value: string) => void;
  onTest: (toolName: string) => void;
}) {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {!selected ? <Alert type="warning" showIcon message="当前工具未勾选，保存工具集时这份配置不会生效。" /> : null}
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="说明">{tool.description}</Descriptions.Item>
        <Descriptions.Item label="权限"><AiToolPermissionTag permission={tool.permission} /></Descriptions.Item>
        <Descriptions.Item label="配置状态">
          <Tag color={configStatus.color}>{configStatus.label}</Tag>
        </Descriptions.Item>
      </Descriptions>
      {tool.configExample && Object.keys(tool.configExample).length > 0 ? <JsonPreview title="示例配置" value={tool.configExample} emptyDescription="暂无示例" /> : null}
      <JsonPreview title="输入 Schema" value={tool.inputSchema} emptyDescription="暂无 Schema" />
      <JsonPreview title="输出 Schema" value={tool.outputSchema} emptyDescription="暂无 Schema" />
      <div>
        <Typography.Text strong>测试输入</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          这里传入工具测试请求体。
        </Typography.Paragraph>
        <Input.TextArea rows={4} value={testInputText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onTestInputChange(tool.name, event.target.value)} />
      </div>
      <Space wrap>
        <Button icon={<PlayCircleOutlined />} loading={testing} onClick={() => onTest(tool.name)}>测试</Button>
      </Space>
      {testResult ? <JsonPreview title="工具测试结果" value={testResult as unknown as Record<string, unknown>} emptyDescription="暂无结果" /> : null}
      <div>
        <Typography.Text strong>工具配置 JSON</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          这里编辑的是该工具在当前工具集下的运行参数。
        </Typography.Paragraph>
        <Input.TextArea rows={14} value={draftText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onDraftChange(event.target.value)} />
      </div>
      <Space wrap>
        <Button danger onClick={onClear} disabled={!tool.configurable}>清空配置</Button>
        <Button type="primary" onClick={onApply} disabled={!tool.configurable}>应用</Button>
      </Space>
    </Space>
  );
}

function ToolConfigDrawer({
  tool,
  open,
  selected,
  configStatus,
  draftText,
  testInputText,
  testResult,
  testing,
  onDraftChange,
  onApply,
  onClear,
  onTestInputChange,
  onTest,
  onClose
}: ToolConfigDrawerProps) {
  return (
    <Drawer
      title={tool ? `查看工具：${tool.name}` : "查看工具"}
      open={open}
      width={640}
      onClose={onClose}
      destroyOnClose={false}
      footer={<Space style={{ justifyContent: "flex-end", width: "100%" }}><Button onClick={onClose}>关闭</Button></Space>}
    >
      {tool ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {tool.configHelp ? <Alert type="info" showIcon message={tool.configHelp} /> : <Alert type="info" showIcon message="该工具使用下方 JSON 配置参数。" />}
          <ToolConfigWorkspace
            tool={tool}
            selected={selected}
            configStatus={configStatus}
            draftText={draftText}
            testInputText={testInputText}
            testResult={testResult}
            testing={testing}
            onDraftChange={onDraftChange}
            onApply={onApply}
            onClear={onClear}
            onTestInputChange={onTestInputChange}
            onTest={onTest}
          />
        </Space>
      ) : null}
    </Drawer>
  );
}

interface AiToolPickerTableProps {
  tools: AiTool[];
  selectedNames: string[];
  toolOptionsByName: ToolConfigMap;
  testingTool: string | null;
  testInputByTool: Record<string, string>;
  testResultByTool: Record<string, AiToolExecutionResult | null>;
  onSelectionChange: (names: Key[]) => void;
  onOpenConfig: (name: string) => void;
  onTestInputChange: (toolName: string, value: string) => void;
  onTest: (name: string) => void;
}

export function AiToolPickerTable({
  tools,
  selectedNames,
  toolOptionsByName,
  testingTool,
  testInputByTool,
  testResultByTool,
  onSelectionChange,
  onOpenConfig,
  onTestInputChange,
  onTest
}: AiToolPickerTableProps) {
  const toolColumns: ColumnsType<AiTool> = [
    {
      title: "工具",
      dataIndex: "name",
      render: (name, tool) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tool.description}</Typography.Text>
        </Space>
      )
    },
    { title: "权限", dataIndex: "permission", render: (permission) => <AiToolPermissionTag permission={permission} /> },
    {
      title: "配置状态",
      render: (_, tool) => {
        const configStatus = getToolConfigStatus(tool, toolOptionsByName);
        return <Tag color={configStatus.color}>{configStatus.label}</Tag>;
      }
    },
    {
      title: "操作",
      render: (_, tool) => (
        <Space wrap>
          <Button icon={<EyeOutlined />} onClick={() => onOpenConfig(tool.name)}>查看</Button>
        </Space>
      )
    }
  ];
  const rowSelection: TableRowSelection<AiTool> = {
    selectedRowKeys: selectedNames,
    preserveSelectedRowKeys: true,
    onChange: onSelectionChange
  };

  return (
    <Table<AiTool>
      rowKey="name"
      dataSource={tools}
      pagination={{ pageSize: 8, showSizeChanger: false }}
      rowSelection={rowSelection}
      columns={toolColumns}
    />
  );
}

export function AiToolsetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = id === "new";
  const navigate = useNavigate();
  const [form] = Form.useForm<ToolsetFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [tools, setTools] = useState<AiTool[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [toolOptionsByName, setToolOptionsByName] = useState<ToolConfigMap>({});
  const [toolQuery, setToolQuery] = useState("");
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testInputByTool, setTestInputByTool] = useState<Record<string, string>>({});
  const [testResultByTool, setTestResultByTool] = useState<Record<string, AiToolExecutionResult | null>>({});
  const [configToolName, setConfigToolName] = useState<string | null>(null);
  const [configDraftText, setConfigDraftText] = useState(prettyJson({}));
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);

  useEffect(() => {
    void listAiTools()
      .then(setTools)
      .catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载工具失败"));
  }, [messageApi]);

  useEffect(() => {
    if (isCreate) {
      form.setFieldsValue({ id: "", name: "", description: "", maxPermission: "READ_ONLY", enabled: true });
      setSelectedNames([]);
      setToolOptionsByName({});
      setTestInputByTool({});
      setTestResultByTool({});
      setConfigToolName(null);
      setConfigDraftText(prettyJson({}));
      setConfigDrawerOpen(false);
      return;
    }
    if (!id) return;
    void getAiToolset(id)
      .then((toolset) => {
        form.setFieldsValue({
          id: toolset.id,
          name: toolset.name,
          description: toolset.description,
          maxPermission: toolset.maxPermission,
          enabled: toolset.enabled
        });
        setSelectedNames(toolset.toolNames ?? []);
        setToolOptionsByName(cloneToolConfigMap(toolset.toolOptions));
        setTestInputByTool({});
        setTestResultByTool({});
        setConfigToolName(null);
        setConfigDraftText(prettyJson({}));
        setConfigDrawerOpen(false);
      })
      .catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载工具集失败"));
  }, [form, id, isCreate, messageApi]);

  const filteredTools = useMemo(() => filterAiToolsForPicker(tools, toolQuery), [tools, toolQuery]);
  const configTool = useMemo(() => tools.find((tool) => tool.name === configToolName) ?? null, [configToolName, tools]);

  const openToolConfig = (toolName: string) => {
    const tool = tools.find((item) => item.name === toolName) ?? null;
    if (!tool) return;
    setConfigToolName(toolName);
    setConfigDraftText(prettyJson(toolOptionsByName[toolName]));
    setConfigDrawerOpen(true);
  };

  const closeToolConfig = () => {
    setConfigDrawerOpen(false);
  };

  const applyToolConfig = () => {
    if (!configTool) return;
    try {
      const config = parseJsonText(configDraftText, "工具配置");
      setToolOptionsByName((current) => {
        const next = { ...current };
        if (Object.keys(config).length === 0) {
          delete next[configTool.name];
        } else {
          next[configTool.name] = config;
        }
        return next;
      });
      messageApi.success("工具配置已应用");
      setConfigDrawerOpen(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工具配置不是合法 JSON");
    }
  };

  const clearToolConfig = () => {
    if (!configTool) return;
    setToolOptionsByName((current) => {
      const next = { ...current };
      delete next[configTool.name];
      return next;
    });
    setConfigDraftText(prettyJson({}));
    messageApi.success("工具配置已清空");
  };

  const handleSelectionChange = (names: Key[]) => {
    setSelectedNames(names.map(String));
  };

  const handleTestInputChange = (toolName: string, value: string) => {
    setTestInputByTool((current) => ({ ...current, [toolName]: value }));
  };

  const handleTest = async (toolName: string) => {
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
      const payload = buildAiToolsetPayload(values, selectedNames, toolOptionsByName);
      const saved = isCreate ? await createAiToolset(payload) : await updateAiToolset(values.id, payload);
      messageApi.success("工具集已保存");
      if (isCreate) navigate(`/ai/toolsets/${saved.id}`, { replace: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存工具集失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title={isCreate ? "新建工具集" : "工具集"}
        meta={isCreate ? "选择 Agent 可用工具并为每个工具配置专属参数" : id}
        onBack={() => navigate("/ai/toolsets")}
        actions={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>}
      />
      <Card>
        <Form form={form} layout="vertical">
          <Form.Item name="id" label="ID" rules={[{ required: true }]}><Input disabled={!isCreate} /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="maxPermission" label="权限上限" rules={[{ required: true }]}><Select options={PERMISSIONS.map((value) => ({ value, label: value }))} /></Form.Item>
        </Form>
      </Card>
      <Card title="工具列表">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert type="info" showIcon message="勾选决定工具集里启用哪些工具，工具详情请在行内点击“查看”打开。" />
          <Input.Search
            allowClear
            placeholder="搜索工具名、说明或权限"
            value={toolQuery}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setToolQuery(event.target.value)}
          />
          <AiToolPickerTable
            tools={filteredTools}
            selectedNames={selectedNames}
            toolOptionsByName={toolOptionsByName}
            testingTool={testingTool}
            testInputByTool={testInputByTool}
            testResultByTool={testResultByTool}
            onSelectionChange={handleSelectionChange}
            onOpenConfig={openToolConfig}
            onTestInputChange={handleTestInputChange}
            onTest={(toolName) => void handleTest(toolName)}
          />
        </Space>
      </Card>
      <ToolConfigDrawer
        tool={configTool}
        open={configDrawerOpen}
        selected={configTool ? selectedNames.includes(configTool.name) : false}
        configStatus={configTool ? getToolConfigStatus(configTool, toolOptionsByName) : { label: "无需配置", color: "default" }}
        draftText={configDraftText}
        testInputText={configTool ? testInputByTool[configTool.name] ?? "{}" : "{}"}
        testResult={configTool ? testResultByTool[configTool.name] ?? null : null}
        testing={configTool ? testingTool === configTool.name : false}
        onDraftChange={setConfigDraftText}
        onApply={applyToolConfig}
        onClear={clearToolConfig}
        onTestInputChange={handleTestInputChange}
        onTest={(toolName) => void handleTest(toolName)}
        onClose={closeToolConfig}
      />
    </Space>
  );
}
