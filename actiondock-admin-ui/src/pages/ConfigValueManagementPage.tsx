import {
  CopyOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
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
import type { ConfigValue, ConfigValueRequest } from "../types";
import { copyText, formatDateTime, getErrorMessage } from "../utils";

const { Paragraph, Text } = Typography;

type EditorMode = "create" | "edit";

interface EditorState {
  mode: EditorMode;
  key?: string;
}

export function ConfigValueManagementPage() {
  const [form] = Form.useForm<ConfigValueRequest>();
  const watchedKey = Form.useWatch("key", form);
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
      [item.key, item.description ?? "", item.value]
        .some((field) => field.toLowerCase().includes(keyword))
    );
  }, [items, searchText]);

  const openCreate = () => {
    form.setFieldsValue({
      key: "",
      value: "",
      description: ""
    });
    setEditorState({ mode: "create" });
  };

  const openEdit = (item: ConfigValue) => {
    form.setFieldsValue({
      key: item.key,
      value: item.value,
      description: item.description ?? ""
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
        description: values.description?.trim() || undefined
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
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "值",
      dataIndex: "value",
      key: "value",
      render: (value: string) => (
        <Typography.Paragraph
          ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
          style={{ marginBottom: 0, maxWidth: 420 }}
        >
          {value}
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
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除这个配置值？"
            description="删除后，运行时引用该 key 的配置会在解析时报错。"
            okText="删除"
            cancelText="取消"
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
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={deletingKey === record.key}>
              删除
            </Button>
          </Popconfirm>
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

  const handleCopy = async (value: string) => {
    try {
      await copyText(value);
      messageApi.success("已复制");
    } catch {
      messageApi.error("复制失败");
    }
  };

  const exportConfigValues = (targetItems: ConfigValue[], successMessage: string) => {
    try {
      const bundle = buildConfigValueExportBundle(targetItems);
      downloadJsonFile(formatConfigValueExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出配置值失败");
    }
  };

  const handleExportAll = () => {
    exportConfigValues(items, `已导出 ${items.length} 个配置值`);
  };

  const handleExportSelected = () => {
    const selectedItems = items.filter((item) => selectedKeys.includes(item.key));
    exportConfigValues(selectedItems, `已导出 ${selectedItems.length} 个选中配置值`);
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
          value: item.value,
          description: item.description
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
      <Card title="配置值管理">
        <div className="script-list-toolbar">
          <Space direction="vertical" size={2} className="script-list-toolbar__meta">
            <Text type="secondary">共 {items.length} 个配置值</Text>
            <Text type="secondary">已选 {selectedKeys.length} 个配置值</Text>
            <Space size={8} wrap>
              <Tag color="blue">字符串值</Tag>
              <Tag>${"{config.some_key}"}</Tag>
            </Space>
          </Space>
          <Space wrap className="script-list-toolbar__actions">
            <Input.Search
              allowClear
              placeholder="按 key / 说明 / 值搜索"
              style={{ width: 280 }}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
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
        </div>

        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          在插件配置、插件调试参数、脚本执行输入和定时任务输入里，可使用
          <Text code>${"{config.xxx}"}</Text> 引用这里维护的值。脚本运行时也会注入只读
          <Text code>config</Text> 变量。
        </Paragraph>

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
            rules={[{ required: true, message: "请输入配置值" }]}
            extra="支持在值内继续引用其他配置值，例如 https://host/${config.region}/v1。"
          >
            <Input.TextArea rows={6} placeholder="sk-..." />
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
