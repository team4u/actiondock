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
  Descriptions,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
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
import type { PluginConfigView, PluginView } from "../types";
import { copyText, parseJsonText, prettyJson } from "../utils";

const { Text } = Typography;

export function PluginManagementPage({ onOpenApiKeyModal }: { onOpenApiKeyModal: () => void }) {
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [actionPluginId, setActionPluginId] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<PluginConfigView | null>(null);
  const [configText, setConfigText] = useState("{}");
  const [messageApi, contextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSaveConfig = async () => {
    if (!currentConfig) {
      return;
    }
    setConfigSaving(true);
    try {
      const saved = await updatePluginConfig(currentConfig.pluginId, parseJsonText(configText, "插件配置"));
      setCurrentConfig(saved);
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
        onCancel={() => setConfigModalOpen(false)}
        onOk={() => void handleSaveConfig()}
        okText="保存配置"
        confirmLoading={configSaving}
        width={860}
      >
        {configLoading || !currentConfig ? (
          <Alert type="info" showIcon message="正在加载插件配置" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="默认配置">
                <pre className="json-preview">{prettyJson(currentConfig.defaultConfig)}</pre>
              </Descriptions.Item>
              <Descriptions.Item label="配置 Schema">
                <pre className="json-preview">{prettyJson(currentConfig.configSchema)}</pre>
              </Descriptions.Item>
            </Descriptions>
            <CodeEditor
              height="320px"
              language="json"
              value={configText}
              onChange={setConfigText}
              theme="vs-light"
            />
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
                {record.actions.map((action) => (
                  <Card key={`${record.pluginId}-${action.action}`} type="inner" title={`${action.action} · ${action.title || "未命名动作"}`}>
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      {action.description ? <Text type="secondary">{action.description}</Text> : null}
                      <pre className="json-preview">{prettyJson(action.inputSchema)}</pre>
                      <pre className="json-preview">
                        {`plugins.invoke("${record.pluginId}", "${action.action}", ${JSON.stringify(action.exampleArgs, null, 2)})`}
                      </pre>
                    </Space>
                  </Card>
                ))}
              </Space>
            ),
            rowExpandable: (record) => record.actions.length > 0
          }}
        />
      </Card>
    </>
  );
}
