import {
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";
import { installPlugin, listPlugins, startPlugin, stopPlugin, upgradePlugin, uninstallPlugin } from "../../plugins/api";
import {
  listPluginsByRepository,
  listRepositories,
  syncRepository,
  updateRepositoryPlugin
} from "../../resources/api";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { useActionWithLoading } from "../../../shared/hooks/useActionWithLoading";
import { ApiError } from "../../../shared/api/httpClient";
import type { PluginSummaryView, PluginView, RepositoryPluginConflict, RepositoryPluginDescriptor } from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

const { Text } = Typography;

export function PluginManagementPage() {
  const [plugins, setPlugins] = useState<PluginSummaryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
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

  const toPluginSummary = (plugin: PluginView): PluginSummaryView => ({
    pluginId: plugin.pluginId,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    repositoryId: plugin.repositoryId,
    repositoryPluginId: plugin.repositoryPluginId,
    repositoryVersion: plugin.repositoryVersion,
    state: plugin.state,
    sourceType: plugin.sourceType,
    started: plugin.started,
    configurable: plugin.configurable,
    fileName: plugin.fileName,
    actionCount: plugin.actions.length
  });

  const replacePlugin = (nextPlugin: PluginView) => {
    const nextSummary = toPluginSummary(nextPlugin);
    setPlugins((previous) => {
      const hasPlugin = previous.some((item) => item.pluginId === nextSummary.pluginId);
      const next = hasPlugin
        ? previous.map((item) => (item.pluginId === nextSummary.pluginId ? nextSummary : item))
        : [...previous, nextSummary];
      return [...next].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
    });
  };

  const formatConflicts = (conflicts: RepositoryPluginConflict[]) =>
    conflicts
      .slice(0, 8)
      .map((item) => `${item.scriptId}${item.requiredVersionRange ? ` (${item.requiredVersionRange})` : ""}`)
      .join("\n");

  const isPluginVersionConflict = (
    error: unknown
  ): error is ApiError & { data: { code?: string; conflicts?: RepositoryPluginConflict[] } } =>
    error instanceof ApiError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    (error.data as { code?: string }).code === "PLUGIN_VERSION_CONFLICT";

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

  const handleUpdateAll = async () => {
    setBulkUpdating(true);
    const repositoryFailures: string[] = [];
    const pluginFailures: string[] = [];
    let updatedCount = 0;
    try {
      const repositories = await listRepositories();
      const syncedRepositoryIds: string[] = [];
      for (const repository of repositories.filter((item) => item.enabled)) {
        try {
          await syncRepository(repository.id);
          syncedRepositoryIds.push(repository.id);
        } catch (error) {
          repositoryFailures.push(`${repository.id}: ${getErrorMessage(error, "同步失败")}`);
        }
      }

      const installedPlugins = await listPlugins();
      const repositoryInstalledPlugins = new Map(
        installedPlugins.filter((item) => Boolean(item.repositoryId)).map((item) => [item.pluginId, item])
      );
      const targetByPluginId = new Map<string, RepositoryPluginDescriptor>();

      for (const repositoryId of syncedRepositoryIds) {
        try {
          const descriptors = await listPluginsByRepository(repositoryId);
          for (const descriptor of descriptors) {
            const installedPlugin = repositoryInstalledPlugins.get(descriptor.pluginId);
            if (!installedPlugin || !descriptor.installed || !descriptor.updateAvailable) {
              continue;
            }

            const previous = targetByPluginId.get(descriptor.pluginId);
            const matchesInstalledSource = descriptor.repositoryId === installedPlugin.repositoryId;
            const previousMatchesInstalledSource = previous?.repositoryId === installedPlugin.repositoryId;
            if (!previous || (matchesInstalledSource && !previousMatchesInstalledSource)) {
              targetByPluginId.set(descriptor.pluginId, descriptor);
            }
          }
        } catch (error) {
          repositoryFailures.push(`${repositoryId}: ${getErrorMessage(error, "读取插件失败")}`);
        }
      }

      for (const plugin of targetByPluginId.values()) {
        try {
          const result = await updateRepositoryPlugin(plugin.repositoryId, plugin.pluginId, { force: false });
          replacePlugin(result.plugin);
          updatedCount += 1;
        } catch (error) {
          const fallbackMessage = isPluginVersionConflict(error) ? "版本冲突" : "更新失败";
          pluginFailures.push(`${plugin.pluginId}: ${getErrorMessage(error, fallbackMessage)}`);
        }
      }

      await loadPlugins();
      if (targetByPluginId.size === 0 && repositoryFailures.length === 0) {
        messageApi.success("已是最新");
        return;
      }
      if (repositoryFailures.length > 0 || pluginFailures.length > 0) {
        messageApi.warning(`更新完成，成功 ${updatedCount} 个，失败 ${repositoryFailures.length + pluginFailures.length} 项`);
        return;
      }
      messageApi.success(`已更新 ${updatedCount} 个插件`);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "一键更新失败"));
    } finally {
      setBulkUpdating(false);
    }
  };

  const columns: ColumnsType<PluginSummaryView> = [
    {
      title: "插件 ID",
      dataIndex: "pluginId",
      key: "pluginId",
      render: (value: string) => <TableLinkCell to={`/plugins/${value}`}>{value}</TableLinkCell>
    },
    { title: "名称", dataIndex: "name", key: "name" },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: 120,
      render: (state: string, record) => <Tag color={record.started ? "green" : state === "FAILED" ? "red" : "gold"}>{state}</Tag>
    },
    { title: "版本", dataIndex: "version", key: "version", width: 120 },
    {
      title: "来源",
      key: "source",
      width: 160,
      render: (_: unknown, record) =>
        record.sourceType === "SYSTEM" ? (
          <Tag color="processing">系统内置</Tag>
        ) : record.repositoryId ? (
          <Space direction="vertical" size={2}>
            <Text>{record.repositoryId}</Text>
            <Text type="secondary">{record.repositoryVersion || record.version}</Text>
          </Space>
        ) : (
          <Tag>手动上传</Tag>
        )
    },
    { title: "动作数", dataIndex: "actionCount", key: "actionCount", width: 100 },
    {
      title: "操作",
      key: "operations",
      width: 320,
      render: (_: unknown, record) => (
        <Space wrap>
          {record.sourceType !== "SYSTEM" ? (
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
          ) : null}
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
          {record.sourceType !== "SYSTEM" ? (
            <Button
              size="small"
              danger
              icon={<DownloadOutlined />}
              loading={actionId === record.pluginId}
              onClick={() =>
                void withAction(record.pluginId, async () => {
                  await uninstallPlugin(record.pluginId);
                  setPlugins((previous) => previous.filter((item) => item.pluginId !== record.pluginId));
                  messageApi.success("插件已卸载");
                })
              }
            >
              卸载
            </Button>
          ) : null}
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
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="插件管理"
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadPlugins()} loading={loading}>
                刷新
              </Button>
              <Button icon={<SyncOutlined />} loading={bulkUpdating} disabled={loading || uploading} onClick={() => void handleUpdateAll()}>
                一键更新
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
      </Space>
    </>
  );
}
