import { Button, Descriptions, Drawer, Empty, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { CodeEditor } from "../../../../components/common/CodeEditor";
import { MarkdownDescription } from "../../../../components/common/MarkdownDescription";
import { RiskLevelTag } from "../../../../components/domain/RiskLevelTag";
import { TrustLevelTag } from "../../../../components/domain/TrustLevelTag";
import { UpstreamSyncTag, getUpstreamActionLabel } from "../../../../components/domain/UpstreamSyncTag";
import type {
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  RepositoryWebhookDescriptor,
  RepositoryWebhookDetail,
  RepositoryKnowledgeDescriptor,
  RepositoryKnowledgeDetail,
  RepositoryPlaybookDescriptor,
  RepositoryPlaybookDetail,
  RepositoryPluginDescriptor,
  RepositorySkillDetail,
  RepositoryScriptDescriptor,
  RepositoryScriptDetail
} from "../../../../shared/types";
import { getScriptTypeLabel } from "../../../../components/domain/typeLabels";
import {
  getSkillInstallLabel,
  isLocalWebhook,
  isLocalPlaybook,
  isLocalTool,
  isLockedLocal,
  isTrackedLocal,
  localAssetId,
  renderExternalDependencies,
  renderPluginDependencies,
  renderScriptDependencies
} from "./discoveryHelpers";
import type { AddMode, InstallAction, LocalAssetAction } from "./types";

const { Text } = Typography;

interface DiscoveryDetailDrawersProps {
  editorTheme: "vs-dark" | "vs-light";
  actionKey: string | null;
  packageActionKey: string | null;
  knowledgeActionKey: string | null;
  detailOpen: boolean;
  detailLoading: boolean;
  detail: RepositoryScriptDetail | null;
  availableTools: RepositoryScriptDescriptor[];
  availablePlugins: RepositoryPluginDescriptor[];
  webhookDetailOpen: boolean;
  webhookDetailLoading: boolean;
  webhookDetail: RepositoryWebhookDetail | null;
  playbookDetailOpen: boolean;
  playbookDetailLoading: boolean;
  playbookDetail: RepositoryPlaybookDetail | null;
  packageDetailOpen: boolean;
  packageDetailLoading: boolean;
  packageDetail: CapabilityPackageDetail | null;
  skillDetailOpen: boolean;
  skillDetailLoading: boolean;
  skillDetail: RepositorySkillDetail | null;
  knowledgeDetailOpen: boolean;
  knowledgeDetailLoading: boolean;
  knowledgeDetail: RepositoryKnowledgeDetail | null;
  onCloseToolDetail: () => void;
  onCloseWebhookDetail: () => void;
  onClosePlaybookDetail: () => void;
  onClosePackageDetail: () => void;
  onCloseSkillDetail: () => void;
  onCloseKnowledgeDetail: () => void;
  onOpenSkillInstall: (descriptor: RepositorySkillDetail["descriptor"]) => void;
  onToolLocalAssetAction: (
    descriptor: RepositoryScriptDetail["descriptor"],
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddToolToLocal: (descriptor: RepositoryScriptDetail["descriptor"]) => void | Promise<void>;
  onWebhookLocalAssetAction: (
    descriptor: RepositoryWebhookDetail["descriptor"],
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddWebhookToLocal: (descriptor: RepositoryWebhookDetail["descriptor"]) => void | Promise<void>;
  onPlaybookLocalAssetAction: (descriptor: RepositoryPlaybookDescriptor, action: LocalAssetAction) => void | Promise<void>;
  onPlaybookInstall: (descriptor: RepositoryPlaybookDescriptor) => void | Promise<void>;
  onPlaybookUninstall: (descriptor: RepositoryPlaybookDescriptor) => void | Promise<void>;
  onPackageInstall: (descriptor: CapabilityPackageDescriptor, action: InstallAction) => void | Promise<void>;
  onPackageUninstall: (descriptor: CapabilityPackageDescriptor) => void | Promise<void>;
  onKnowledgeInstall: (descriptor: RepositoryKnowledgeDescriptor) => void | Promise<void>;
  onKnowledgeUninstall: (descriptor: RepositoryKnowledgeDescriptor) => void | Promise<void>;
  onNavigate: (path: string) => void;
}

export function DiscoveryDetailDrawers({
  editorTheme,
  actionKey,
  packageActionKey,
  knowledgeActionKey,
  detailOpen,
  detailLoading,
  detail,
  availableTools,
  availablePlugins,
  webhookDetailOpen,
  webhookDetailLoading,
  webhookDetail,
  playbookDetailOpen,
  playbookDetailLoading,
  playbookDetail,
  packageDetailOpen,
  packageDetailLoading,
  packageDetail,
  skillDetailOpen,
  skillDetailLoading,
  skillDetail,
  knowledgeDetailOpen,
  knowledgeDetailLoading,
  knowledgeDetail,
  onCloseToolDetail,
  onCloseWebhookDetail,
  onClosePlaybookDetail,
  onClosePackageDetail,
  onCloseSkillDetail,
  onCloseKnowledgeDetail,
  onOpenSkillInstall,
  onToolLocalAssetAction,
  onAddToolToLocal,
  onWebhookLocalAssetAction,
  onAddWebhookToLocal,
  onPlaybookLocalAssetAction,
  onPlaybookInstall,
  onPlaybookUninstall,
  onPackageInstall,
  onPackageUninstall,
  onKnowledgeInstall,
  onKnowledgeUninstall,
  onNavigate
}: DiscoveryDetailDrawersProps) {
  const packageDrawerActions = packageDetail ? (
    <Space>
      {packageDetail.descriptor.installed ? (
        <>
          <Button
            type={packageDetail.descriptor.updateAvailable ? "primary" : "default"}
            ghost={packageDetail.descriptor.updateAvailable}
            disabled={!packageDetail.descriptor.updateAvailable}
            loading={packageActionKey === `update:${packageDetail.descriptor.repositoryId}:${packageDetail.descriptor.packageId}`}
            onClick={() => void onPackageInstall(packageDetail.descriptor, "update")}
          >
            {packageDetail.descriptor.updateAvailable ? "更新能力包" : "已安装"}
          </Button>
          <Button
            danger
            loading={packageActionKey === `uninstall:${packageDetail.descriptor.repositoryId}:${packageDetail.descriptor.packageId}`}
            onClick={() => void onPackageUninstall(packageDetail.descriptor)}
          >
            卸载
          </Button>
        </>
      ) : (
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={packageActionKey === `install:${packageDetail.descriptor.repositoryId}:${packageDetail.descriptor.packageId}`}
          onClick={() => void onPackageInstall(packageDetail.descriptor, "install")}
        >
          安装能力包
        </Button>
      )}
    </Space>
  ) : null;

  return (
    <>
      <Drawer
        title={detail?.descriptor.displayName || "脚本资产详情"}
        open={detailOpen}
        onClose={onCloseToolDetail}
        width={920}
        destroyOnHidden
      >
        {detailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !detail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="脚本详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "tool", label: "脚本 ID", children: <Text code>{localAssetId(detail.descriptor)}</Text> },
                { key: "repo", label: "来源仓库", children: detail.descriptor.repositoryId },
                { key: "type", label: "类型", children: getScriptTypeLabel(detail.descriptor.type) },
                { key: "version", label: "远端版本", children: detail.descriptor.version },
                { key: "installedVersion", label: "本机版本", children: detail.descriptor.localState?.version || "-" },
                { key: "owner", label: "维护人", children: detail.descriptor.owner || "-" },
                { key: "risk", label: "风险等级", children: <RiskLevelTag level={detail.descriptor.riskLevel} /> },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={detail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> },
                { key: "syncState", label: "上游同步", children: isTrackedLocal(detail.descriptor) ? <UpstreamSyncTag state={detail.descriptor.localState?.syncState} /> : <Text type="secondary">-</Text> }
              ]}
            />

            <Space wrap size={[8, 8]}>
              {detail.descriptor.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
              {isLocalTool(detail.descriptor) ? <Tag color="blue">已添加</Tag> : <Tag>未添加</Tag>}
              {isTrackedLocal(detail.descriptor) ? <Tag color="purple">跟踪本地资产</Tag> : null}
              {detail.descriptor.localState?.updateAvailable ? <Tag color="processing">有更新</Tag> : null}
            </Space>

            <Space wrap size={[8, 8]}>
              {isTrackedLocal(detail.descriptor) ? (
                <Button onClick={() => onNavigate(`/scripts/${localAssetId(detail.descriptor)}`)}>
                  {getUpstreamActionLabel(detail.descriptor.localState?.syncState)}
                </Button>
              ) : isLockedLocal(detail.descriptor) ? (
                <Button
                  type={detail.descriptor.localState?.updateAvailable ? "primary" : "default"}
                  ghost={detail.descriptor.localState?.updateAvailable}
                  disabled={!detail.descriptor.localState?.updateAvailable}
                  loading={actionKey === `update-local:${detail.descriptor.repositoryId}:${detail.descriptor.scriptId}`}
                  onClick={() => void onToolLocalAssetAction(detail.descriptor, "update-local")}
                >
                  {detail.descriptor.localState?.updateAvailable ? "更新脚本" : "已添加"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={actionKey === `add-local:${detail.descriptor.repositoryId}:${detail.descriptor.scriptId}`}
                  onClick={() => void onAddToolToLocal(detail.descriptor)}
                >
                  添加到本地
                </Button>
              )}
            </Space>

            <Tabs
              items={[
                {
                  key: "description",
                  label: "说明",
                  children: (
                    <MarkdownDescription
                      value={detail.descriptor.description}
                      emptyText="该脚本没有填写说明。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "releaseNotes",
                  label: "发布日志",
                  children: (
                    <MarkdownDescription
                      value={detail.descriptor.releaseNotes}
                      emptyText="该版本没有填写发布日志。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "source",
                  label: "源码",
                  children: (
                    <CodeEditor
                      height="440px"
                      language={detail.descriptor.type === "PYTHON" ? "python" : "groovy"}
                      value={detail.source}
                      onChange={() => undefined}
                      theme={editorTheme}
                      readOnly={true}
                    />
                  )
                },
                {
                  key: "requirements",
                  label: "Python 依赖",
                  children: detail.descriptor.type === "PYTHON" ? (
                    detail.pythonRequirements ? (
                      <CodeEditor
                        height="240px"
                        language="plaintext"
                        value={detail.pythonRequirements}
                        onChange={() => undefined}
                        theme={editorTheme}
                        readOnly={true}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该脚本未声明 Python 依赖" />
                    )
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="仅 Python 脚本支持依赖声明" />
                  )
                },
                {
                  key: "config",
                  label: `配置模板 (${detail.configTemplate.length})`,
                  children: detail.configTemplate.length > 0 ? (
                    <Table
                      rowKey="key"
                      size="small"
                      pagination={false}
                      dataSource={detail.configTemplate}
                      columns={[
                        {
                          title: "配置键",
                          dataIndex: "key",
                          key: "key",
                          render: (value: string) => <Text code>{value}</Text>
                        },
                        {
                          title: "说明",
                          dataIndex: "label",
                          key: "label",
                          render: (value?: string) => value || "-"
                        },
                        {
                          title: "默认值",
                          dataIndex: "defaultValue",
                          key: "defaultValue",
                          render: (value: string | undefined, record: RepositoryScriptDetail["configTemplate"][number]) =>
                            record.secret ? <Tag color="volcano">仅占位，不带值</Tag> : (value || "-")
                        }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该脚本没有配置模板" />
                  )
                },
                {
                  key: "scripts",
                  label: `脚本依赖 (${detail.descriptor.scriptDependencies.length})`,
                  children: renderScriptDependencies(detail.descriptor.scriptDependencies, {
                    currentRepositoryId: detail.descriptor.repositoryId,
                    availableTools
                  })
                },
                {
                  key: "plugins",
                  label: `插件依赖 (${detail.descriptor.pluginDependencies.length})`,
                  children: renderPluginDependencies(detail.descriptor.pluginDependencies, {
                    currentRepositoryId: detail.descriptor.repositoryId,
                    availablePlugins
                  })
                },
                {
                  key: "schedules",
                  label: `定时模板 (${detail.scheduleTemplate.length})`,
                  children: detail.scheduleTemplate.length > 0 ? (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detail.scheduleTemplate}
                      columns={[
                        { title: "名称", dataIndex: "name", key: "name" },
                        {
                          title: "绑定脚本",
                          dataIndex: "scriptId",
                          key: "scriptId",
                          render: (value: string) => <Text code>{value}</Text>
                        },
                        { title: "Cron", dataIndex: "cronExpression", key: "cronExpression" },
                        {
                          title: "默认状态",
                          dataIndex: "enabledByDefault",
                          key: "enabledByDefault",
                          render: (value: boolean) => value ? <Tag color="processing">默认启用</Tag> : <Tag>默认停用</Tag>
                        }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该脚本没有定时任务模板" />
                  )
                }
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Drawer
        title={webhookDetail?.descriptor.displayName || "Webhook资产详情"}
        open={webhookDetailOpen}
        onClose={onCloseWebhookDetail}
        width={920}
        destroyOnHidden
      >
        {webhookDetailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !webhookDetail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Webhook详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "source", label: "Webhook ID", children: <Text code>{localAssetId(webhookDetail.descriptor)}</Text> },
                { key: "repo", label: "来源仓库", children: webhookDetail.descriptor.repositoryId },
                { key: "version", label: "远端版本", children: webhookDetail.descriptor.version },
                { key: "installedVersion", label: "本机版本", children: webhookDetail.descriptor.localState?.version || "-" },
                { key: "owner", label: "维护人", children: webhookDetail.descriptor.owner || "-" },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={webhookDetail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> },
                { key: "sync", label: "上游同步", children: isTrackedLocal(webhookDetail.descriptor) ? <UpstreamSyncTag state={webhookDetail.descriptor.localState?.syncState} /> : <Text type="secondary">-</Text> }
              ]}
            />

            <Space wrap size={[8, 8]}>
              {webhookDetail.descriptor.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              {isLocalWebhook(webhookDetail.descriptor) ? <Tag color="blue">已添加</Tag> : <Tag>未添加</Tag>}
              {isTrackedLocal(webhookDetail.descriptor) ? <Tag color="purple">跟踪本地资产</Tag> : null}
              {webhookDetail.descriptor.localState?.updateAvailable ? <Tag color="processing">有更新</Tag> : null}
            </Space>

            <Space wrap size={[8, 8]}>
              {isTrackedLocal(webhookDetail.descriptor) ? (
                <Button onClick={() => onNavigate("/webhooks")}>
                  {getUpstreamActionLabel(webhookDetail.descriptor.localState?.syncState)}
                </Button>
              ) : isLockedLocal(webhookDetail.descriptor) ? (
                <Button
                  type={webhookDetail.descriptor.localState?.updateAvailable ? "primary" : "default"}
                  ghost={webhookDetail.descriptor.localState?.updateAvailable}
                  disabled={!webhookDetail.descriptor.localState?.updateAvailable}
                  loading={actionKey === `update-local:${webhookDetail.descriptor.repositoryId}:${webhookDetail.descriptor.webhookId}`}
                  onClick={() => void onWebhookLocalAssetAction(webhookDetail.descriptor, "update-local")}
                >
                  {webhookDetail.descriptor.localState?.updateAvailable ? "更新Webhook" : "已添加"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={actionKey === `add-local:${webhookDetail.descriptor.repositoryId}:${webhookDetail.descriptor.webhookId}`}
                  onClick={() => void onAddWebhookToLocal(webhookDetail.descriptor)}
                >
                  添加到本地
                </Button>
              )}
            </Space>

            <Tabs
              items={[
                {
                  key: "description",
                  label: "说明",
                  children: (
                    <MarkdownDescription
                      value={webhookDetail.descriptor.description}
                      emptyText="该Webhook没有填写说明。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "releaseNotes",
                  label: "发布日志",
                  children: (
                    <MarkdownDescription
                      value={webhookDetail.descriptor.releaseNotes}
                      emptyText="该版本没有填写发布日志。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "transport",
                  label: "接入配置",
                  children: (
                    <Descriptions bordered size="small" column={2}>
                      <Descriptions.Item label="Transport">{webhookDetail.webhook.transport.type}</Descriptions.Item>
                      <Descriptions.Item label="Endpoint">
                        <Text code>{webhookDetail.webhook.transport.endpointPath || "-"}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Content Types">{(webhookDetail.webhook.transport.contentTypes ?? []).join(", ") || "-"}</Descriptions.Item>
                      <Descriptions.Item label="Webhook Script">
                        {webhookDetail.webhook.webhookScriptId ? <Text code>{webhookDetail.webhook.webhookScriptId}</Text> : "-"}
                      </Descriptions.Item>
                    </Descriptions>
                  )
                },
                {
                  key: "sample",
                  label: "样例请求",
                  children: (
                    <CodeEditor
                      height="320px"
                      language="json"
                      value={JSON.stringify(webhookDetail.webhook.sampleRequest ?? {}, null, 2)}
                      onChange={() => undefined}
                      theme={editorTheme}
                      readOnly={true}
                    />
                  )
                },
                {
                  key: "config",
                  label: `配置模板 (${webhookDetail.configTemplate.length})`,
                  children: webhookDetail.configTemplate.length > 0 ? (
                    <Table
                      rowKey="key"
                      size="small"
                      pagination={false}
                      dataSource={webhookDetail.configTemplate}
                      columns={[
                        { title: "配置键", dataIndex: "key", key: "key", render: (value: string) => <Text code>{value}</Text> },
                        { title: "说明", dataIndex: "label", key: "label", render: (value?: string) => value || "-" },
                        {
                          title: "要求",
                          key: "required",
                          render: (_value: unknown, record) => (
                            <Space wrap size={[6, 6]}>
                              {record.required ? <Tag color="blue">必填</Tag> : <Tag>可选</Tag>}
                              {record.secret ? <Tag color="gold">SECRET</Tag> : <Tag>{record.type}</Tag>}
                            </Space>
                          )
                        }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该Webhook没有配置模板" />
                  )
                },
                {
                  key: "dependencies",
                  label: `脚本依赖 (${webhookDetail.descriptor.scriptDependencies.length})`,
                  children: renderScriptDependencies(webhookDetail.descriptor.scriptDependencies, {
                    currentRepositoryId: webhookDetail.descriptor.repositoryId,
                    availableTools
                  })
                }
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Drawer
        title={packageDetail?.descriptor.displayName || "能力包详情"}
        open={packageDetailOpen}
        onClose={onClosePackageDetail}
        width={980}
        destroyOnHidden
        extra={packageDrawerActions}
      >
        {packageDetailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !packageDetail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="能力包详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "package", label: "能力包 ID", children: <Text code>{packageDetail.descriptor.repositoryId}/{packageDetail.descriptor.packageId}</Text> },
                { key: "version", label: "发布版本", children: packageDetail.descriptor.version },
                { key: "installedVersion", label: "本机版本", children: packageDetail.descriptor.installedVersion || "-" },
                { key: "owner", label: "维护人", children: packageDetail.descriptor.owner || "-" },
                { key: "entry", label: "主入口", children: packageDetail.releaseFile.entries[0] ? <Text code>{packageDetail.releaseFile.entries[0].target}</Text> : "-" },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={packageDetail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> },
                { key: "risk", label: "风险等级", children: <RiskLevelTag level={packageDetail.descriptor.riskLevel} /> },
                { key: "sourceType", label: "发布来源", children: packageDetail.releaseFile.sourceType }
              ]}
            />

            <Space wrap size={[8, 8]}>
              {packageDetail.descriptor.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              {packageDetail.descriptor.installed ? <Tag color="blue">已安装</Tag> : <Tag>未安装</Tag>}
              {packageDetail.descriptor.updateAvailable ? <Tag color="processing">有更新</Tag> : null}
            </Space>

            <Tabs
              items={[
                {
                  key: "description",
                  label: "说明",
                  children: (
                    <MarkdownDescription
                      value={packageDetail.descriptor.description}
                      emptyText="该能力包没有填写说明。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "releaseNotes",
                  label: "发布日志",
                  children: (
                    <MarkdownDescription
                      value={packageDetail.descriptor.releaseNotes}
                      emptyText="该版本没有填写发布日志。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "assets",
                  label: "发布资产",
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Descriptions bordered size="small" column={4}>
                        <Descriptions.Item label="入口">{packageDetail.releaseFile.entries.length}</Descriptions.Item>
                        <Descriptions.Item label="脚本">{packageDetail.releaseFile.scripts.length}</Descriptions.Item>
                        <Descriptions.Item label="Agent">{packageDetail.releaseFile.agents.length}</Descriptions.Item>
                        <Descriptions.Item label="工具集">{packageDetail.releaseFile.toolsets.length}</Descriptions.Item>
                        <Descriptions.Item label="模型">{packageDetail.releaseFile.models.length}</Descriptions.Item>
                        <Descriptions.Item label="配置模板">{packageDetail.configTemplate.length}</Descriptions.Item>
                        <Descriptions.Item label="定时任务">{packageDetail.scheduleTemplate.length}</Descriptions.Item>
                        <Descriptions.Item label="执行预设">{packageDetail.presetTemplate.length}</Descriptions.Item>
                      </Descriptions>
                      <Table
                        rowKey={(item) => `${item.type}:${item.id}`}
                        size="small"
                        pagination={false}
                        dataSource={packageDetail.releaseFile.entries}
                        columns={[
                          { title: "入口类型", dataIndex: "type", key: "type", width: 120 },
                          { title: "名称", dataIndex: "displayName", key: "displayName" },
                          { title: "目标", dataIndex: "target", key: "target", render: (value: string) => <Text code>{value}</Text> }
                        ]}
                      />
                    </Space>
                  )
                },
                {
                  key: "config",
                  label: `配置模板 (${packageDetail.configTemplate.length})`,
                  children: packageDetail.configTemplate.length > 0 ? (
                    <Table
                      rowKey="key"
                      size="small"
                      pagination={false}
                      dataSource={packageDetail.configTemplate}
                      columns={[
                        {
                          title: "配置键",
                          dataIndex: "key",
                          key: "key",
                          render: (value: string) => <Text code>{value}</Text>
                        },
                        {
                          title: "说明",
                          dataIndex: "label",
                          key: "label",
                          render: (value?: string) => value || "-"
                        },
                        {
                          title: "要求",
                          key: "required",
                          render: (_value: unknown, record) => (
                            <Space wrap size={[6, 6]}>
                              {record.required ? <Tag color="blue">必填</Tag> : <Tag>可选</Tag>}
                              {record.secret ? <Tag color="gold">SECRET</Tag> : <Tag>{record.type}</Tag>}
                            </Space>
                          )
                        }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该能力包没有配置模板" />
                  )
                },
                {
                  key: "schedules",
                  label: `定时任务 (${packageDetail.scheduleTemplate.length})`,
                  children: packageDetail.scheduleTemplate.length > 0 ? (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={packageDetail.scheduleTemplate}
                      columns={[
                        { title: "名称", dataIndex: "name", key: "name" },
                        { title: "脚本", dataIndex: "scriptId", key: "scriptId", render: (value: string) => <Text code>{value}</Text> },
                        { title: "Cron", dataIndex: "cronExpression", key: "cronExpression" },
                        {
                          title: "默认状态",
                          dataIndex: "enabledByDefault",
                          key: "enabledByDefault",
                          render: (value: boolean) => value ? <Tag color="processing">默认启用</Tag> : <Tag>默认停用</Tag>
                        }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该能力包没有定时任务模板" />
                  )
                },
                {
                  key: "presets",
                  label: `执行预设 (${packageDetail.presetTemplate.length})`,
                  children: packageDetail.presetTemplate.length > 0 ? (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={packageDetail.presetTemplate}
                      columns={[
                        { title: "预设 ID", dataIndex: "id", key: "id", render: (value: string) => <Text code>{value}</Text> },
                        { title: "名称", dataIndex: "name", key: "name" },
                        { title: "脚本", dataIndex: "scriptId", key: "scriptId", render: (value: string) => <Text code>{value}</Text> }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该能力包没有执行预设模板" />
                  )
                },
                {
                  key: "dependencies",
                  label: `外部依赖 (${packageDetail.releaseFile.externalDependencies.length})`,
                  children: renderExternalDependencies(packageDetail.releaseFile.externalDependencies)
                }
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Drawer
        title={playbookDetail?.descriptor.displayName || "任务手册详情"}
        open={playbookDetailOpen}
        onClose={onClosePlaybookDetail}
        width={920}
        destroyOnHidden
        extra={playbookDetail ? (
          <Space>
            {isLocalPlaybook(playbookDetail.descriptor) ? (
              <>
                <Button
                  type={playbookDetail.descriptor.localState?.updateAvailable ? "primary" : "default"}
                  ghost={playbookDetail.descriptor.localState?.updateAvailable}
                  disabled={!playbookDetail.descriptor.localState?.updateAvailable}
                  loading={actionKey === `update-local:${playbookDetail.descriptor.repositoryId}:${playbookDetail.descriptor.playbookId}`}
                  onClick={() => void onPlaybookLocalAssetAction(playbookDetail.descriptor, "update-local")}
                >
                  {playbookDetail.descriptor.localState?.updateAvailable ? "更新" : "已安装"}
                </Button>
                <Button
                  danger
                  loading={actionKey === `uninstall:${playbookDetail.descriptor.repositoryId}:${playbookDetail.descriptor.playbookId}`}
                  onClick={() => void onPlaybookUninstall(playbookDetail.descriptor)}
                >
                  卸载
                </Button>
              </>
            ) : (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={actionKey === `add-local:${playbookDetail.descriptor.repositoryId}:${playbookDetail.descriptor.playbookId}`}
                onClick={() => void onPlaybookInstall(playbookDetail.descriptor)}
              >
                安装
              </Button>
            )}
          </Space>
        ) : null}
      >
        {playbookDetailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !playbookDetail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="任务手册详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "playbookId", label: "任务手册 ID", children: <Text code>{localAssetId(playbookDetail.descriptor)}</Text> },
                { key: "repo", label: "来源仓库", children: playbookDetail.descriptor.repositoryId },
                { key: "version", label: "远端版本", children: playbookDetail.descriptor.version },
                { key: "installedVersion", label: "本机版本", children: playbookDetail.descriptor.localState?.version || "-" },
                { key: "owner", label: "维护人", children: playbookDetail.descriptor.owner || "-" },
                { key: "risk", label: "风险等级", children: <RiskLevelTag level={playbookDetail.descriptor.riskLevel} /> },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={playbookDetail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> }
              ]}
            />
            <Space wrap size={[8, 8]}>
              {playbookDetail.descriptor.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              {isLocalPlaybook(playbookDetail.descriptor) ? <Tag color="blue">已安装</Tag> : <Tag>未安装</Tag>}
              {playbookDetail.descriptor.localState?.updateAvailable ? <Tag color="processing">有更新</Tag> : null}
              {playbookDetail.playbook.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
            </Space>
            <Tabs
              items={[
                {
                  key: "description",
                  label: "说明",
                  children: (
                    <MarkdownDescription
                      value={playbookDetail.playbook.description}
                      emptyText="该任务手册没有填写说明。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "guide",
                  label: "Guide",
                  children: (
                    <MarkdownDescription
                      value={playbookDetail.playbook.guideMarkdown}
                      emptyText="该任务手册没有填写 Guide。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "knowledge",
                  label: `知识引用 (${playbookDetail.playbook.knowledgeRefs.length})`,
                  children: playbookDetail.playbook.knowledgeRefs.length > 0 ? (
                    <Table
                      rowKey={(item) => `${item.type}:${item.repositoryId}:${item.path}`}
                      size="small"
                      pagination={false}
                      dataSource={playbookDetail.playbook.knowledgeRefs}
                      columns={[
                        { title: "类型", dataIndex: "type", key: "type", width: 120 },
                        { title: "仓库", dataIndex: "repositoryId", key: "repositoryId", render: (value: string) => <Text code>{value}</Text> },
                        { title: "路径", dataIndex: "path", key: "path", render: (value: string) => <Text code>{value}</Text> }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该任务手册没有知识引用" />
                  )
                },
                {
                  key: "scripts",
                  label: `脚本引用 (${playbookDetail.playbook.scriptRefs.length})`,
                  children: playbookDetail.playbook.scriptRefs.length > 0 ? (
                    <Table
                      rowKey="scriptId"
                      size="small"
                      pagination={false}
                      dataSource={playbookDetail.playbook.scriptRefs}
                      columns={[
                        { title: "脚本", dataIndex: "scriptId", key: "scriptId", render: (value: string) => <Text code>{value}</Text> },
                        { title: "用途", dataIndex: "purpose", key: "purpose", render: (value?: string) => value || "-" }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该任务手册没有脚本引用" />
                  )
                },
                {
                  key: "stop",
                  label: `停止条件 (${playbookDetail.playbook.stopConditions.length})`,
                  children: playbookDetail.playbook.stopConditions.length > 0 ? (
                    <Space wrap>{playbookDetail.playbook.stopConditions.map((item) => <Tag color="red" key={item}>{item}</Tag>)}</Space>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该任务手册没有停止条件" />
                  )
                },
                {
                  key: "releaseNotes",
                  label: "发布日志",
                  children: (
                    <MarkdownDescription
                      value={playbookDetail.playbook.releaseNotes}
                      emptyText="该版本没有填写发布日志。"
                      className="markdown-description--panel"
                    />
                  )
                }
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Drawer
        title={skillDetail?.descriptor.displayName || "Skill 详情"}
        open={skillDetailOpen}
        onClose={onCloseSkillDetail}
        width={860}
        destroyOnHidden
        extra={skillDetail ? (
          <Button
            type="primary"
            disabled={skillDetail.descriptor.installed && !skillDetail.descriptor.updateAvailable}
            onClick={() => onOpenSkillInstall(skillDetail.descriptor)}
          >
            {getSkillInstallLabel(skillDetail.descriptor).replace(" Skill", "")}
          </Button>
        ) : null}
      >
        {skillDetailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !skillDetail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Skill 详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "skillId", label: "Skill ID", children: <Text code>{skillDetail.descriptor.skillId}</Text> },
                { key: "repo", label: "来源仓库", children: skillDetail.descriptor.repositoryId },
                { key: "version", label: "版本", children: skillDetail.descriptor.version },
                { key: "owner", label: "维护人", children: skillDetail.descriptor.owner || "-" },
                { key: "risk", label: "风险等级", children: <RiskLevelTag level={skillDetail.descriptor.riskLevel} /> },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={skillDetail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> }
              ]}
            />
            <MarkdownDescription
              value={skillDetail.descriptor.description}
              emptyText="该 Skill 没有填写说明。"
              className="markdown-description--panel"
            />
            <CodeEditor
              height="480px"
              language="markdown"
              value={skillDetail.content}
              onChange={() => undefined}
              theme={editorTheme}
              readOnly={true}
            />
          </Space>
        )}
      </Drawer>

      <Drawer
        title={knowledgeDetail?.descriptor.displayName || "知识源详情"}
        open={knowledgeDetailOpen}
        onClose={onCloseKnowledgeDetail}
        width={860}
        destroyOnHidden
        extra={knowledgeDetail ? (
          <Space>
            {knowledgeDetail.descriptor.installed ? (
              <Button
                danger
                loading={knowledgeActionKey === `uninstall:${knowledgeDetail.descriptor.repositoryId}:${knowledgeDetail.descriptor.knowledgeId}`}
                onClick={() => void onKnowledgeUninstall(knowledgeDetail.descriptor)}
              >
                卸载
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={knowledgeActionKey === `install:${knowledgeDetail.descriptor.repositoryId}:${knowledgeDetail.descriptor.knowledgeId}`}
                onClick={() => void onKnowledgeInstall(knowledgeDetail.descriptor)}
              >
                安装
              </Button>
            )}
          </Space>
        ) : null}
      >
        {knowledgeDetailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !knowledgeDetail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="知识源详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "knowledgeId", label: "知识源 ID", children: <Text code>{knowledgeDetail.descriptor.knowledgeId}</Text> },
                { key: "repo", label: "来源仓库", children: knowledgeDetail.descriptor.repositoryId },
                { key: "sourceType", label: "类型", children: knowledgeDetail.knowledge.source.type },
                { key: "sourceUrl", label: "地址", children: <Text code>{knowledgeDetail.knowledge.source.url}</Text> },
                { key: "branch", label: "分支", children: knowledgeDetail.knowledge.source.branch || "-" },
                { key: "entryPath", label: "入口文件", children: knowledgeDetail.knowledge.source.entryPath || "ACTIONDOCK.md" },
                { key: "installed", label: "安装状态", children: knowledgeDetail.descriptor.installed ? <Tag color="blue">已安装</Tag> : <Tag>未安装</Tag> },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={knowledgeDetail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> }
              ]}
            />
            <Space wrap size={[8, 8]}>
              {knowledgeDetail.knowledge.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
            </Space>
            <MarkdownDescription
              value={knowledgeDetail.knowledge.description}
              emptyText="该知识源没有填写说明。"
              className="markdown-description--panel"
            />
          </Space>
        )}
      </Drawer>
    </>
  );
}
