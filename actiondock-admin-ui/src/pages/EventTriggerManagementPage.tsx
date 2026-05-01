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
  Descriptions,
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
  createEventTrigger,
  deleteEventTrigger,
  disableEventTrigger,
  enableEventTrigger,
  listEventSources,
  listEventTriggers,
  listScripts,
  testEventTrigger,
  updateEventTrigger
} from "../api";
import { ProcessorEditor } from "../components/ProcessorEditor";
import { ExecutionResultCard } from "../components/ExecutionResultCard";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type {
  EventSourceDefinition,
  EventTrigger,
  EventTriggerTestResult,
  ExecutionResponseView,
  ScriptDefinition,
  SubmitMode
} from "../types";
import { formatDateTime, getErrorMessage, parseJsonText, prettyJson } from "../utils";

const { Text } = Typography;

interface EventTriggerManagementPageProps {
  embedded?: boolean;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyDraft(): EventTrigger {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    sourceId: "",
    targetScriptId: "",
    submitMode: "ASYNC",
    responseView: "RESULT"
  };
}

function buildDefaultEventJson(source?: EventSourceDefinition): string {
  const value = source?.sampleContext && typeof source.sampleContext === "object"
    ? ((source.sampleContext.event as Record<string, unknown>) ?? {})
    : {};
  return prettyJson({
    headers: {},
    query: {},
    body: {},
    ...value
  });
}

export function EventTriggerManagementPage({ embedded = false }: EventTriggerManagementPageProps) {
  const [items, setItems] = useState<EventTrigger[]>([]);
  const [sources, setSources] = useState<EventSourceDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<EventTrigger>(createEmptyDraft());
  const [testEventText, setTestEventText] = useState("{}");
  const [testResult, setTestResult] = useState<EventTriggerTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = async () => {
    setLoading(true);
    try {
      const [triggerItems, sourceItems, scriptItems] = await Promise.all([
        listEventTriggers(),
        listEventSources(),
        listScripts()
      ]);
      setItems(triggerItems);
      setSources(sourceItems);
      setScripts(scriptItems);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载事件触发器失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const sourceOptions = useMemo(
    () => sources.map((item) => ({ label: `${item.name} (${item.key})`, value: item.id })),
    [sources]
  );

  const scriptOptions = useMemo(
    () => scripts
      .filter((script) => Boolean(script.publishedSnapshot) || script.status === "PUBLISHED")
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((script) => ({ label: `${script.name} (${script.id})`, value: script.id })),
    [scripts]
  );

  const sourceById = useMemo(() => new Map(sources.map((item) => [item.id, item])), [sources]);
  const scriptById = useMemo(() => new Map(scripts.map((item) => [item.id, item])), [scripts]);

  const updateDraft = (patch: Partial<EventTrigger>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };

  const openCreate = () => {
    const nextDraft = createEmptyDraft();
    const defaultSource = sources[0];
    nextDraft.sourceId = defaultSource?.id ?? "";
    nextDraft.targetScriptId = scriptOptions[0]?.value ?? "";
    setDraft(nextDraft);
    setTestEventText(buildDefaultEventJson(defaultSource));
    setTestResult(null);
    setDrawerOpen(true);
  };

  const openEdit = (item: EventTrigger) => {
    const nextDraft = cloneValue(item);
    setDraft(nextDraft);
    setTestEventText(buildDefaultEventJson(sourceById.get(nextDraft.sourceId)));
    setTestResult(null);
    setDrawerOpen(true);
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const payload: Partial<EventTrigger> = { ...draft };
      const saved = draft.id
        ? await updateEventTrigger(draft.id, payload)
        : await createEventTrigger(payload);
      setItems((previous) => {
        const hasExisting = previous.some((item) => item.id === saved.id);
        const next = hasExisting
          ? previous.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...previous];
        return [...next].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
      });
      setDrawerOpen(false);
      messageApi.success(draft.id ? "事件触发器已更新" : "事件触发器已创建");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存事件触发器失败"));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (execute: boolean) => {
    if (!draft.id) {
      messageApi.warning("请先保存事件触发器，再执行测试");
      return;
    }
    setTesting(true);
    try {
      const event = parseJsonText(testEventText, "测试事件");
      const result = await testEventTrigger(draft.id, {
        event: {
          headers: (event.headers as Record<string, unknown>) ?? {},
          query: (event.query as Record<string, unknown>) ?? {},
          body: (event.body as Record<string, unknown>) ?? {},
          id: typeof event.id === "string" ? event.id : undefined,
          sourceId: typeof event.sourceId === "string" ? event.sourceId : draft.sourceId,
          sourceKey: typeof event.sourceKey === "string" ? event.sourceKey : sourceById.get(draft.sourceId)?.key,
          eventType: typeof event.eventType === "string" ? event.eventType : undefined,
          eventId: typeof event.eventId === "string" ? event.eventId : undefined,
          actor: typeof event.actor === "string" ? event.actor : undefined,
          subject: typeof event.subject === "string" ? event.subject : undefined,
          timestamp: typeof event.timestamp === "string" ? event.timestamp : undefined
        },
        execute
      });
      setTestResult(result);
      messageApi.success(execute ? "试运行完成" : "测试完成");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "事件触发器测试失败"));
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async (item: EventTrigger) => {
    try {
      const saved = item.enabled ? await disableEventTrigger(item.id) : await enableEventTrigger(item.id);
      setItems((previous) => previous.map((record) => (record.id === saved.id ? saved : record)));
      if (draft.id === saved.id) {
        setDraft(saved);
      }
      messageApi.success(item.enabled ? "事件触发器已停用" : "事件触发器已启用");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "更新状态失败"));
    }
  };

  const removeItem = async (item: EventTrigger) => {
    try {
      await deleteEventTrigger(item.id);
      setItems((previous) => previous.filter((record) => record.id !== item.id));
      messageApi.success("事件触发器已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除事件触发器失败"));
    }
  };

  const columns: ColumnsType<EventTrigger> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_value, record) => (
        <TableLinkCell title={record.name} onClick={() => openEdit(record)}>
          <Space direction="vertical" size={0}>
            <Text strong>{record.name}</Text>
            <Text type="secondary">{sourceById.get(record.sourceId)?.key ?? record.sourceId}</Text>
          </Space>
        </TableLinkCell>
      )
    },
    {
      title: "目标脚本",
      width: 220,
      render: (_value, record) => <Text code>{record.targetScriptId}</Text>
    },
    {
      title: "执行",
      width: 120,
      render: (_value, record) => <Tag>{record.submitMode}</Tag>
    },
    {
      title: "状态",
      width: 120,
      render: (_value, record) => (
        <Tag color={record.enabled ? "green" : "default"}>{record.enabled ? "启用" : "停用"}</Tag>
      )
    },
    {
      title: "最近执行",
      width: 180,
      render: (_value, record) => formatDateTime(record.lastTriggeredAt)
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button
            size="small"
            icon={record.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => void toggleEnabled(record)}
          >
            {record.enabled ? "停用" : "启用"}
          </Button>
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => void removeItem(record)}
          >
            删除
          </Button>
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
            title="事件触发"
            meta="把标准事件过滤、幂等、映射后转换成已发布脚本执行。"
            actions={(
              <>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  新建触发器
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
              新建触发器
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
          </Space>
        )}

        <Alert
          type="info"
          showIcon
          message="创建顺序：先选事件源和已发布脚本，再配置过滤、幂等和入参生成，最后用测试面板验证。"
          description="过滤 Processor 决定是否触发，幂等 Processor 生成唯一 key，Input Processor 决定脚本入参。"
        />

        <Card>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有事件触发器" />
          ) : (
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={[...items].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 1120 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title={draft.id ? `编辑触发器 · ${draft.name}` : "新建事件触发器"}
        open={drawerOpen}
        width={920}
        onClose={() => setDrawerOpen(false)}
        extra={(
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void saveDraft()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" title="基础信息">
            <Form layout="vertical">
              <Form.Item label="名称" required>
                <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
              </Form.Item>
              <Form.Item label="描述">
                <Input.TextArea rows={3} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
              </Form.Item>
              <Form.Item label="启用">
                <Switch checked={draft.enabled} onChange={(checked) => updateDraft({ enabled: checked })} />
              </Form.Item>
              <Form.Item
                label={(
                  <Space size={6}>
                    <span>事件源</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>选择事件入口</Text>
                  </Space>
                )}
                required
              >
                <Select
                  value={draft.sourceId || undefined}
                  options={sourceOptions}
                  onChange={(sourceId) => {
                    updateDraft({ sourceId });
                    setTestEventText(buildDefaultEventJson(sourceById.get(sourceId)));
                  }}
                />
              </Form.Item>
              <Form.Item
                label={(
                  <Space size={6}>
                    <span>目标脚本</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>必须已发布</Text>
                  </Space>
                )}
                required
              >
                <Select
                  value={draft.targetScriptId || undefined}
                  options={scriptOptions}
                  onChange={(targetScriptId) => updateDraft({ targetScriptId })}
                />
              </Form.Item>
              <Form.Item
                label={(
                  <Space size={6}>
                    <span>提交模式</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>同步或异步</Text>
                  </Space>
                )}
              >
                <Select
                  value={draft.submitMode}
                  options={[
                    { label: "异步", value: "ASYNC" },
                    { label: "同步", value: "SYNC" }
                  ]}
                  onChange={(submitMode) => updateDraft({ submitMode: submitMode as SubmitMode })}
                />
              </Form.Item>
              <Form.Item
                label={(
                  <Space size={6}>
                    <span>响应视图</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>同步时生效</Text>
                  </Space>
                )}
              >
                <Select
                  value={draft.responseView ?? "RESULT"}
                  options={[
                    { label: "RESULT", value: "RESULT" },
                    { label: "DEBUG", value: "DEBUG" }
                  ]}
                  onChange={(responseView) => updateDraft({ responseView: responseView as ExecutionResponseView })}
                />
              </Form.Item>
            </Form>
          </Card>

          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="事件源">
              {sourceById.get(draft.sourceId)?.key ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label="目标脚本">
              {scriptById.get(draft.targetScriptId)?.name ?? (draft.targetScriptId || "-")}
            </Descriptions.Item>
            <Descriptions.Item label="过滤">
              {draft.filterProcessor ? draft.filterProcessor.mode : "未配置"}
            </Descriptions.Item>
            <Descriptions.Item label="幂等">
              {draft.idempotencyProcessor ? draft.idempotencyProcessor.mode : "未配置"}
            </Descriptions.Item>
          </Descriptions>

          <ProcessorEditor
            title="过滤 Processor"
            purpose="filter"
            value={draft.filterProcessor}
            scripts={scripts}
            description="返回匹配结果，推荐输出 { matched: true/false }。"
            onChange={(filterProcessor) => updateDraft({ filterProcessor })}
          />
          <ProcessorEditor
            title="幂等 Processor"
            purpose="idempotency"
            value={draft.idempotencyProcessor}
            scripts={scripts}
            description="返回唯一 key，用来避免重复触发。"
            onChange={(idempotencyProcessor) => updateDraft({ idempotencyProcessor })}
          />
          <ProcessorEditor
            title="Input Processor"
            purpose="input"
            required
            value={draft.inputProcessor}
            scripts={scripts}
            description="把标准事件转换成目标脚本入参。"
            onChange={(inputProcessor) => updateDraft({ inputProcessor })}
          />

          <Card size="small" title="测试面板">
            <Alert
              type="info"
              showIcon
              message={draft.id ? "测试只校验 Processor 和脚本入参；试运行会直接创建一次执行记录。" : "请先保存事件触发器，再执行测试或试运行。"}
            />
            <Form layout="vertical" style={{ marginTop: draft.id ? 0 : 12 }}>
              <Form.Item label="测试事件 JSON">
                <Input.TextArea rows={10} value={testEventText} onChange={(event) => setTestEventText(event.target.value)} />
              </Form.Item>
            </Form>
            <Space wrap>
              <Button disabled={!draft.id} loading={testing} onClick={() => void runTest(false)}>
                测试
              </Button>
              <Button type="primary" disabled={!draft.id} loading={testing} onClick={() => void runTest(true)}>
                试运行
              </Button>
              <Button disabled={!draft.sourceId} onClick={() => setTestEventText(buildDefaultEventJson(sourceById.get(draft.sourceId)))}>
                恢复事件样例
              </Button>
            </Space>
            {testResult ? (
              <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
                <Space wrap>
                  <Text type="secondary">过滤结果</Text>
                  <Tag color={testResult.filterMatched ? "green" : "default"}>
                    {testResult.filterMatched ? "命中" : "未命中"}
                  </Tag>
                  {testResult.idempotencyKey ? <Text code>{testResult.idempotencyKey}</Text> : null}
                </Space>
                {testResult.mappedInput ? (
                  <pre className="json-preview">{prettyJson(testResult.mappedInput)}</pre>
                ) : null}
                {testResult.execution ? (
                  <ExecutionResultCard
                    execution={testResult.execution}
                    title="试运行结果"
                    showTriggerSource
                  />
                ) : null}
              </Space>
            ) : null}
          </Card>
        </Space>
      </Drawer>
    </>
  );
}
