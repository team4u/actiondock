import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExecutionResultCard } from "../../../components/execution/ExecutionResultCard";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { RepositoryPublishBasicsForm } from "../../../components/repository/RepositoryPublishBasicsForm";
import {
  createWebhook,
  deleteWebhook,
  disableWebhook,
  enableWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook
} from "../../triggers/api";
import { listScripts } from "../../scripts/api";
import { buildWebhookScriptPreset, writeScriptCreatePreset } from "../../../services/scriptCreatePreset";
import {
  listRepositories,
  listRepositoryScripts,
  listWebhooksByRepository,
  previewRepositoryWebhookPublish,
  publishRepositoryWebhook,
  syncRepository
} from "../../resources/api";
import { getPublishableRepositories } from "../../../services/repositoryPublish";
import { useDefaultOwner } from "../../../shared/hooks/useDefaultOwner";
import type {
  RepositoryDefinition,
  RepositoryPublishConfigCandidate,
  RepositoryWebhookPublishDependencyDraft,
  ScriptDefinition,
  ScriptDependency,
  WebhookDefinition,
  WebhookRequest,
  WebhookSampleRequest,
  WebhookTestResult
} from "../../../shared/types";
import { formatDateTime, getErrorMessage, parseJsonText, prettyJson } from "../../../services/utils";
import { isScriptPublished } from "../../../services/scriptPublication";

const { Text } = Typography;

interface WebhookManagementPageProps {
  embedded?: boolean;
}

interface WebhookPublishFormValues {
  repositoryId: string;
  webhookId: string;
  displayName: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
  tags?: string[];
}

function suggestNextRepositoryVersion(value?: string): string {
  if (!value?.trim()) {
    return "0.1.0";
  }
  const parts = value.split(".");
  const last = Number(parts[parts.length - 1]);
  if (Number.isNaN(last)) {
    return value;
  }
  const next = [...parts];
  next[next.length - 1] = String(last + 1);
  return next.join(".");
}

function normalizeTagValues(tags?: string[]): string[] {
  return (tags ?? []).filter((item) => item.trim().length > 0);
}

function normalizeDependencyDrafts(drafts: RepositoryWebhookPublishDependencyDraft[]): ScriptDependency[] {
  return drafts
    .filter((item) => item.repositoryId?.trim() && item.repositoryScriptId?.trim())
    .map((item) => ({
      scriptId: item.scriptId.trim(),
      repositoryId: item.repositoryId!.trim(),
      repositoryScriptId: item.repositoryScriptId!.trim(),
      versionRange: item.versionRange?.trim() || undefined
    }));
}

function renderDependencyEditor(
  drafts: RepositoryWebhookPublishDependencyDraft[],
  repositories: RepositoryDefinition[],
  repositoryToolOptions: Array<{ repositoryId: string; scriptId: string; displayName: string }>,
  onChange: (scriptId: string, changedValues: Partial<RepositoryWebhookPublishDependencyDraft>) => void
) {
  if (drafts.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前脚本没有检测到 scripts.invoke(...) 依赖" />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {drafts.map((dependency) => {
        const toolOptions = repositoryToolOptions
          .filter((item) => item.repositoryId === dependency.repositoryId)
          .map((item) => ({
            value: item.scriptId,
            label: `${item.displayName} (${item.scriptId})`
          }));
        return (
          <div key={dependency.scriptId}>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Space wrap size={[8, 8]}>
                <Text code>{dependency.scriptId}</Text>
                {dependency.state === "AUTO" ? <Tag color="green">已自动匹配</Tag> : null}
                {dependency.state === "MANUAL" ? <Tag color="blue">手工指定</Tag> : null}
                {dependency.state === "UNRESOLVED" ? <Tag color="orange">未匹配</Tag> : null}
                {dependency.versionRange ? <Tag color="geekblue">{dependency.versionRange}</Tag> : null}
              </Space>
              <Space size={12} style={{ width: "100%" }} wrap>
                <Select
                  value={dependency.repositoryId}
                  placeholder="选择仓库"
                  style={{ flex: "1 1 180px", minWidth: 180 }}
                  options={repositories.map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(value) => onChange(dependency.scriptId, {
                    repositoryId: value,
                    repositoryScriptId: undefined,
                    versionRange: undefined,
                    state: "MANUAL"
                  })}
                />
                <Select
                  value={dependency.repositoryScriptId}
                  placeholder="选择依赖脚本"
                  disabled={!dependency.repositoryId}
                  style={{ flex: "2 1 260px", minWidth: 260 }}
                  options={toolOptions}
                  onChange={(value) => onChange(dependency.scriptId, {
                    repositoryScriptId: value,
                    versionRange: undefined,
                    state: "MANUAL"
                  })}
                />
                <Input
                  value={dependency.versionRange}
                  placeholder="例如 >= 1.0.0"
                  style={{ flex: "1 1 180px", minWidth: 180 }}
                  onChange={(event) => onChange(dependency.scriptId, {
                    versionRange: event.target.value,
                    state: "MANUAL"
                  })}
                />
              </Space>
            </Space>
          </div>
        );
      })}
    </Space>
  );
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
  const [publishForm] = Form.useForm<WebhookPublishFormValues>();
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
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishDependencyDrafts, setPublishDependencyDrafts] = useState<RepositoryWebhookPublishDependencyDraft[]>([]);
  const [publishConfigItems, setPublishConfigItems] = useState<RepositoryPublishConfigCandidate[]>([]);
  const [publishMissingKeys, setPublishMissingKeys] = useState<string[]>([]);
  const [publishConfigModes, setPublishConfigModes] = useState<Record<string, "INLINE" | "PLACEHOLDER">>({});
  const [publishRepositoryToolOptions, setPublishRepositoryToolOptions] = useState<Array<{ repositoryId: string; scriptId: string; displayName: string }>>([]);
  const [publishVersionHint, setPublishVersionHint] = useState<string>("");
  const [messageApi, contextHolder] = message.useMessage();
  const defaultOwner = useDefaultOwner();

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
  const hasIncompletePublishDependencies = publishDependencyDrafts.some(
    (item) => item.repositoryId?.trim() !== "" && !item.repositoryScriptId?.trim()
      || !item.repositoryId?.trim() && !!item.repositoryScriptId?.trim()
      || item.state === "UNRESOLVED"
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

  function updatePublishDependency(scriptId: string, changedValues: Partial<RepositoryWebhookPublishDependencyDraft>) {
    setPublishDependencyDrafts((current) => current.map((item) => {
      if (item.scriptId !== scriptId) {
        return item;
      }
      return { ...item, ...changedValues };
    }));
  }

  async function loadPublishPreview(repositoryId: string, dependencyDrafts?: RepositoryWebhookPublishDependencyDraft[]) {
    const preview = await previewRepositoryWebhookPublish({
      sourceId: draft.id,
      repositoryId,
      scriptDependencies: normalizeDependencyDrafts(dependencyDrafts ?? publishDependencyDrafts)
    });
    setPublishDependencyDrafts(preview.dependencyDrafts);
    setPublishConfigItems(preview.items);
    setPublishMissingKeys(preview.missingKeys);
    setPublishConfigModes((current) => {
      const next: Record<string, "INLINE" | "PLACEHOLDER"> = {};
      for (const item of preview.items) {
        next[item.key] = item.secret ? "PLACEHOLDER" : (current[item.key] ?? "PLACEHOLDER");
      }
      return next;
    });
  }

  async function openPublishModal() {
    if (!draft.id) {
      messageApi.warning("请先保存 Webhook");
      return;
    }
    if (draft.editable === false) {
      messageApi.warning("仓库 Webhook 为只读版本，请先创建工作副本");
      return;
    }
    setPublishLoading(true);
    try {
      const [repositories, repositoryScripts] = await Promise.all([
        listRepositories(),
        listRepositoryScripts()
      ]);
      const publishableRepositories = getPublishableRepositories(repositories);
      if (publishableRepositories.length === 0) {
        messageApi.warning("当前没有可发布的仓库，请先添加一个 Git 或本地目录仓库");
        return;
      }
      setPublishRepositories(publishableRepositories);
      setPublishRepositoryToolOptions(repositoryScripts.map((item) => ({
        repositoryId: item.repositoryId,
        scriptId: item.scriptId,
        displayName: item.displayName
      })));

      const initialRepositoryId = draft.repositoryId || publishableRepositories[0].id;
      let versionHint = "目标仓库暂无该 Webhook 版本。";
      try {
        await syncRepository(initialRepositoryId);
        const existing = await listWebhooksByRepository(initialRepositoryId);
        const matched = existing.find((item) => item.webhookId === (draft.repositoryWebhookId || draft.id));
        if (matched) {
          const suggested = suggestNextRepositoryVersion(matched.version);
          versionHint = suggested === matched.version
            ? `仓库当前版本 ${matched.version}，请手动填写新版本。`
            : `仓库当前版本 ${matched.version}，建议发布 ${suggested}。`;
        }
      } catch {
        versionHint = "无法读取目标仓库当前版本，请手动确认版本号。";
      }
      setPublishVersionHint(versionHint);
      publishForm.setFieldsValue({
        repositoryId: initialRepositoryId,
        webhookId: draft.repositoryWebhookId || draft.id,
        displayName: draft.name,
        version: suggestNextRepositoryVersion(draft.repositoryVersion),
        owner: defaultOwner || undefined,
        releaseNotes: "",
        tags: []
      });
      await loadPublishPreview(initialRepositoryId, []);
      setPublishOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载发布信息失败"));
    } finally {
      setPublishLoading(false);
    }
  }

  async function submitPublish() {
    try {
      const values = await publishForm.validateFields();
      if (publishMissingKeys.length > 0) {
        messageApi.error(`缺少发布依赖的配置值: ${publishMissingKeys.join(", ")}`);
        return;
      }
      if (hasIncompletePublishDependencies) {
        messageApi.error("请先补全脚本依赖映射");
        return;
      }
      setPublishSubmitting(true);
      await publishRepositoryWebhook(values.repositoryId, {
        sourceId: draft.id,
        webhookId: values.webhookId.trim(),
        displayName: values.displayName.trim(),
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        releaseNotes: values.releaseNotes?.trim() || undefined,
        tags: normalizeTagValues(values.tags),
        configItems: publishConfigItems.map((item) => ({
          key: item.key,
          publishMode: publishConfigModes[item.key] ?? "PLACEHOLDER"
        })),
        scriptDependencies: normalizeDependencyDrafts(publishDependencyDrafts),
        publishScriptDependencies: true
      });
      messageApi.success("Webhook 已发布到仓库");
      setPublishOpen(false);
      await loadData();
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      messageApi.error(getErrorMessage(error, "发布到仓库失败"));
    } finally {
      setPublishSubmitting(false);
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
            {draft.id && draft.editable !== false ? (
              <Button loading={publishLoading} onClick={() => void openPublishModal()}>发布到仓库</Button>
            ) : null}
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

      <Modal
        title="发布到仓库"
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onOk={() => void submitPublish()}
        okText="发布"
        cancelText="取消"
        confirmLoading={publishSubmitting}
        okButtonProps={{ disabled: publishLoading || hasIncompletePublishDependencies || publishMissingKeys.length > 0 }}
        width={980}
        destroyOnHidden
      >
        {publishLoading ? (
          <div className="page-loading"><Spin size="large" /></div>
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Form
              form={publishForm}
              layout="vertical"
              onValuesChange={(changedValues: Partial<WebhookPublishFormValues>) => {
                if (changedValues.repositoryId) {
                  void loadPublishPreview(changedValues.repositoryId);
                }
              }}
            >
              <RepositoryPublishBasicsForm
                repositories={publishRepositories}
                afterRepository={(
                  <Form.Item
                    label="仓库 Webhook ID"
                    name="webhookId"
                    rules={[{ required: true, message: "请输入仓库 Webhook ID" }]}
                  >
                    <Input placeholder="例如 order-created" />
                  </Form.Item>
                )}
                showDescription={false}
                showRiskLevel={false}
                displayNamePlaceholder="例如 订单创建回调"
                versionPlaceholder="例如 1.0.0"
                versionExtra={publishVersionHint ? <Text type="secondary">{publishVersionHint}</Text> : null}
                ownerPlaceholder="例如 platform-team"
                tagsPlaceholder="输入后回车"
                releaseNotesPlaceholder="本次发布的变更说明，支持 Markdown 语法"
              />
            </Form>

            <Card type="inner" title="绑定脚本">
              <Text code>{draft.webhookScriptId || "-"}</Text>
            </Card>

            <Card type="inner" title={`脚本依赖 (${publishDependencyDrafts.length})`}>
              {renderDependencyEditor(publishDependencyDrafts, publishRepositories, publishRepositoryToolOptions, updatePublishDependency)}
            </Card>

            <Card type="inner" title={`配置模板 (${publishConfigItems.length})`}>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {publishMissingKeys.length > 0 ? (
                  <Alert
                    type="error"
                    showIcon
                    message="检测到缺失的配置依赖"
                    description={publishMissingKeys.join(", ")}
                  />
                ) : null}
                {publishConfigItems.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Webhook 没有检测到配置引用" />
                ) : (
                  publishConfigItems.map((item) => {
                    const forcedPlaceholder = Boolean(item.secret);
                    const selectedMode = forcedPlaceholder ? "PLACEHOLDER" : (publishConfigModes[item.key] ?? "PLACEHOLDER");
                    return (
                      <div key={item.key} className="repository-config-publish-row">
                        <Space direction="vertical" size={2}>
                          <Space wrap size={[8, 8]}>
                            <Text code>{item.key}</Text>
                            {item.secret ? <Tag color="gold">SECRET</Tag> : null}
                          </Space>
                          <Text type="secondary">{item.label || "未填写说明"}</Text>
                        </Space>
                        <Select
                          value={selectedMode}
                          disabled={forcedPlaceholder}
                          style={{ width: 160 }}
                          options={[
                            { value: "PLACEHOLDER", label: "PLACEHOLDER" },
                            ...(forcedPlaceholder ? [] : [{ value: "INLINE", label: "INLINE" }])
                          ]}
                          onChange={(value) => setPublishConfigModes((current) => ({ ...current, [item.key]: value }))}
                        />
                      </div>
                    );
                  })
                )}
              </Space>
            </Card>
          </Space>
        )}
      </Modal>
    </>
  );
}
