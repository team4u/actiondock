import { App, Checkbox, Descriptions, Input, Select, Space, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import {
  addRepositoryWebhookLocalAsset,
  addRepositoryToolLocalAsset,
  addRepositoryPlaybookLocalAsset,
  getCapabilityPackage,
  getRepositoryWebhook,
  getRepositorySkill,
  getRepositoryScript,
  getRepositoryKnowledge,
  getRepositoryPlaybook,
  installCapabilityPackage,
  installRepositoryKnowledge,
  installRepositoryPlugin,
  listInstalledResources,
  listCapabilityPackages,
  listRepositories,
  listRepositoryWebhooks,
  listRepositoryPlugins,
  listRepositorySkills,
  listRepositoryKnowledge,
  listRepositoryPlaybooks,
  listRepositoryScripts,
  uninstallCapabilityPackage,
  uninstallInstalledResource,
  uninstallRepositoryKnowledge,
  updateCapabilityPackage,
  updateRepositoryWebhookLocalAsset,
  updateRepositoryPlugin,
  updateRepositoryPlaybookLocalAsset,
  updateRepositoryToolLocalAsset
} from "../../api";
import { ApiError } from "../../../../shared/api/httpClient";
import type {
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  InstalledResourceView,
  RepositoryDefinition,
  RepositoryKnowledgeDescriptor,
  RepositoryKnowledgeDetail,
  RepositoryPlaybookDescriptor,
  RepositoryPlaybookDetail,
  RepositoryWebhookDescriptor,
  RepositoryWebhookDetail,
  RepositoryPluginDescriptor,
  RepositorySkillDescriptor,
  RepositorySkillDetail,
  RepositoryScriptDescriptor,
  RepositoryScriptDetail
} from "../../../../shared/types";
import { getErrorMessage } from "../../../../services/utils";
import {
  filterCapabilityPackages,
  filterRepositoryKnowledge,
  filterRepositoryPlaybooks,
  filterRepositoryWebhooks,
  filterRepositoryPlugins,
  filterRepositorySkills,
  filterRepositoryTools,
  getSkillInstallLabel,
  isLocalWebhook,
  isLocalPlaybook,
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
  modal: ReturnType<typeof App.useApp>["modal"];
  navigate: NavigateFunction;
}

export function useRepositoryDiscovery({ messageApi, modal, navigate }: UseRepositoryDiscoveryParams) {
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [tools, setTools] = useState<RepositoryScriptDescriptor[]>([]);
  const [webhooks, setWebhooks] = useState<RepositoryWebhookDescriptor[]>([]);
  const [packages, setPackages] = useState<CapabilityPackageDescriptor[]>([]);
  const [skills, setSkills] = useState<RepositorySkillDescriptor[]>([]);
  const [plugins, setPlugins] = useState<RepositoryPluginDescriptor[]>([]);
  const [knowledge, setKnowledge] = useState<RepositoryKnowledgeDescriptor[]>([]);
  const [playbooks, setPlaybooks] = useState<RepositoryPlaybookDescriptor[]>([]);
  const [installedResources, setInstalledResources] = useState<InstalledResourceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [packageActionKey, setPackageActionKey] = useState<string | null>(null);
  const [installedResourceActionKey, setInstalledResourceActionKey] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<RepositoryScriptDetail | null>(null);

  const [webhookDetailOpen, setWebhookDetailOpen] = useState(false);
  const [webhookDetailLoading, setWebhookDetailLoading] = useState(false);
  const [webhookDetail, setWebhookDetail] = useState<RepositoryWebhookDetail | null>(null);

  const [packageDetailOpen, setPackageDetailOpen] = useState(false);
  const [packageDetailLoading, setPackageDetailLoading] = useState(false);
  const [packageDetail, setPackageDetail] = useState<CapabilityPackageDetail | null>(null);

  const [skillDetailOpen, setSkillDetailOpen] = useState(false);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetail, setSkillDetail] = useState<RepositorySkillDetail | null>(null);
  const [skillInstallDescriptor, setSkillInstallDescriptor] = useState<RepositorySkillDescriptor | null>(null);

  const [knowledgeDetailOpen, setKnowledgeDetailOpen] = useState(false);
  const [knowledgeDetailLoading, setKnowledgeDetailLoading] = useState(false);
  const [knowledgeDetail, setKnowledgeDetail] = useState<RepositoryKnowledgeDetail | null>(null);
  const [knowledgeActionKey, setKnowledgeActionKey] = useState<string | null>(null);
  const [playbookDetailOpen, setPlaybookDetailOpen] = useState(false);
  const [playbookDetailLoading, setPlaybookDetailLoading] = useState(false);
  const [playbookDetail, setPlaybookDetail] = useState<RepositoryPlaybookDetail | null>(null);

  const [searchText, setSearchText] = useState("");
  const [repositoryFilter, setRepositoryFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [installFilter, setInstallFilter] = useState<InstallFilter>("ALL");
  const [trustFilter, setTrustFilter] = useState<TrustFilter>("ALL");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [repositoryData, toolData, webhookData, playbookData, packageData, skillData, installedResourceData] = await Promise.all([
        listRepositories(),
        listRepositoryScripts(),
        listRepositoryWebhooks(),
        listRepositoryPlaybooks(),
        listCapabilityPackages(),
        listRepositorySkills(),
        listInstalledResources()
      ]);
      const [pluginData, knowledgeData] = await Promise.all([
        listRepositoryPlugins(),
        listRepositoryKnowledge()
      ]);
      setRepositories(repositoryData);
      setTools(toolData);
      setWebhooks(webhookData);
      setPlaybooks(playbookData);
      setPackages(packageData);
      setSkills(skillData);
      setPlugins(pluginData);
      setKnowledge(knowledgeData);
      setInstalledResources(installedResourceData);
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

  const filteredWebhooks = useMemo(() => filterRepositoryWebhooks(webhooks, {
    searchText,
    repositoryFilter,
    installFilter,
    trustFilter
  }), [webhooks, installFilter, repositoryFilter, searchText, trustFilter]);

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

  const filteredKnowledge = useMemo(() => filterRepositoryKnowledge(knowledge, {
    searchText,
    repositoryFilter,
    installFilter,
    trustFilter
  }), [installFilter, knowledge, repositoryFilter, searchText, trustFilter]);

  const filteredPlaybooks = useMemo(() => filterRepositoryPlaybooks(playbooks, {
    searchText,
    repositoryFilter,
    installFilter,
    trustFilter
  }), [installFilter, playbooks, repositoryFilter, searchText, trustFilter]);

  const filteredInstalledResources = useMemo(() => {
    const tokens = searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return installedResources.filter((resource) => {
      if (repositoryFilter !== "ALL" && resource.repositoryId !== repositoryFilter) {
        return false;
      }
      if (installFilter === "NOT_INSTALLED") {
        return false;
      }
      if (installFilter === "ORPHAN" && !resource.orphan) {
        return false;
      }
      const haystack = [
        resource.displayName,
        resource.id,
        resource.description,
        resource.repositoryId,
        resource.repositoryName,
        resource.upstreamId,
        resource.version
      ]
        .filter((part): part is string => Boolean(part))
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [installFilter, installedResources, repositoryFilter, searchText]);

  const openDetail = useCallback(async (descriptor: RepositoryScriptDescriptor) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await getRepositoryScript(descriptor.repositoryId, descriptor.scriptId));
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

  const openWebhookDetail = useCallback(async (descriptor: RepositoryWebhookDescriptor) => {
    setWebhookDetailOpen(true);
    setWebhookDetailLoading(true);
    try {
      setWebhookDetail(await getRepositoryWebhook(descriptor.repositoryId, descriptor.webhookId));
    } catch (error) {
      setWebhookDetail(null);
      messageApi.error(getErrorMessage(error, "加载Webhook详情失败"));
    } finally {
      setWebhookDetailLoading(false);
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

  const openKnowledgeDetail = useCallback(async (descriptor: RepositoryKnowledgeDescriptor) => {
    setKnowledgeDetailOpen(true);
    setKnowledgeDetailLoading(true);
    try {
      setKnowledgeDetail(await getRepositoryKnowledge(descriptor.repositoryId, descriptor.knowledgeId));
    } catch (error) {
      setKnowledgeDetail(null);
      messageApi.error(getErrorMessage(error, "加载知识源详情失败"));
    } finally {
      setKnowledgeDetailLoading(false);
    }
  }, [messageApi]);

  const openPlaybookDetail = useCallback(async (descriptor: RepositoryPlaybookDescriptor) => {
    setPlaybookDetailOpen(true);
    setPlaybookDetailLoading(true);
    try {
      setPlaybookDetail(await getRepositoryPlaybook(descriptor.repositoryId, descriptor.playbookId));
    } catch (error) {
      setPlaybookDetail(null);
      messageApi.error(getErrorMessage(error, "加载任务手册详情失败"));
    } finally {
      setPlaybookDetailLoading(false);
    }
  }, [messageApi]);

  const handleKnowledgeInstall = useCallback(async (descriptor: RepositoryKnowledgeDescriptor) => {
    setKnowledgeActionKey(`install:${descriptor.repositoryId}:${descriptor.knowledgeId}`);
    try {
      await installRepositoryKnowledge(descriptor.repositoryId, descriptor.knowledgeId);
      messageApi.success("知识源已安装");
      await loadData();
      if (knowledgeDetailOpen) {
        await openKnowledgeDetail(descriptor);
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装知识源失败"));
    } finally {
      setKnowledgeActionKey(null);
    }
  }, [knowledgeDetailOpen, loadData, messageApi, openKnowledgeDetail]);

  const handleKnowledgeUninstall = useCallback((descriptor: RepositoryKnowledgeDescriptor) => {
    modal.confirm({
      title: "卸载知识源",
      okText: "卸载",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>将删除知识源安装时自动创建的项目仓库。</Text>
          <Text code>{descriptor.repositoryId}/{descriptor.knowledgeId}</Text>
        </Space>
      ),
      onOk: async () => {
        setKnowledgeActionKey(`uninstall:${descriptor.repositoryId}:${descriptor.knowledgeId}`);
        try {
          await uninstallRepositoryKnowledge(descriptor.repositoryId, descriptor.knowledgeId);
          messageApi.success("知识源已卸载");
          setKnowledgeDetailOpen(false);
          setKnowledgeDetail(null);
          await loadData();
        } catch (error) {
          messageApi.error(getErrorMessage(error, "卸载知识源失败"));
        } finally {
          setKnowledgeActionKey(null);
        }
      }
    });
  }, [loadData, messageApi, modal]);

  const handlePlaybookLocalAssetAction = useCallback(async (descriptor: RepositoryPlaybookDescriptor, action: LocalAssetAction) => {
    setActionKey(`${action}:${descriptor.repositoryId}:${descriptor.playbookId}`);
    try {
      if (action === "add-local") {
        await addRepositoryPlaybookLocalAsset(descriptor.repositoryId, descriptor.playbookId);
        messageApi.success("任务手册已安装");
      } else {
        await updateRepositoryPlaybookLocalAsset(descriptor.repositoryId, descriptor.playbookId);
        messageApi.success("任务手册已更新");
      }
      await loadData();
      if (playbookDetailOpen) {
        await openPlaybookDetail(descriptor);
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, action === "add-local" ? "安装任务手册失败" : "更新任务手册失败"));
    } finally {
      setActionKey(null);
    }
  }, [loadData, messageApi, openPlaybookDetail, playbookDetailOpen]);

  const confirmAddPlaybookToLocal = useCallback(async (descriptor: RepositoryPlaybookDescriptor) => {
    const selection: { mode: AddMode; localAssetId: string } = {
      mode: "LOCKED",
      localAssetId: localAssetId(descriptor)
    };
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "添加任务手册到本地",
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
                { value: "LOCKED", label: "锁定使用：安装只读任务手册，可后续更新" },
                { value: "TRACKED", label: "可编辑跟踪：创建本地可编辑副本，可发布到仓库" }
              ]}
            />
          </Space>
        )
      });
    });
    if (!confirmed) {
      return;
    }
    setActionKey(`add-local:${descriptor.repositoryId}:${descriptor.playbookId}`);
    try {
      const asset = await addRepositoryPlaybookLocalAsset(descriptor.repositoryId, descriptor.playbookId, {
        mode: selection.mode,
        localAssetId: selection.localAssetId.trim() || localAssetId(descriptor),
        installSchedules: false,
        installScriptDependencies: false,
        installPluginDependencies: false,
        forcePluginUpgrade: false
      });
      messageApi.success("任务手册已添加");
      await loadData();
      if (playbookDetailOpen) {
        await openPlaybookDetail(descriptor);
      }
      if (selection.mode === "TRACKED") {
        navigate("/playbooks");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else {
        messageApi.error(getErrorMessage(error, "添加任务手册失败"));
      }
    } finally {
      setActionKey(null);
    }
  }, [loadData, messageApi, modal, navigate, openPlaybookDetail, playbookDetailOpen]);

  const handlePlaybookUninstall = useCallback((descriptor: RepositoryPlaybookDescriptor) => {
    const installedId = descriptor.localState?.localAssetId;
    if (!installedId) {
      return;
    }
    modal.confirm({
      title: "卸载任务手册",
      okText: "卸载",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>将删除仓库安装的托管任务手册；若任务分组不再被引用，也会一并删除。</Text>
          <Text code>{installedId}</Text>
        </Space>
      ),
      onOk: async () => {
        setActionKey(`uninstall:${descriptor.repositoryId}:${descriptor.playbookId}`);
        try {
          await uninstallInstalledResource("PLAYBOOK", installedId);
          messageApi.success("任务手册已卸载");
          setPlaybookDetailOpen(false);
          setPlaybookDetail(null);
          await loadData();
        } catch (error) {
          messageApi.error(getErrorMessage(error, "卸载任务手册失败"));
        } finally {
          setActionKey(null);
        }
      }
    });
  }, [loadData, messageApi, modal]);

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
    descriptor: RepositoryScriptDescriptor,
    action: LocalAssetAction,
    mode: AddMode = "LOCKED",
    customLocalAssetId?: string
  ) => {
    let installSchedules = false;
    let installScriptDependencies = descriptor.scriptDependencies.length > 0;
    let installPluginDependencies = descriptor.pluginDependencies.length > 0;
    let detailForAction = detail?.descriptor.repositoryId === descriptor.repositoryId
      && detail.descriptor.scriptId === descriptor.scriptId
      ? detail
      : null;

    if (!detailForAction) {
      try {
        detailForAction = await getRepositoryScript(descriptor.repositoryId, descriptor.scriptId);
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

    setActionKey(`${action}:${descriptor.repositoryId}:${descriptor.scriptId}`);
    try {
      const asset = action === "add-local"
        ? await addRepositoryToolLocalAsset(descriptor.repositoryId, descriptor.scriptId, {
          mode,
          localAssetId: localId,
          installSchedules,
          installScriptDependencies,
          installPluginDependencies
        })
        : await updateRepositoryToolLocalAsset(descriptor.repositoryId, descriptor.scriptId, {
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

  const confirmAddToolToLocal = useCallback(async (descriptor: RepositoryScriptDescriptor) => {
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

  const confirmWebhookLocalAssetAction = useCallback(async (
    descriptor: RepositoryWebhookDescriptor,
    action: LocalAssetAction,
    mode: AddMode = "LOCKED",
    customLocalAssetId?: string
  ) => {
    let installScriptDependencies = descriptor.scriptDependencies.length > 0;
    let detailForAction = webhookDetail?.descriptor.repositoryId === descriptor.repositoryId
      && webhookDetail.descriptor.webhookId === descriptor.webhookId
      ? webhookDetail
      : null;

    if (!detailForAction) {
      try {
        detailForAction = await getRepositoryWebhook(descriptor.repositoryId, descriptor.webhookId);
      } catch (error) {
        messageApi.error(getErrorMessage(error, "读取Webhook模板失败"));
        return;
      }
    }

    const localId = customLocalAssetId?.trim() || localAssetId(descriptor);

    await modal.confirm({
      title: action === "add-local" ? "添加Webhook资产" : "更新Webhook资产",
      okText: action === "add-local" ? "添加" : "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {descriptor.displayName} 将添加到本机Webhook ID <Text code>{localId}</Text>。
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
            <Text type="secondary">该Webhook没有声明脚本依赖。</Text>
          )}
          {!descriptor.trusted ? (
            <Text type="warning">当前来源仓库未标记为可信，安装前请先检查脚本依赖、配置模板和样例请求。</Text>
          ) : null}
        </Space>
      )
    });

    setActionKey(`${action}:${descriptor.repositoryId}:${descriptor.webhookId}`);
    try {
      const asset = action === "add-local"
        ? await addRepositoryWebhookLocalAsset(descriptor.repositoryId, descriptor.webhookId, {
          mode,
          localAssetId: localId,
          installSchedules: false,
          installScriptDependencies
        })
        : await updateRepositoryWebhookLocalAsset(descriptor.repositoryId, descriptor.webhookId, {
          installSchedules: false,
          installScriptDependencies
        });
      messageApi.success(action === "add-local" ? "Webhook资产已添加" : "Webhook资产已更新");
      await loadData();
      if (webhookDetailOpen) {
        await openWebhookDetail(descriptor);
      }
      if (mode === "TRACKED" && action === "add-local") {
        navigate("/webhooks");
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, action === "add-local" ? "添加Webhook失败" : "更新Webhook失败"));
    } finally {
      setActionKey(null);
    }
  }, [webhookDetail, webhookDetailOpen, loadData, messageApi, modal, navigate, openWebhookDetail]);

  const confirmAddWebhookToLocal = useCallback(async (descriptor: RepositoryWebhookDescriptor) => {
    const selection: { mode: AddMode; localAssetId: string } = {
      mode: "LOCKED",
      localAssetId: localAssetId(descriptor)
    };
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "添加Webhook到本地",
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
                { value: "LOCKED", label: "锁定使用：安装只读Webhook，可后续更新" },
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
    await confirmWebhookLocalAssetAction(descriptor, "add-local", selection.mode, selection.localAssetId);
  }, [confirmWebhookLocalAssetAction, modal]);

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

  const handlePackageUninstall = useCallback((descriptor: CapabilityPackageDescriptor) => {
    modal.confirm({
      title: "卸载能力包",
      okText: "卸载",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>将删除该能力包安装出的脚本、Agent、工具集、模型、定时任务和执行预设。</Text>
          <Text code>{descriptor.repositoryId}/{descriptor.packageId}</Text>
        </Space>
      ),
      onOk: async () => {
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
      }
    });
  }, [loadData, messageApi, modal]);

  const handleInstalledResourceUninstall = useCallback((resource: InstalledResourceView) => {
    modal.confirm({
      title: "卸载已安装资源",
      okText: "卸载",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>将删除本机已安装资源及其托管安装记录。</Text>
          <Text code>{resource.type}:{resource.id}</Text>
          {resource.orphan ? <Text type="warning">来源仓库已删除，卸载将使用本地安装记录完成清理。</Text> : null}
        </Space>
      ),
      onOk: async () => {
        setInstalledResourceActionKey(`uninstall:${resource.type}:${resource.id}`);
        try {
          await uninstallInstalledResource(resource.type, resource.id);
          messageApi.success("资源已卸载");
          await loadData();
        } catch (error) {
          messageApi.error(getErrorMessage(error, "卸载资源失败"));
        } finally {
          setInstalledResourceActionKey(null);
        }
      }
    });
  }, [loadData, messageApi, modal]);

  return {
    repositories,
    tools,
    playbooks,
    loading,
    actionKey,
    packageActionKey,
    installedResourceActionKey,
    filteredTools,
    filteredWebhooks,
    filteredPlaybooks,
    filteredPackages,
    filteredSkills,
    filteredPlugins,
    filteredKnowledge,
    filteredInstalledResources,
    plugins,
    detailOpen,
    detailLoading,
    detail,
    webhookDetailOpen,
    webhookDetailLoading,
    webhookDetail,
    packageDetailOpen,
    packageDetailLoading,
    packageDetail,
    skillDetailOpen,
    skillDetailLoading,
    skillDetail,
    skillInstallDescriptor,
    knowledgeDetailOpen,
    knowledgeDetailLoading,
    knowledgeDetail,
    knowledgeActionKey,
    playbookDetailOpen,
    playbookDetailLoading,
    playbookDetail,
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
    openWebhookDetail,
    openSkillDetail,
    openSkillInstall,
    closeSkillInstall,
    openKnowledgeDetail,
    openPlaybookDetail,
    handleKnowledgeInstall,
    handleKnowledgeUninstall,
    handlePlaybookLocalAssetAction,
    handlePlaybookUninstall,
    handleRepositoryPluginAction,
    confirmToolLocalAssetAction,
    confirmAddToolToLocal,
    confirmAddPlaybookToLocal,
    confirmWebhookLocalAssetAction,
    confirmAddWebhookToLocal,
    handlePackageInstall,
    handlePackageUninstall,
    handleInstalledResourceUninstall,
    closeDetail: () => setDetailOpen(false),
    closeWebhookDetail: () => setWebhookDetailOpen(false),
    closePackageDetail: () => setPackageDetailOpen(false),
    closeSkillDetail: () => setSkillDetailOpen(false),
    closeKnowledgeDetail: () => setKnowledgeDetailOpen(false),
    closePlaybookDetail: () => setPlaybookDetailOpen(false)
  };
}
