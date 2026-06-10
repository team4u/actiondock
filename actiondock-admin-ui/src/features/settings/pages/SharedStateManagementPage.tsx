import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SaveOutlined
} from "@ant-design/icons";
import {
  Alert,
  AutoComplete,
  Tooltip,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
  message
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createSharedState,
  deleteSharedState,
  getSharedState,
  listSharedState,
  listSharedStateNamespaces,
  purgeExpiredSharedState,
  updateSharedState
} from "../../settings/api";
import { getApiKey } from "../../../shared/auth/auth";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { useCopyMessage } from "../../../shared/hooks/useCopyMessage";
import { buildSharedStateCasCliCommand, buildSharedStatePutCliCommand } from "../../../services/commands";
import { ApiError } from "../../../shared/api/httpClient";
import type { SharedStateDetail, SharedStateRequest, SharedStateSummary } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

const { Text } = Typography;

interface SharedStateManagementPageProps {
  embedded?: boolean;
}

interface SharedStateFormValues {
  namespace: string;
  key: string;
  valueText: string;
  secret: boolean;
  expiresAt: Dayjs | null;
}

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; namespace: string; key: string };

type SharedStateSnippetLanguage = "Groovy" | "Python" | "CLI";

interface SharedStateSnippetItem {
  family: SharedStateSnippetLanguage;
  label: "state.get" | "state.put" | "state.cas" | "state.list" | "actiondock state put" | "actiondock state cas";
  value: string;
}

function stringifySharedStateValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseSharedStateValue(valueText: string): unknown {
  const source = valueText.trim();
  if (!source) {
    throw new Error("请输入 JSON 值");
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "格式错误";
    throw new Error(`值不是合法 JSON: ${reason}`);
  }
}

function toSummary(detail: SharedStateDetail): SharedStateSummary {
  return {
    namespace: detail.namespace,
    key: detail.key,
    secret: detail.secret,
    version: detail.version,
    expiresAt: detail.expiresAt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    lastWriterScriptId: detail.lastWriterScriptId,
    lastWriterExecutionId: detail.lastWriterExecutionId
  };
}

function buildFormValues(detail: SharedStateDetail): SharedStateFormValues {
  return {
    namespace: detail.namespace,
    key: detail.key,
    valueText: stringifySharedStateValue(detail.value),
    secret: detail.secret,
    expiresAt: detail.expiresAt ? dayjs(detail.expiresAt) : null
  };
}

function fallbackSharedStateValue(): Record<string, string> {
  return { value: "..." };
}

function resolveSharedStateExampleValue(valueText: string, exposeValue: boolean): unknown {
  if (!exposeValue) {
    return fallbackSharedStateValue();
  }
  try {
    return parseSharedStateValue(valueText);
  } catch {
    return fallbackSharedStateValue();
  }
}

export function toGroovyLiteral(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toGroovyLiteral(item)).join(", ")}]`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value && typeof value === "object") {
    return `[${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${toGroovyLiteral(item)}`).join(", ")}]`;
  }
  return "null";
}

export function toPythonLiteral(value: unknown): string {
  if (value === null) {
    return "None";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toPythonLiteral(item)).join(", ")}]`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${toPythonLiteral(item)}`).join(", ")}}`;
  }
  return "None";
}

export function buildSharedStateSnippetItems({
  apiKey,
  currentVersion,
  expiresAt,
  namespace,
  key,
  origin,
  valueText,
  secret,
  exposeValue
}: {
  apiKey?: string;
  currentVersion?: number;
  expiresAt?: string | null;
  namespace: string;
  key: string;
  origin: string;
  valueText: string;
  secret: boolean;
  exposeValue: boolean;
}): SharedStateSnippetItem[] {
  const normalizedNamespace = namespace.trim();
  const normalizedKey = key.trim();
  if (!normalizedNamespace || !normalizedKey) {
    return [];
  }

  const value = resolveSharedStateExampleValue(valueText, exposeValue);
  const groovyValue = toGroovyLiteral(value);
  const pythonValue = toPythonLiteral(value);
  const groovyOptions = secret ? ",\n    [secret: true]" : "";
  const pythonOptions = secret ? ',\n    {"secret": True}' : "";
  const resolvedVersion = currentVersion && currentVersion > 0 ? currentVersion : 1;

  return [
    {
      family: "Groovy",
      label: "state.get",
      value: `def entry = state.get(${JSON.stringify(normalizedNamespace)}, ${JSON.stringify(normalizedKey)})\nif (entry) {\n    return entry.value\n}\nreturn null`
    },
    {
      family: "Groovy",
      label: "state.put",
      value: `def saved = state.put(\n    ${JSON.stringify(normalizedNamespace)},\n    ${JSON.stringify(normalizedKey)},\n    ${groovyValue}${groovyOptions}\n)\n\nreturn saved`
    },
    {
      family: "Groovy",
      label: "state.cas",
      value: `def current = state.get(${JSON.stringify(normalizedNamespace)}, ${JSON.stringify(normalizedKey)})\ndef result = state.cas(\n    ${JSON.stringify(normalizedNamespace)},\n    ${JSON.stringify(normalizedKey)},\n    current?.version,\n    ${groovyValue}${groovyOptions}\n)\n\nif (!result.updated) {\n    throw new IllegalStateException("共享状态版本冲突，请重试")\n}\n\nreturn result.entry`
    },
    {
      family: "Groovy",
      label: "state.list",
      value: `def entries = state.list(${JSON.stringify(normalizedNamespace)})\nreturn entries`
    },
    {
      family: "Python",
      label: "state.get",
      value: `entry = state.get(${JSON.stringify(normalizedNamespace)}, ${JSON.stringify(normalizedKey)})\nif entry:\n    return entry["value"]\nreturn None`
    },
    {
      family: "Python",
      label: "state.put",
      value: `saved = state.put(\n    ${JSON.stringify(normalizedNamespace)},\n    ${JSON.stringify(normalizedKey)},\n    ${pythonValue}${pythonOptions},\n)\n\nreturn saved`
    },
    {
      family: "Python",
      label: "state.cas",
      value: `current = state.get(${JSON.stringify(normalizedNamespace)}, ${JSON.stringify(normalizedKey)})\nresult = state.cas(\n    ${JSON.stringify(normalizedNamespace)},\n    ${JSON.stringify(normalizedKey)},\n    current["version"] if current else None,\n    ${pythonValue}${pythonOptions},\n)\n\nif not result["updated"]:\n    raise RuntimeError("共享状态版本冲突，请重试")\n\nreturn result["entry"]`
    },
    {
      family: "Python",
      label: "state.list",
      value: `entries = state.list(${JSON.stringify(normalizedNamespace)})\nreturn entries`
    },
    {
      family: "CLI",
      label: "actiondock state put",
      value: buildSharedStatePutCliCommand({
        apiKey,
        environment: "bash/zsh",
        expiresAt,
        key: normalizedKey,
        namespace: normalizedNamespace,
        origin,
        secret,
        value
      })
    },
    {
      family: "CLI",
      label: "actiondock state cas",
      value: buildSharedStateCasCliCommand({
        apiKey,
        environment: "bash/zsh",
        expectedVersion: resolvedVersion,
        expiresAt,
        key: normalizedKey,
        namespace: normalizedNamespace,
        origin,
        secret,
        value
      })
    }
  ];
}

function SharedStateSnippetCard({
  items,
  onCopy
}: {
  items: SharedStateSnippetItem[];
  onCopy: (value: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card size="small" title="可复制示例">
        <Text type="secondary">先填写命名空间和 Key，这里会自动生成脚本内调用示例，以及可直接执行的 CLI 写入示例。</Text>
      </Card>
    );
  }

  const families: SharedStateSnippetLanguage[] = ["Groovy", "Python", "CLI"];

  return (
    <Card size="small" title="可复制示例">
      <Tabs
        size="small"
        items={families.map((family) => ({
          key: family,
          label: family,
          children: (
            <List
              dataSource={items.filter((item) => item.family === family)}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key={item.label} size="small" icon={<CopyOutlined />} onClick={() => onCopy(item.value)}>
                      复制
                    </Button>
                  ]}
                >
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Text strong>{item.label}</Text>
                    <pre className="json-preview">{item.value}</pre>
                  </Space>
                </List.Item>
              )}
            />
          )
        }))}
      />
    </Card>
  );
}

export function SharedStateManagementPage({ embedded = false }: SharedStateManagementPageProps) {
  const apiKey = getApiKey() || undefined;
  const origin = window.location.origin;
  const [form] = Form.useForm<SharedStateFormValues>();
  const watchedNamespace = Form.useWatch("namespace", form) ?? "";
  const watchedKey = Form.useWatch("key", form) ?? "";
  const watchedSecret = Form.useWatch("secret", form) ?? false;
  const watchedValueText = Form.useWatch("valueText", form) ?? "";
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespaceInput, setNamespaceInput] = useState("");
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [items, setItems] = useState<SharedStateSummary[]>([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [operatingKey, setOperatingKey] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [detail, setDetail] = useState<SharedStateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [secretValueVisible, setSecretValueVisible] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const handleCopy = useCopyMessage(messageApi, "示例已复制", "复制失败");

  useEffect(() => {
    if (!watchedSecret) {
      setSecretValueVisible(true);
    }
  }, [watchedSecret]);

  const snippetItems = useMemo(
    () => buildSharedStateSnippetItems({
      apiKey,
      currentVersion: detail?.version ?? undefined,
      expiresAt: detail?.expiresAt ?? null,
      namespace: typeof watchedNamespace === "string" ? watchedNamespace : "",
      key: typeof watchedKey === "string" ? watchedKey : "",
      origin,
      valueText: typeof watchedValueText === "string" ? watchedValueText : "",
      secret: watchedSecret,
      exposeValue: !watchedSecret || secretValueVisible
    }),
    [apiKey, detail?.expiresAt, detail?.version, origin, secretValueVisible, watchedKey, watchedNamespace, watchedSecret, watchedValueText]
  );

  const loadNamespaces = async (): Promise<string[]> => {
    setLoadingNamespaces(true);
    try {
      const data = await listSharedStateNamespaces();
      setNamespaces(data);
      return data;
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载共享状态命名空间失败"));
      return [];
    } finally {
      setLoadingNamespaces(false);
    }
  };

  const loadEntries = async (namespace: string) => {
    const normalized = namespace.trim();
    if (!normalized) {
      setSelectedNamespace(null);
      setNamespaceInput("");
      setItems([]);
      return;
    }
    setLoadingEntries(true);
    try {
      const data = await listSharedState(normalized);
      setSelectedNamespace(normalized);
      setNamespaceInput(normalized);
      setItems(data);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载共享状态列表失败"));
    } finally {
      setLoadingEntries(false);
    }
  };

  const refreshPage = async (preferredNamespace?: string | null) => {
    const data = await loadNamespaces();
    const nextNamespace = preferredNamespace?.trim() || selectedNamespace?.trim() || data[0] || "";
    if (nextNamespace) {
      await loadEntries(nextNamespace);
      return;
    }
    setSelectedNamespace(null);
    setNamespaceInput("");
    setItems([]);
  };

  useEffect(() => {
    void refreshPage();
  }, []);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      namespace: selectedNamespace ?? namespaceInput.trim(),
      key: "",
      valueText: "{}",
      secret: false,
      expiresAt: null
    });
    setDetail(null);
    setSecretValueVisible(true);
    setEditorState({ mode: "create" });
  };

  const openEdit = async (item: SharedStateSummary) => {
    setEditorState({ mode: "edit", namespace: item.namespace, key: item.key });
    setDetail(null);
    setDetailLoading(true);
    setSecretValueVisible(!item.secret);
    try {
      const data = await getSharedState(item.namespace, item.key);
      setDetail(data);
      form.resetFields();
      form.setFieldsValue(buildFormValues(data));
      setSecretValueVisible(!data.secret);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载共享状态详情失败"));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeEditor = () => {
    setEditorState(null);
    setDetail(null);
    setDetailLoading(false);
    setSecretValueVisible(true);
    form.resetFields();
  };

  const handleNamespaceSubmit = async () => {
    await loadEntries(namespaceInput);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: SharedStateRequest = {
        namespace: values.namespace.trim(),
        key: values.key.trim(),
        value: parseSharedStateValue(values.valueText),
        secret: Boolean(values.secret),
        expiresAt: values.expiresAt ? values.expiresAt.format("YYYY-MM-DDTHH:mm:ss") : null
      };

      setSaving(true);
      const saved = editorState?.mode === "edit"
        ? await updateSharedState(payload)
        : await createSharedState(payload);

      setDetail(saved);
      setEditorState({ mode: "edit", namespace: saved.namespace, key: saved.key });
      form.setFieldsValue(buildFormValues(saved));
      setSecretValueVisible(!saved.secret);
      await refreshPage(saved.namespace);
      messageApi.success(editorState?.mode === "edit" ? "共享状态已更新" : "共享状态已创建");
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "保存共享状态失败"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: SharedStateSummary) => {
    setOperatingKey(`${item.namespace}/${item.key}`);
    try {
      await deleteSharedState(item.namespace, item.key);
      if (editorState?.mode === "edit" && editorState.namespace === item.namespace && editorState.key === item.key) {
        closeEditor();
      }
      await refreshPage(selectedNamespace);
      messageApi.success("共享状态已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除共享状态失败"));
    } finally {
      setOperatingKey(null);
    }
  };

  const confirmPurgeExpired = () => {
    const scope = selectedNamespace?.trim() ? `命名空间 ${selectedNamespace}` : "全部命名空间";
    modal.confirm({
      title: "确认清理过期共享状态？",
      content: `将清理 ${scope} 内已过期的条目。`,
      okText: "清理",
      cancelText: "取消",
      onOk: async () => {
        setPurging(true);
        try {
          const count = await purgeExpiredSharedState(selectedNamespace?.trim() || undefined);
          await refreshPage(selectedNamespace);
          messageApi.success(`已清理 ${count} 条过期共享状态`);
        } catch (error) {
          messageApi.error(getErrorMessage(error, "清理过期共享状态失败"));
        } finally {
          setPurging(false);
        }
      }
    });
  };

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((item) => {
      const writer = `${item.lastWriterScriptId ?? ""} ${item.lastWriterExecutionId ?? ""}`.toLowerCase();
      return item.key.toLowerCase().includes(keyword) || writer.includes(keyword);
    });
  }, [items, searchText]);

  const namespaceOptions = useMemo(
    () => namespaces.map((value) => ({ value })),
    [namespaces]
  );

  const columns: ColumnsType<SharedStateSummary> = [
    {
      title: "Key",
      dataIndex: "key",
      key: "key",
      render: (value: string, record) => <TableLinkCell onClick={() => void openEdit(record)}>{value}</TableLinkCell>
    },
    {
      title: "标签",
      key: "tags",
      width: 150,
      render: (_value, record) => (
        <Space size={[6, 6]} wrap>
          {record.secret ? <Tag color="gold">SECRET</Tag> : <Tag>PLAIN</Tag>}
          {record.expiresAt ? <Tag color="blue">TTL</Tag> : <Tag>PERSISTENT</Tag>}
        </Space>
      )
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 100,
      render: (value?: number) => value ?? "-"
    },
    {
      title: "过期时间",
      dataIndex: "expiresAt",
      key: "expiresAt",
      width: 180,
      render: (value?: string | null) => formatDateTime(value ?? undefined)
    },
    {
      title: "最后写入",
      key: "writer",
      width: 260,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.lastWriterScriptId || "-"}</Text>
          <Text type="secondary">{record.lastWriterExecutionId || "-"}</Text>
        </Space>
      )
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_value, record) => (
        <ConfirmDangerAction
          title={`确认删除 ${record.namespace}/${record.key}？`}
          description="删除后，依赖该共享状态的脚本需要自行处理缺失值。"
          onConfirm={() => handleDelete(record)}
          loading={operatingKey === `${record.namespace}/${record.key}`}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={operatingKey === `${record.namespace}/${record.key}`}
          >
            删除
          </Button>
        </ConfirmDangerAction>
      )
    }
  ];

  const actions = (
    <Space wrap>
      <Button icon={<ReloadOutlined />} loading={loadingNamespaces || loadingEntries} onClick={() => void refreshPage(selectedNamespace)}>
        刷新
      </Button>
      <Button onClick={confirmPurgeExpired} loading={purging}>
        清理过期
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新建条目
      </Button>
    </Space>
  );

  const drawerExtra = (
    <Space wrap>
      {editorState?.mode === "edit" ? (
        <ConfirmDangerAction
          title={`确认删除 ${editorState.namespace}/${editorState.key}？`}
          description="删除后，依赖该共享状态的脚本需要自行处理缺失值。"
          onConfirm={() => handleDelete({
            namespace: editorState.namespace,
            key: editorState.key,
            secret: detail?.secret ?? false,
            version: detail?.version,
            expiresAt: detail?.expiresAt,
            createdAt: detail?.createdAt,
            updatedAt: detail?.updatedAt,
            lastWriterScriptId: detail?.lastWriterScriptId,
            lastWriterExecutionId: detail?.lastWriterExecutionId
          })}
          loading={operatingKey === `${editorState.namespace}/${editorState.key}`}
        >
          <Button danger icon={<DeleteOutlined />} loading={operatingKey === `${editorState.namespace}/${editorState.key}`}>
            删除
          </Button>
        </ConfirmDangerAction>
      ) : null}
      <Button onClick={closeEditor}>关闭</Button>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSubmit()}>
        保存
      </Button>
    </Space>
  );

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!embedded ? (
          <PageHeader
            title="共享状态"
            meta="为脚本和外部流程提供通用的命名空间 KV/JSON 存储，支持 Secret、过期时间和版本号。"
            actions={actions}
          />
        ) : null}

        <Card title={embedded ? "共享状态" : undefined} extra={embedded ? actions : undefined}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space>
              <Text strong>命名空间</Text>
              <Tooltip title='建议按能力或系统拆分命名空间，例如 "oauth.github"、"cache.user-sync"、"workflow.invoice"。脚本侧可通过内置 state 对象访问。'>
                <QuestionCircleOutlined style={{ color: "#999" }} />
              </Tooltip>
            </Space>

            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Space wrap>
                <AutoComplete
                  options={namespaceOptions}
                  value={namespaceInput}
                  onChange={setNamespaceInput}
                  onSelect={(value) => {
                    setNamespaceInput(value);
                    void loadEntries(value);
                  }}
                  style={{ minWidth: 320 }}
                >
                  <Input.Search
                    allowClear
                    placeholder="输入或选择命名空间"
                    onSearch={(value: string) => {
                      if (value.trim()) {
                        void loadEntries(value.trim());
                      }
                    }}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const next = e.target.value;
                      setNamespaceInput(next);
                      if (!next.trim()) {
                        setSelectedNamespace(null);
                        setItems([]);
                      }
                    }}
                  />
                </AutoComplete>
                <Input
                  placeholder="按 key 或写入者过滤"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  style={{ width: 260 }}
                />
              </Space>

              {namespaces.length > 0 ? (
                <Space size={[8, 8]} wrap>
                  {namespaces.map((namespace) => (
                    <Tag
                      key={namespace}
                      color={namespace === selectedNamespace ? "blue" : undefined}
                      onClick={() => {
                        setNamespaceInput(namespace);
                        void loadEntries(namespace);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {namespace}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary">当前还没有共享状态命名空间，可以直接新建第一个条目。</Text>
              )}
            </Space>

            {selectedNamespace ? (
              <Card
                size="small"
                title={<Space wrap><Text strong>命名空间</Text><Text code>{selectedNamespace}</Text></Space>}
              >
                {filteredItems.length === 0 && !loadingEntries ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={items.length === 0 ? "这个命名空间下还没有共享状态" : "没有匹配当前过滤条件的条目"}
                  />
                ) : (
                  <Table
                    rowKey={(record: SharedStateSummary) => `${record.namespace}/${record.key}`}
                    columns={columns}
                    dataSource={filteredItems}
                    loading={loadingEntries}
                    pagination={{ pageSize: 10, responsive: true }}
                    scroll={{ x: 1100 }}
                  />
                )}
              </Card>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择一个命名空间，或者直接新建条目" />
            )}
          </Space>
        </Card>
      </Space>

      <Drawer
        title={editorState?.mode === "edit" ? "共享状态详情" : "新建共享状态"}
        width={760}
        open={Boolean(editorState)}
        onClose={closeEditor}
        destroyOnClose
        extra={drawerExtra}
      >
        {detailLoading ? (
          <Card loading={true} />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {editorState?.mode === "edit" && detail ? (
              <Card
                size="small"
                title={<Space wrap><Text code>{detail.namespace}/{detail.key}</Text>{detail.secret ? <Tag color="gold">SECRET</Tag> : <Tag>PLAIN</Tag>}</Space>}
              >
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label="版本">{detail.version ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="过期时间">{formatDateTime(detail.expiresAt ?? undefined)}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{formatDateTime(detail.createdAt)}</Descriptions.Item>
                  <Descriptions.Item label="更新时间">{formatDateTime(detail.updatedAt)}</Descriptions.Item>
                  <Descriptions.Item label="最后写入脚本">{detail.lastWriterScriptId || "-"}</Descriptions.Item>
                  <Descriptions.Item label="最后写入执行">{detail.lastWriterExecutionId || "-"}</Descriptions.Item>
                </Descriptions>
              </Card>
            ) : null}

            <Form form={form} layout="vertical">
              <Form.Item
                label="命名空间"
                name="namespace"
                rules={[
                  { required: true, message: "请输入命名空间" },
                  { pattern: /^[A-Za-z][A-Za-z0-9_.-]*$/, message: "仅支持字母开头，后续可包含字母、数字、点、下划线和中划线" }
                ]}
                extra="建议按系统或能力拆分，例如 oauth.github 或 workflow.invoice。"
              >
                <Input disabled={editorState?.mode === "edit"} placeholder="oauth.github" />
              </Form.Item>

              <Form.Item
                label="Key"
                name="key"
                rules={[
                  { required: true, message: "请输入 key" },
                  { pattern: /^[A-Za-z][A-Za-z0-9_.-]*$/, message: "仅支持字母开头，后续可包含字母、数字、点、下划线和中划线" }
                ]}
                extra="命名空间内唯一标识，例如 access-token 或 cursor。"
              >
                <Input disabled={editorState?.mode === "edit"} placeholder="access-token" />
              </Form.Item>

              <Form.Item label="高级选项" style={{ marginBottom: 12 }}>
                <Space direction="vertical" size={8}>
                  <Form.Item name="secret" valuePropName="checked" noStyle>
                    <Checkbox>作为 Secret 管理</Checkbox>
                  </Form.Item>
                  <Text type="secondary">
                    Secret 条目会在列表中隐藏值，详情页默认也不会直接展示，点击后才会显示并允许编辑。
                  </Text>
                </Space>
              </Form.Item>

              {watchedSecret && editorState?.mode === "edit" && !secretValueVisible ? (
                <Form.Item label="值">
                  <Alert
                    type="warning"
                    showIcon
                    message="这个值已按 Secret 处理"
                    description="点击下方按钮后会显示明文 JSON，并可继续编辑。"
                    action={
                      <Button size="small" onClick={() => setSecretValueVisible(true)}>
                        显示并编辑
                      </Button>
                    }
                  />
                </Form.Item>
              ) : (
                <>
                  <Form.Item
                    name="valueText"
                    hidden
                    rules={[{
                      validator: async (_rule, value) => {
                        parseSharedStateValue(typeof value === "string" ? value : "");
                      }
                    }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    label="值"
                    validateStatus={(() => {
                      const errors = form.getFieldError("valueText");
                      return errors.length > 0 ? "error" : undefined;
                    })()}
                    help={(() => {
                      const errors = form.getFieldError("valueText");
                      return errors.length > 0 ? errors[0] : undefined;
                    })()}
                    extra="请输入合法 JSON。可保存对象、数组、字符串、数字、布尔值或 null。"
                  >
                    <CodeEditor
                      height="320px"
                      language="json"
                      value={watchedValueText}
                      onChange={(nextValue) => form.setFieldValue("valueText", nextValue)}
                      theme={editorTheme}
                      placeholder='{"accessToken":"...","expiresAt":"2026-04-28T12:00:00"}'
                    />
                  </Form.Item>
                </>
              )}

              <Form.Item
                label="过期时间"
                name="expiresAt"
                extra="留空表示永久有效。过期条目不会再被脚本读取，也不会出现在列表中。"
              >
                <DatePicker showTime style={{ width: "100%" }} placeholder="选择过期时间" />
              </Form.Item>
            </Form>

            <SharedStateSnippetCard items={snippetItems} onCopy={(value) => void handleCopy(value)} />

            {editorState?.mode === "edit" && detail && (!detail.secret || secretValueVisible) ? (
              <Card size="small" title="当前值预览">
                <CodeEditor
                  height="240px"
                  language="json"
                  value={stringifySharedStateValue(detail.value)}
                  onChange={() => undefined}
                  theme={editorTheme}
                  readOnly={true}
                />
              </Card>
            ) : null}
          </Space>
        )}
      </Drawer>
    </>
  );
}
