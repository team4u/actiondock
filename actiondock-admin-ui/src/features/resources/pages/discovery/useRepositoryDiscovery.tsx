import { Checkbox, Descriptions, Input, Modal, Select, Space, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import {
  addRepositoryEventSourceLocalAsset,
  addRepositoryToolLocalAsset,
  getCapabilityPackage,
  getRepositoryEventSource,
  getRepositorySkill,
  getRepositoryTool,
  installCapabilityPackage,
  installRepositoryPlugin,
  listCapabilityPackages,
  listRepositories,
  listRepositoryEventSources,
  listRepositoryPlugins,
  listRepositorySkills,
  listRepositoryTools,
  uninstallCapabilityPackage,
  updateCapabilityPackage,
  updateRepositoryEventSourceLocalAsset,
  updateRepositoryPlugin,
  updateRepositoryToolLocalAsset
} from "../../api";
import { ApiError } from "../../../../shared/api/httpClient";
import type {
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  RepositoryDefinition,
  RepositoryEventSourceDescriptor,
  RepositoryEventSourceDetail,
  RepositoryPluginDescriptor,
  RepositorySkillDescriptor,
  RepositorySkillDetail,
  RepositoryToolDescriptor,
  RepositoryToolDetail
} from "../../../../shared/types";
import { getErrorMessage } from "../../../../services/utils";
import {
  filterCapabilityPackages,
  filterRepositoryEventSources,
  filterRepositoryPlugins,
  filterRepositorySkills,
  filterRepositoryTools,
  getSkillInstallLabel,
  isLocalEventSource,
  isLocalTool,
  localAssetId,
  renderPluginDependencies,
  renderScriptDependencies
} from "./discoveryHelpers";
import type {
  AddMode,
  InstallAction,
  InstallFilter,
  LocalAssetAction,
  TrustFilter,
  TypeFilter
} from "./types";

const { Text } = Typography;

interface UseRepositoryDiscoveryParams {
  messageApi: MessageInstance;
  modal: ReturnType<typeof Modal.useModal>[0];
  navigate: NavigateFunction;
}

export function useRepositoryDiscovery({ messageApi, modal, navigate }: UseRepositoryDiscoveryParams) {
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [tools, setTools] = useState<RepositoryToolDescriptor[]>([]);
  const [eventSources, setEventSources] = useState<RepositoryEventSourceDescriptor[]>([]);
  const [packages, setPackages] = useState<CapabilityPackageDescriptor[]>([]);
  const [skills, setSkills] = useState<RepositorySkillDescriptor[]>([]);
  const [plugins, setPlugins] = useState<RepositoryPluginDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [packageActionKey, setPackageActionKey] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<RepositoryToolDetail | null>(null);

  const [eventSourceDetailOpen, setEventSourceDetailOpen] = useState(false);
  const [eventSourceDetailLoading, setEventSourceDetailLoading] = useState(false);
  const [eventSourceDetail, setEventSourceDetail] = useState<RepositoryEventSourceDetail | null>(null);

  const [packageDetailOpen, setPackageDetailOpen] = useState(false);
  const [packageDetailLoading, setPackageDetailLoading] = useState(false);
  const [packageDetail, setPackageDetail] = useState<CapabilityPackageDetail | null>(null);

  const [skillDetailOpen, setSkillDetailOpen] = useState(false);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetail, setSkillDetail] = useState<RepositorySkillDetail | null>(null);
  const [skillInstallDescriptor, setSkillInstallDescriptor] = useState<RepositorySkillDescriptor | null>(null);

  const [searchText, setSearchText] = useState("");
  const [repositoryFilter, setRepositoryFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [installFilter, setInstallFilter] = useState<InstallFilter>("ALL");
  const [trustFilter, setTrustFilter] = useState<TrustFilter>("ALL");

  const loadData = useCallback(async () => {
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
  }, [messageApi]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredTools = useMemo(() => filterRepositoryTools(tools, {
    searchText,
    repositoryFilter,
    typeFilter,
    installFilter,
    trustFilter
  }), [installFilter, repositoryFilter, searchText, tools, trustFilter, typeFilter]);

  const filteredPackages = useMemo(() => filterCapabilityPackages(packages, {
    searchText,
    repositoryFilter,
    installFilter,
    trustFilter
  }), [installFilter, packages, repositoryFilter, searchText, trustFilter]);

  const filteredEventSources = useMemo(() => filterRepositoryEventSources(eventSources, {
    searchText,
    repositoryFilter,
    installFilter,
    trustFilter
  }), [eventSources, installFilter, repositoryFilter, searchText, trustFilter]);

  const filteredSkills = useMemo(() => filterRepositorySkills(skills, {
    searchText,
    repositoryFilter,
    trustFilter
  }), [repositoryFilter, searchText, skills, trustFilter]);

  const filteredPlugins = useMemo(() => filterRepositoryPlugins(plugins, {
    searchText,
    repositoryFilter,
    installFilter,
    trustFilter
  }), [installFilter, plugins, repositoryFilter, searchText, trustFilter]);

  const openDetail = useCallback(async (descriptor: RepositoryToolDescriptor) => {
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
  }, [messageApi]);

  const openPackageDetail = useCallback(async (descriptor: CapabilityPackageDescriptor) => {
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
  }, [messageApi]);

  const openEventSourceDetail = useCallback(async (descriptor: RepositoryEventSourceDescriptor) => {
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
  }, [messageApi]);

  const fetchSkillDetail = useCallback(async (descriptor: RepositorySkillDescriptor) => {
    if (skillDetail?.descriptor.repositoryId === descriptor.repositoryId
      && skillDetail.descriptor.skillId === descriptor.skillId) {
      return skillDetail;
    }
    return getRepositorySkill(descriptor.repositoryId, descriptor.skillId);
  }, [skillDetail]);

  const openSkillDetail = useCallback(async (descriptor: RepositorySkillDescriptor) => {
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
  }, [fetchSkillDetail, messageApi]);

  const openSkillInstall = useCallback((descriptor: RepositorySkillDescriptor) => {
    setSkillInstallDescriptor(descriptor);
  }, []);

  const closeSkillInstall = useCallback(() => {
    setSkillInstallDescriptor(null);
  }, []);

  const handleRepositoryPluginAction = useCallback(async (
    record: RepositoryPluginDescriptor,
    action: "install" | "update",
    force = false
  ) => {
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
  }, [loadData, messageApi]);

  const confirmToolLocalAssetAction = useCallback(async (
    descriptor: RepositoryToolDescriptor,
    action: LocalAssetAction,
    mode: AddMode = "LOCKED",
    customLocalAssetId?: string
  ) => {
    let installSchedules = false;
    let installScriptDependencies = descriptor.scriptDependencies.length > 0;
    let installPluginDependencies = descriptor.pluginDependencies.length > 0;
    let detailForAction = detail?.descriptor.repositoryId === descriptor.repositoryId
      && detail.descriptor.toolId === descriptor.toolId
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
              {renderScriptDependencies(descriptor.scriptDependencies, {
                currentRepositoryId: descriptor.repositoryId,
                availableTools: tools
              })}
              <Text type="secondary">将按依赖声明自动补齐本地脚本版本。</Text>
            </Space>
          ) : (
            <Text type="secondary">该脚本没有声明脚本依赖。</Text>
          )}
          {descriptor.pluginDependencies.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox defaultChecked onChange={(event) => { installPluginDependencies = event.target.checked; }}>
                同时安装或更新 {descriptor.pluginDependencies.length} 个插件依赖
              </Checkbox>
              {renderPluginDependencies(descriptor.pluginDependencies, {
                currentRepositoryId: descriptor.repositoryId,
                availablePlugins: plugins
              })}
              <Text type="secondary">插件依赖会按当前仓库版本要求解析。</Text>
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
  }, [detail, detailOpen, loadData, messageApi, modal, navigate, openDetail]);

  const confirmAddToolToLocal = useCallback(async (descriptor: RepositoryToolDescriptor) => {
    const selection: { mode: AddMode; localAssetId: string } = {
      mode: "LOCKED",
      localAssetId: localAssetId(descriptor)
    };
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "添加脚本到本地",
        okText: "添加",
        cancelText: "取消",
        onOk: () => { resolve(true); },
        onCancel: () => { resolve(false); },
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
    });
    if (!confirmed) {
      return;
    }
    await confirmToolLocalAssetAction(descriptor, "add-local", selection.mode, selection.localAssetId);
  }, [confirmToolLocalAssetAction, modal]);

  const confirmEventSourceLocalAssetAction = useCallback(async (
    descriptor: RepositoryEventSourceDescriptor,
    action: LocalAssetAction,
    mode: AddMode = "LOCKED",
    customLocalAssetId?: string
  ) => {
    let installScriptDependencies = descriptor.scriptDependencies.length > 0;
    let detailForAction = eventSourceDetail?.descriptor.repositoryId === descriptor.repositoryId
      && eventSourceDetail.descriptor.eventSourceId === descriptor.eventSourceId
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
              {renderScriptDependencies(descriptor.scriptDependencies, {
                currentRepositoryId: descriptor.repositoryId,
                availableTools: tools
              })}
              <Text type="secondary">目标脚本会按模板依赖自动补齐。</Text>
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
  }, [eventSourceDetail, eventSourceDetailOpen, loadData, messageApi, modal, navigate, openEventSourceDetail]);

  const confirmAddEventSourceToLocal = useCallback(async (descriptor: RepositoryEventSourceDescriptor) => {
    const selection: { mode: AddMode; localAssetId: string } = {
      mode: "LOCKED",
      localAssetId: localAssetId(descriptor)
    };
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "添加事件源到本地",
        okText: "添加",
        cancelText: "取消",
        onOk: () => { resolve(true); },
        onCancel: () => { resolve(false); },
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
    });
    if (!confirmed) {
      return;
    }
    await confirmEventSourceLocalAssetAction(descriptor, "add-local", selection.mode, selection.localAssetId);
  }, [confirmEventSourceLocalAssetAction, modal]);

  const handlePackageInstall = useCallback(async (descriptor: CapabilityPackageDescriptor, action: InstallAction) => {
    const detailForAction = packageDetail?.descriptor.repositoryId === descriptor.repositoryId
      && packageDetail.descriptor.packageId === descriptor.packageId
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
  }, [loadData, messageApi, modal, openPackageDetail, packageDetail, packageDetailOpen]);

  const handlePackageUninstall = useCallback(async (descriptor: CapabilityPackageDescriptor) => {
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
  }, [loadData, messageApi, modal]);

  return {
    repositories,
    tools,
    loading,
    actionKey,
    packageActionKey,
    filteredTools,
    filteredEventSources,
    filteredPackages,
    filteredSkills,
    filteredPlugins,
    plugins,
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
    skillInstallDescriptor,
    searchText,
    repositoryFilter,
    typeFilter,
    installFilter,
    trustFilter,
    setSearchText,
    setRepositoryFilter,
    setTypeFilter,
    setInstallFilter,
    setTrustFilter,
    loadData,
    openDetail,
    openPackageDetail,
    openEventSourceDetail,
    openSkillDetail,
    openSkillInstall,
    closeSkillInstall,
    handleRepositoryPluginAction,
    confirmToolLocalAssetAction,
    confirmAddToolToLocal,
    confirmEventSourceLocalAssetAction,
    confirmAddEventSourceToLocal,
    handlePackageInstall,
    handlePackageUninstall,
    closeDetail: () => setDetailOpen(false),
    closeEventSourceDetail: () => setEventSourceDetailOpen(false),
    closePackageDetail: () => setPackageDetailOpen(false),
    closeSkillDetail: () => setSkillDetailOpen(false)
  };
}
