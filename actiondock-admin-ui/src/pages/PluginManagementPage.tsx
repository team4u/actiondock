import {
  DeleteOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Card, Modal, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  installRepositoryPlugin,
  installPlugin,
  listPlugins,
  listRepositoryPlugins,
  startPlugin,
  stopPlugin,
  updateRepositoryPlugin,
  upgradePlugin,
  uninstallPlugin
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import { useActionWithLoading } from "../hooks/useActionWithLoading";
import type { PluginView, RepositoryPluginConflict, RepositoryPluginDescriptor } from "../types";
import { getErrorMessage } from "../utils";

const { Text } = Typography;

export function PluginManagementPage() {
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [repositoryPlugins, setRepositoryPlugins] = useState<RepositoryPluginDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const { actionId, withAction } = useActionWithLoading();
  const [pendingUploadPluginId, setPendingUploadPluginId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const [pluginData, repositoryPluginData] = await Promise.all([listPlugins(), listRepositoryPlugins()]);
      setPlugins(pluginData);
      setRepositoryPlugins(repositoryPluginData);
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

  const refreshRepositoryPlugins = async () => {
    try {
      setRepositoryPlugins(await listRepositoryPlugins());
    } catch (error) {
      messageApi.error(getErrorMessage(error, "刷新仓库插件失败"));
    }
  };

  const formatConflicts = (conflicts: RepositoryPluginConflict[]) =>
    conflicts
      .slice(0, 8)
      .map((item) => `${item.scriptId}${item.requiredVersionRange ? ` (${item.requiredVersionRange})` : ""}`)
      .join("\n");

  const handleRepositoryPluginAction = async (record: RepositoryPluginDescriptor, action: "install" | "update", force = false) => {
    await withAction(`${action}:${record.repositoryId}:${record.pluginId}`, async () => {
      try {
        const result = action === "install"
          ? await installRepositoryPlugin(record.repositoryId, record.pluginId, { force })
          : await updateRepositoryPlugin(record.repositoryId, record.pluginId, { force });
        replacePlugin(result.plugin);
        await refreshRepositoryPlugins();
        messageApi.success(action === "install" ? "插件已从仓库安装" : "插件已从仓库更新");
      } catch (error) {
        if (
          error instanceof ApiError &&
          typeof error.data === "object" &&
          error.data !== null &&
          "code" in error.data &&
          (error.data as { code?: string }).code === "PLUGIN_VERSION_CONFLICT"
        ) {
          const conflicts = ((error.data as { conflicts?: RepositoryPluginConflict[] }).conflicts ?? []);
          await modal.confirm({
            title: "插件版本会影响已安装工具",
            okText: "强制覆盖",
            cancelText: "取消",
            width: 620,
            content: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Text>以下工具声明的插件版本范围不满足仓库版本。强制覆盖后，这些工具可能运行失败。</Text>
                <pre className="script-import-result__code">{formatConflicts(conflicts)}</pre>
              </Space>
            ),
            onOk: () => handleRepositoryPluginAction(record, action, true)
          });
          return;
        }
        messageApi.error(getErrorMessage(error, action === "install" ? "安装仓库插件失败" : "更新仓库插件失败"));
      }
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
      title: "来源",
      key: "source",
      width: 160,
      render: (_: unknown, record) =>
        record.repositoryId ? (
          <Space direction="vertical" size={2}>
            <Text>{record.repositoryId}</Text>
            <Text type="secondary">{record.repositoryVersion || record.version}</Text>
          </Space>
        ) : (
          <Tag>手动上传</Tag>
        )
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
            description="将删除插件文件与相关配置。"
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

  const repositoryColumns: ColumnsType<RepositoryPluginDescriptor> = [
    {
      title: "仓库插件",
      key: "plugin",
      render: (_: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[8, 8]}>
            <Text strong>{record.displayName || record.pluginId}</Text>
            <Text code>{record.pluginId}</Text>
          </Space>
          <Text type="secondary">{record.description || "未填写描述"}</Text>
        </Space>
      )
    },
    {
      title: "来源",
      key: "repository",
      width: 150,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.repositoryId}</Text>
          {record.trusted ? <Tag color="green">可信仓库</Tag> : <Tag color="gold">未信任</Tag>}
        </Space>
      )
    },
    {
      title: "版本",
      key: "version",
      width: 150,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Text>远端 {record.version}</Text>
          {record.installedVersion ? <Text type="secondary">本机 {record.installedVersion}</Text> : null}
        </Space>
      )
    },
    {
      title: "状态",
      key: "state",
      width: 140,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={2}>
          {record.installed ? <Tag color="blue">已安装</Tag> : <Tag>未安装</Tag>}
          {record.updateAvailable ? <Tag color="processing">可更新</Tag> : null}
          {record.dependentToolCount > 0 ? <Tag color="purple">{record.dependentToolCount} 个工具依赖</Tag> : null}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, record) => (
        record.installed ? (
          <Button
            size="small"
            icon={<SyncOutlined />}
            type={record.updateAvailable ? "primary" : "default"}
            ghost={record.updateAvailable}
            disabled={!record.updateAvailable}
            loading={actionId === `update:${record.repositoryId}:${record.pluginId}`}
            onClick={() => void handleRepositoryPluginAction(record, "update")}
          >
            更新
          </Button>
        ) : (
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            loading={actionId === `install:${record.repositoryId}:${record.pluginId}`}
            onClick={() => void handleRepositoryPluginAction(record, "install")}
          >
            安装
          </Button>
        )
      )
    }
  ];

  return (
    <>
      {contextHolder}
      {modalContextHolder}
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
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="插件管理"
          actions={
            <>
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
            </>
          }
        />
        <Card>
          <Table
            rowKey="pluginId"
            loading={loading || uploading}
            columns={columns}
            dataSource={plugins}
            pagination={{ pageSize: 10, responsive: true }}
            scroll={{ x: 980 }}
          />
        </Card>
        <Card title="仓库插件">
          <Table
            rowKey={(item) => `${item.repositoryId}:${item.pluginId}`}
            loading={loading}
            columns={repositoryColumns}
            dataSource={repositoryPlugins}
            pagination={{ pageSize: 8, responsive: true }}
            scroll={{ x: 900 }}
          />
        </Card>
      </Space>
    </>
  );
}
