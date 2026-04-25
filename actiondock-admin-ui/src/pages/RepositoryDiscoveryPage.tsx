import {
  DownloadOutlined,
  ReloadOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tabs,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  developRepositoryTool,
  getRepositoryTool,
  installRepositoryTool,
  listRepositories,
  listRepositoryTools,
  updateRepositoryTool
} from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { MarkdownDescription } from "../components/MarkdownDescription";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type {
  DevelopmentSyncState,
  PluginDependency,
  RepositoryDefinition,
  RepositoryToolDescriptor,
  RepositoryToolDetail
} from "../types";
import { getErrorMessage } from "../utils";
import { useColorMode } from "../contexts/ColorModeContext";

const { Text } = Typography;

type InstallAction = "install" | "update";

function getRiskTag(riskLevel?: string) {
  if (!riskLevel) {
    return <Tag>未声明</Tag>;
  }
  const normalized = riskLevel.toUpperCase();
  const color = normalized === "HIGH" ? "red" : normalized === "MEDIUM" ? "gold" : "green";
  return <Tag color={color}>{normalized}</Tag>;
}

function getTrustTag(trusted: boolean) {
  return trusted ? <Tag color="green">可信仓库</Tag> : <Tag color="gold">未信任</Tag>;
}

function getTypeLabel(type: RepositoryToolDescriptor["type"]): string {
  return type === "PYTHON" ? "Python" : "Groovy";
}

function getDevelopmentSyncTag(state?: DevelopmentSyncState) {
  switch (state) {
    case "LOCAL_CHANGES":
      return <Tag color="orange">本地有修改</Tag>;
    case "REMOTE_CHANGES":
      return <Tag color="processing">远端有更新</Tag>;
    case "DIVERGED":
      return <Tag color="red">有冲突</Tag>;
    case "SYNCED":
      return <Tag color="purple">已同步</Tag>;
    default:
      return <Tag color="purple">开发同步</Tag>;
  }
}

function getDevelopmentActionLabel(state?: DevelopmentSyncState) {
  switch (state) {
    case "LOCAL_CHANGES":
      return "本地有修改";
    case "REMOTE_CHANGES":
      return "远端有更新";
    case "DIVERGED":
      return "有冲突";
    case "SYNCED":
      return "已同步";
    default:
      return "打开开发脚本";
  }
}

function renderPluginDependencies(dependencies: PluginDependency[]) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该工具没有声明插件依赖" />;
  }

  return (
    <Table<PluginDependency>
      rowKey="pluginId"
      size="small"
      pagination={false}
      dataSource={dependencies}
      columns={[
        {
          title: "插件 ID",
          dataIndex: "pluginId",
          key: "pluginId",
          render: (value: string) => <Text code>{value}</Text>
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

export function RepositoryDiscoveryPage() {
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [tools, setTools] = useState<RepositoryToolDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<RepositoryToolDetail | null>(null);
  const [searchText, setSearchText] = useState("");
  const [repositoryFilter, setRepositoryFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [installFilter, setInstallFilter] = useState<string>("ALL");
  const [trustFilter, setTrustFilter] = useState<string>("ALL");
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadData = async () => {
    setLoading(true);
    try {
      const [repositoryData, toolData] = await Promise.all([listRepositories(), listRepositoryTools()]);
      setRepositories(repositoryData);
      setTools(toolData);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载仓库工具失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredTools = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return tools.filter((tool) => {
      if (repositoryFilter !== "ALL" && tool.repositoryId !== repositoryFilter) {
        return false;
      }
      if (typeFilter !== "ALL" && tool.type !== typeFilter) {
        return false;
      }
      if (installFilter === "INSTALLED" && !tool.installed) {
        return false;
      }
      if (installFilter === "NOT_INSTALLED" && tool.installed) {
        return false;
      }
      if (trustFilter === "TRUSTED" && !tool.trusted) {
        return false;
      }
      if (trustFilter === "UNTRUSTED" && tool.trusted) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        tool.displayName,
        tool.toolId,
        tool.installedScriptId,
        tool.description ?? "",
        tool.owner ?? "",
        tool.repositoryId
      ]
        .join(" ")
        .toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [installFilter, repositoryFilter, searchText, tools, trustFilter, typeFilter]);

  const openDetail = async (descriptor: RepositoryToolDescriptor) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await getRepositoryTool(descriptor.repositoryId, descriptor.toolId));
    } catch (error) {
      setDetail(null);
      messageApi.error(getErrorMessage(error, "加载工具详情失败"));
    } finally {
      setDetailLoading(false);
    }
  };

  const confirmInstallAction = async (descriptor: RepositoryToolDescriptor, action: InstallAction) => {
    let installSchedules = false;
    let installPluginDependencies = descriptor.pluginDependencies.length > 0;
    let detailForAction = detail?.descriptor.repositoryId === descriptor.repositoryId && detail?.descriptor.toolId === descriptor.toolId
      ? detail
      : null;

    if (!detailForAction) {
      try {
        detailForAction = await getRepositoryTool(descriptor.repositoryId, descriptor.toolId);
      } catch (error) {
        messageApi.error(getErrorMessage(error, "读取工具模板失败"));
        return;
      }
    }

    const scheduleCount = detailForAction.scheduleTemplate.length;

    await modal.confirm({
      title: action === "install" ? "安装工具" : "更新工具",
      okText: action === "install" ? "安装" : "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {descriptor.displayName} 将安装到本机脚本 ID <Text code>{descriptor.installedScriptId}</Text>。
          </Text>
          {scheduleCount > 0 ? (
            <Checkbox onChange={(event) => { installSchedules = event.target.checked; }}>
              同时创建 {scheduleCount} 个定时任务模板（创建后默认停用）
            </Checkbox>
          ) : (
            <Text type="secondary">该工具没有定时任务模板。</Text>
          )}
          {descriptor.pluginDependencies.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox defaultChecked onChange={(event) => { installPluginDependencies = event.target.checked; }}>
                同时安装或更新 {descriptor.pluginDependencies.length} 个插件依赖
              </Checkbox>
              {renderPluginDependencies(descriptor.pluginDependencies)}
            </Space>
          ) : (
            <Text type="secondary">该工具没有声明插件依赖。</Text>
          )}
          {!descriptor.trusted ? (
            <Text type="warning">当前来源仓库未标记为可信，安装前请先检查源码与配置模板。</Text>
          ) : null}
        </Space>
      )
    });

    setActionKey(`${action}:${descriptor.installedScriptId}`);
    try {
      if (action === "install") {
        await installRepositoryTool(descriptor.repositoryId, descriptor.toolId, { installSchedules, installPluginDependencies });
      } else {
        await updateRepositoryTool(descriptor.repositoryId, descriptor.toolId, { installSchedules, installPluginDependencies });
      }
      messageApi.success(action === "install" ? "工具已安装到本机" : "工具已更新");
      await loadData();
      if (detailOpen) {
        await openDetail(descriptor);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else {
        messageApi.error(getErrorMessage(error, action === "install" ? "安装失败" : "更新失败"));
      }
    } finally {
      setActionKey(null);
    }
  };

  const handleDevelopTool = async (descriptor: RepositoryToolDescriptor, scriptId?: string) => {
    setActionKey(`develop:${descriptor.repositoryId}:${descriptor.toolId}`);
    try {
      const script = await developRepositoryTool(descriptor.repositoryId, descriptor.toolId, { scriptId });
      messageApi.success("已同步为本地开发脚本");
      await loadData();
      navigate(`/scripts/${encodeURIComponent(script.id)}`);
    } catch (error) {
      if (error instanceof ApiError && !scriptId && error.message.includes("脚本 ID 已存在")) {
        let customScriptId = descriptor.toolId;
        await modal.confirm({
          title: "指定开发脚本 ID",
          okText: "同步",
          cancelText: "取消",
          content: (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Text type="secondary">默认脚本 ID 已被占用，请输入一个本地开发脚本 ID。</Text>
              <Input defaultValue={customScriptId} onChange={(event) => { customScriptId = event.target.value; }} />
            </Space>
          ),
          onOk: () => handleDevelopTool(descriptor, customScriptId.trim())
        });
        return;
      }
      messageApi.error(getErrorMessage(error, "同步开发脚本失败"));
    } finally {
      setActionKey(null);
    }
  };

  const columns: ColumnsType<RepositoryToolDescriptor> = [
    {
      title: "工具",
      key: "tool",
      render: (_value: unknown, record) => (
        <Space wrap size={[8, 8]}>
          <TableLinkCell onClick={() => void openDetail(record)}>{record.displayName}</TableLinkCell>
          <Text code>{record.installedScriptId}</Text>
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
          {record.repositoryUsage === "DEVELOPMENT" ? <Tag color="purple">开发仓库</Tag> : null}
          {getTrustTag(record.trusted)}
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
      width: 180,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          {record.installed ? (
            record.repositoryUsage === "DEVELOPMENT" ? (
              record.developmentScriptId ? (
                <Button
                  size="small"
                  type={record.developmentSyncState === "REMOTE_CHANGES" ? "primary" : "default"}
                  danger={record.developmentSyncState === "DIVERGED"}
                  ghost={record.developmentSyncState === "REMOTE_CHANGES"}
                  icon={<SyncOutlined />}
                  onClick={() => navigate(`/scripts/${record.developmentScriptId}`)}
                >
                  {getDevelopmentActionLabel(record.developmentSyncState)}
                </Button>
              ) : null
            ) : (
              <Button
                size="small"
                type={record.updateAvailable ? "primary" : "default"}
                ghost={record.updateAvailable}
                icon={<SyncOutlined />}
                disabled={!record.updateAvailable}
                loading={actionKey === `update:${record.installedScriptId}`}
                onClick={() => void confirmInstallAction(record, "update")}
              >
                {record.updateAvailable ? "更新" : "已安装"}
              </Button>
            )
          ) : record.repositoryUsage === "DEVELOPMENT" ? (
            record.developmentScriptId ? (
              <Button
                size="small"
                type={record.developmentSyncState === "REMOTE_CHANGES" ? "primary" : "default"}
                danger={record.developmentSyncState === "DIVERGED"}
                ghost={record.developmentSyncState === "REMOTE_CHANGES"}
                icon={<SyncOutlined />}
                onClick={() => navigate(`/scripts/${record.developmentScriptId}`)}
              >
                {getDevelopmentActionLabel(record.developmentSyncState)}
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                icon={<DownloadOutlined />}
                loading={actionKey === `develop:${record.repositoryId}:${record.toolId}`}
                onClick={() => void handleDevelopTool(record)}
              >
                同步开发
              </Button>
            )
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `install:${record.installedScriptId}`}
              onClick={() => void confirmInstallAction(record, "install")}
            >
              安装
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="发现工具"
          meta={<Text type="secondary">聚合展示所有已添加仓库中的工具。安装只是把定义同步到本机，执行仍在你的机器上完成。</Text>}
          actions={
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新目录
            </Button>
          }
        />

        <Card>
          <Space wrap size={[12, 12]} style={{ width: "100%" }}>
            <Input.Search
              allowClear
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索名称、toolId、来源或维护人"
              style={{ minWidth: 220, flex: "1 1 280px" }}
            />
            <Select
              value={repositoryFilter}
              onChange={setRepositoryFilter}
              style={{ minWidth: 180 }}
              options={[
                { value: "ALL", label: "全部仓库" },
                ...repositories.map((item) => ({ value: item.id, label: item.name }))
              ]}
            />
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部类型" },
                { value: "PYTHON", label: "Python" },
                { value: "GROOVY", label: "Groovy" }
              ]}
            />
            <Select
              value={installFilter}
              onChange={setInstallFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部状态" },
                { value: "INSTALLED", label: "已安装" },
                { value: "NOT_INSTALLED", label: "未安装" }
              ]}
            />
            <Select
              value={trustFilter}
              onChange={setTrustFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部信任级别" },
                { value: "TRUSTED", label: "可信仓库" },
                { value: "UNTRUSTED", label: "未信任仓库" }
              ]}
            />
          </Space>
        </Card>

        <Card>
          <Table<RepositoryToolDescriptor>
            rowKey={(item) => `${item.repositoryId}:${item.toolId}`}
            loading={loading}
            columns={columns}
            dataSource={filteredTools}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="当前没有可发现的工具。先到仓库管理页添加并同步仓库。"
                />
              )
            }}
          />
        </Card>
      </Space>

      <Drawer
        title={detail?.descriptor.displayName || "工具详情"}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={920}
        destroyOnHidden
      >
        {detailLoading ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !detail ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="工具详情加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: "tool", label: "工具 ID", children: <Text code>{detail.descriptor.installedScriptId}</Text> },
                { key: "repo", label: "来源仓库", children: detail.descriptor.repositoryId },
                { key: "usage", label: "仓库用途", children: detail.descriptor.repositoryUsage === "DEVELOPMENT" ? <Tag color="purple">开发仓库</Tag> : <Tag>分发仓库</Tag> },
                { key: "type", label: "类型", children: getTypeLabel(detail.descriptor.type) },
                { key: "version", label: "远端版本", children: detail.descriptor.version },
                { key: "installedVersion", label: "本机版本", children: detail.descriptor.installedVersion || "-" },
                { key: "owner", label: "维护人", children: detail.descriptor.owner || "-" },
                { key: "risk", label: "风险等级", children: getRiskTag(detail.descriptor.riskLevel) },
                { key: "trust", label: "仓库信任", children: getTrustTag(detail.descriptor.trusted) },
                { key: "syncState", label: "开发同步", children: detail.descriptor.developmentScriptId ? getDevelopmentSyncTag(detail.descriptor.developmentSyncState) : <Text type="secondary">-</Text> }
              ]}
            />

            <Space wrap size={[8, 8]}>
              {detail.descriptor.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
              {detail.descriptor.installed ? <Tag color="blue">已安装</Tag> : <Tag>未安装</Tag>}
              {detail.descriptor.updateAvailable ? <Tag color="processing">有更新</Tag> : null}
            </Space>

            <Tabs
              items={[
                {
                  key: "description",
                  label: "说明",
                  children: (
                    <MarkdownDescription
                      value={detail.descriptor.description}
                      emptyText="该工具没有填写说明。"
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
	                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该工具没有配置模板" />
	                  )
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
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该工具没有定时任务模板" />
                  )
                }
              ]}
            />
          </Space>
        )}
      </Drawer>
    </>
  );
}
