import { Button, Empty, Space, Table, Tag, Typography } from "antd";
import { DownloadOutlined, SyncOutlined } from "@ant-design/icons";
import { MarkdownDescription } from "../../../../components/common/MarkdownDescription";
import type {
  CapabilityPackageDescriptor,
  PluginDependency,
  RepositoryAiPackageDependency,
  RepositoryWebhookDescriptor,
  RepositoryKnowledgeDescriptor,
  RepositoryPluginDescriptor,
  RepositorySkillDescriptor,
  RepositoryScriptDescriptor,
  ScriptDependency
} from "../../../../shared/types";
import type { InstallFilter, TrustFilter, TypeFilter } from "./types";

const { Text } = Typography;
export type DependencyToolLookup = Pick<RepositoryScriptDescriptor, "repositoryId" | "scriptId" | "displayName">;
export type DependencyPluginLookup = Pick<RepositoryPluginDescriptor, "repositoryId" | "pluginId" | "displayName">;

interface DependencyRenderOptions {
  currentRepositoryId?: string;
  availableTools?: DependencyToolLookup[];
  availablePlugins?: DependencyPluginLookup[];
}

function resolveScriptDependencyRepositoryId(
  dependency: ScriptDependency,
  currentRepositoryId?: string
): string {
  return dependency.repositoryId || currentRepositoryId || "";
}

function resolveScriptDependencyName(
  dependency: ScriptDependency,
  options?: DependencyRenderOptions
): string | undefined {
  const repositoryId = resolveScriptDependencyRepositoryId(dependency, options?.currentRepositoryId);
  return options?.availableTools?.find(
    (tool) => tool.repositoryId === repositoryId && tool.scriptId === dependency.repositoryScriptId
  )?.displayName;
}

function resolvePluginDependencyName(
  dependency: PluginDependency,
  options?: DependencyRenderOptions
): string | undefined {
  if (!options?.currentRepositoryId) {
    return undefined;
  }
  return options.availablePlugins?.find(
    (plugin) => plugin.repositoryId === options.currentRepositoryId && plugin.pluginId === dependency.pluginId
  )?.displayName;
}

export function isLocalTool(record: RepositoryScriptDescriptor): boolean {
  return Boolean(record.localState);
}

export function isLocalWebhook(record: RepositoryWebhookDescriptor): boolean {
  return Boolean(record.localState);
}

export function localAssetId(record: RepositoryScriptDescriptor | RepositoryWebhookDescriptor): string {
  return record.localState?.localAssetId ?? ("scriptId" in record ? record.scriptId : record.webhookId);
}

export function isTrackedLocal(record: RepositoryScriptDescriptor | RepositoryWebhookDescriptor): boolean {
  return record.localState?.mode === "TRACKED";
}

export function isLockedLocal(record: RepositoryScriptDescriptor | RepositoryWebhookDescriptor): boolean {
  return record.localState?.mode === "LOCKED";
}

export function getSkillInstallLabel(record: RepositorySkillDescriptor): string {
  if (!record.installed) {
    return "安装 Skill";
  }
  return record.updateAvailable ? "更新 Skill" : "已安装";
}

function normalizeKeyword(keyword: string): string[] {
  return keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesKeyword(keyword: string, parts: Array<string | undefined>): boolean {
  const tokens = normalizeKeyword(keyword);
  if (tokens.length === 0) {
    return true;
  }
  const haystack = parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function matchesRepositoryFilter(repositoryId: string, repositoryFilter: string): boolean {
  return repositoryFilter === "ALL" || repositoryId === repositoryFilter;
}

function matchesInstallFilter(installed: boolean, installFilter: InstallFilter): boolean {
  if (installFilter === "INSTALLED") {
    return installed;
  }
  if (installFilter === "NOT_INSTALLED") {
    return !installed;
  }
  return true;
}

function matchesTrustFilter(trusted: boolean, trustFilter: TrustFilter): boolean {
  if (trustFilter === "TRUSTED") {
    return trusted;
  }
  if (trustFilter === "UNTRUSTED") {
    return !trusted;
  }
  return true;
}

function matchesTypeFilter(type: string, typeFilter: TypeFilter): boolean {
  return typeFilter === "ALL" || type === typeFilter;
}

export function filterRepositoryTools(
  tools: RepositoryScriptDescriptor[],
  filters: {
    searchText: string;
    repositoryFilter: string;
    typeFilter: TypeFilter;
    installFilter: InstallFilter;
    trustFilter: TrustFilter;
  }
): RepositoryScriptDescriptor[] {
  return tools.filter((tool) => {
    if (!matchesRepositoryFilter(tool.repositoryId, filters.repositoryFilter)) {
      return false;
    }
    if (!matchesTypeFilter(tool.type, filters.typeFilter)) {
      return false;
    }
    if (!matchesInstallFilter(isLocalTool(tool), filters.installFilter)) {
      return false;
    }
    if (!matchesTrustFilter(tool.trusted, filters.trustFilter)) {
      return false;
    }
    return matchesKeyword(filters.searchText, [
      tool.displayName,
      tool.scriptId,
      tool.localState?.localAssetId,
      tool.description,
      tool.owner,
      tool.repositoryId
    ]);
  });
}

export function filterCapabilityPackages(
  packages: CapabilityPackageDescriptor[],
  filters: {
    searchText: string;
    repositoryFilter: string;
    installFilter: InstallFilter;
    trustFilter: TrustFilter;
  }
): CapabilityPackageDescriptor[] {
  return packages.filter((item) => {
    if (!matchesRepositoryFilter(item.repositoryId, filters.repositoryFilter)) {
      return false;
    }
    if (!matchesInstallFilter(item.installed, filters.installFilter)) {
      return false;
    }
    if (!matchesTrustFilter(item.trusted, filters.trustFilter)) {
      return false;
    }
    return matchesKeyword(filters.searchText, [
      item.displayName,
      item.packageId,
      item.description,
      item.owner,
      item.repositoryId,
      ...item.tags
    ]);
  });
}

export function filterRepositoryWebhooks(
  webhooks: RepositoryWebhookDescriptor[],
  filters: {
    searchText: string;
    repositoryFilter: string;
    installFilter: InstallFilter;
    trustFilter: TrustFilter;
  }
): RepositoryWebhookDescriptor[] {
  return webhooks.filter((item) => {
    if (!matchesRepositoryFilter(item.repositoryId, filters.repositoryFilter)) {
      return false;
    }
    if (!matchesInstallFilter(isLocalWebhook(item), filters.installFilter)) {
      return false;
    }
    if (!matchesTrustFilter(item.trusted, filters.trustFilter)) {
      return false;
    }
    return matchesKeyword(filters.searchText, [
      item.displayName,
      item.webhookId,
      item.localState?.localAssetId,
      item.description,
      item.owner,
      item.repositoryId
    ]);
  });
}

export function filterRepositorySkills(
  skills: RepositorySkillDescriptor[],
  filters: {
    searchText: string;
    repositoryFilter: string;
    trustFilter: TrustFilter;
  }
): RepositorySkillDescriptor[] {
  return skills.filter((item) => {
    if (!matchesRepositoryFilter(item.repositoryId, filters.repositoryFilter)) {
      return false;
    }
    if (!matchesTrustFilter(item.trusted, filters.trustFilter)) {
      return false;
    }
    return matchesKeyword(filters.searchText, [
      item.displayName,
      item.skillId,
      item.description,
      item.owner,
      item.repositoryId
    ]);
  });
}

export function filterRepositoryPlugins(
  plugins: RepositoryPluginDescriptor[],
  filters: {
    searchText: string;
    repositoryFilter: string;
    installFilter: InstallFilter;
    trustFilter: TrustFilter;
  }
): RepositoryPluginDescriptor[] {
  return plugins.filter((item) => {
    if (!matchesRepositoryFilter(item.repositoryId, filters.repositoryFilter)) {
      return false;
    }
    if (!matchesInstallFilter(item.installed, filters.installFilter)) {
      return false;
    }
    if (!matchesTrustFilter(item.trusted, filters.trustFilter)) {
      return false;
    }
    return matchesKeyword(filters.searchText, [
      item.displayName,
      item.pluginId,
      item.description,
      item.owner,
      item.repositoryId,
      ...item.tags
    ]);
  });
}

export function filterRepositoryKnowledge(
  knowledge: RepositoryKnowledgeDescriptor[],
  filters: {
    searchText: string;
    repositoryFilter: string;
    installFilter: InstallFilter;
    trustFilter: TrustFilter;
  }
): RepositoryKnowledgeDescriptor[] {
  return knowledge.filter((item) => {
    if (!matchesRepositoryFilter(item.repositoryId, filters.repositoryFilter)) {
      return false;
    }
    if (!matchesInstallFilter(item.installed, filters.installFilter)) {
      return false;
    }
    if (!matchesTrustFilter(item.trusted, filters.trustFilter)) {
      return false;
    }
    return matchesKeyword(filters.searchText, [
      item.displayName,
      item.knowledgeId,
      item.description,
      item.repositoryId,
      ...item.tags
    ]);
  });
}

export function renderPluginDependencies(
  dependencies: PluginDependency[],
  options?: DependencyRenderOptions
) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该脚本没有声明插件依赖" />;
  }

  return (
    <Table<PluginDependency>
      rowKey="pluginId"
      size="small"
      pagination={false}
      dataSource={dependencies}
      columns={[
        {
          title: "插件",
          key: "plugin",
          render: (_value: unknown, record) => {
            const name = resolvePluginDependencyName(record, options);
            return (
              <Space direction="vertical" size={2}>
                {name ? <Text strong>{name}</Text> : null}
                <Text code>{record.pluginId}</Text>
              </Space>
            );
          }
        },
        {
          title: "版本要求",
          dataIndex: "versionRange",
          key: "versionRange",
          render: (value?: string) => value ? <Tag color="blue">{value}</Tag> : <Tag>未锁定版本</Tag>
        },
        {
          title: "动作",
          dataIndex: "requiredActions",
          key: "requiredActions",
          render: (actions: string[]) => (
            <Space wrap size={[4, 4]}>
              {actions.length > 0 ? actions.map((action) => <Tag key={action}>{action}</Tag>) : <Text type="secondary">未声明</Text>}
            </Space>
          )
        }
      ]}
    />
  );
}

export function renderScriptDependencies(
  dependencies: ScriptDependency[],
  options?: DependencyRenderOptions
) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该脚本没有声明脚本依赖" />;
  }

  return (
    <Table<ScriptDependency>
      rowKey={(item) => `${item.scriptId}:${item.repositoryId}:${item.repositoryScriptId}`}
      size="small"
      pagination={false}
      dataSource={dependencies}
      columns={[
        {
          title: "依赖脚本",
          key: "script",
          render: (_value: unknown, record) => {
            const name = resolveScriptDependencyName(record, options);
            return (
              <Space direction="vertical" size={2}>
                {name ? <Text strong>{name}</Text> : null}
                <Text code>{record.scriptId}</Text>
              </Space>
            );
          }
        },
        {
          title: "仓库脚本",
          key: "target",
          render: (_value: unknown, record) => {
            const repositoryId = resolveScriptDependencyRepositoryId(record, options?.currentRepositoryId);
            return <Text code>{`${repositoryId}/${record.repositoryScriptId}`}</Text>;
          }
        },
        {
          title: "版本要求",
          dataIndex: "versionRange",
          key: "versionRange",
          render: (value?: string) => value ? <Tag color="blue">{value}</Tag> : <Tag>未锁定版本</Tag>
        }
      ]}
    />
  );
}

export function renderExternalDependencies(dependencies: RepositoryAiPackageDependency[]) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该能力包没有外部依赖" />;
  }

  return (
    <Table<RepositoryAiPackageDependency>
      rowKey={(item) => `${item.assetType}:${item.repositoryId}:${item.assetId}`}
      size="small"
      pagination={false}
      dataSource={dependencies}
      columns={[
        { title: "类型", dataIndex: "assetType", key: "assetType" },
        { title: "仓库", dataIndex: "repositoryId", key: "repositoryId", render: (value?: string) => value || "-" },
        { title: "资产", dataIndex: "assetId", key: "assetId" },
        { title: "版本", dataIndex: "version", key: "version", render: (value?: string) => value || "-" }
      ]}
    />
  );
}

export function renderRepositoryPlugins(
  plugins: RepositoryPluginDescriptor[],
  actionKey: string | null,
  onAction: (record: RepositoryPluginDescriptor, action: "install" | "update", force?: boolean) => Promise<void>
) {
  if (plugins.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可发现的插件。先到仓库管理页添加并同步仓库。" />;
  }

  return (
    <Table<RepositoryPluginDescriptor>
      rowKey={(item) => `${item.repositoryId}:${item.pluginId}`}
      loading={false}
      size="small"
      pagination={{ pageSize: 10, showSizeChanger: true }}
      dataSource={plugins}
      scroll={{ x: 980 }}
      columns={[
        {
          title: "插件",
          key: "plugin",
          render: (_value, record) => (
            <Space direction="vertical" size={2}>
              <Space wrap size={[8, 8]}>
                <Text strong>{record.displayName || record.pluginId}</Text>
                <Text code>{record.pluginId}</Text>
              </Space>
              <Text type="secondary">{record.description || "未填写描述"}</Text>
              {record.releaseNotes ? (
                <MarkdownDescription value={record.releaseNotes} className="markdown-description--compact" />
              ) : null}
            </Space>
          )
        },
        {
          title: "来源",
          key: "repository",
          width: 150,
          render: (_value, record) => (
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
          render: (_value, record) => (
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
          render: (_value, record) => (
            <Space direction="vertical" size={2}>
              {record.installed ? <Tag color="blue">已安装</Tag> : <Tag>未安装</Tag>}
              {record.updateAvailable ? <Tag color="processing">可更新</Tag> : null}
              {record.dependentToolCount > 0 ? <Tag color="purple">{record.dependentToolCount} 个脚本依赖</Tag> : null}
            </Space>
          )
        },
        {
          title: "操作",
          key: "actions",
          width: 180,
          render: (_value, record) => (
            record.installed ? (
              <Button
                size="small"
                icon={<SyncOutlined />}
                type={record.updateAvailable ? "primary" : "default"}
                ghost={record.updateAvailable}
                disabled={!record.updateAvailable}
                loading={actionKey === `update:${record.repositoryId}:${record.pluginId}`}
                onClick={() => void onAction(record, "update")}
              >
                更新
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                icon={<DownloadOutlined />}
                loading={actionKey === `install:${record.repositoryId}:${record.pluginId}`}
                onClick={() => void onAction(record, "install")}
              >
                安装
              </Button>
            )
          )
        }
      ]}
    />
  );
}
