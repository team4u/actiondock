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
  RepositoryEventSourceDescriptor,
  RepositoryEventSourceDetail,
  RepositorySkillDetail,
  RepositoryToolDetail
} from "../../../../shared/types";
import { getScriptTypeLabel } from "../../../../components/domain/typeLabels";
import {
  getSkillInstallLabel,
  isLocalEventSource,
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
  detailOpen: boolean;
  detailLoading: boolean;
  detail: RepositoryToolDetail | null;
  eventSourceDetailOpen: boolean;
  eventSourceDetailLoading: boolean;
  eventSourceDetail: RepositoryEventSourceDetail | null;
  packageDetailOpen: boolean;
  packageDetailLoading: boolean;
  packageDetail: CapabilityPackageDetail | null;
  skillDetailOpen: boolean;
  skillDetailLoading: boolean;
  skillDetail: RepositorySkillDetail | null;
  onCloseToolDetail: () => void;
  onCloseEventSourceDetail: () => void;
  onClosePackageDetail: () => void;
  onCloseSkillDetail: () => void;
  onOpenSkillInstall: (descriptor: RepositorySkillDetail["descriptor"]) => void;
  onToolLocalAssetAction: (
    descriptor: RepositoryToolDetail["descriptor"],
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddToolToLocal: (descriptor: RepositoryToolDetail["descriptor"]) => void | Promise<void>;
  onEventSourceLocalAssetAction: (
    descriptor: RepositoryEventSourceDetail["descriptor"],
    action: LocalAssetAction,
    mode?: AddMode,
    customLocalAssetId?: string
  ) => void | Promise<void>;
  onAddEventSourceToLocal: (descriptor: RepositoryEventSourceDetail["descriptor"]) => void | Promise<void>;
  onPackageInstall: (descriptor: CapabilityPackageDescriptor, action: InstallAction) => void | Promise<void>;
  onPackageUninstall: (descriptor: CapabilityPackageDescriptor) => void | Promise<void>;
  onNavigate: (path: string) => void;
}

export function DiscoveryDetailDrawers({
  editorTheme,
  actionKey,
  packageActionKey,
  detailOpen,
  detailLoading,
  detail,
  eventSourceDetailOpen,
  eventSourceDetailLoading,
  eventSourceDetail,
  packageDetailOpen,
  packageDetailLoading,
  packageDetail,
  skillDetailOpen,
  skillDetailLoading,
  skillDetail,
  onCloseToolDetail,
  onCloseEventSourceDetail,
  onClosePackageDetail,
  onCloseSkillDetail,
  onOpenSkillInstall,
  onToolLocalAssetAction,
  onAddToolToLocal,
  onEventSourceLocalAssetAction,
  onAddEventSourceToLocal,
  onPackageInstall,
  onPackageUninstall,
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
                  loading={actionKey === `update-local:${detail.descriptor.repositoryId}:${detail.descriptor.toolId}`}
                  onClick={() => void onToolLocalAssetAction(detail.descriptor, "update-local")}
                >
                  {detail.descriptor.localState?.updateAvailable ? "更新脚本" : "已添加"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={actionKey === `add-local:${detail.descriptor.repositoryId}:${detail.descriptor.toolId}`}
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
                          render: (value: string | undefined, record: RepositoryToolDetail["configTemplate"][number]) =>
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
                  children: renderScriptDependencies(detail.descriptor.scriptDependencies)
                },
                {
                  key: "plugins",
                  label: `插件依赖 (${detail.descriptor.pluginDependencies.length})`,
                  children: renderPluginDependencies(detail.descriptor.pluginDependencies)
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
        title={eventSourceDetail?.descriptor.displayName || "事件源资产详情"}
        open={eventSourceDetailOpen}
        onClose={onCloseEventSourceDetail}
        width={920}
        destroyOnHidden
      >
        {eventSourceDetailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !eventSourceDetail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="事件源详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "source", label: "事件源 ID", children: <Text code>{localAssetId(eventSourceDetail.descriptor)}</Text> },
                { key: "repo", label: "来源仓库", children: eventSourceDetail.descriptor.repositoryId },
                { key: "version", label: "远端版本", children: eventSourceDetail.descriptor.version },
                { key: "installedVersion", label: "本机版本", children: eventSourceDetail.descriptor.localState?.version || "-" },
                { key: "owner", label: "维护人", children: eventSourceDetail.descriptor.owner || "-" },
                { key: "trust", label: "仓库信任", children: <TrustLevelTag level={eventSourceDetail.descriptor.trusted ? "TRUSTED" : "UNTRUSTED"} /> },
                { key: "sync", label: "上游同步", children: isTrackedLocal(eventSourceDetail.descriptor) ? <UpstreamSyncTag state={eventSourceDetail.descriptor.localState?.syncState} /> : <Text type="secondary">-</Text> }
              ]}
            />

            <Space wrap size={[8, 8]}>
              {eventSourceDetail.descriptor.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              {isLocalEventSource(eventSourceDetail.descriptor) ? <Tag color="blue">已添加</Tag> : <Tag>未添加</Tag>}
              {isTrackedLocal(eventSourceDetail.descriptor) ? <Tag color="purple">跟踪本地资产</Tag> : null}
              {eventSourceDetail.descriptor.localState?.updateAvailable ? <Tag color="processing">有更新</Tag> : null}
            </Space>

            <Space wrap size={[8, 8]}>
              {isTrackedLocal(eventSourceDetail.descriptor) ? (
                <Button onClick={() => onNavigate("/triggers")}>
                  {getUpstreamActionLabel(eventSourceDetail.descriptor.localState?.syncState)}
                </Button>
              ) : isLockedLocal(eventSourceDetail.descriptor) ? (
                <Button
                  type={eventSourceDetail.descriptor.localState?.updateAvailable ? "primary" : "default"}
                  ghost={eventSourceDetail.descriptor.localState?.updateAvailable}
                  disabled={!eventSourceDetail.descriptor.localState?.updateAvailable}
                  loading={actionKey === `update-local:${eventSourceDetail.descriptor.repositoryId}:${eventSourceDetail.descriptor.eventSourceId}`}
                  onClick={() => void onEventSourceLocalAssetAction(eventSourceDetail.descriptor, "update-local")}
                >
                  {eventSourceDetail.descriptor.localState?.updateAvailable ? "更新事件源" : "已添加"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={actionKey === `add-local:${eventSourceDetail.descriptor.repositoryId}:${eventSourceDetail.descriptor.eventSourceId}`}
                  onClick={() => void onAddEventSourceToLocal(eventSourceDetail.descriptor)}
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
                      value={eventSourceDetail.descriptor.description}
                      emptyText="该事件源没有填写说明。"
                      className="markdown-description--panel"
                    />
                  )
                },
                {
                  key: "releaseNotes",
                  label: "发布日志",
                  children: (
                    <MarkdownDescription
                      value={eventSourceDetail.descriptor.releaseNotes}
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
                      <Descriptions.Item label="Transport">{eventSourceDetail.eventSource.transport.type}</Descriptions.Item>
                      <Descriptions.Item label="Content Types">{(eventSourceDetail.eventSource.transport.contentTypes ?? []).join(", ") || "-"}</Descriptions.Item>
                      <Descriptions.Item label="Auth Mode">{eventSourceDetail.eventSource.auth?.mode || "NONE"}</Descriptions.Item>
                      <Descriptions.Item label="Secret Config">{eventSourceDetail.eventSource.auth?.secretConfigKey ? <Text code>{eventSourceDetail.eventSource.auth.secretConfigKey}</Text> : "-"}</Descriptions.Item>
                    </Descriptions>
                  )
                },
                {
                  key: "sample",
                  label: "样例上下文",
                  children: (
                    <CodeEditor
                      height="320px"
                      language="json"
                      value={JSON.stringify(eventSourceDetail.eventSource.sampleContext ?? {}, null, 2)}
                      onChange={() => undefined}
                      theme={editorTheme}
                      readOnly={true}
                    />
                  )
                },
                {
                  key: "config",
                  label: `配置模板 (${eventSourceDetail.configTemplate.length})`,
                  children: eventSourceDetail.configTemplate.length > 0 ? (
                    <Table
                      rowKey="key"
                      size="small"
                      pagination={false}
                      dataSource={eventSourceDetail.configTemplate}
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
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该事件源没有配置模板" />
                  )
                },
                {
                  key: "dependencies",
                  label: `脚本依赖 (${eventSourceDetail.descriptor.scriptDependencies.length})`,
                  children: renderScriptDependencies(eventSourceDetail.descriptor.scriptDependencies)
                },
                {
                  key: "triggers",
                  label: `触发器模板 (${eventSourceDetail.triggerTemplate.length})`,
                  children: eventSourceDetail.triggerTemplate.length > 0 ? (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={eventSourceDetail.triggerTemplate}
                      columns={[
                        { title: "模板 ID", dataIndex: "id", key: "id", render: (value: string) => <Text code>{value}</Text> },
                        { title: "名称", dataIndex: "name", key: "name" },
                        {
                          title: "目标脚本",
                          key: "target",
                          render: (_value: unknown, record) => (
                            <Text code>{`${record.targetScriptDependency.repositoryId}/${record.targetScriptDependency.toolId}`}</Text>
                          )
                        },
                        {
                          title: "默认状态",
                          dataIndex: "enabledByDefault",
                          key: "enabledByDefault",
                          render: (value: boolean) => value ? <Tag color="processing">默认启用</Tag> : <Tag>默认停用</Tag>
                        }
                      ]}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该事件源没有触发器模板" />
                  )
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
    </>
  );
}
