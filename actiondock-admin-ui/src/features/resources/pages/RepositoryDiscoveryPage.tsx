import {
  DownloadOutlined,
  PlusOutlined,
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
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  addRepositoryEventSourceLocalAsset,
  addRepositoryToolLocalAsset,
  installRepositoryPlugin,
  getRepositoryEventSource,
  getCapabilityPackage,
  getRepositorySkill,
  getRepositoryTool,
  installCapabilityPackage,
  listCapabilityPackages,
  listRepositoryEventSources,
  listRepositories,
  listRepositoryPlugins,
  listRepositorySkills,
  listRepositoryTools,
  uninstallCapabilityPackage,
  updateCapabilityPackage,
  updateRepositoryEventSourceLocalAsset,
  updateRepositoryPlugin,
  updateRepositoryToolLocalAsset
} from "../../resources/api";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { UpstreamSyncTag, getUpstreamActionLabel } from "../../../components/domain/UpstreamSyncTag";
import { RiskLevelTag } from "../../../components/domain/RiskLevelTag";
import { TrustLevelTag } from "../../../components/domain/TrustLevelTag";
import { getScriptTypeLabel } from "../../../components/domain/typeLabels";
import { MarkdownDescription } from "../../../components/common/MarkdownDescription";
import { PageHeader } from "../../../components/common/PageHeader";
import { RepositorySkillInstallDrawer } from "../../../components/repository/RepositorySkillInstallDrawer";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { ApiError } from "../../../shared/api/httpClient";
import type {
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  PluginDependency,
  RepositoryEventSourceDescriptor,
  RepositoryEventSourceDetail,
  RepositoryAiPackageDependency,
  RepositoryDefinition,
  RepositoryPluginConflict,
  RepositoryPluginDescriptor,
  RepositorySkillDescriptor,
  RepositorySkillDetail,
  RepositoryToolDescriptor,
  RepositoryToolDetail,
  ScriptDependency
} from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

const { Text } = Typography;

type InstallAction = "install" | "update";
type AddMode = "LOCKED" | "TRACKED";
type LocalAssetAction = "add-local" | "update-local";

function isLocalTool(record: RepositoryToolDescriptor): boolean {
  return Boolean(record.localState);
}

function isLocalEventSource(record: RepositoryEventSourceDescriptor): boolean {
  return Boolean(record.localState);
}

function localAssetId(record: RepositoryToolDescriptor | RepositoryEventSourceDescriptor): string {
  return record.localState?.localAssetId ?? ("toolId" in record ? record.toolId : record.eventSourceId);
}

function isTrackedLocal(record: RepositoryToolDescriptor | RepositoryEventSourceDescriptor): boolean {
  return record.localState?.mode === "TRACKED";
}

function isLockedLocal(record: RepositoryToolDescriptor | RepositoryEventSourceDescriptor): boolean {
  return record.localState?.mode === "LOCKED";
}

function getSkillInstallLabel(record: RepositorySkillDescriptor): string {
  if (!record.installed) {
    return "安装 Skill";
  }
  return record.updateAvailable ? "更新 Skill" : "已安装";
}

function renderPluginDependencies(dependencies: PluginDependency[]) {
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

function renderScriptDependencies(dependencies: ScriptDependency[]) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该脚本没有声明脚本依赖" />;
  }

  return (
    <Table<ScriptDependency>
      rowKey={(item) => `${item.scriptId}:${item.repositoryId}:${item.toolId}`}
      size="small"
      pagination={false}
      dataSource={dependencies}
      columns={[
        {
          title: "逻辑脚本 ID",
          dataIndex: "scriptId",
          key: "scriptId",
          render: (value: string) => <Text code>{value}</Text>
        },
        {
          title: "仓库脚本",
          key: "target",
          render: (_value: unknown, record) => <Text code>{`${record.repositoryId}/${record.toolId}`}</Text>
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

function renderExternalDependencies(dependencies: RepositoryAiPackageDependency[]) {
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

function renderRepositoryPlugins(
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

export function RepositoryDiscoveryPage() {
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [tools, setTools] = useState<RepositoryToolDescriptor[]>([]);
  const [eventSources, setEventSources] = useState<RepositoryEventSourceDescriptor[]>([]);
  const [packages, setPackages] = useState<CapabilityPackageDescriptor[]>([]);
  const [skills, setSkills] = useState<RepositorySkillDescriptor[]>([]);
  const [plugins, setPlugins] = useState<RepositoryPluginDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<RepositoryToolDetail | null>(null);
  const [eventSourceDetailOpen, setEventSourceDetailOpen] = useState(false);
  const [eventSourceDetailLoading, setEventSourceDetailLoading] = useState(false);
  const [eventSourceDetail, setEventSourceDetail] = useState<RepositoryEventSourceDetail | null>(null);
  const [packageActionKey, setPackageActionKey] = useState<string | null>(null);
  const [packageDetailOpen, setPackageDetailOpen] = useState(false);
  const [packageDetailLoading, setPackageDetailLoading] = useState(false);
  const [packageDetail, setPackageDetail] = useState<CapabilityPackageDetail | null>(null);
  const [skillDetailOpen, setSkillDetailOpen] = useState(false);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetail, setSkillDetail] = useState<RepositorySkillDetail | null>(null);
  const [searchText, setSearchText] = useState("");
  const [repositoryFilter, setRepositoryFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [installFilter, setInstallFilter] = useState<string>("ALL");
  const [trustFilter, setTrustFilter] = useState<string>("ALL");
  const [skillInstallDescriptor, setSkillInstallDescriptor] = useState<RepositorySkillDescriptor | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadData = async () => {
    setLoading(true);
    try {
      const [repositoryData, toolData, eventSourceData, packageData, skillData] = await Promise.all([
        listRepositories(),
        listRepositoryTools(),
        listRepositoryEventSources(),
        listCapabilityPackages(),
        listRepositorySkills()
      ]);
      const pluginData = await listRepositoryPlugins();
      setRepositories(repositoryData);
      setTools(toolData);
      setEventSources(eventSourceData);
      setPackages(packageData);
      setSkills(skillData);
      setPlugins(pluginData);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载仓库目录失败"));
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
      if (installFilter === "INSTALLED" && !isLocalTool(tool)) {
        return false;
      }
      if (installFilter === "NOT_INSTALLED" && isLocalTool(tool)) {
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
        tool.localState?.localAssetId ?? "",
        tool.description ?? "",
        tool.owner ?? "",
        tool.repositoryId
      ]
        .join(" ")
        .toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [installFilter, repositoryFilter, searchText, tools, trustFilter, typeFilter]);

  const filteredPackages = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return packages.filter((item) => {
      if (repositoryFilter !== "ALL" && item.repositoryId !== repositoryFilter) {
        return false;
      }
      if (installFilter === "INSTALLED" && !item.installed) {
        return false;
      }
      if (installFilter === "NOT_INSTALLED" && item.installed) {
        return false;
      }
      if (trustFilter === "TRUSTED" && !item.trusted) {
        return false;
      }
      if (trustFilter === "UNTRUSTED" && item.trusted) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.displayName,
        item.packageId,
        item.description ?? "",
        item.owner ?? "",
        item.repositoryId,
        ...item.tags
      ].join(" ").toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [installFilter, packages, repositoryFilter, searchText, trustFilter]);

  const filteredEventSources = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return eventSources.filter((item) => {
      if (repositoryFilter !== "ALL" && item.repositoryId !== repositoryFilter) {
        return false;
      }
      if (installFilter === "INSTALLED" && !isLocalEventSource(item)) {
        return false;
      }
      if (installFilter === "NOT_INSTALLED" && isLocalEventSource(item)) {
        return false;
      }
      if (trustFilter === "TRUSTED" && !item.trusted) {
        return false;
      }
      if (trustFilter === "UNTRUSTED" && item.trusted) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.displayName,
        item.eventSourceId,
        item.localState?.localAssetId ?? "",
        item.description ?? "",
        item.owner ?? "",
        item.repositoryId
      ].join(" ").toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [eventSources, installFilter, repositoryFilter, searchText, trustFilter]);

  const filteredSkills = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return skills.filter((item) => {
      if (repositoryFilter !== "ALL" && item.repositoryId !== repositoryFilter) {
        return false;
      }
      if (trustFilter === "TRUSTED" && !item.trusted) {
        return false;
      }
      if (trustFilter === "UNTRUSTED" && item.trusted) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.displayName,
        item.skillId,
        item.description ?? "",
        item.owner ?? "",
        item.repositoryId
      ].join(" ").toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [repositoryFilter, searchText, skills, trustFilter]);

  const filteredPlugins = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return plugins.filter((item) => {
      if (repositoryFilter !== "ALL" && item.repositoryId !== repositoryFilter) {
        return false;
      }
      if (installFilter === "INSTALLED" && !item.installed) {
        return false;
      }
      if (installFilter === "NOT_INSTALLED" && item.installed) {
        return false;
      }
      if (trustFilter === "TRUSTED" && !item.trusted) {
        return false;
      }
      if (trustFilter === "UNTRUSTED" && item.trusted) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.displayName,
        item.pluginId,
        item.description ?? "",
        item.owner ?? "",
        item.repositoryId,
        ...item.tags
      ].join(" ").toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [installFilter, plugins, repositoryFilter, searchText, trustFilter]);

  const openDetail = async (descriptor: RepositoryToolDescriptor) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await getRepositoryTool(descriptor.repositoryId, descriptor.toolId));
    } catch (error) {
      setDetail(null);
      messageApi.error(getErrorMessage(error, "加载脚本详情失败"));
    } finally {
      setDetailLoading(false);
    }
  };

  const openPackageDetail = async (descriptor: CapabilityPackageDescriptor) => {
    setPackageDetailOpen(true);
    setPackageDetailLoading(true);
    try {
      setPackageDetail(await getCapabilityPackage(descriptor.repositoryId, descriptor.packageId));
    } catch (error) {
      setPackageDetail(null);
      messageApi.error(getErrorMessage(error, "加载能力包详情失败"));
    } finally {
      setPackageDetailLoading(false);
    }
  };

  const openEventSourceDetail = async (descriptor: RepositoryEventSourceDescriptor) => {
    setEventSourceDetailOpen(true);
    setEventSourceDetailLoading(true);
    try {
      setEventSourceDetail(await getRepositoryEventSource(descriptor.repositoryId, descriptor.eventSourceId));
    } catch (error) {
      setEventSourceDetail(null);
      messageApi.error(getErrorMessage(error, "加载事件源详情失败"));
    } finally {
      setEventSourceDetailLoading(false);
    }
  };

  const fetchSkillDetail = async (descriptor: RepositorySkillDescriptor) => {
    if (skillDetail?.descriptor.repositoryId === descriptor.repositoryId && skillDetail.descriptor.skillId === descriptor.skillId) {
      return skillDetail;
    }
    return getRepositorySkill(descriptor.repositoryId, descriptor.skillId);
  };

  const openSkillDetail = async (descriptor: RepositorySkillDescriptor) => {
    setSkillDetailOpen(true);
    setSkillDetailLoading(true);
    try {
      setSkillDetail(await fetchSkillDetail(descriptor));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Skill 详情失败"));
      setSkillDetail(null);
    } finally {
      setSkillDetailLoading(false);
    }
  };

  const openSkillInstall = (descriptor: RepositorySkillDescriptor) => {
    setSkillInstallDescriptor(descriptor);
  };

  const handleRepositoryPluginAction = async (record: RepositoryPluginDescriptor, action: "install" | "update", force = false) => {
    setActionKey(`${action}:${record.repositoryId}:${record.pluginId}`);
    try {
      if (action === "install") {
        await installRepositoryPlugin(record.repositoryId, record.pluginId, { force });
      } else {
        await updateRepositoryPlugin(record.repositoryId, record.pluginId, { force });
      }
      messageApi.success(action === "install" ? "插件已安装" : "插件已更新");
      await loadData();
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else {
        messageApi.error(getErrorMessage(error, action === "install" ? "安装插件失败" : "更新插件失败"));
      }
    } finally {
      setActionKey(null);
    }
  };

  const confirmToolLocalAssetAction = async (descriptor: RepositoryToolDescriptor, action: LocalAssetAction, mode: AddMode = "LOCKED", customLocalAssetId?: string) => {
    let installSchedules = false;
    let installScriptDependencies = descriptor.scriptDependencies.length > 0;
    let installPluginDependencies = descriptor.pluginDependencies.length > 0;
    let detailForAction = detail?.descriptor.repositoryId === descriptor.repositoryId && detail?.descriptor.toolId === descriptor.toolId
      ? detail
      : null;

    if (!detailForAction) {
      try {
        detailForAction = await getRepositoryTool(descriptor.repositoryId, descriptor.toolId);
      } catch (error) {
        messageApi.error(getErrorMessage(error, "读取脚本模板失败"));
        return;
      }
    }

    const scheduleCount = detailForAction.scheduleTemplate.length;
    const localId = customLocalAssetId?.trim() || localAssetId(descriptor);

    await modal.confirm({
      title: action === "add-local" ? "添加脚本资产" : "更新脚本资产",
      okText: action === "add-local" ? "添加" : "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {descriptor.displayName} 将添加到本机脚本 ID <Text code>{localId}</Text>。
          </Text>
          {scheduleCount > 0 ? (
            <Checkbox onChange={(event) => { installSchedules = event.target.checked; }}>
              同时创建 {scheduleCount} 个定时任务模板
            </Checkbox>
          ) : (
            <Text type="secondary">该脚本没有定时任务模板。</Text>
          )}
          {descriptor.scriptDependencies.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox defaultChecked onChange={(event) => { installScriptDependencies = event.target.checked; }}>
                同时安装或更新 {descriptor.scriptDependencies.length} 个脚本依赖
              </Checkbox>
              {renderScriptDependencies(descriptor.scriptDependencies)}
            </Space>
          ) : (
            <Text type="secondary">该脚本没有声明脚本依赖。</Text>
          )}
          {descriptor.pluginDependencies.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox defaultChecked onChange={(event) => { installPluginDependencies = event.target.checked; }}>
                同时安装或更新 {descriptor.pluginDependencies.length} 个插件依赖
              </Checkbox>
              {renderPluginDependencies(descriptor.pluginDependencies)}
            </Space>
          ) : (
            <Text type="secondary">该脚本没有声明插件依赖。</Text>
          )}
          {!descriptor.trusted ? (
            <Text type="warning">当前来源仓库未标记为可信，安装前请先检查源码与配置模板。</Text>
          ) : null}
        </Space>
      )
    });

    setActionKey(`${action}:${descriptor.repositoryId}:${descriptor.toolId}`);
    try {
      const asset = action === "add-local"
        ? await addRepositoryToolLocalAsset(descriptor.repositoryId, descriptor.toolId, {
          mode,
          localAssetId: localId,
          installSchedules,
          installScriptDependencies,
          installPluginDependencies
        })
        : await updateRepositoryToolLocalAsset(descriptor.repositoryId, descriptor.toolId, {
          installSchedules,
          installScriptDependencies,
          installPluginDependencies
        });
      messageApi.success(action === "add-local" ? "脚本资产已添加" : "脚本资产已更新");
      await loadData();
      if (detailOpen) {
        await openDetail(descriptor);
      }
      if (mode === "TRACKED" && action === "add-local") {
        navigate(`/scripts/${encodeURIComponent(asset.localAssetId)}`);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else {
        messageApi.error(getErrorMessage(error, action === "add-local" ? "添加失败" : "更新失败"));
      }
    } finally {
      setActionKey(null);
    }
  };

  const confirmAddToolToLocal = async (descriptor: RepositoryToolDescriptor) => {
    const selection: { mode: AddMode; localAssetId: string } = { mode: "LOCKED", localAssetId: localAssetId(descriptor) };
    await modal.confirm({
      title: "添加脚本到本地",
      okText: "添加",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>{descriptor.displayName} 将添加为本地资产。</Text>
          <Input defaultValue={selection.localAssetId} onChange={(event) => { selection.localAssetId = event.target.value; }} />
          <Select
            defaultValue={selection.mode}
            style={{ width: "100%" }}
            onChange={(value: AddMode) => { selection.mode = value; }}
            options={[
              { value: "LOCKED", label: "锁定使用：安装只读脚本，可后续更新" },
              { value: "TRACKED", label: "可编辑跟踪：创建本地工作副本，可拉取上游" }
            ]}
          />
        </Space>
      )
    });
    await confirmToolLocalAssetAction(descriptor, "add-local", selection.mode, selection.localAssetId);
  };

  const confirmEventSourceLocalAssetAction = async (descriptor: RepositoryEventSourceDescriptor, action: LocalAssetAction, mode: AddMode = "LOCKED", customLocalAssetId?: string) => {
    let installScriptDependencies = descriptor.scriptDependencies.length > 0;
    let detailForAction = eventSourceDetail?.descriptor.repositoryId === descriptor.repositoryId
      && eventSourceDetail?.descriptor.eventSourceId === descriptor.eventSourceId
      ? eventSourceDetail
      : null;

    if (!detailForAction) {
      try {
        detailForAction = await getRepositoryEventSource(descriptor.repositoryId, descriptor.eventSourceId);
      } catch (error) {
        messageApi.error(getErrorMessage(error, "读取事件源模板失败"));
        return;
      }
    }

    const localId = customLocalAssetId?.trim() || localAssetId(descriptor);

    await modal.confirm({
      title: action === "add-local" ? "添加事件源资产" : "更新事件源资产",
      okText: action === "add-local" ? "添加" : "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {descriptor.displayName} 将添加到本机事件源 ID <Text code>{localId}</Text>。
          </Text>
          {descriptor.scriptDependencies.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox defaultChecked onChange={(event) => { installScriptDependencies = event.target.checked; }}>
                同时安装或更新 {descriptor.scriptDependencies.length} 个脚本依赖
              </Checkbox>
              {renderScriptDependencies(descriptor.scriptDependencies)}
            </Space>
          ) : (
            <Text type="secondary">该事件源没有声明脚本依赖。</Text>
          )}
          {detailForAction.triggerTemplate.length > 0 ? (
            <Text type="secondary">本次将同步 {detailForAction.triggerTemplate.length} 个事件触发器模板。</Text>
          ) : null}
          {!descriptor.trusted ? (
            <Text type="warning">当前来源仓库未标记为可信，安装前请先检查标准化 Processor、配置模板和触发器模板。</Text>
          ) : null}
        </Space>
      )
    });

    setActionKey(`${action}:${descriptor.repositoryId}:${descriptor.eventSourceId}`);
    try {
      const asset = action === "add-local"
        ? await addRepositoryEventSourceLocalAsset(descriptor.repositoryId, descriptor.eventSourceId, {
          mode,
          localAssetId: localId,
          installSchedules: false,
          installScriptDependencies
        })
        : await updateRepositoryEventSourceLocalAsset(descriptor.repositoryId, descriptor.eventSourceId, {
          installSchedules: false,
          installScriptDependencies
        });
      messageApi.success(action === "add-local" ? "事件源资产已添加" : "事件源资产已更新");
      await loadData();
      if (eventSourceDetailOpen) {
        await openEventSourceDetail(descriptor);
      }
      if (mode === "TRACKED" && action === "add-local") {
        navigate("/triggers");
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, action === "add-local" ? "添加事件源失败" : "更新事件源失败"));
    } finally {
      setActionKey(null);
    }
  };

  const confirmAddEventSourceToLocal = async (descriptor: RepositoryEventSourceDescriptor) => {
    const selection: { mode: AddMode; localAssetId: string } = { mode: "LOCKED", localAssetId: localAssetId(descriptor) };
    await modal.confirm({
      title: "添加事件源到本地",
      okText: "添加",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>{descriptor.displayName} 将添加为本地资产。</Text>
          <Input defaultValue={selection.localAssetId} onChange={(event) => { selection.localAssetId = event.target.value; }} />
          <Select
            defaultValue={selection.mode}
            style={{ width: "100%" }}
            onChange={(value: AddMode) => { selection.mode = value; }}
            options={[
              { value: "LOCKED", label: "锁定使用：安装只读事件源，可后续更新" },
              { value: "TRACKED", label: "可编辑跟踪：创建本地工作副本，可拉取上游" }
            ]}
          />
        </Space>
      )
    });
    await confirmEventSourceLocalAssetAction(descriptor, "add-local", selection.mode, selection.localAssetId);
  };

  const handlePackageInstall = async (descriptor: CapabilityPackageDescriptor, action: InstallAction) => {
    const detailForAction = packageDetail?.descriptor.repositoryId === descriptor.repositoryId
      && packageDetail?.descriptor.packageId === descriptor.packageId
      ? packageDetail
      : await getCapabilityPackage(descriptor.repositoryId, descriptor.packageId).catch((error) => {
        messageApi.error(getErrorMessage(error, "读取能力包发布计划失败"));
        return null;
      });

    if (!detailForAction) {
      return;
    }

    await modal.confirm({
      title: action === "install" ? "安装能力包" : "更新能力包",
      okText: action === "install" ? "安装" : "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Text>{descriptor.displayName} 将以整包方式安装到本机。</Text>
          <Text code>{descriptor.repositoryId}/{descriptor.packageId}@{descriptor.version}</Text>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="入口">{detailForAction.releaseFile.entries.map((item) => item.displayName).join(", ") || "-"}</Descriptions.Item>
            <Descriptions.Item label="脚本">{detailForAction.releaseFile.scripts.length}</Descriptions.Item>
            <Descriptions.Item label="Agent">{detailForAction.releaseFile.agents.length}</Descriptions.Item>
            <Descriptions.Item label="工具集">{detailForAction.releaseFile.toolsets.length}</Descriptions.Item>
            <Descriptions.Item label="模型">{detailForAction.releaseFile.models.length}</Descriptions.Item>
            <Descriptions.Item label="配置模板">{detailForAction.configTemplate.length}</Descriptions.Item>
            <Descriptions.Item label="定时任务模板">{detailForAction.scheduleTemplate.length}</Descriptions.Item>
            <Descriptions.Item label="执行预设">{detailForAction.presetTemplate.length}</Descriptions.Item>
          </Descriptions>
          {!descriptor.trusted ? (
            <Text type="warning">当前来源仓库未标记为可信，安装前请先检查闭包、配置模板和依赖。</Text>
          ) : null}
        </Space>
      )
    });

    setPackageActionKey(`${action}:${descriptor.repositoryId}:${descriptor.packageId}`);
    try {
      if (action === "install") {
        await installCapabilityPackage(descriptor.repositoryId, descriptor.packageId);
      } else {
        await updateCapabilityPackage(descriptor.repositoryId, descriptor.packageId);
      }
      messageApi.success(action === "install" ? "能力包已安装" : "能力包已更新");
      await loadData();
      if (packageDetailOpen) {
        await openPackageDetail(descriptor);
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, action === "install" ? "安装能力包失败" : "更新能力包失败"));
    } finally {
      setPackageActionKey(null);
    }
  };

  const handlePackageUninstall = async (descriptor: CapabilityPackageDescriptor) => {
    await modal.confirm({
      title: "卸载能力包",
      okText: "卸载",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>将删除该能力包安装出的脚本、Agent、工具集、模型、定时任务和执行预设。</Text>
          <Text code>{descriptor.repositoryId}/{descriptor.packageId}</Text>
        </Space>
      )
    });
    setPackageActionKey(`uninstall:${descriptor.repositoryId}:${descriptor.packageId}`);
    try {
      await uninstallCapabilityPackage(descriptor.repositoryId, descriptor.packageId);
      messageApi.success("能力包已卸载");
      setPackageDetailOpen(false);
      setPackageDetail(null);
      await loadData();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "卸载能力包失败"));
    } finally {
      setPackageActionKey(null);
    }
  };

  const toolColumns: ColumnsType<RepositoryToolDescriptor> = [
    {
      title: "脚本资产",
      key: "tool",
      render: (_value: unknown, record) => (
        <Space wrap size={[8, 8]}>
          <TableLinkCell onClick={() => void openDetail(record)}>{record.displayName}</TableLinkCell>
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
              onClick={() => navigate(`/scripts/${localAssetId(record)}`)}
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
              onClick={() => void confirmToolLocalAssetAction(record, "update-local")}
            >
              {record.localState?.updateAvailable ? "更新" : "已添加"}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.toolId}`}
              onClick={() => void confirmAddToolToLocal(record)}
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
          <TableLinkCell onClick={() => void openPackageDetail(record)}>{record.displayName}</TableLinkCell>
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
                onClick={() => void handlePackageInstall(record, "update")}
              >
                {record.updateAvailable ? "更新" : "已安装"}
              </Button>
              <Button
                size="small"
                danger
                loading={packageActionKey === `uninstall:${record.repositoryId}:${record.packageId}`}
                onClick={() => void handlePackageUninstall(record)}
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
              onClick={() => void handlePackageInstall(record, "install")}
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
          <TableLinkCell onClick={() => void openEventSourceDetail(record)}>{record.displayName}</TableLinkCell>
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
              onClick={() => navigate("/triggers")}
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
              onClick={() => void confirmEventSourceLocalAssetAction(record, "update-local")}
            >
              {record.localState?.updateAvailable ? "更新" : "已添加"}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={actionKey === `add-local:${record.repositoryId}:${record.eventSourceId}`}
              onClick={() => void confirmAddEventSourceToLocal(record)}
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
          <TableLinkCell onClick={() => void openSkillDetail(record)}>{record.displayName}</TableLinkCell>
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
          <Button size="small" onClick={() => void openSkillDetail(record)}>
            查看
          </Button>
          <Button
            size="small"
            type={record.updateAvailable ? "primary" : "default"}
            ghost={record.updateAvailable}
            disabled={record.installed && !record.updateAvailable}
            onClick={() => openSkillInstall(record)}
          >
            {getSkillInstallLabel(record)}
          </Button>
        </Space>
      )
    }
  ];

  const packageDrawerActions = packageDetail ? (
    <Space>
      {packageDetail.descriptor.installed ? (
        <>
          <Button
            type={packageDetail.descriptor.updateAvailable ? "primary" : "default"}
            ghost={packageDetail.descriptor.updateAvailable}
            disabled={!packageDetail.descriptor.updateAvailable}
            loading={packageActionKey === `update:${packageDetail.descriptor.repositoryId}:${packageDetail.descriptor.packageId}`}
            onClick={() => void handlePackageInstall(packageDetail.descriptor, "update")}
          >
            {packageDetail.descriptor.updateAvailable ? "更新能力包" : "已安装"}
          </Button>
          <Button
            danger
            loading={packageActionKey === `uninstall:${packageDetail.descriptor.repositoryId}:${packageDetail.descriptor.packageId}`}
            onClick={() => void handlePackageUninstall(packageDetail.descriptor)}
          >
            卸载
          </Button>
        </>
      ) : (
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={packageActionKey === `install:${packageDetail.descriptor.repositoryId}:${packageDetail.descriptor.packageId}`}
          onClick={() => void handlePackageInstall(packageDetail.descriptor, "install")}
        >
          安装能力包
        </Button>
      )}
    </Space>
  ) : null;

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="发现"
          meta={<Text type="secondary">发现脚本、事件源、能力包、插件和 Skill，支持安装、升级与同步。</Text>}
          actions={(
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/packages/publish")}>
                发布能力包
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                刷新目录
              </Button>
            </Space>
          )}
        />

        <Card>
          <Space wrap size={[12, 12]} style={{ width: "100%" }}>
            <Input.Search
              allowClear
              value={searchText}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
              placeholder="搜索能力包、脚本、来源仓库或维护人"
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
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部脚本类型" },
                { value: "PYTHON", label: "Python" },
                { value: "GROOVY", label: "Groovy" }
              ]}
            />
          </Space>
        </Card>

        <Card>
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
                children: renderRepositoryPlugins(filteredPlugins, actionKey, handleRepositoryPluginAction)
              }
            ]}
          />
        </Card>
      </Space>

      <Drawer
        title={detail?.descriptor.displayName || "脚本资产详情"}
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
                <Button onClick={() => navigate(`/scripts/${localAssetId(detail.descriptor)}`)}>
                  {getUpstreamActionLabel(detail.descriptor.localState?.syncState)}
                </Button>
              ) : isLockedLocal(detail.descriptor) ? (
                <Button
                  type={detail.descriptor.localState?.updateAvailable ? "primary" : "default"}
                  ghost={detail.descriptor.localState?.updateAvailable}
                  disabled={!detail.descriptor.localState?.updateAvailable}
                  loading={actionKey === `update-local:${detail.descriptor.repositoryId}:${detail.descriptor.toolId}`}
                  onClick={() => void confirmToolLocalAssetAction(detail.descriptor, "update-local")}
                >
                  {detail.descriptor.localState?.updateAvailable ? "更新脚本" : "已添加"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={actionKey === `add-local:${detail.descriptor.repositoryId}:${detail.descriptor.toolId}`}
                  onClick={() => void confirmAddToolToLocal(detail.descriptor)}
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
        onClose={() => setEventSourceDetailOpen(false)}
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
                <Button onClick={() => navigate("/triggers")}>
                  {getUpstreamActionLabel(eventSourceDetail.descriptor.localState?.syncState)}
                </Button>
              ) : isLockedLocal(eventSourceDetail.descriptor) ? (
                <Button
                  type={eventSourceDetail.descriptor.localState?.updateAvailable ? "primary" : "default"}
                  ghost={eventSourceDetail.descriptor.localState?.updateAvailable}
                  disabled={!eventSourceDetail.descriptor.localState?.updateAvailable}
                  loading={actionKey === `update-local:${eventSourceDetail.descriptor.repositoryId}:${eventSourceDetail.descriptor.eventSourceId}`}
                  onClick={() => void confirmEventSourceLocalAssetAction(eventSourceDetail.descriptor, "update-local")}
                >
                  {eventSourceDetail.descriptor.localState?.updateAvailable ? "更新事件源" : "已添加"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={actionKey === `add-local:${eventSourceDetail.descriptor.repositoryId}:${eventSourceDetail.descriptor.eventSourceId}`}
                  onClick={() => void confirmAddEventSourceToLocal(eventSourceDetail.descriptor)}
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
        onClose={() => setPackageDetailOpen(false)}
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
        onClose={() => setSkillDetailOpen(false)}
        width={860}
        destroyOnHidden
        extra={skillDetail ? (
          <Button
            type="primary"
            disabled={skillDetail.descriptor.installed && !skillDetail.descriptor.updateAvailable}
            onClick={() => openSkillInstall(skillDetail.descriptor)}
          >
            {skillDetail.descriptor.updateAvailable
              ? "更新"
              : skillDetail.descriptor.installed
                ? "已安装"
                : "安装"}
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
      <RepositorySkillInstallDrawer
        open={skillInstallDescriptor !== null}
        descriptor={skillInstallDescriptor}
        onClose={() => setSkillInstallDescriptor(null)}
        onSuccess={() => {
          setSkillInstallDescriptor(null);
          void loadData();
        }}
      />
    </>
  );
}
