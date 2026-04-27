import { Button, Card, Form, Input, Select, Space, Switch, Table, message } from "antd";
import { PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, createAiToolset, getAiToolset, listAiTools, testAiTool, updateAiToolset } from "../../api";
import { AiToolPermissionTag } from "../../components/ai/AiTags";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import type { AiTool, AiToolExecutionResult, AiToolPermission, AiToolset } from "../../types";
import { parseJsonText, prettyJson } from "../../utils";

const PERMISSIONS: AiToolPermission[] = ["READ_ONLY", "PROPOSE_CHANGE", "CONTROLLED_ACTION", "DANGEROUS_ACTION"];

interface ToolsetFormValues {
  id: string;
  name: string;
  description?: string;
  toolNames: string[];
  maxPermission: AiToolPermission;
  enabled: boolean;
}

export function AiToolsetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = id === "new";
  const navigate = useNavigate();
  const [form] = Form.useForm<ToolsetFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [tools, setTools] = useState<AiTool[]>([]);
  const [saving, setSaving] = useState(false);
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testInputText, setTestInputText] = useState("{}");
  const [testResult, setTestResult] = useState<AiToolExecutionResult | null>(null);

  useEffect(() => {
    void listAiTools().then(setTools).catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载工具失败"));
  }, [messageApi]);

  useEffect(() => {
    if (isCreate) {
      form.setFieldsValue({ id: "", name: "", toolNames: [], maxPermission: "READ_ONLY", enabled: true });
      return;
    }
    if (!id) return;
    void getAiToolset(id).then((toolset) => {
      form.setFieldsValue({
        id: toolset.id,
        name: toolset.name,
        description: toolset.description,
        toolNames: toolset.toolNames,
        maxPermission: toolset.maxPermission,
        enabled: toolset.enabled
      });
    }).catch((error) => messageApi.error(error instanceof ApiError ? error.message : "加载工具集失败"));
  }, [form, id, isCreate, messageApi]);

  const selectedNames = Form.useWatch("toolNames", form) ?? [];
  const selectedTools = useMemo(() => tools.filter((tool) => selectedNames.includes(tool.name)), [selectedNames, tools]);
  const toolOptions = useMemo(() => tools.map((tool) => ({ value: tool.name, label: `${tool.name} (${tool.permission})` })), [tools]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const payload: AiToolset = {
        id: values.id.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        toolNames: values.toolNames ?? [],
        maxPermission: values.maxPermission,
        enabled: values.enabled
      };
      const saved = isCreate ? await createAiToolset(payload) : await updateAiToolset(values.id, payload);
      messageApi.success("工具集已保存");
      if (isCreate) navigate(`/ai/toolsets/${saved.id}`, { replace: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存工具集失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (toolName: string) => {
    setTestingTool(toolName);
    setTestResult(null);
    try {
      setTestResult(await testAiTool(toolName, parseJsonText(testInputText, "测试输入")));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工具测试失败");
    } finally {
      setTestingTool(null);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title={isCreate ? "新建工具集" : "工具集"}
        meta={isCreate ? "选择 Agent 可用工具并设置权限上限" : id}
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
          <Form.Item name="toolNames" label="工具"><Select mode="multiple" options={toolOptions} /></Form.Item>
        </Form>
      </Card>
      <Card title="工具详情">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Input.TextArea rows={4} value={testInputText} onChange={(event) => setTestInputText(event.target.value)} />
          <Table<AiTool>
            rowKey="name"
            dataSource={selectedTools}
            pagination={false}
            columns={[
              { title: "工具名", dataIndex: "name" },
              { title: "说明", dataIndex: "description" },
              { title: "权限", dataIndex: "permission", render: (permission) => <AiToolPermissionTag permission={permission} /> },
              { title: "操作", render: (_, tool) => <Button icon={<PlayCircleOutlined />} loading={testingTool === tool.name} onClick={() => void handleTest(tool.name)}>测试</Button> }
            ]}
          />
          {testResult ? <JsonPreview title="工具测试结果" value={testResult as unknown as Record<string, unknown>} emptyDescription="暂无结果" /> : null}
          {selectedTools[0] ? <JsonPreview title="当前选中工具 Schema" value={selectedTools[0].inputSchema} emptyDescription="暂无 Schema" /> : null}
        </Space>
      </Card>
    </Space>
  );
}
