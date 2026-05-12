import { Button, Empty, Space, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined, SyncOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { TableLinkCell } from "../../../../components/common/TableLinkCell";
import { TrustLevelTag } from "../../../../components/domain/TrustLevelTag";
import { getUpstreamActionLabel } from "../../../../components/domain/UpstreamSyncTag";
import type {
  CapabilityPackageDescriptor,
  RepositoryEventSourceDescriptor,
  RepositoryPluginDescriptor,
  RepositorySkillDescriptor,
  RepositoryToolDescriptor
} from "../../../../shared/types";
import {
  getSkillInstallLabel,
  isLocalEventSource,
  isLocalTool,
  isLockedLocal,
  isTrackedLocal,
  localAssetId,
  renderRepositoryPlugins
} from "./discoveryHelpers";
import type { AddMode, InstallAction, LocalAssetAction } from "./types";

const { Text } = Typography;

interface DiscoveryCatalogTabsProps {
  loading: boolean;
  actionKey: string | null;
  packageActionKey: string | null;
  filteredTools: RepositoryToolDescriptor[];
  filteredEventSources: RepositoryEventSourceDescriptor[];
  filteredPackages: CapabilityPackageDescriptor[];
  filteredSkills: RepositorySkillDescriptor[];
  filteredPlugins: RepositoryPluginDescriptor[];
  onOpenToolDetail: (descriptor: RepositoryToolDescriptor) => void | Promise<void>;
  onOpenEventSourceDetail: (descriptor: RepositoryEventSourceDescriptor) => void | Promise<void>;
  onOpenPackageDetail: (descriptor: CapabilityPackageDescriptor) => void | Promise<void>;
  onOpenSkillDetail: (descriptor: RepositorySkillDescriptor) => void | Promise<void>;
  onOpenSkillInstall: (descriptor: RepositorySkillDescriptor) => void;
  onToolLocalAssetAction: (
    descriptor: RepositoryToolDescriptor,
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddToolToLocal: (descriptor: RepositoryToolDescriptor) => void | Promise<void>;
  onEventSourceLocalAssetAction: (
    descriptor: RepositoryEventSourceDescriptor,
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddEventSourceToLocal: (descriptor: RepositoryEventSourceDescriptor) => void | Promise<void>;
  onPackageInstall: (descriptor: CapabilityPackageDescriptor, action: InstallAction) => void | Promise<void>;
  onPackageUninstall: (descriptor: CapabilityPackageDescriptor) => void | Promise<void>;
  onPluginAction: (record: RepositoryPluginDescriptor, action: "install" | "update", force?: boolean) => Promise<void>;
  onNavigate: (path: string) => void;
}

export function DiscoveryCatalogTabs({
  loading,
  actionKey,
  packageActionKey,
  filteredTools,
  filteredEventSources,
  filteredPackages,
  filteredSkills,
  filteredPlugins,
  onOpenToolDetail,
  onOpenEventSourceDetail,
  onOpenPackageDetail,
  onOpenSkillDetail,
  onOpenSkillInstall,
  onToolLocalAssetAction,
  onAddToolToLocal,
  onEventSourceLocalAssetAction,
  onAddEventSourceToLocal,
  onPackageInstall,
  onPackageUninstall,
  onPluginAction,
  onNavigate
}: DiscoveryCatalogTabsProps) {
  const toolColumns: ColumnsType<RepositoryToolDescriptor> = [
    {
      title: "脚本资产",
      key: "tool",
      render: (_value: unknown, record) => (
        <Space wrap size={[8, 8]}>
          <TableLinkCell onClick={() => void onOpenToolDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{localAssetId(record)}</Text>
        </Space>
      )
    },
    {
      title: "来源",
      key: "repositoryId",
      width: 260,
      render: (_value: unknown, record) => (
        <Space size={[4, 4]}>
          <Text>{record.repositoryId}</Text>
          {isTrackedLocal(record) ? <Tag color="purple">跟踪本地资产</Tag> : null}
          <TrustLevelTag level={record.trusted ? "TRUSTED" : "UNTRUSTED"} />
        </Space>
      )
    },
    {
      title: "版本",
      key: "version",
      width: 150,
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.version}</Text>
          {record.localState?.version ? <Text type="secondary">本地 {record.localState.version}</Text> : null}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          {isTrackedLocal(record) ? (
            <Button
              size="small"
              type={record.localState?.syncState === "REMOTE_CHANGES" ? "primary" : "default"}
              danger={record.localState?.syncState === "DIVERGED"}
              ghost={record.localState?.syncState === "REMOTE_CHANGES"}
              icon={<SyncOutlined />}
              onClick={() => onNavigate(`/scripts/${localAssetId(record)}`)}
            >
              {getUpstreamActionLabel(record.localState?.syncState)}
            </Button>
          ) : isLockedLocal(record) ? (
            <Button
              size="small"
              type={record.localState?.updateAvailable ? "primary" : "default"}
              ghost={record.localState?.updateAvailable}
              icon={<SyncOutlined />}
              disabled={!record.localState?.updateAvailable}
              loading={actionKey === `update-local:${record.repositoryId}:${record.toolId}`}
              onClick={() => void onToolLocalAssetAction(record, "update-local")}
            >
              {record.localState?.updateAvailable ? "更新" : "已添加"}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.toolId}`}
              onClick={() => void onAddToolToLocal(record)}
            >
              添加到本地
            </Button>
          )}
        </Space>
      )
    }
  ];

  const capabilityPackageColumns: ColumnsType<CapabilityPackageDescriptor> = [
    {
      title: "能力包",
      key: "package",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell onClick={() => void onOpenPackageDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{record.repositoryId}/{record.packageId}</Text>
        </Space>
      )
    },
    {
      title: "入口",
      key: "entries",
      width: 260,
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          {record.entries.length > 0 ? (
            <>
              <Text code>{record.entries[0].target}</Text>
              {record.entries.length > 1 ? <Text type="secondary">共 {record.entries.length} 个入口</Text> : null}
            </>
          ) : (
            <Text type="secondary">未声明</Text>
          )}
        </Space>
      )
    },
    {
      title: "版本",
      key: "version",
      width: 150,
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.version}</Text>
          {record.installedVersion ? <Text type="secondary">已装 {record.installedVersion}</Text> : null}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          {record.installed ? (
            <>
              <Button
                size="small"
                type={record.updateAvailable ? "primary" : "default"}
                ghost={record.updateAvailable}
                disabled={!record.updateAvailable}
                loading={packageActionKey === `update:${record.repositoryId}:${record.packageId}`}
                onClick={() => void onPackageInstall(record, "update")}
              >
                {record.updateAvailable ? "更新" : "已安装"}
              </Button>
              <Button
                size="small"
                danger
                loading={packageActionKey === `uninstall:${record.repositoryId}:${record.packageId}`}
                onClick={() => void onPackageUninstall(record)}
              >
                卸载
              </Button>
            </>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={packageActionKey === `install:${record.repositoryId}:${record.packageId}`}
              onClick={() => void onPackageInstall(record, "install")}
            >
              安装
            </Button>
          )}
        </Space>
      )
    }
  ];

  const eventSourceColumns: ColumnsType<RepositoryEventSourceDescriptor> = [
    {
      title: "事件源",
      key: "eventSource",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell onClick={() => void onOpenEventSourceDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{localAssetId(record)}</Text>
        </Space>
      )
    },
    {
      title: "来源",
      key: "repositoryId",
      width: 260,
      render: (_value: unknown, record) => (
        <Space size={[4, 4]}>
          <Text>{record.repositoryId}</Text>
          {isTrackedLocal(record) ? <Tag color="purple">跟踪本地资产</Tag> : null}
          <TrustLevelTag level={record.trusted ? "TRUSTED" : "UNTRUSTED"} />
        </Space>
      )
    },
    {
      title: "版本",
      key: "version",
      width: 150,
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.version}</Text>
          {record.localState?.version ? <Text type="secondary">本地 {record.localState.version}</Text> : null}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          {isTrackedLocal(record) ? (
            <Button
              size="small"
              type={record.localState?.syncState === "REMOTE_CHANGES" ? "primary" : "default"}
              danger={record.localState?.syncState === "DIVERGED"}
              ghost={record.localState?.syncState === "REMOTE_CHANGES"}
              icon={<SyncOutlined />}
              onClick={() => onNavigate("/triggers")}
            >
              {getUpstreamActionLabel(record.localState?.syncState)}
            </Button>
          ) : isLockedLocal(record) ? (
            <Button
              size="small"
              type={record.localState?.updateAvailable ? "primary" : "default"}
              ghost={record.localState?.updateAvailable}
              icon={<SyncOutlined />}
              disabled={!record.localState?.updateAvailable}
              loading={actionKey === `update-local:${record.repositoryId}:${record.eventSourceId}`}
              onClick={() => void onEventSourceLocalAssetAction(record, "update-local")}
            >
              {record.localState?.updateAvailable ? "更新" : "已添加"}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.eventSourceId}`}
              onClick={() => void onAddEventSourceToLocal(record)}
            >
              添加到本地
            </Button>
          )}
        </Space>
      )
    }
  ];

  const skillColumns: ColumnsType<RepositorySkillDescriptor> = [
    {
      title: "Skill",
      key: "skill",
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell onClick={() => void onOpenSkillDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{record.repositoryId}/{record.skillId}</Text>
        </Space>
      )
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 140
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      render: (value?: string) => value || <Text type="secondary">-</Text>
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value, record) => (
        <Space wrap size={[4, 4]}>
          <Button size="small" onClick={() => void onOpenSkillDetail(record)}>
            查看
          </Button>
          <Button
            size="small"
            type={record.updateAvailable ? "primary" : "default"}
            ghost={record.updateAvailable}
            disabled={record.installed && !record.updateAvailable}
            onClick={() => onOpenSkillInstall(record)}
          >
            {getSkillInstallLabel(record)}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Tabs
      defaultActiveKey="scripts"
      items={[
        {
          key: "scripts",
          label: `脚本 (${filteredTools.length})`,
          children: (
            <Table<RepositoryToolDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.toolId}`}
              loading={loading}
              columns={toolColumns}
              dataSource={filteredTools}
              scroll={{ x: 1200 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的脚本。先到仓库管理页添加并同步仓库。"
                  />
                )
              }}
            />
          )
        },
        {
          key: "event-sources",
          label: `事件源 (${filteredEventSources.length})`,
          children: (
            <Table<RepositoryEventSourceDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.eventSourceId}`}
              loading={loading}
              columns={eventSourceColumns}
              dataSource={filteredEventSources}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的事件源。先到仓库管理页添加并同步仓库。"
                  />
                )
              }}
            />
          )
        },
        {
          key: "packages",
          label: `能力包 (${filteredPackages.length})`,
          children: (
            <Table<CapabilityPackageDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.packageId}`}
              loading={loading}
              columns={capabilityPackageColumns}
              dataSource={filteredPackages}
              scroll={{ x: 960 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的能力包。"
                  />
                )
              }}
            />
          )
        },
        {
          key: "skills",
          label: `Skills (${filteredSkills.length})`,
          children: (
            <Table<RepositorySkillDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.skillId}`}
              loading={loading}
              columns={skillColumns}
              dataSource={filteredSkills}
              scroll={{ x: 900 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的 Skill。"
                  />
                )
              }}
            />
          )
        },
        {
          key: "plugins",
          label: `插件 (${filteredPlugins.length})`,
          children: renderRepositoryPlugins(filteredPlugins, actionKey, onPluginAction)
        }
      ]}
    />
  );
}
