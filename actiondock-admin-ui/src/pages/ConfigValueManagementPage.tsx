import {
  CopyOutlined,
  DownloadOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { ChangeEvent, Key } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createConfigValue,
  deleteConfigValue,
  listConfigValues,
  updateConfigValue
} from "../api";
import {
  analyzeConfigValueImport,
  buildConfigValueExportBundle,
  downloadJsonFile,
  formatConfigValueExportFileName,
  parseConfigValueImportBundle
} from "../scriptTransfer";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type { ConfigValue, ConfigValueRequest } from "../types";
import { formatDateTime, getErrorMessage } from "../utils";
import { ConfirmDangerAction } from "../components/ConfirmDangerAction";
import { useCopyMessage } from "../hooks/useCopyMessage";

const { Text } = Typography;

type EditorMode = "create" | "edit";

interface EditorState {
  mode: EditorMode;
  key?: string;
}

interface ConfigValueManagementPageProps {
  embedded?: boolean;
}

export function ConfigValueManagementPage({ embedded = false }: ConfigValueManagementPageProps) {
  const [form] = Form.useForm<ConfigValueRequest>();
  const watchedKey = Form.useWatch("key", form);
  const watchedSecret = Form.useWatch("secret", form) ?? false;
  const [items, setItems] = useState<ConfigValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await listConfigValues();
      setItems(data);
      setSelectedKeys((previous) => previous.filter((key) => data.some((item) => item.key === key)));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载配置值失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((item) =>
      [item.key, item.description ?? "", item.value ?? "", item.valueMasked ?? ""]
        .some((field) => field.toLowerCase().includes(keyword))
    );
  }, [items, searchText]);

  const openCreate = () => {
    form.setFieldsValue({
      key: "",
      value: "",
      description: "",
      secret: false,
      preserveValue: false
    });
    setEditorState({ mode: "create" });
  };

  const openEdit = (item: ConfigValue) => {
    form.setFieldsValue({
      key: item.key,
      value: item.secret ? "" : (item.value ?? ""),
      description: item.description ?? "",
      secret: item.secret ?? false,
      preserveValue: Boolean(item.secret && item.hasValue)
    });
    setEditorState({ mode: "edit", key: item.key });
  };

  const closeEditor = () => {
    setEditorState(null);
    form.resetFields();
  };

  const upsertItem = (nextItem: ConfigValue) => {
    setItems((previous) => {
      const hasExisting = previous.some((item) => item.key === nextItem.key);
      const next = hasExisting
        ? previous.map((item) => (item.key === nextItem.key ? nextItem : item))
        : [...previous, nextItem];
      return [...next].sort((left, right) => left.key.localeCompare(right.key));
    });
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: ConfigValueRequest = {
        key: values.key.trim(),
        value: values.value ?? "",
        description: values.description?.trim() || undefined,
        secret: Boolean(values.secret),
        preserveValue: Boolean(values.preserveValue)
      };
      const saved = editorState?.mode === "edit" && editorState.key
        ? await updateConfigValue(editorState.key, payload)
        : await createConfigValue(payload);
      upsertItem(saved);
      closeEditor();
      messageApi.success(editorState?.mode === "edit" ? "配置值已更新" : "配置值已创建");
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "保存配置值失败"));
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<ConfigValue> = [
    {
      title: "Key",
      dataIndex: "key",
      key: "key",
      width: 260,
      render: (value: string, record) => (
        <TableLinkCell onClick={() => openEdit(record)}><Text code>{value}</Text></TableLinkCell>
      )
    },
    {
      title: "值",
      dataIndex: "value",
      key: "value",
      render: (_value: string | null | undefined, record) => record.secret ? (
        <Space size={8}>
          <Tag color="gold">SECRET</Tag>
          <Text>{record.hasValue ? record.valueMasked ?? "********" : "未设置"}</Text>
        </Space>
      ) : (
        <Typography.Paragraph
          ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
          style={{ marginBottom: 0, maxWidth: 420 }}
        >
          {record.value ?? ""}
        </Typography.Paragraph>
      )
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      render: (value?: string) => value ? <Text>{value}</Text> : <Text type="secondary">未填写</Text>
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
      width: 180,
      render: (_: unknown, record) => (
        <Space wrap>
          <ConfirmDangerAction
            title="确认删除这个配置值？"
            description="删除后，运行时引用该 key 的配置会在解析时报错。"
            onConfirm={async () => {
              setDeletingKey(record.key);
              try {
                await deleteConfigValue(record.key);
                setItems((previous) => previous.filter((item) => item.key !== record.key));
                messageApi.success("配置值已删除");
              } catch (error) {
                messageApi.error(getErrorMessage(error, "删除配置值失败"));
              } finally {
                setDeletingKey(null);
              }
            }}
            loading={deletingKey === record.key}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </ConfirmDangerAction>
        </Space>
      )
    }
  ];

  const normalizedKey = typeof watchedKey === "string" ? watchedKey.trim() : "";
  const referenceItems = normalizedKey
    ? [
        {
          label: "JSON 配置值",
          value: `\${config.${normalizedKey}}`
        },
        {
          label: "Bearer / 前缀拼接",
          value: `Bearer \${config.${normalizedKey}}`
        },
        {
          label: "Groovy 脚本",
          value: `config["${normalizedKey}"]`
        },
        {
          label: "Python 脚本",
          value: `config.get("${normalizedKey}")`
        },
        {
          label: "插件调用参数",
          value: `plugins.invoke("plugin-id", "action", [token: "\${config.${normalizedKey}}"])`
        }
      ]
    : [];

  const handleCopy = useCopyMessage(messageApi);

  const exportConfigValues = (targetItems: ConfigValue[], successMessage: string, includeSecretValues: boolean) => {
    try {
      const bundle = buildConfigValueExportBundle(targetItems, { includeSecretValues });
      downloadJsonFile(formatConfigValueExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出配置值失败");
    }
  };

  const confirmExport = async (targetItems: ConfigValue[], successMessage: string) => {
    const hasSecretItems = targetItems.some((item) => item.secret);
    if (!hasSecretItems) {
      exportConfigValues(targetItems, successMessage, true);
      return;
    }
    let includeSecretValues = true;
    await modal.confirm({
      title: "导出配置值",
      okText: "导出",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>已选配置值中包含 Secret。默认会导出明文值，适合完整备份。</Text>
          <Checkbox
            defaultChecked={true}
            onChange={(event) => {
              includeSecretValues = event.target.checked;
            }}
          >
            包含 Secret 明文
          </Checkbox>
        </Space>
      ),
      onOk: () => exportConfigValues(targetItems, successMessage, includeSecretValues)
    });
  };

  const handleExportAll = () => {
    void confirmExport(items, `已导出 ${items.length} 个配置值`);
  };

  const handleExportSelected = () => {
    const selectedItems = items.filter((item) => selectedKeys.includes(item.key));
    void confirmExport(selectedItems, `已导出 ${selectedItems.length} 个选中配置值`);
  };

  const runImport = async (importedItems: ConfigValue[]) => {
    setImporting(true);
    const currentKeys = new Set(items.map((item) => item.key));
    const successes: string[] = [];
    const failures: Array<{ key: string; reason: string }> = [];

    try {
      for (const item of importedItems) {
        const payload: ConfigValueRequest = {
          key: item.key,
          value: item.value ?? "",
          description: item.description,
          secret: item.secret,
          preserveValue: Boolean(item.secret && item.value == null && currentKeys.has(item.key))
        };
        try {
          if (currentKeys.has(item.key)) {
            await updateConfigValue(item.key, payload);
          } else {
            await createConfigValue(payload);
            currentKeys.add(item.key);
          }
          successes.push(item.key);
        } catch (error) {
          const detail = error instanceof ApiError ? error.message : "导入失败";
          failures.push({ key: item.key, reason: detail });
        }
      }

      if (successes.length > 0) {
        await loadData();
      }

      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个配置值`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分配置值处理失败",
        width: 640,
        content: (
          <div className="script-import-result">
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre className="script-import-result__code">
              {failures.slice(0, 10).map((item) => `${item.key}: ${item.reason}`).join("\n")}
            </pre>
            {failures.length > 10 ? <Text type="secondary">仅展示前 10 条失败明细。</Text> : null}
          </div>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedItems = parseConfigValueImportBundle(await file.text());
      const analysis = analyzeConfigValueImport(importedItems, items);
      const overwritePreview = analysis.overwriteKeys.slice(0, 10);

      await modal.confirm({
        title: "确认导入配置值",
        okText: "开始导入",
        cancelText: "取消",
        width: 680,
        content: (
          <div className="script-import-summary">
            <Text>共解析到 {analysis.configValues.length} 个配置值。</Text>
            <Text>新增 {analysis.createKeys.length} 个，覆盖 {analysis.overwriteKeys.length} 个。</Text>
            {analysis.overwriteKeys.length > 0 ? (
              <>
                <Text strong>将被覆盖的配置值 key</Text>
                <pre className="script-import-result__code">{overwritePreview.join("\n")}</pre>
                {analysis.overwriteKeys.length > overwritePreview.length ? (
                  <Text type="secondary">
                    仅展示前 {overwritePreview.length} 个，剩余 {analysis.overwriteKeys.length - overwritePreview.length} 个将在导入时一并覆盖。
                  </Text>
                ) : null}
              </>
            ) : null}
          </div>
        ),
        onOk: () => runImport(analysis.configValues)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "导入配置值失败";
      messageApi.error(detail);
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      messageApi.error("仅支持导入 .json 文件");
      return;
    }

    await handleImportFile(file);
  };

  const rowSelection: TableRowSelection<ConfigValue> = {
    selectedRowKeys: selectedKeys,
    onChange: (nextSelectedRowKeys) => setSelectedKeys(nextSelectedRowKeys),
    preserveSelectedRowKeys: true
  };

  const actions = (
    <Space wrap>
      <Input.Search
        allowClear
        placeholder="按 key / 说明 / 值搜索"
        style={{ width: 280 }}
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
      />
      <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileInputRef.current?.click()}>
        导入配置值
      </Button>
      <Button icon={<DownloadOutlined />} disabled={loading || importing || items.length === 0} onClick={handleExportAll}>
        导出全部
      </Button>
      <Button
        icon={<DownloadOutlined />}
        type="primary"
        ghost
        disabled={loading || importing || selectedKeys.length === 0}
        onClick={handleExportSelected}
      >
        导出选中
      </Button>
      <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
        刷新
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新建配置值
      </Button>
    </Space>
  );

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleImportChange(event)}
      />
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!embedded ? (
          <PageHeader
            title="配置值管理"
            meta="平台全局字符串配置值，可被脚本、插件、调度和调试参数复用。"
            actions={actions}
          />
        ) : null}
        <Card title={embedded ? "配置值" : undefined} extra={embedded ? actions : undefined}>

          {filteredItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={items.length === 0 ? "当前没有配置值" : "没有匹配结果"} />
          ) : (
            <Table
              rowKey="key"
              loading={loading || importing}
              rowSelection={rowSelection}
              columns={columns}
              dataSource={filteredItems}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 1100 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title={editorState?.mode === "edit" ? "编辑配置值" : "新建配置值"}
        width={520}
        open={Boolean(editorState)}
        onClose={closeEditor}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeEditor}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSubmit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Key"
            name="key"
            rules={[
              { required: true, message: "请输入 key" },
              {
                pattern: /^[A-Za-z][A-Za-z0-9_.-]*$/,
                message: "仅支持字母开头，后续可包含字母、数字、点、下划线和中划线"
              }
            ]}
            extra="创建后不支持修改，引用格式为 ${config.key}。"
          >
            <Input placeholder="openai.api_key" disabled={editorState?.mode === "edit"} />
          </Form.Item>
          <Form.Item
            label="值"
            name="value"
            rules={[
              {
                validator: async (_, value) => {
                  const secret = Boolean(form.getFieldValue("secret"));
                  const preserveValue = Boolean(form.getFieldValue("preserveValue"));
                  if (secret && preserveValue) {
                    return;
                  }
                  if (typeof value === "string" && value.length > 0) {
                    return;
                  }
                  throw new Error("请输入配置值");
                }
              }
            ]}
            extra="支持在值内继续引用其他配置值，例如 https://host/${config.region}/v1。"
          >
            <Input.TextArea rows={6} placeholder="sk-..." />
          </Form.Item>
          <Form.Item label="高级选项" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={8}>
              <Form.Item name="secret" valuePropName="checked" noStyle>
                <Checkbox
                  onChange={(event) => {
                    if (!event.target.checked) {
                      form.setFieldValue("preserveValue", false);
                    }
                  }}
                >
                  作为 Secret 管理
                </Checkbox>
              </Form.Item>
              <Text type="secondary">
                Secret 值不会在列表和编辑弹窗中明文回显，但运行时仍可通过 {"${config.key}"} 引用。
              </Text>
              {watchedSecret && editorState?.mode === "edit" ? (
                <Form.Item name="preserveValue" valuePropName="checked" noStyle>
                  <Checkbox>保留现值，不覆盖为当前输入</Checkbox>
                </Form.Item>
              ) : null}
            </Space>
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} placeholder="这个值会被哪些脚本或插件复用" />
          </Form.Item>
        </Form>

        <Card size="small" title="可复制引用" style={{ marginTop: 16 }}>
          {referenceItems.length === 0 ? (
            <Text type="secondary">先填写 Key，这里会自动生成不同场景可直接复制的引用片段。</Text>
          ) : (
            <List
              dataSource={referenceItems}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key={item.label}
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => void handleCopy(item.value)}
                    >
                      复制
                    </Button>
                  ]}
                >
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Text strong>{item.label}</Text>
                    <Text code>{item.value}</Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Drawer>
    </>
  );
}
