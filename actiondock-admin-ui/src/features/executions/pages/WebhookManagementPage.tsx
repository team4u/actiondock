import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExecutionResultCard } from "../../../components/execution/ExecutionResultCard";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { createWebhook, deleteWebhook, disableWebhook, enableWebhook, listWebhooks, testWebhook, updateWebhook } from "../../triggers/api";
import { listScripts } from "../../scripts/api";
import { buildWebhookScriptPreset, writeScriptCreatePreset } from "../../../services/scriptCreatePreset";
import type { WebhookDefinition, ScriptDefinition, WebhookRequest, WebhookSampleRequest, WebhookTestResult } from "../../../shared/types";
import { formatDateTime, getErrorMessage, parseJsonText, prettyJson } from "../../../services/utils";
import { isScriptPublished } from "../../../services/scriptPublication";

const { Text } = Typography;

interface WebhookManagementPageProps {
  embedded?: boolean;
}

function createDefaultSampleRequest(): WebhookSampleRequest {
  return {
    method: "POST",
    headers: {},
    query: {},
    rawBody: "{\"hello\":\"world\"}",
    contentType: "application/json"
  };
}

function createEmptyDraft(): WebhookDefinition {
  return {
    id: "",
    key: "",
    name: "",
    description: "",
    enabled: true,
    transport: {
      type: "HTTP_WEBHOOK",
      contentTypes: ["*/*"]
    },
    webhookScriptId: "",
    sampleRequest: createDefaultSampleRequest()
  };
}

function buildTestRequest(source: WebhookDefinition): WebhookRequest {
  return {
    ...((source.sampleRequest ?? createDefaultSampleRequest()) as WebhookSampleRequest),
    path: source.id ? `/api/webhooks/${source.id}` : "/api/webhooks/{id}"
  };
}

function parseSampleRequestText(value: string): WebhookSampleRequest {
  return parseJsonText(value, "样例请求") as unknown as WebhookSampleRequest;
}

function parseWebhookRequestText(value: string): WebhookRequest {
  return parseJsonText(value, "dry-run 请求") as unknown as WebhookRequest;
}

export function WebhookManagementPage({ embedded = false }: WebhookManagementPageProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<WebhookDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [draft, setDraft] = useState<WebhookDefinition>(createEmptyDraft());
  const [sampleRequestText, setSampleRequestText] = useState(prettyJson(createDefaultSampleRequest()));
  const [testRequestText, setTestRequestText] = useState(prettyJson(buildTestRequest(createEmptyDraft())));
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);
  const [useKeyAsId, setUseKeyAsId] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  async function loadData() {
    setLoading(true);
    try {
      const [sources, scriptsValue] = await Promise.all([listWebhooks(), listScripts()]);
      setItems(sources);
      setScripts(scriptsValue);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Webhook 失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const publishedScripts = useMemo(
    () => scripts.filter(isScriptPublished).sort((a, b) => a.id.localeCompare(b.id)),
    [scripts]
  );

  const scriptOptions = useMemo(
    () => publishedScripts.map((script) => ({
      label: `${script.name} (${script.id})`,
      value: script.id
    })),
    [publishedScripts]
  );

  function openCreate() {
    const next = createEmptyDraft();
    setDraft(next);
    setUseKeyAsId(false);
    setSampleRequestText(prettyJson(next.sampleRequest));
    setTestRequestText(prettyJson(buildTestRequest(next)));
    setTestResult(null);
    setDrawerOpen(true);
  }

  function openEdit(item: WebhookDefinition) {
    const next = JSON.parse(JSON.stringify(item)) as WebhookDefinition;
    next.sampleRequest = next.sampleRequest ?? createDefaultSampleRequest();
    setDraft(next);
    setSampleRequestText(prettyJson(next.sampleRequest));
    setTestRequestText(prettyJson(buildTestRequest(next)));
    setTestResult(null);
    setDrawerOpen(true);
  }

  function updateDraft(patch: Partial<WebhookDefinition>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function applySampleRequestToTest() {
    try {
      const sampleRequest = parseSampleRequestText(sampleRequestText);
      setTestRequestText(prettyJson(buildTestRequest({ ...draft, sampleRequest } as WebhookDefinition)));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "样例请求格式不正确"));
    }
  }

  function handleCreateWebhookScript() {
    writeScriptCreatePreset(buildWebhookScriptPreset({
      key: draft.key,
      name: draft.name
    }));
    navigate("/scripts/new");
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const payload: WebhookDefinition = {
        ...draft,
        sampleRequest: parseSampleRequestText(sampleRequestText)
      };
      if (!draft.id && useKeyAsId && draft.key?.trim()) {
        payload.id = draft.key.trim();
      }
      const saved = draft.id
        ? await updateWebhook(draft.id, payload)
        : await createWebhook(payload);
      messageApi.success(draft.id ? "Webhook 已更新" : "Webhook 已创建");
      setDrawerOpen(false);
      setDraft(saved);
      await loadData();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存 Webhook 失败"));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!draft.id) {
      messageApi.warning("请先保存 Webhook，再执行 dry-run");
      return;
    }
    setTesting(true);
    try {
      const requestPayload = parseWebhookRequestText(testRequestText);
      const result = await testWebhook(draft.id, requestPayload);
      setTestResult(result);
      messageApi.success("dry-run 完成");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "Webhook dry-run 失败"));
    } finally {
      setTesting(false);
    }
  }

  async function toggleEnabled(item: WebhookDefinition) {
    try {
      await (item.enabled ? disableWebhook(item.id) : enableWebhook(item.id));
      await loadData();
      messageApi.success(item.enabled ? "Webhook 已停用" : "Webhook 已启用");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "更新状态失败"));
    }
  }

  async function removeItem(item: WebhookDefinition) {
    try {
      await deleteWebhook(item.id);
      messageApi.success("Webhook 已删除");
      await loadData();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除 Webhook 失败"));
    }
  }

  const columns: ColumnsType<WebhookDefinition> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_value, record) => (
        <TableLinkCell
          title={record.name}
          onClick={() => openEdit(record)}
        >
          <Space direction="vertical" size={0}>
            <span>{record.name}</span>
            <Text type="secondary">{record.description || record.key}</Text>
          </Space>
        </TableLinkCell>
      )
    },
    {
      title: "脚本",
      dataIndex: "webhookScriptId",
      render: (value: string) => <Text code>{value || "-"}</Text>
    },
    {
      title: "Webhook",
      render: (_value, record) => <Text code>{record.transport.endpointPath ?? `/api/webhooks/${record.id}`}</Text>
    },
    {
      title: "状态",
      dataIndex: "enabled",
      render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "启用" : "停用"}</Tag>
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Button
            size="small"
            icon={record.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => void toggleEnabled(record)}
          >
            {record.enabled ? "停用" : "启用"}
          </Button>
          <Popconfirm
            title="确认删除"
            description={`确定要删除 Webhook「${record.name || record.key}」吗？`}
            onConfirm={() => void removeItem(record)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!embedded ? (
          <PageHeader
            title="Webhook"
            actions={(
              <>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建 Webhook</Button>
                <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>刷新</Button>
              </>
            )}
          />
        ) : (
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建 Webhook</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>刷新</Button>
          </Space>
        )}

        <Card>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有 Webhook" />
          ) : (
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={[...items].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 1080 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title={draft.id ? `编辑 Webhook · ${draft.name || draft.key}` : "新建 Webhook"}
        open={drawerOpen}
        width={920}
        onClose={() => setDrawerOpen(false)}
        extra={(
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void saveDraft()}>保存</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" title="基础信息">
            <Form layout="vertical">
              <Form.Item label="名称" required>
                <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
              </Form.Item>
              <Form.Item label="Key" required>
                <Input value={draft.key} onChange={(event) => updateDraft({ key: event.target.value })} />
              </Form.Item>
              <Form.Item label="描述">
                <Input.TextArea rows={3} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
              </Form.Item>
              <Form.Item label="Webhook 脚本" required>
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    showSearch
                    value={draft.webhookScriptId || undefined}
                    options={scriptOptions}
                    optionFilterProp="label"
                    placeholder="选择一个已发布脚本"
                    onChange={(webhookScriptId) => updateDraft({ webhookScriptId })}
                    style={{ width: "100%" }}
                  />
                  <Button icon={<PlusOutlined />} onClick={handleCreateWebhookScript}>
                    新建脚本
                  </Button>
                </Space.Compact>
              </Form.Item>
              <Form.Item label="启用">
                <Switch checked={draft.enabled} onChange={(enabled) => updateDraft({ enabled })} />
              </Form.Item>
              <Form.Item
                label="Webhook Endpoint"
                tooltip="选择端点路径的生成方式。仅创建时可配置。"
              >
                {draft.id ? (
                  <Input value={`/api/webhooks/${draft.id}`} readOnly />
                ) : (
                  <Select
                    style={{ width: "100%" }}
                    value={useKeyAsId ? "key" : "auto"}
                    onChange={(value) => setUseKeyAsId(value === "key")}
                    options={[
                      { label: "自动生成", value: "auto" },
                      { label: `使用 Key（/api/webhooks/${draft.key || "..."}）`, value: "key", disabled: !draft.key?.trim() }
                    ]}
                  />
                )}
              </Form.Item>
            </Form>
          </Card>

          <Card size="small" title="样例请求">
            <Input.TextArea rows={12} value={sampleRequestText} onChange={(event) => setSampleRequestText(event.target.value)} />
          </Card>

          <Card size="small" title="Dry-run">
            <Form layout="vertical">
              <Form.Item label="请求 JSON">
                <Input.TextArea rows={12} value={testRequestText} onChange={(event) => setTestRequestText(event.target.value)} />
              </Form.Item>
            </Form>
            <Space wrap>
              <Button disabled={!draft.id} loading={testing} onClick={() => void runTest()}>执行 dry-run</Button>
              <Button onClick={applySampleRequestToTest}>使用样例请求</Button>
            </Space>
            {testResult ? (
              <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
                <Card size="small" title="HTTP 响应">
                  <pre className="json-preview">{prettyJson(testResult.webhookResponse)}</pre>
                </Card>
                <ExecutionResultCard
                  execution={testResult.execution}
                  title="脚本执行记录"
                  showTriggerSource
                />
              </Space>
            ) : null}
          </Card>
        </Space>
      </Drawer>
    </>
  );
}
