import {
  DeleteOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
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
import {
  createEventSource,
  deleteEventSource,
  disableEventSource,
  enableEventSource,
  getEventSourceUpstreamStatus,
  listEventSources,
  pullUpstreamEventSource,
  testEventSourceNormalization,
  updateEventSource
} from "../../triggers/api";
import {
  listRepositoryEventSources
} from "../../resources/api";
import { listScripts } from "../../scripts/api";
import { listConfigValues } from "../../settings/api";
import { UpstreamSyncTag, getUpstreamActionLabel } from "../../../components/domain/UpstreamSyncTag";
import { InfoHint } from "../../../components/common/InfoHint";
import { ProcessorEditor } from "../../../components/plugin/ProcessorEditor";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { TrustLevelTag } from "../../../components/domain/TrustLevelTag";
import type {
  ConfigValue,
  UpstreamStatus,
  EventSourceAuthConfig,
  EventSourceDefinition,
  EventSourceWebhookResponse,
  IncomingEventPayload,
  NormalizedEvent,
  RepositoryEventSourceDescriptor,
  ScriptDefinition
} from "../../../shared/types";
import { formatDateTime, getErrorMessage, parseJsonText, prettyJson } from "../../../services/utils";

const { Text } = Typography;

interface EventSourceManagementPageProps {
  embedded?: boolean;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyDraft(): EventSourceDefinition {
  return {
    id: "",
    key: "",
    name: "",
    description: "",
    enabled: true,
    transport: {
      type: "HTTP_WEBHOOK",
      contentTypes: ["application/json"]
    },
    auth: {
      mode: "NONE"
    },
    webhookResponse: undefined,
    sampleContext: {},
    normalizationProcessor: undefined
  };
}

function createDefaultWebhookResponse(): EventSourceWebhookResponse {
  return {
    successStatus: 200,
    successHeaders: {},
    responseProcessor: undefined,
    errorResponse: {
      httpStatus: 500,
      msg: "响应生成失败",
      data: null
    }
  };
}

function normalizeWebhookErrorResponse(response?: EventSourceWebhookResponse["errorResponse"]) {
  return {
    httpStatus: response?.httpStatus ?? 500,
    msg: response?.msg ?? "响应生成失败",
    data: response?.data ?? null
  };
}

function prettyJsonValue(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function createDefaultSampleContext(): Record<string, unknown> {
  return {
    event: {
      headers: {},
      query: {},
      body: {}
    }
  };
}

function buildTestPayloadFromSampleContext(sampleContext?: Record<string, unknown>) {
  const event = (sampleContext?.event as Record<string, unknown> | undefined) ?? {};
  return {
    headers: prettyJson((event.headers as Record<string, unknown>) ?? {}),
    query: prettyJson((event.query as Record<string, unknown>) ?? {}),
    body: prettyJson((event.body as Record<string, unknown>) ?? {}),
    rawBody: prettyJson((event.body as Record<string, unknown>) ?? {})
  };
}

function fieldLabel(label: string, content: string) {
  return (
    <Space size={6}>
      <span>{label}</span>
      <InfoHint content={content} />
    </Space>
  );
}

export function EventSourceManagementPage({ embedded = false }: EventSourceManagementPageProps) {
  const [items, setItems] = useState<EventSourceDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [configValues, setConfigValues] = useState<ConfigValue[]>([]);
  const [repositoryEventSources, setRepositoryEventSources] = useState<RepositoryEventSourceDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<EventSourceDefinition>(createEmptyDraft());
  const [developmentStatus, setUpstreamStatus] = useState<UpstreamStatus | null>(null);
  const [sampleContextText, setSampleContextText] = useState("{}");
  const [testHeadersText, setTestHeadersText] = useState("{}");
  const [testQueryText, setTestQueryText] = useState("{}");
  const [testBodyText, setTestBodyText] = useState("{}");
  const [testRawBody, setTestRawBody] = useState("{}");
  const [testResult, setTestResult] = useState<NormalizedEvent | null>(null);
  const [webhookSuccessHeadersText, setWebhookSuccessHeadersText] = useState("{}");
  const [webhookErrorDataText, setWebhookErrorDataText] = useState("null");
  const [testing, setTesting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = async () => {
    setLoading(true);
    try {
      const [sourceItems, scriptItems, configItems, repositorySourceItems] = await Promise.all([
        listEventSources(),
        listScripts(),
        listConfigValues(),
        listRepositoryEventSources()
      ]);
      setItems(sourceItems);
      setScripts(scriptItems);
      setConfigValues(configItems);
      setRepositoryEventSources(repositorySourceItems);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载事件源失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const configOptions = useMemo(
    () => configValues.map((item) => ({ label: item.key, value: item.key })),
    [configValues]
  );

  const repositoryDescriptorByLocalId = useMemo(
    () => new Map(
      repositoryEventSources
        .filter((item) => item.localState)
        .map((item) => [item.localState!.localAssetId, item])
    ),
    [repositoryEventSources]
  );

  const repositoryDescriptorByTrackedId = useMemo(
    () => new Map(
      repositoryEventSources
        .filter((item) => item.localState?.mode === "TRACKED")
        .map((item) => [item.localState!.localAssetId, item])
    ),
    [repositoryEventSources]
  );

  const updateDraft = (patch: Partial<EventSourceDefinition>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };

  const loadUpstreamInfo = async (item: EventSourceDefinition) => {
    if (!repositoryDescriptorByTrackedId.has(item.id)) {
      setUpstreamStatus(null);
      return;
    }
    try {
      setUpstreamStatus(await getEventSourceUpstreamStatus(item.id));
    } catch {
      setUpstreamStatus(null);
    }
  };

  const openCreate = () => {
    const nextDraft = createEmptyDraft();
    setDraft(nextDraft);
    setUpstreamStatus(null);
    const sampleContext = createDefaultSampleContext();
    setSampleContextText(prettyJson(sampleContext));
    const testPayload = buildTestPayloadFromSampleContext(sampleContext);
    setTestHeadersText(testPayload.headers);
    setTestQueryText(testPayload.query);
    setTestBodyText(testPayload.body);
    setTestRawBody(testPayload.rawBody);
    setWebhookSuccessHeadersText(prettyJsonValue(createDefaultWebhookResponse().successHeaders));
    setWebhookErrorDataText("null");
    setTestResult(null);
    setDrawerOpen(true);
  };

  const openEdit = (item: EventSourceDefinition) => {
    const nextDraft = cloneValue(item);
    setDraft(nextDraft);
    void loadUpstreamInfo(nextDraft);
    const sampleContext = (nextDraft.sampleContext && Object.keys(nextDraft.sampleContext).length > 0)
      ? nextDraft.sampleContext
      : createDefaultSampleContext();
    setSampleContextText(prettyJson(sampleContext));
    const testPayload = buildTestPayloadFromSampleContext(sampleContext);
    setTestHeadersText(testPayload.headers);
    setTestQueryText(testPayload.query);
    setTestBodyText(testPayload.body);
    setTestRawBody(testPayload.rawBody);
    const webhookResponse = nextDraft.webhookResponse ?? createDefaultWebhookResponse();
    setWebhookSuccessHeadersText(prettyJsonValue(webhookResponse.successHeaders ?? {}));
    setWebhookErrorDataText(
      webhookResponse.errorResponse?.data === undefined
        ? "null"
        : prettyJsonValue(webhookResponse.errorResponse.data)
    );
    setTestResult(null);
    setDrawerOpen(true);
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      let webhookErrorData: unknown = null;
      if (draft.webhookResponse) {
        try {
          webhookErrorData = webhookErrorDataText.trim() ? JSON.parse(webhookErrorDataText) : null;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "格式错误";
          throw new Error(`失败数据 JSON 不是合法 JSON: ${reason}`);
        }
      }
      const webhookResponse = draft.webhookResponse
        ? {
            ...draft.webhookResponse,
            successHeaders: parseJsonText(webhookSuccessHeadersText, "成功响应头"),
            errorResponse: {
              ...normalizeWebhookErrorResponse(draft.webhookResponse.errorResponse),
              data: webhookErrorData
            }
          }
        : undefined;
      const payload: Partial<EventSourceDefinition> = {
        ...draft,
        webhookResponse,
        sampleContext: parseJsonText(sampleContextText, "样例上下文")
      };
      const saved = draft.id
        ? await updateEventSource(draft.id, payload)
        : await createEventSource(payload);
      messageApi.success(draft.id ? "事件源已更新" : "事件源已创建");
      setDrawerOpen(false);
      setItems((previous) => {
        const hasExisting = previous.some((item) => item.id === saved.id);
        const next = hasExisting
          ? previous.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...previous];
        return [...next].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
      });
      await loadUpstreamInfo(saved);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存事件源失败"));
    } finally {
      setSaving(false);
    }
  };

  const runNormalizationTest = async () => {
    if (!draft.id) {
      messageApi.warning("请先保存事件源，再测试标准化");
      return;
    }
    setTesting(true);
    try {
      const payload: IncomingEventPayload = {
        headers: parseJsonText(testHeadersText, "测试 headers"),
        query: parseJsonText(testQueryText, "测试 query"),
        body: parseJsonText(testBodyText, "测试 body"),
        rawBody: testRawBody,
        contentType: "application/json"
      };
      const result = await testEventSourceNormalization(draft.id, payload);
      setTestResult(result);
      messageApi.success("标准化测试完成");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "标准化测试失败"));
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async (item: EventSourceDefinition) => {
    try {
      const saved = item.enabled ? await disableEventSource(item.id) : await enableEventSource(item.id);
      setItems((previous) => previous.map((record) => (record.id === saved.id ? saved : record)));
      if (draft.id === saved.id) {
        setDraft(saved);
      }
      messageApi.success(item.enabled ? "事件源已停用" : "事件源已启用");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "更新事件源状态失败"));
    }
  };

  const removeItem = async (item: EventSourceDefinition) => {
    try {
      await deleteEventSource(item.id);
      setItems((previous) => previous.filter((record) => record.id !== item.id));
      messageApi.success("事件源已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除事件源失败"));
    }
  };

  const handlePullDevelopmentSource = async (item: EventSourceDefinition, force = false) => {
    setActionKey(`pull:${item.id}`);
    try {
      const saved = await pullUpstreamEventSource(item.id, force);
      setDraft(saved);
      await loadUpstreamInfo(saved);
      const sampleContext = (saved.sampleContext && Object.keys(saved.sampleContext).length > 0)
        ? saved.sampleContext
        : createDefaultSampleContext();
      setSampleContextText(prettyJson(sampleContext));
      const testPayload = buildTestPayloadFromSampleContext(sampleContext);
      setTestHeadersText(testPayload.headers);
      setTestQueryText(testPayload.query);
      setTestBodyText(testPayload.body);
      setTestRawBody(testPayload.rawBody);
      await loadData();
      messageApi.success("工作副本事件源已拉取上游更新");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "拉取工作副本事件源失败"));
    } finally {
      setActionKey(null);
    }
  };

  const columns: ColumnsType<EventSourceDefinition> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_value, record) => (
        <TableLinkCell title={record.name} onClick={() => openEdit(record)}>
          <Space direction="vertical" size={0}>
            <Space wrap size={[8, 8]}>
              <Text strong>{record.name}</Text>
              {record.scope === "REPOSITORY" ? <Tag color="blue">仓库安装</Tag> : null}
              {repositoryDescriptorByTrackedId.has(record.id) ? <Tag color="purple">跟踪本地资产</Tag> : null}
            </Space>
            <Text type="secondary">{record.key}</Text>
          </Space>
        </TableLinkCell>
      )
    },
    {
      title: "来源",
      width: 220,
      render: (_value, record) => {
        const descriptor = repositoryDescriptorByLocalId.get(record.id);
        if (!descriptor) {
          return <Text type="secondary">本地创建</Text>;
        }
        return (
          <Space direction="vertical" size={2}>
            <Text>{descriptor.repositoryId}</Text>
            <Text code>{descriptor.eventSourceId}</Text>
          </Space>
        );
      }
    },
    {
      title: "鉴权",
      width: 140,
      render: (_value, record) => <Tag>{record.auth?.mode ?? "NONE"}</Tag>
    },
    {
      title: "Endpoint",
      width: 260,
      render: (_value, record) => <Text code>{record.transport.endpointPath ?? `/api/event-sources/${record.id}/events`}</Text>
    },
    {
      title: "状态",
      width: 180,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.enabled ? "green" : "default"}>{record.enabled ? "启用" : "停用"}</Tag>
          {repositoryDescriptorByTrackedId.has(record.id) ? (
            <UpstreamSyncTag state={repositoryDescriptorByTrackedId.get(record.id)?.localState?.syncState} />
          ) : null}
        </Space>
      )
    },
    {
      title: "最近事件",
      width: 180,
      render: (_value, record) => formatDateTime(record.lastReceivedAt)
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" onClick={() => openEdit(record)}>
            {record.editable === false ? "查看" : "编辑"}
          </Button>
          {repositoryDescriptorByTrackedId.has(record.id) ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={actionKey === `pull:${record.id}`}
              onClick={() => void handlePullDevelopmentSource(record)}
            >
              {getUpstreamActionLabel(repositoryDescriptorByTrackedId.get(record.id)?.localState?.syncState)}
            </Button>
          ) : null}
          <Button
            size="small"
            icon={record.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            disabled={record.editable === false}
            onClick={() => void toggleEnabled(record)}
          >
            {record.enabled ? "停用" : "启用"}
          </Button>
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            disabled={record.editable === false}
            onClick={() => void removeItem(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const currentAuth: EventSourceAuthConfig = draft.auth ?? { mode: "NONE" };
  const currentWebhookResponse = draft.webhookResponse ?? createDefaultWebhookResponse();
  const webhookResponseEnabled = Boolean(draft.webhookResponse);
  const currentRepositoryDescriptor =
    repositoryDescriptorByLocalId.get(draft.id);

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!embedded ? (
          <PageHeader
            title="事件源"
            meta="定义外部事件如何进入 ActionDock，以及如何鉴权、标准化和测试。"
            actions={(
              <>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  新建事件源
                </Button>
                <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                  刷新
                </Button>
              </>
            )}
          />
        ) : (
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建事件源
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
          </Space>
        )}

        <Alert
          type="info"
          showIcon
          message="先定义 sourceKey 和 Webhook 地址，再选鉴权方式，最后写标准化 Processor。"
          description="仓库安装源是只读资产；工作副本可编辑，并支持拉取来源仓库更新。"
        />

        <Card>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有事件源" />
          ) : (
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={[...items].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 1040 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title={draft.id ? `编辑事件源 · ${draft.name || draft.key}` : "新建事件源"}
        open={drawerOpen}
        width={880}
        onClose={() => setDrawerOpen(false)}
        extra={(
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            {repositoryDescriptorByTrackedId.has(draft.id) ? (
              <Button loading={actionKey === `pull:${draft.id}`} onClick={() => void handlePullDevelopmentSource(draft)}>
                拉取更新
              </Button>
            ) : null}
            {draft.editable !== false ? (
              <Button type="primary" loading={saving} onClick={() => void saveDraft()}>
                保存
              </Button>
            ) : null}
          </Space>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {draft.scope === "REPOSITORY" || repositoryDescriptorByTrackedId.has(draft.id) ? (
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "scope", label: "来源类型", children: repositoryDescriptorByTrackedId.has(draft.id) ? "跟踪本地资产" : "仓库安装" },
                { key: "repository", label: "来源仓库", children: draft.repositoryId || currentRepositoryDescriptor?.repositoryId || "-" },
                { key: "source", label: "仓库事件源", children: <Text code>{draft.repositoryEventSourceId || currentRepositoryDescriptor?.eventSourceId || "-"}</Text> },
                { key: "version", label: "仓库版本", children: draft.repositoryVersion || currentRepositoryDescriptor?.version || "-" },
                { key: "trust", label: "仓库信任", children: currentRepositoryDescriptor ? <TrustLevelTag level={currentRepositoryDescriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> : "-" },
                { key: "sync", label: "上游同步", children: repositoryDescriptorByTrackedId.has(draft.id) ? <UpstreamSyncTag state={developmentStatus?.syncState} /> : <Text type="secondary">-</Text> }
              ]}
            />
          ) : null}
          <Card size="small" title="基础信息">
            <Form layout="vertical">
              <Form.Item label={fieldLabel("名称", "给事件源起一个便于识别的名字。")} required>
                <Input value={draft.name} readOnly={draft.editable === false} onChange={(event) => updateDraft({ name: event.target.value })} />
              </Form.Item>
              <Form.Item label={fieldLabel("Key", "用户自定义唯一键，例如 github.issue 或 custom.crm。")} required>
                <Input value={draft.key} readOnly={draft.editable === false} onChange={(event) => updateDraft({ key: event.target.value })} />
              </Form.Item>
              <Form.Item label={fieldLabel("描述", "补充这个事件源对应的外部系统和事件范围。")}>
                <Input.TextArea rows={3} value={draft.description} readOnly={draft.editable === false} onChange={(event) => updateDraft({ description: event.target.value })} />
              </Form.Item>
              <Form.Item label={fieldLabel("启用", "停用后入口仍在，但不会继续接收和分发事件。")}>
                <Switch checked={draft.enabled} disabled={draft.editable === false} onChange={(checked) => updateDraft({ enabled: checked })} />
              </Form.Item>
              <Form.Item label={fieldLabel("Webhook Endpoint", "保存后自动生成，外部系统调用这个地址。")}>
                <Input value={draft.transport.endpointPath ?? (draft.id ? `/api/event-sources/${draft.id}/events` : "保存后生成")} readOnly />
              </Form.Item>
            </Form>
          </Card>

          <Card size="small" title="鉴权配置">
            <Form layout="vertical">
              <Form.Item label={fieldLabel("鉴权模式", "选择这条入口如何校验外部请求。")}>
                <Select
                  value={currentAuth.mode}
                  disabled={draft.editable === false}
                  options={[
                    { label: "无鉴权", value: "NONE" },
                    { label: "Header Token", value: "HEADER_TOKEN" },
                    { label: "Query Token", value: "QUERY_TOKEN" },
                    { label: "HMAC SHA256", value: "HMAC_SHA256" }
                  ]}
                  onChange={(mode) => updateDraft({ auth: { ...currentAuth, mode } })}
                />
              </Form.Item>
              {currentAuth.mode === "HEADER_TOKEN" ? (
                <Form.Item label={fieldLabel("Token Header", "从哪个请求头里读取 Token。")}>
                  <Input readOnly={draft.editable === false} value={currentAuth.tokenHeader} onChange={(event) => updateDraft({ auth: { ...currentAuth, tokenHeader: event.target.value } })} />
                </Form.Item>
              ) : null}
              {currentAuth.mode === "QUERY_TOKEN" ? (
                <Form.Item label={fieldLabel("Token Query Param", "从哪个查询参数里读取 Token。")}>
                  <Input readOnly={draft.editable === false} value={currentAuth.tokenQueryParam} onChange={(event) => updateDraft({ auth: { ...currentAuth, tokenQueryParam: event.target.value } })} />
                </Form.Item>
              ) : null}
              {currentAuth.mode === "HMAC_SHA256" ? (
                <>
                  <Form.Item label={fieldLabel("Signature Header", "签名所在请求头，例如 X-Hub-Signature-256。")}>
                    <Input readOnly={draft.editable === false} value={currentAuth.signatureHeader} onChange={(event) => updateDraft({ auth: { ...currentAuth, signatureHeader: event.target.value } })} />
                  </Form.Item>
                  <Form.Item label={fieldLabel("Signature Prefix", "签名前缀，例如 sha256=。")}>
                    <Input readOnly={draft.editable === false} value={currentAuth.signaturePrefix} onChange={(event) => updateDraft({ auth: { ...currentAuth, signaturePrefix: event.target.value } })} />
                  </Form.Item>
                  <Form.Item label={fieldLabel("Signature Payload", "计算签名时使用原始请求体或时间戳拼接体。")}>
                    <Select
                      value={currentAuth.signaturePayload ?? "RAW_BODY"}
                      disabled={draft.editable === false}
                      options={[
                        { label: "RAW_BODY", value: "RAW_BODY" },
                        { label: "TIMESTAMP_DOT_RAW_BODY", value: "TIMESTAMP_DOT_RAW_BODY" }
                      ]}
                      onChange={(signaturePayload) => updateDraft({ auth: { ...currentAuth, signaturePayload } })}
                    />
                  </Form.Item>
                  <Form.Item label={fieldLabel("Timestamp Header", "时间戳所在请求头，仅在需要防重放时使用。")}>
                    <Input readOnly={draft.editable === false} value={currentAuth.timestampHeader} onChange={(event) => updateDraft({ auth: { ...currentAuth, timestampHeader: event.target.value } })} />
                  </Form.Item>
                  <Form.Item label={fieldLabel("Secret Config Key", "从系统配置中读取签名密钥，不直接明文保存。")}>
                    <Select
                      showSearch
                      allowClear
                      value={currentAuth.secretConfigKey}
                      disabled={draft.editable === false}
                      options={configOptions}
                      optionFilterProp="label"
                      onChange={(secretConfigKey) => updateDraft({ auth: { ...currentAuth, secretConfigKey } })}
                    />
                  </Form.Item>
                </>
              ) : null}
            </Form>
          </Card>

          <ProcessorEditor
            title="标准化 Processor"
            purpose="normalization"
            value={draft.normalizationProcessor}
            scripts={scripts}
            description="把原始请求转成统一事件结构，供后续触发器使用；留空默认直接使用基础事件字段。"
            disabled={draft.editable === false}
            onChange={(normalizationProcessor) => updateDraft({ normalizationProcessor })}
          />

          <Card size="small" title="外部响应">
            <Form layout="vertical">
              <Form.Item label={fieldLabel("启用自定义响应", "关闭时保持当前默认 ApiResponse；开启后仅在鉴权与基础解析通过后接管 webhook HTTP 响应。")}>
                <Switch
                  checked={webhookResponseEnabled}
                  disabled={draft.editable === false}
                  onChange={(checked) => {
                    updateDraft({ webhookResponse: checked ? createDefaultWebhookResponse() : undefined });
                    if (checked) {
                      setWebhookSuccessHeadersText("{}");
                      setWebhookErrorDataText("null");
                    }
                  }}
                />
              </Form.Item>
              {webhookResponseEnabled ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="成功响应返回原始 HTTP body；失败兜底返回配置的 ApiResponse 错误包。若要使用脚本结果，请把相关触发器设为 SYNC。"
                    style={{ marginBottom: 16 }}
                  />
                  <Form.Item label={fieldLabel("成功状态码", "自定义响应成功时返回的 HTTP 状态码。")}>
                    <Input
                      type="number"
                      value={String(currentWebhookResponse.successStatus ?? 200)}
                      readOnly={draft.editable === false}
                      onChange={(event) => updateDraft({
                        webhookResponse: {
                          ...currentWebhookResponse,
                          successStatus: Number(event.target.value || 200)
                        }
                      })}
                    />
                  </Form.Item>
                  <Form.Item label={fieldLabel("成功响应头 JSON", "Header 名和值，值会转成字符串。")}>
                    <Input.TextArea
                      rows={4}
                      value={webhookSuccessHeadersText}
                      readOnly={draft.editable === false}
                      onChange={(event) => setWebhookSuccessHeadersText(event.target.value)}
                    />
                  </Form.Item>
                  <ProcessorEditor
                    title="响应 Processor"
                    value={currentWebhookResponse.responseProcessor}
                    scripts={scripts}
                    description="基于标准化事件、触发器分发结果和同步执行结果生成返回给外部系统的 JSON body。"
                    required
                    disabled={draft.editable === false}
                    onChange={(responseProcessor) => updateDraft({
                      webhookResponse: {
                        ...currentWebhookResponse,
                        responseProcessor
                      }
                    })}
                  />
                  <Form.Item label={fieldLabel("失败状态码", "自定义响应链路未产出结果时返回的 HTTP 状态码。")} style={{ marginTop: 16 }}>
                    <Input
                      type="number"
                      value={String(currentWebhookResponse.errorResponse?.httpStatus ?? 500)}
                      readOnly={draft.editable === false}
                      onChange={(event) => updateDraft({
                        webhookResponse: {
                          ...currentWebhookResponse,
                          errorResponse: { ...normalizeWebhookErrorResponse(currentWebhookResponse.errorResponse), httpStatus: Number(event.target.value || 500) }
                        }
                      })}
                    />
                  </Form.Item>
                  <Form.Item label={fieldLabel("失败消息", "写入 ApiResponse.msg。")}>
                    <Input
                      value={currentWebhookResponse.errorResponse?.msg}
                      readOnly={draft.editable === false}
                      onChange={(event) => updateDraft({
                        webhookResponse: {
                          ...currentWebhookResponse,
                          errorResponse: { ...normalizeWebhookErrorResponse(currentWebhookResponse.errorResponse), msg: event.target.value }
                        }
                      })}
                    />
                  </Form.Item>
                  <Form.Item label={fieldLabel("失败数据 JSON", "写入 ApiResponse.data。")}>
                    <Input.TextArea
                      rows={4}
                      value={webhookErrorDataText}
                      readOnly={draft.editable === false}
                      onChange={(event) => setWebhookErrorDataText(event.target.value)}
                    />
                  </Form.Item>
                </>
              ) : null}
            </Form>
          </Card>

          <Card size="small" title="样例上下文">
            <Input.TextArea
              rows={8}
              value={sampleContextText}
              readOnly={draft.editable === false}
              onChange={(event) => setSampleContextText(event.target.value)}
            />
          </Card>

          <Card size="small" title="调试面板">
            {!draft.id ? (
              <Alert type="info" showIcon message="请先保存事件源，再执行标准化测试。" />
            ) : null}
            {draft.id ? (
              <Alert
                type="info"
                showIcon
                message="测试面板模拟外部系统请求。Headers / Query / Body 会先进入标准化 Processor。"
              />
            ) : null}
            <Form layout="vertical" style={{ marginTop: draft.id ? 0 : 12 }}>
              <Form.Item label={fieldLabel("Headers JSON", "请求头，通常包含事件类型、签名或 delivery id。")}>
                <Input.TextArea rows={4} value={testHeadersText} onChange={(event) => setTestHeadersText(event.target.value)} />
              </Form.Item>
              <Form.Item label={fieldLabel("Query JSON", "查询参数，常用于简单 token 鉴权。")}>
                <Input.TextArea rows={3} value={testQueryText} onChange={(event) => setTestQueryText(event.target.value)} />
              </Form.Item>
              <Form.Item label={fieldLabel("Body JSON", "外部系统提交的结构化请求体。")}>
                <Input.TextArea rows={6} value={testBodyText} onChange={(event) => setTestBodyText(event.target.value)} />
              </Form.Item>
              <Form.Item label={fieldLabel("Raw Body", "HMAC 签名通常基于原始请求体计算。")}>
                <Input.TextArea rows={4} value={testRawBody} onChange={(event) => setTestRawBody(event.target.value)} />
              </Form.Item>
            </Form>
            <Space wrap>
              <Button disabled={!draft.id} loading={testing} onClick={() => void runNormalizationTest()}>
                测试标准化
              </Button>
              <Button disabled={!draft.id} onClick={() => {
                const sampleContext = createDefaultSampleContext();
                const payload = buildTestPayloadFromSampleContext(sampleContext);
                setSampleContextText(prettyJson(sampleContext));
                setTestHeadersText(payload.headers);
                setTestQueryText(payload.query);
                setTestBodyText(payload.body);
                setTestRawBody(payload.rawBody);
              }}>
                使用默认样例
              </Button>
              {testResult ? (
                <pre className="json-preview">{prettyJson(testResult as unknown as Record<string, unknown>)}</pre>
              ) : null}
            </Space>
          </Card>
        </Space>
      </Drawer>
    </>
  );
}
