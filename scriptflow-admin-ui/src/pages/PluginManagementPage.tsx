import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Card, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  installPlugin,
  listPlugins,
  startPlugin,
  stopPlugin,
  upgradePlugin,
  uninstallPlugin
} from "../api";
import { TableLinkCell } from "../components/TableLinkCell";
import { useActionWithLoading } from "../hooks/useActionWithLoading";
import type { PluginView } from "../types";
import { getErrorMessage } from "../utils";

const { Text } = Typography;

export function PluginManagementPage() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const { actionId, withAction } = useActionWithLoading();
  const [pendingUploadPluginId, setPendingUploadPluginId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadPlugins = async () => {
    setLoading(true);
    try {
      setPlugins(await listPlugins());
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

  const handlePluginUpload = async (file?: File) => {
    const targetPluginId = pendingUploadPluginId;
    setPendingUploadPluginId(null);

    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".jar")) {
      messageApi.error("仅支持上传 .jar 插件包");
      return;
    }

    if (targetPluginId) {
      void withAction(targetPluginId, async () => {
        setUploading(true);
        try {
          const plugin = await upgradePlugin(targetPluginId, file);
          replacePlugin(plugin);
          messageApi.success(`插件已升级：${plugin.pluginId}`);
        } catch (error) {
          messageApi.error(getErrorMessage(error, "升级插件失败"));
        } finally {
          setUploading(false);
        }
      });
      return;
    }

    setUploading(true);
    try {
      const plugin = await installPlugin(file);
      replacePlugin(plugin);
      messageApi.success(`插件已安装：${plugin.pluginId}`);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装插件失败"));
    } finally {
      setUploading(false);
    }
  };

  const columns: ColumnsType<PluginView> = [
    {
      title: "插件 ID",
      dataIndex: "pluginId",
      key: "pluginId",
      render: (value: string) => (
        <TableLinkCell to={`/plugins/${value}`}>{value}</TableLinkCell>
      )
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
            icon={<UploadOutlined />}
            loading={actionId === record.pluginId}
            onClick={() => {
              setPendingUploadPluginId(record.pluginId);
              fileInputRef.current?.click();
            }}
          >
            升级
          </Button>
          {record.started ? (
            <Button
              size="small"
              icon={<PauseCircleOutlined />}
              loading={actionId === record.pluginId}
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
              loading={actionId === record.pluginId}
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
              loading={actionId === record.pluginId}
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
          void handlePluginUpload(file);
        }}
      />
      <Card title="插件管理">
        <div className="script-list-toolbar">
          <Space direction="vertical" size={2} className="script-list-toolbar__meta">
            <Text type="secondary">共 {plugins.length} 个插件</Text>
            <Text type="secondary">已启动 {plugins.filter((item) => item.started).length} 个</Text>
          </Space>
          <Space wrap className="script-list-toolbar__actions">
            <Button icon={<ReloadOutlined />} onClick={() => void loadPlugins()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => {
                setPendingUploadPluginId(null);
                fileInputRef.current?.click();
              }}
              loading={uploading}
            >
              上传安装
            </Button>
          </Space>
        </div>
        <Table
          rowKey="pluginId"
          loading={loading || uploading}
          columns={columns}
          dataSource={plugins}
          pagination={{ pageSize: 10, responsive: true }}
          scroll={{ x: 980 }}
        />
      </Card>
    </>
  );
}
