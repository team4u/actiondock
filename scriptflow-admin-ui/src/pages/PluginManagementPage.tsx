import {
  DeleteOutlined,
  KeyOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  getPluginConfig,
  installPlugin,
  listPlugins,
  startPlugin,
  stopPlugin,
  uninstallPlugin,
  updatePluginConfig
} from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { SchemaFieldList } from "../components/SchemaFieldList";
import { resolveSchemaFields } from "../schema";
import {
  buildSchemaFieldRules,
  getSchemaFieldValuePropName,
  renderSchemaFieldInput
} from "../schemaForm";
import type { PluginConfigView, PluginView } from "../types";
import { copyText, parseJsonText, prettyJson } from "../utils";

const { Text } = Typography;

type PluginConfigInputMode = "SCHEMA" | "JSON";

export function PluginManagementPage({ onOpenApiKeyModal }: { onOpenApiKeyModal: () => void }) {
  const [configForm] = Form.useForm<Record<string, any>>();
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [actionPluginId, setActionPluginId] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<PluginConfigView | null>(null);
  const [configText, setConfigText] = useState("{}");
  const [configInputMode, setConfigInputMode] = useState<PluginConfigInputMode>("JSON");
  const [messageApi, contextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { supportedFields: configSupportedFields, unsupportedFields: configUnsupportedFields } = resolveSchemaFields(
    currentConfig?.configSchema
  );
  const hasConfigSchemaForm = configSupportedFields.length > 0;

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const data = await listPlugins();
      setPlugins(data);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载插件失败";
      messageApi.error(detail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlugins();
  }, []);

  useEffect(() => {
    if (!currentConfig) {
      configForm.resetFields();
      setConfigText("{}");
      setConfigInputMode("JSON");
      return;
    }

    configForm.setFieldsValue(currentConfig.config);
    setConfigText(prettyJson(currentConfig.config));
    setConfigInputMode(hasConfigSchemaForm ? "SCHEMA" : "JSON");
  }, [configForm, currentConfig, hasConfigSchemaForm]);

  const replacePlugin = (nextPlugin: PluginView) => {
    setPlugins((previous) => {
      const hasPlugin = previous.some((item) => item.pluginId === nextPlugin.pluginId);
      const next = hasPlugin
        ? previous.map((item) => (item.pluginId === nextPlugin.pluginId ? nextPlugin : item))
        : [...previous, nextPlugin];
      return [...next].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
    });
  };

  const withAction = async (pluginId: string, action: () => Promise<void>) => {
    setActionPluginId(pluginId);
    try {
      await action();
    } finally {
      setActionPluginId(null);
    }
  };

  const handleInstallChange = async (file?: File) => {
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".jar")) {
      messageApi.error("仅支持上传 .jar 插件包");
      return;
    }

    setUploading(true);
    try {
      const installed = await installPlugin(file);
      replacePlugin(installed);
      messageApi.success(`插件已安装：${installed.pluginId}`);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "安装插件失败";
      messageApi.error(detail);
    } finally {
      setUploading(false);
    }
  };

  const openConfigModal = async (pluginId: string) => {
    setConfigModalOpen(true);
    setConfigLoading(true);
    setCurrentConfig(null);
    try {
      const data = await getPluginConfig(pluginId);
      setCurrentConfig(data);
      setConfigText(prettyJson(data.config));
    } catch (error) {
      setConfigModalOpen(false);
      const detail = error instanceof ApiError ? error.message : "加载插件配置失败";
      messageApi.error(detail);
    } finally {
      setConfigLoading(false);
    }
  };

  const mergeConfigWithFormValues = (
    baseConfig: Record<string, unknown>,
    formValues: Record<string, any>
  ): Record<string, unknown> => {
    const nextConfig = { ...baseConfig };

    configSupportedFields.forEach((field) => {
      delete nextConfig[field.name];
    });

    Object.entries(formValues).forEach(([key, value]) => {
      if (value !== undefined) {
        nextConfig[key] = value;
      }
    });

    return nextConfig;
  };

  const handleConfigModeChange = (nextMode: string) => {
    if (!currentConfig) {
      return;
    }

    if (nextMode === "JSON") {
      try {
        const baseConfig = parseJsonText(configText, "插件配置");
        const nextConfig = mergeConfigWithFormValues(baseConfig, configForm.getFieldsValue(true));
        setConfigText(prettyJson(nextConfig));
        setConfigInputMode("JSON");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "切换到 JSON 模式失败";
        messageApi.error(detail);
      }
      return;
    }

    try {
      const parsedConfig = parseJsonText(configText, "插件配置");
      configForm.setFieldsValue(parsedConfig);
      setConfigInputMode("SCHEMA");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "当前 JSON 不是合法配置";
      messageApi.error(detail);
    }
  };

  const handleSaveConfig = async () => {
    if (!currentConfig) {
      return;
    }
    setConfigSaving(true);
    try {
      const nextConfig =
        configInputMode === "SCHEMA"
          ? mergeConfigWithFormValues(
              parseJsonText(configText, "插件配置"),
              await configForm.validateFields()
            )
          : parseJsonText(configText, "插件配置");
      const saved = await updatePluginConfig(currentConfig.pluginId, nextConfig);
      setCurrentConfig(saved);
      configForm.setFieldsValue(saved.config);
      setConfigText(prettyJson(saved.config));
      messageApi.success("插件配置已保存");
      await loadPlugins();
    } catch (error) {
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "保存插件配置失败";
      messageApi.error(detail);
    } finally {
      setConfigSaving(false);
    }
  };

  const columns: ColumnsType<PluginView> = [
    {
      title: "插件 ID",
      dataIndex: "pluginId",
      key: "pluginId",
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name"
    },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: 120,
      render: (state: string, record) => (
        <Tag color={record.started ? "green" : state === "FAILED" ? "red" : "gold"}>{state}</Tag>
      )
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 120
    },
    {
      title: "动作数",
      key: "actions",
      width: 100,
      render: (_: unknown, record) => record.actions.length
    },
    {
      title: "操作",
      key: "operations",
      width: 320,
      render: (_: unknown, record) => (
        <Space wrap>
          <Button
            size="small"
            icon={<SettingOutlined />}
            disabled={!record.configurable}
            onClick={() => void openConfigModal(record.pluginId)}
          >
            配置
          </Button>
          {record.started ? (
            <Button
              size="small"
              icon={<PauseCircleOutlined />}
              loading={actionPluginId === record.pluginId}
              onClick={() =>
                void withAction(record.pluginId, async () => {
                  replacePlugin(await stopPlugin(record.pluginId));
                  messageApi.success("插件已停止");
                })
              }
            >
              停止
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<PlayCircleOutlined />}
              loading={actionPluginId === record.pluginId}
              onClick={() =>
                void withAction(record.pluginId, async () => {
                  replacePlugin(await startPlugin(record.pluginId));
                  messageApi.success("插件已启动");
                })
              }
            >
              启动
            </Button>
          )}
          <Popconfirm
            title="确认卸载这个插件？"
            description="会删除数据库记录、插件文件与保存的配置。"
            okText="卸载"
            cancelText="取消"
            onConfirm={() =>
              withAction(record.pluginId, async () => {
                await uninstallPlugin(record.pluginId);
                setPlugins((previous) => previous.filter((item) => item.pluginId !== record.pluginId));
                messageApi.success("插件已卸载");
              })
            }
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={actionPluginId === record.pluginId}
            >
              卸载
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jar,application/java-archive"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handleInstallChange(file);
        }}
      />
      <Modal
        title={currentConfig ? `插件配置 · ${currentConfig.pluginId}` : "插件配置"}
        open={configModalOpen}
        onCancel={() => {
          setConfigModalOpen(false);
          setCurrentConfig(null);
        }}
        onOk={() => void handleSaveConfig()}
        okText="保存配置"
        confirmLoading={configSaving}
        width={860}
      >
        {configLoading || !currentConfig ? (
          <Alert type="info" showIcon message="正在加载插件配置" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {configUnsupportedFields.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="部分配置字段无法在表单模式中编辑"
                description={`以下字段仍需通过 JSON 模式维护：${configUnsupportedFields.join(", ")}`}
              />
            ) : null}
            {hasConfigSchemaForm ? (
              <Tabs
                activeKey={configInputMode}
                onChange={handleConfigModeChange}
                items={[
                  {
                    key: "SCHEMA",
                    label: "表单输入",
                    children: (
                      <Form form={configForm} layout="vertical">
                        {configSupportedFields.map((field) => (
                          <Form.Item
                            key={field.name}
                            label={field.label}
                            name={field.name}
                            rules={buildSchemaFieldRules(field)}
                            valuePropName={getSchemaFieldValuePropName(field)}
                            extra={field.description}
                          >
                            {renderSchemaFieldInput(field, {
                              booleanLabels: {
                                checked: "启用",
                                unchecked: "关闭"
                              }
                            })}
                          </Form.Item>
                        ))}
                      </Form>
                    )
                  },
                  {
                    key: "JSON",
                    label: "JSON 输入",
                    children: (
                      <Form layout="vertical">
                        <Form.Item label="插件配置 JSON" extra="直接输入完整配置对象保存。">
                          <CodeEditor
                            height="320px"
                            language="json"
                            value={configText}
                            onChange={setConfigText}
                            theme="vs-light"
                          />
                        </Form.Item>
                      </Form>
                    )
                  }
                ]}
              />
            ) : (
              <Form layout="vertical">
                <Form.Item
                  label="插件配置 JSON"
                  extra="当前配置 schema 无法渲染为表单，请直接输入完整配置对象。"
                >
                  <CodeEditor
                    height="320px"
                    language="json"
                    value={configText}
                    onChange={setConfigText}
                    theme="vs-light"
                  />
                </Form.Item>
              </Form>
            )}
          </Space>
        )}
      </Modal>
      <Card title="插件管理">
        <div className="script-list-toolbar">
          <Space direction="vertical" size={2} className="script-list-toolbar__meta">
            <Text type="secondary">共 {plugins.length} 个插件</Text>
            <Text type="secondary">已启动 {plugins.filter((item) => item.started).length} 个</Text>
          </Space>
          <Space wrap className="script-list-toolbar__actions">
            <Button icon={<KeyOutlined />} onClick={onOpenApiKeyModal}>
              API Key
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadPlugins()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
            >
              上传安装
            </Button>
          </Space>
        </div>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={'Groovy 脚本统一通过 plugins.invoke("pluginId", "action", args) 调用插件。'}
          action={
            <Button
              size="small"
              onClick={() => void copyText('plugins.invoke("scriptflow-demo-plugin", "echo", [message: "hello"])')}
            >
              复制示例
            </Button>
          }
        />
        <Table
          rowKey="pluginId"
          loading={loading || uploading}
          columns={columns}
          dataSource={plugins}
          pagination={{ pageSize: 10, responsive: true }}
          scroll={{ x: 920 }}
          expandable={{
            expandedRowRender: (record) => (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {record.description ? <Text type="secondary">{record.description}</Text> : null}
                <Collapse
                  className="plugin-reference-collapse plugin-reference-collapse--nested"
                  items={record.actions.map((action) => {
                    const snippet = `plugins.invoke("${record.pluginId}", "${action.action}", ${JSON.stringify(action.exampleArgs, null, 2)})`;
                    return {
                      key: `${record.pluginId}-${action.action}`,
                      label: (
                        <Space wrap size={[8, 8]}>
                          <Text strong>{action.title || action.action}</Text>
                          <Text code>{action.action}</Text>
                        </Space>
                      ),
                      children: (
                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                          {action.description ? <Text type="secondary">{action.description}</Text> : null}
                          <SchemaFieldList
                            schema={action.inputSchema}
                            title="输入字段"
                            emptyDescription="当前动作没有声明输入字段。"
                          />
                          <SchemaFieldList
                            schema={action.outputSchema}
                            title="输出字段"
                            emptyDescription="当前动作没有声明输出字段。"
                          />
                          <Text strong>调用示例</Text>
                          <pre className="json-preview">{snippet}</pre>
                        </Space>
                      )
                    };
                  })}
                />
              </Space>
            ),
            rowExpandable: (record) => record.actions.length > 0
          }}
        />
      </Card>
    </>
  );
}
