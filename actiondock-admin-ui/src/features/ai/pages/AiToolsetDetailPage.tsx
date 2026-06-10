import { Alert, Button, Card, Descriptions, Drawer, Form, Input, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import { EyeOutlined, PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import { useEffect, useMemo, useState, type ChangeEvent, type Key } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createAiToolset, getAiToolset, listAiTools, testAiTool, updateAiToolset } from "../../ai/api";
import { buildToolOptionsPayload, cloneToolConfigMap, type ToolConfigMap } from "../../../services/aiAgentTools";
import { AiToolPermissionTag } from "../../../components/ai/AiTags";
import { JsonPreview } from "../../../components/common/JsonPreview";
import { PageHeader } from "../../../components/common/PageHeader";
import { ApiError } from "../../../shared/api/httpClient";
import type { AiTool, AiToolExecutionResult, AiToolPermission, AiToolSourceType, AiToolset } from "../../../shared/types";
import { parseJsonText, prettyJson } from "../../../services/utils";

const PERMISSIONS: AiToolPermission[] = ["READ_ONLY", "PROPOSE_CHANGE", "CONTROLLED_ACTION", "DANGEROUS_ACTION"];

export interface ToolsetFormValues {
  id: string;
  name: string;
  description?: string;
  maxPermission: AiToolPermission;
  enabled: boolean;
}

function getToolSourceLabel(sourceType: AiToolSourceType): string {
  switch (sourceType) {
    case "SCRIPT":
      return "脚本";
    case "AGENT":
      return "Agent";
    default:
      return "系统";
  }
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

export function filterAiToolsForPicker(tools: AiTool[], query: string): AiTool[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return tools;
  return tools.filter((tool) => [
    tool.name,
    tool.displayName,
    tool.description,
    tool.permission,
    tool.sourceId,
    tool.sourceType
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
        <Descriptions.Item label="来源">
          <Space size={8} wrap>
            <Tag>{getToolSourceLabel(tool.sourceType)}</Tag>
            <Typography.Text code>{tool.sourceId}</Typography.Text>
          </Space>
        </Descriptions.Item>
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

interface AiToolPickerTableProps {
  tools: AiTool[];
  selectedNames: string[];
  toolOptionsByName: ToolConfigMap;
  selectionDisabledByName?: Record<string, string | undefined>;
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
  selectionDisabledByName,
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
      width: 420,
      render: (name, tool) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Typography.Text strong>{tool.displayName}</Typography.Text>
            <Tag>{getToolSourceLabel(tool.sourceType)}</Tag>
          </Space>
          {tool.displayName !== name ? <Typography.Text code>{name}</Typography.Text> : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tool.description}</Typography.Text>
        </Space>
      )
    },
    { title: "权限", dataIndex: "permission", width: 140, render: (permission) => <AiToolPermissionTag permission={permission} /> },
    {
      title: "配置状态",
      width: 140,
      render: (_, tool) => {
        const configStatus = getToolConfigStatus(tool, toolOptionsByName);
        return <Tag color={configStatus.color}>{configStatus.label}</Tag>;
      }
    },
    {
      title: "操作",
      width: 120,
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
    onChange: onSelectionChange,
    getCheckboxProps: (tool) => {
      const disabledReason = selectionDisabledByName?.[tool.name];
      return disabledReason ? { disabled: true, title: disabledReason } : {};
    }
  };

  return (
    <Table<AiTool>
      rowKey="name"
      dataSource={tools}
      pagination={{ pageSize: 8, showSizeChanger: false }}
      rowSelection={rowSelection}
      columns={toolColumns}
      scroll={{ x: "max-content" }}
    />
  );
}

interface SelectedToolSummaryRow {
  key: string;
  name: string;
  tool?: AiTool;
  configured: boolean;
}

export function AiToolsetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form] = Form.useForm<ToolsetFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [tools, setTools] = useState<AiTool[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [toolOptionsByName, setToolOptionsByName] = useState<ToolConfigMap>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [draftSelectedNames, setDraftSelectedNames] = useState<string[]>([]);
  const [draftToolOptionsByName, setDraftToolOptionsByName] = useState<ToolConfigMap>({});
  const [toolQuery, setToolQuery] = useState("");
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testInputByTool, setTestInputByTool] = useState<Record<string, string>>({});
  const [testResultByTool, setTestResultByTool] = useState<Record<string, AiToolExecutionResult | null>>({});
  const [configToolName, setConfigToolName] = useState<string | null>(null);
  const [configDraftText, setConfigDraftText] = useState(prettyJson({}));

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
      setDraftSelectedNames([]);
      setDraftToolOptionsByName({});
      setTestInputByTool({});
      setTestResultByTool({});
      setConfigToolName(null);
      setConfigDraftText(prettyJson({}));
      setManagerOpen(false);
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
        setDraftSelectedNames(toolset.toolNames ?? []);
        setDraftToolOptionsByName(cloneToolConfigMap(toolset.toolOptions));
        setTestInputByTool({});
        setTestResultByTool({});
        setConfigToolName(null);
        setConfigDraftText(prettyJson({}));
        setManagerOpen(false);
      })
      .catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载工具集失败"));
  }, [form, id, isCreate, messageApi]);

  const configuredToolCount = useMemo(
    () => selectedNames.filter((name) => Object.keys(toolOptionsByName[name] ?? {}).length > 0).length,
    [selectedNames, toolOptionsByName]
  );
  const invalidSelectedNames = useMemo(
    () => selectedNames.filter((name) => !tools.some((tool) => tool.name === name)),
    [selectedNames, tools]
  );
  const filteredTools = useMemo(() => filterAiToolsForPicker(tools, toolQuery), [tools, toolQuery]);
  const configTool = useMemo(() => tools.find((tool) => tool.name === configToolName) ?? null, [configToolName, tools]);
  const draftInvalidSelectedNames = useMemo(
    () => draftSelectedNames.filter((name) => !tools.some((tool) => tool.name === name)),
    [draftSelectedNames, tools]
  );
  const draftConfiguredToolCount = useMemo(
    () => draftSelectedNames.filter((name) => Object.keys(draftToolOptionsByName[name] ?? {}).length > 0).length,
    [draftSelectedNames, draftToolOptionsByName]
  );
  const selectedToolSummaries = useMemo<SelectedToolSummaryRow[]>(
    () => draftSelectedNames.map((name) => {
      const tool = tools.find((item) => item.name === name);
      return {
        key: name,
        name,
        tool,
        configured: Object.keys(draftToolOptionsByName[name] ?? {}).length > 0
      };
    }),
    [draftSelectedNames, draftToolOptionsByName, tools]
  );

  const openToolManager = () => {
    setDraftSelectedNames(selectedNames);
    setDraftToolOptionsByName(cloneToolConfigMap(toolOptionsByName));
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
    setConfigDraftText(prettyJson(draftToolOptionsByName[toolName]));
  };

  const applyToolConfig = () => {
    if (!configTool) return;
    try {
      const config = parseJsonText(configDraftText, "工具配置");
      setDraftToolOptionsByName((current) => {
        const next = { ...current };
        if (Object.keys(config).length === 0) {
          delete next[configTool.name];
        } else {
          next[configTool.name] = config;
        }
        return next;
      });
      messageApi.success("工具配置已应用");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工具配置不是合法 JSON");
    }
  };

  const clearToolConfig = () => {
    if (!configTool) return;
    setDraftToolOptionsByName((current) => {
      const next = { ...current };
      delete next[configTool.name];
      return next;
    });
    setConfigDraftText(prettyJson({}));
    messageApi.success("工具配置已清空");
  };

  const handleSelectionChange = (names: Key[]) => {
    setDraftSelectedNames([...draftInvalidSelectedNames, ...names.map(String)]);
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

  const applyToolManager = () => {
    setSelectedNames(draftSelectedNames);
    setToolOptionsByName(buildToolOptionsPayload(draftSelectedNames, draftToolOptionsByName));
    setManagerOpen(false);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title={isCreate ? "新建工具集" : "工具集"}
        meta={isCreate ? "配置工具集基本信息，工具选择在抽屉中管理" : id}
        onBack={() => navigate("/ai/toolsets")}
        actions={(
          <Space>
            <Button onClick={openToolManager}>管理工具</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>
          </Space>
        )}
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
      <Drawer
        title="管理工具"
        open={managerOpen}
        width={960}
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
                  <Descriptions size="small" column={{ xs: 1, md: 3 }} bordered>
                    <Descriptions.Item label="已选工具">{draftSelectedNames.length}</Descriptions.Item>
                    <Descriptions.Item label="已配置">{draftConfiguredToolCount}</Descriptions.Item>
                    <Descriptions.Item label="失效工具">{draftInvalidSelectedNames.length}</Descriptions.Item>
                  </Descriptions>
                  {draftInvalidSelectedNames.length > 0 ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="当前草稿中包含已失效工具"
                      description={<Space size={[8, 8]} wrap>{draftInvalidSelectedNames.map((name) => <Tag key={name}>{name}</Tag>)}</Space>}
                    />
                  ) : null}
                  <Table
                      rowKey="key"
                      size="small"
                      pagination={false}
                      dataSource={selectedToolSummaries}
                      locale={{ emptyText: "当前没有选择工具" }}
                      columns={[
                        {
                          title: "工具",
                          dataIndex: "name",
                          render: (_value: unknown, item: SelectedToolSummaryRow) => (
                            <Space direction="vertical" size={2}>
                              <Typography.Text strong>{item.tool?.displayName ?? item.name}</Typography.Text>
                              <Typography.Text code>{item.name}</Typography.Text>
                          </Space>
                        )
                      },
                        {
                          title: "状态",
                          render: (_value: unknown, item: SelectedToolSummaryRow) => (
                            <Space size={[4, 4]} wrap>
                              <Tag color={item.tool ? "blue" : "red"}>{item.tool ? "有效" : "失效"}</Tag>
                              <Tag color={item.configured ? "green" : "default"}>{item.configured ? "已配置" : "默认"}</Tag>
                          </Space>
                        )
                      }
                    ]}
                  />
                </Space>
              )
            },
            {
              key: "selection",
              label: "选择/配置",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Alert type="info" showIcon message="勾选决定工具集里启用哪些工具，选中工具后可在下方直接配置。" />
                  <Input.Search
                    allowClear
                    placeholder="搜索工具名、显示名、来源、说明或权限"
                    value={toolQuery}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setToolQuery(event.target.value)}
                  />
                  <AiToolPickerTable
                    tools={filteredTools}
                    selectedNames={draftSelectedNames}
                    toolOptionsByName={draftToolOptionsByName}
                    testingTool={testingTool}
                    testInputByTool={testInputByTool}
                    testResultByTool={testResultByTool}
                    onSelectionChange={handleSelectionChange}
                    onOpenConfig={openToolConfig}
                    onTestInputChange={handleTestInputChange}
                    onTest={(toolName) => void handleTest(toolName)}
                  />
                  {configTool ? (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      {configTool.configHelp ? <Alert type="info" showIcon message={configTool.configHelp} /> : <Alert type="info" showIcon message="该工具使用下方 JSON 配置参数。" />}
                      <ToolConfigWorkspace
                        tool={configTool}
                        selected={draftSelectedNames.includes(configTool.name)}
                        configStatus={getToolConfigStatus(configTool, draftToolOptionsByName)}
                        draftText={configDraftText}
                        testInputText={testInputByTool[configTool.name] ?? "{}"}
                        testResult={testResultByTool[configTool.name] ?? null}
                        testing={testingTool === configTool.name}
                        onDraftChange={setConfigDraftText}
                        onApply={applyToolConfig}
                        onClear={clearToolConfig}
                        onTestInputChange={handleTestInputChange}
                        onTest={(toolName) => void handleTest(toolName)}
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
  );
}
