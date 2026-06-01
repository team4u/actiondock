import { Button, Empty, Space, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined, SyncOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { TableLinkCell } from "../../../../components/common/TableLinkCell";
import { TrustLevelTag } from "../../../../components/domain/TrustLevelTag";
import { getUpstreamActionLabel } from "../../../../components/domain/UpstreamSyncTag";
import type {
  CapabilityPackageDescriptor,
  InstalledResourceView,
  RepositoryKnowledgeDescriptor,
  RepositoryPlaybookDescriptor,
  RepositoryWebhookDescriptor,
  RepositoryPluginDescriptor,
  RepositorySkillDescriptor,
  RepositoryScriptDescriptor
} from "../../../../shared/types";
import {
  getSkillInstallLabel,
  isLocalWebhook,
  isLocalPlaybook,
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
  knowledgeActionKey: string | null;
  installedResourceActionKey: string | null;
  filteredTools: RepositoryScriptDescriptor[];
  filteredWebhooks: RepositoryWebhookDescriptor[];
  filteredPlaybooks: RepositoryPlaybookDescriptor[];
  filteredPackages: CapabilityPackageDescriptor[];
  filteredSkills: RepositorySkillDescriptor[];
  filteredPlugins: RepositoryPluginDescriptor[];
  filteredKnowledge: RepositoryKnowledgeDescriptor[];
  filteredInstalledResources: InstalledResourceView[];
  onOpenToolDetail: (descriptor: RepositoryScriptDescriptor) => void | Promise<void>;
  onOpenWebhookDetail: (descriptor: RepositoryWebhookDescriptor) => void | Promise<void>;
  onOpenPlaybookDetail: (descriptor: RepositoryPlaybookDescriptor) => void | Promise<void>;
  onOpenPackageDetail: (descriptor: CapabilityPackageDescriptor) => void | Promise<void>;
  onOpenSkillDetail: (descriptor: RepositorySkillDescriptor) => void | Promise<void>;
  onOpenSkillInstall: (descriptor: RepositorySkillDescriptor) => void;
  onOpenKnowledgeDetail: (descriptor: RepositoryKnowledgeDescriptor) => void | Promise<void>;
  onToolLocalAssetAction: (
    descriptor: RepositoryScriptDescriptor,
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddToolToLocal: (descriptor: RepositoryScriptDescriptor) => void | Promise<void>;
  onWebhookLocalAssetAction: (
    descriptor: RepositoryWebhookDescriptor,
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddWebhookToLocal: (descriptor: RepositoryWebhookDescriptor) => void | Promise<void>;
  onPlaybookLocalAssetAction: (descriptor: RepositoryPlaybookDescriptor, action: LocalAssetAction) => void | Promise<void>;
  onPlaybookInstall: (descriptor: RepositoryPlaybookDescriptor) => void | Promise<void>;
  onPlaybookUninstall: (descriptor: RepositoryPlaybookDescriptor) => void | Promise<void>;
  onPackageInstall: (descriptor: CapabilityPackageDescriptor, action: InstallAction) => void | Promise<void>;
  onPackageUninstall: (descriptor: CapabilityPackageDescriptor) => void | Promise<void>;
  onPluginAction: (record: RepositoryPluginDescriptor, action: "install" | "update", force?: boolean) => Promise<void>;
  onKnowledgeInstall: (descriptor: RepositoryKnowledgeDescriptor) => void | Promise<void>;
  onKnowledgeUninstall: (descriptor: RepositoryKnowledgeDescriptor) => void | Promise<void>;
  onInstalledResourceUninstall: (resource: InstalledResourceView) => void | Promise<void>;
  onNavigate: (path: string) => void;
}

const installedResourceTypeLabels: Record<InstalledResourceView["type"], string> = {
  SCRIPT: "脚本",
  WEBHOOK: "Webhook",
  PLAYBOOK: "任务手册",
  CONFIG_VALUE: "配置",
  CAPABILITY_PACKAGE: "能力包",
  KNOWLEDGE: "知识源",
  SKILL: "Skill",
  PLUGIN: "插件"
};

export function DiscoveryCatalogTabs({
  loading,
  actionKey,
  packageActionKey,
  knowledgeActionKey,
  installedResourceActionKey,
  filteredTools,
  filteredWebhooks,
  filteredPlaybooks,
  filteredPackages,
  filteredSkills,
  filteredPlugins,
  filteredKnowledge,
  filteredInstalledResources,
  onOpenToolDetail,
  onOpenWebhookDetail,
  onOpenPlaybookDetail,
  onOpenPackageDetail,
  onOpenSkillDetail,
  onOpenSkillInstall,
  onOpenKnowledgeDetail,
  onToolLocalAssetAction,
  onAddToolToLocal,
  onWebhookLocalAssetAction,
  onAddWebhookToLocal,
  onPlaybookLocalAssetAction,
  onPlaybookInstall,
  onPlaybookUninstall,
  onPackageInstall,
  onPackageUninstall,
  onPluginAction,
  onKnowledgeInstall,
  onKnowledgeUninstall,
  onInstalledResourceUninstall,
  onNavigate
}: DiscoveryCatalogTabsProps) {
  const toolColumns: ColumnsType<RepositoryScriptDescriptor> = [
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
              loading={actionKey === `update-local:${record.repositoryId}:${record.scriptId}`}
              onClick={() => void onToolLocalAssetAction(record, "update-local")}
            >
              {record.localState?.updateAvailable ? "更新" : "已添加"}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.scriptId}`}
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

  const webhookColumns: ColumnsType<RepositoryWebhookDescriptor> = [
    {
      title: "Webhook",
      key: "webhook",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell onClick={() => void onOpenWebhookDetail(record)}>{record.displayName}</TableLinkCell>
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
              onClick={() => onNavigate("/webhooks")}
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
              loading={actionKey === `update-local:${record.repositoryId}:${record.webhookId}`}
              onClick={() => void onWebhookLocalAssetAction(record, "update-local")}
            >
              {record.localState?.updateAvailable ? "更新" : "已添加"}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.webhookId}`}
              onClick={() => void onAddWebhookToLocal(record)}
            >
              添加到本地
            </Button>
          )}
        </Space>
      )
    }
  ];

  const playbookColumns: ColumnsType<RepositoryPlaybookDescriptor> = [
    {
      title: "任务手册",
      key: "playbook",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell onClick={() => void onOpenPlaybookDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{localAssetId(record)}</Text>
        </Space>
      )
    },

    {
      title: "来源",
      key: "repositoryId",
      width: 240,
      render: (_value: unknown, record) => (
        <Space size={[4, 4]}>
          <Text>{record.repositoryId}</Text>
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
      width: 220,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          {isLocalPlaybook(record) ? (
            <>
              <Button
                size="small"
                type={record.localState?.updateAvailable ? "primary" : "default"}
                ghost={record.localState?.updateAvailable}
                icon={<SyncOutlined />}
                disabled={!record.localState?.updateAvailable}
                loading={actionKey === `update-local:${record.repositoryId}:${record.playbookId}`}
                onClick={() => void onPlaybookLocalAssetAction(record, "update-local")}
              >
                {record.localState?.updateAvailable ? "更新" : "已安装"}
              </Button>
              <Button
                size="small"
                danger
                loading={actionKey === `uninstall:${record.repositoryId}:${record.playbookId}`}
                onClick={() => void onPlaybookUninstall(record)}
              >
                卸载
              </Button>
            </>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.playbookId}`}
              onClick={() => void onPlaybookInstall(record)}
            >
              安装
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

  const knowledgeColumns: ColumnsType<RepositoryKnowledgeDescriptor> = [
    {
      title: "知识源",
      key: "knowledge",
      width: "25%",
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell onClick={() => void onOpenKnowledgeDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{record.repositoryId}/{record.knowledgeId}</Text>
        </Space>
      )
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      width: "45%",
      render: (value?: string) => value || <Text type="secondary">-</Text>
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value, record) => (
        <Space wrap size={[4, 4]}>
          <Button size="small" onClick={() => void onOpenKnowledgeDetail(record)}>
            查看
          </Button>
          {record.installed ? (
            <Button
              size="small"
              danger
              loading={knowledgeActionKey === `uninstall:${record.repositoryId}:${record.knowledgeId}`}
              onClick={() => void onKnowledgeUninstall(record)}
            >
              卸载
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={knowledgeActionKey === `install:${record.repositoryId}:${record.knowledgeId}`}
              onClick={() => void onKnowledgeInstall(record)}
            >
              安装
            </Button>
          )}
        </Space>
      )
    }
  ];

  const installedResourceColumns: ColumnsType<InstalledResourceView> = [
    {
      title: "资源",
      key: "resource",
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[8, 8]}>
            <Text strong>{record.displayName}</Text>
            <Text code>{record.id}</Text>
          </Space>
          {record.description ? <Text type="secondary">{record.description}</Text> : null}
        </Space>
      )
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 130,
      render: (value: InstalledResourceView["type"]) => <Tag>{installedResourceTypeLabels[value] ?? value}</Tag>
    },
    {
      title: "来源",
      key: "repository",
      width: 260,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          {record.repositoryId ? (
            <Space wrap size={[4, 4]}>
              <Text>{record.repositoryName || record.repositoryId}</Text>
              {record.orphan ? <Tag color="red">来源仓库已删除</Tag> : null}
            </Space>
          ) : (
            <Text type="secondary">未记录来源</Text>
          )}
          {record.upstreamId ? <Text code>{record.upstreamId}</Text> : null}
        </Space>
      )
    },
    {
      title: "版本",
      key: "version",
      width: 150,
      render: (_value, record) => record.version ? <Text>{record.version}</Text> : <Text type="secondary">-</Text>
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_value, record) => (
        <Button
          size="small"
          danger
          loading={installedResourceActionKey === `uninstall:${record.type}:${record.id}`}
          onClick={() => void onInstalledResourceUninstall(record)}
        >
          卸载
        </Button>
      )
    }
  ];

  return (
    <Tabs
      defaultActiveKey="installed"
      items={[
        {
          key: "installed",
          label: `已安装 (${filteredInstalledResources.length})`,
          children: (
            <Table<InstalledResourceView>
              rowKey={(item) => `${item.type}:${item.id}`}
              loading={loading}
              columns={installedResourceColumns}
              dataSource={filteredInstalledResources}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有匹配的已安装资源。"
                  />
                )
              }}
            />
          )
        },
        {
          key: "scripts",
          label: `脚本 (${filteredTools.length})`,
          children: (
            <Table<RepositoryScriptDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.scriptId}`}
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
          key: "playbooks",
          label: `任务手册 (${filteredPlaybooks.length})`,
          children: (
            <Table<RepositoryPlaybookDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.playbookId}`}
              loading={loading}
              columns={playbookColumns}
              dataSource={filteredPlaybooks}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的任务手册。"
                  />
                )
              }}
            />
          )
        },
        {
          key: "knowledge",
          label: `知识源 (${filteredKnowledge.length})`,
          children: (
            <Table<RepositoryKnowledgeDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.knowledgeId}`}
              loading={loading}
              columns={knowledgeColumns}
              dataSource={filteredKnowledge}
              scroll={{ x: 900 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的知识源。"
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
        },
        {
          key: "webhooks",
          label: `Webhook (${filteredWebhooks.length})`,
          children: (
            <Table<RepositoryWebhookDescriptor>
              rowKey={(item) => `${item.repositoryId}:${item.webhookId}`}
              loading={loading}
              columns={webhookColumns}
              dataSource={filteredWebhooks}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前没有可发现的Webhook。先到仓库管理页添加并同步仓库。"
                  />
                )
              }}
            />
          )
        }
      ]}
    />
  );
}
