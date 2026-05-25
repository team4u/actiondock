import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  ForkOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { ChangeEvent, Key } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listCapabilities } from "../api";
import { listPlugins } from "../../plugins/api";
import { createScript, updateScript } from "../../scripts/api";
import {
  getRepositoryScript,
  listRepositories,
  listRepositoryScripts,
  listToolsByRepository,
  pullUpstreamScript,
  syncRepository,
  uninstallInstalledTool,
  updateRepositoryToolLocalAsset
} from "../../resources/api";
import { ScriptImportDiffModal, type ScriptImportDiffItem } from "../../../components/diff/ScriptImportDiffModal";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { ScopeTag, getScopeLabel } from "../../../components/common/ScopeTag";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import {
  analyzeScriptImport,
  buildScriptExportBundle,
  downloadJsonFile,
  formatScriptExportFileName,
  parseScriptImportBundle
} from "../../../services/scriptTransfer";
import { buildScriptDiff, toDiffTarget } from "../../../services/scriptDiff";
import { ApiError } from "../../../shared/api/httpClient";
import type { PluginDependency, PluginSummaryView, RepositoryScriptDescriptor, ScriptDefinition, ScriptDependency, ScriptScope, ScriptType } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";
import { UpstreamSyncTag } from "../../../components/domain/UpstreamSyncTag";
import { ForkScriptModal } from "../../../components/common/ForkScriptModal";
import { useForkScript } from "../../../shared/hooks/useForkScript";
import { hasScriptDraftChanges, isScriptPublished } from "../../../services/scriptPublication";

const { Text } = Typography;

type SourceFilter = "ALL" | Exclude<ScriptScope, undefined>;
type StatusFilter = "ALL" | "DRAFT" | "PUBLISHED" | "UPDATE_AVAILABLE" | "REMOTE_CHANGES" | "DIVERGED" | "READ_ONLY";
type TypeFilter = "ALL" | ScriptType;



function isEditableAsset(script: ScriptDefinition): boolean {
  return script.scope !== "REPOSITORY";
}

function isRunnable(script: ScriptDefinition): boolean {
  return isScriptPublished(script);
}

function renderPluginDependencies(dependencies: PluginDependency[]) {
  if (dependencies.length === 0) {
    return <Text type="secondary">该脚本没有声明插件依赖。</Text>;
  }

  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {dependencies.map((dependency) => (
        <Space key={dependency.pluginId} wrap size={[6, 6]}>
          <Text code>{dependency.pluginId}</Text>
          {dependency.versionRange ? <Tag color="blue">{dependency.versionRange}</Tag> : <Tag>未锁定版本</Tag>}
          {dependency.requiredActions.map((action) => <Tag key={action}>{action}</Tag>)}
        </Space>
      ))}
    </Space>
  );
}

function renderScriptDependencies(dependencies: ScriptDependency[]) {
  if (dependencies.length === 0) {
    return <Text type="secondary">该脚本没有声明脚本依赖。</Text>;
  }

  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {dependencies.map((dependency) => (
        <Space key={`${dependency.scriptId}:${dependency.repositoryId}:${dependency.repositoryScriptId}`} wrap size={[6, 6]}>
          <Text code>{dependency.scriptId}</Text>
          <Text code>{`${dependency.repositoryId}/${dependency.repositoryScriptId}`}</Text>
          {dependency.versionRange ? <Tag color="blue">{dependency.versionRange}</Tag> : <Tag>未锁定版本</Tag>}
        </Space>
      ))}
    </Space>
  );
}



export function ScriptLibraryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [toolDescriptors, setToolDescriptors] = useState<RepositoryScriptDescriptor[]>([]);
  const [plugins, setPlugins] = useState<PluginSummaryView[]>([]);
  const [selectedScriptIds, setSelectedScriptIds] = useState<Key[]>([]);
  const [searchText, setSearchText] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const fork = useForkScript({ messageApi });
  const [modal, modalContextHolder] = Modal.useModal();
  const [importDiffOpen, setImportDiffOpen] = useState(false);
  const [importDiffItems, setImportDiffItems] = useState<ScriptImportDiffItem[]>([]);
  const [selectedImportDiffId, setSelectedImportDiffId] = useState<string | null>(null);
  const [pendingImportScripts, setPendingImportScripts] = useState<ScriptDefinition[]>([]);
  const [pendingImportCreateCount, setPendingImportCreateCount] = useState(0);

  const loadData = async () => {
    setLoading(true);
    try {
      const [capabilityData, descriptorData, pluginData] = await Promise.all([
        listCapabilities(),
        listRepositoryScripts(),
        listPlugins().catch(() => [])
      ]);
      const sortedScripts = [...capabilityData].sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
      );
      setScripts(sortedScripts);
      setToolDescriptors(descriptorData);
      setPlugins(pluginData);
      setSelectedScriptIds((previous) =>
        previous.filter((id) =>
          sortedScripts.some((script) => script.id === id && isEditableAsset(script))
        )
      );
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载脚本库失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const descriptorMap = useMemo(() => {
    const next = new Map<string, RepositoryScriptDescriptor>();
    toolDescriptors.forEach((item) => {
      if (item.localState) {
        next.set(item.localState.localAssetId, item);
      }
    });
    return next;
  }, [toolDescriptors]);

  const editableScripts = useMemo(() => scripts.filter(isEditableAsset), [scripts]);

  const filteredScripts = useMemo(() => {
    const keywordParts = searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return scripts.filter((script) => {
      const descriptor = descriptorMap.get(script.id);
      if (sourceFilter !== "ALL" && (script.scope ?? "PERSONAL") !== sourceFilter) {
        return false;
      }
      if (typeFilter !== "ALL" && script.type !== typeFilter) {
        return false;
      }
      const published = isScriptPublished(script);
      if (statusFilter === "DRAFT" && published) {
        return false;
      }
      if (statusFilter === "PUBLISHED" && !published) {
        return false;
      }
      if (statusFilter === "UPDATE_AVAILABLE" && !descriptor?.localState?.updateAvailable) {
        return false;
      }
      if (statusFilter === "REMOTE_CHANGES" && descriptor?.localState?.syncState !== "REMOTE_CHANGES") {
        return false;
      }
      if (statusFilter === "DIVERGED" && descriptor?.localState?.syncState !== "DIVERGED") {
        return false;
      }
      if (statusFilter === "READ_ONLY" && script.scope !== "REPOSITORY") {
        return false;
      }
      if (keywordParts.length === 0) {
        return true;
      }

      const haystack = [
        script.id,
        script.name,
        script.description ?? "",
        script.owner ?? "",
        script.repositoryId ?? "",
        script.repositoryScriptId ?? "",
        descriptor?.repositoryId ?? "",
        descriptor?.scriptId ?? ""
      ]
        .join(" ")
        .toLowerCase();

      return keywordParts.every((part) => haystack.includes(part));
    });
  }, [descriptorMap, scripts, searchText, sourceFilter, statusFilter, typeFilter]);

  const exportScripts = (targetScripts: ScriptDefinition[], successMessage: string) => {
    try {
      const bundle = buildScriptExportBundle(targetScripts);
      downloadJsonFile(formatScriptExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出脚本失败");
    }
  };

  const handleExportSelected = () => {
    const selectedScripts = editableScripts.filter((script) => selectedScriptIds.includes(script.id));
    exportScripts(selectedScripts, `已导出 ${selectedScripts.length} 个选中脚本`);
  };

  const handleExportVisible = () => {
    const targetScripts = filteredScripts.filter(isEditableAsset);
    exportScripts(targetScripts, `已导出 ${targetScripts.length} 个可编辑脚本`);
  };

  const runImport = async (importedScripts: ScriptDefinition[]) => {
    setImporting(true);
    const currentEditableIds = new Set(editableScripts.map((script) => script.id));
    const successes: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    try {
      for (const script of importedScripts) {
        try {
          if (currentEditableIds.has(script.id)) {
            await updateScript(script.id, script);
          } else {
            await createScript(script);
            currentEditableIds.add(script.id);
          }
          successes.push(script.id);
        } catch (error) {
          const detail = error instanceof ApiError ? error.message : "导入失败";
          failures.push({ id: script.id, reason: detail });
        }
      }

      if (successes.length > 0) {
        await loadData();
      }

      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个脚本`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分脚本处理失败",
        width: 640,
        content: (
          <div className="script-import-result">
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre className="script-import-result__code">
              {failures
                .slice(0, 10)
                .map((item) => `${item.id}: ${item.reason}`)
                .join("\n")}
            </pre>
          </div>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedScripts = parseScriptImportBundle(await file.text());
      const analysis = analyzeScriptImport(importedScripts, editableScripts);
      const currentById = new Map(editableScripts.map((script) => [script.id, script]));
      const importedById = new Map(analysis.scripts.map((script) => [script.id, script]));
      const overwriteItems = analysis.overwriteIds
        .map((id) => {
          const currentScript = currentById.get(id);
          const importedScript = importedById.get(id);
          if (!currentScript || !importedScript) {
            return null;
          }
          return {
            id,
            currentScript,
            importedScript,
            diff: buildScriptDiff(toDiffTarget(currentScript), toDiffTarget(importedScript), {
              context: "import"
            })
          };
        })
        .filter((item): item is ScriptImportDiffItem => Boolean(item));

      setPendingImportScripts(analysis.scripts);
      setPendingImportCreateCount(analysis.createIds.length);
      setImportDiffItems(overwriteItems);
      setSelectedImportDiffId(overwriteItems[0]?.id ?? null);
      setImportDiffOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "导入脚本失败"));
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      messageApi.error("仅支持导入 .json 文件");
      return;
    }

    await handleImportFile(file);
  };

  const handleConfirmImportDiff = async () => {
    const scriptsToImport = pendingImportScripts;
    setImportDiffOpen(false);
    await runImport(scriptsToImport);
  };





  const handleUpdate = async (tool: ScriptDefinition) => {
    if (bulkUpdating) {
      return;
    }
    const descriptor = descriptorMap.get(tool.id);
    if (!descriptor || !tool.repositoryId || !tool.repositoryScriptId) {
      messageApi.warning("缺少仓库来源信息，无法更新");
      return;
    }

    let installSchedules = false;
    let installScriptDependencies = Boolean(descriptor?.scriptDependencies.length);
    let installPluginDependencies = Boolean(descriptor?.pluginDependencies.length);
    let scheduleCount = 0;
    const repositoryId = tool.repositoryId!;
    const repositoryScriptId = tool.repositoryScriptId!;

    try {
      const detail = await getRepositoryScript(tool.repositoryId, tool.repositoryScriptId);
      scheduleCount = detail.scheduleTemplate.length;
    } catch {
      scheduleCount = 0;
    }

    modal.confirm({
      title: "更新仓库安装脚本",
      okText: "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            将从仓库 <Text code>{descriptor.repositoryId}</Text> 更新 <Text code>{tool.id}</Text>。
          </Text>
          {scheduleCount > 0 ? (
            <Checkbox
              onChange={(event) => {
                installSchedules = event.target.checked;
              }}
            >
              同步更新定时任务模板（仍保持默认停用）
            </Checkbox>
          ) : (
            <Text type="secondary">该脚本没有额外定时模板可同步。</Text>
          )}
          {descriptor?.scriptDependencies.length ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox
                defaultChecked
                onChange={(event) => {
                  installScriptDependencies = event.target.checked;
                }}
              >
                同时安装或更新 {descriptor.scriptDependencies.length} 个脚本依赖
              </Checkbox>
              {renderScriptDependencies(descriptor.scriptDependencies)}
            </Space>
          ) : (
            <Text type="secondary">该脚本没有声明脚本依赖。</Text>
          )}
          {descriptor?.pluginDependencies.length ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Checkbox
                defaultChecked
                onChange={(event) => {
                  installPluginDependencies = event.target.checked;
                }}
              >
                同时安装或更新 {descriptor.pluginDependencies.length} 个插件依赖
              </Checkbox>
              {renderPluginDependencies(descriptor.pluginDependencies)}
            </Space>
          ) : (
            <Text type="secondary">该脚本没有声明插件依赖。</Text>
          )}
        </Space>
      ),
      onOk: async () => {
        setActionKey(`update:${tool.id}`);
        try {
          await updateRepositoryToolLocalAsset(repositoryId, repositoryScriptId, {
            installSchedules,
            installScriptDependencies,
            installPluginDependencies
          });
          messageApi.success("脚本已更新");
          await loadData();
        } catch (error) {
          messageApi.error(getErrorMessage(error, "更新脚本失败"));
        } finally {
          setActionKey(null);
        }
      }
    });
  };

  const diffEditorTheme =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
      ? "vs-dark"
      : "vs-light";

  const handleUpdateAll = async () => {
    setBulkUpdating(true);
    setActionKey("update-all");
    const repositoryFailures: string[] = [];
    const toolFailures: string[] = [];
    let updatedCount = 0;

    try {
      const repositories = await listRepositories();
      const enabledRepositories = repositories.filter((repository) => repository.enabled);
      const syncedRepositoryIds: string[] = [];

      for (const repository of enabledRepositories) {
        try {
          await syncRepository(repository.id);
          syncedRepositoryIds.push(repository.id);
        } catch (error) {
          repositoryFailures.push(`${repository.id}: ${getErrorMessage(error, "同步失败")}`);
        }
      }

      const updateTargets: RepositoryScriptDescriptor[] = [];
      const upstreamPullTargets: RepositoryScriptDescriptor[] = [];
      for (const repositoryId of syncedRepositoryIds) {
        try {
          const repositoryTools = await listToolsByRepository(repositoryId);
          updateTargets.push(
            ...repositoryTools.filter((tool) =>
              tool.localState?.mode === "LOCKED" && tool.localState.updateAvailable
            )
          );
          upstreamPullTargets.push(
            ...repositoryTools.filter((tool) =>
              tool.localState?.mode === "TRACKED"
              && tool.localState.syncState === "REMOTE_CHANGES"
            )
          );
        } catch (error) {
          repositoryFailures.push(`${repositoryId}: ${getErrorMessage(error, "读取脚本失败")}`);
        }
      }

      for (const tool of updateTargets) {
        try {
          await updateRepositoryToolLocalAsset(tool.repositoryId, tool.scriptId, {
            installSchedules: true,
            installScriptDependencies: true,
            installPluginDependencies: true
          });
          updatedCount += 1;
        } catch (error) {
          toolFailures.push(`${tool.localState?.localAssetId ?? tool.scriptId}: ${getErrorMessage(error, "更新失败")}`);
        }
      }

      let pulledCount = 0;
      for (const tool of upstreamPullTargets) {
        try {
          await pullUpstreamScript(tool.localState!.localAssetId);
          pulledCount += 1;
        } catch (error) {
          toolFailures.push(`${tool.localState?.localAssetId ?? tool.scriptId}: ${getErrorMessage(error, "拉取失败")}`);
        }
      }

      await loadData();

      if (updateTargets.length === 0 && upstreamPullTargets.length === 0 && repositoryFailures.length === 0) {
        messageApi.success("已是最新");
        return;
      }

      if (repositoryFailures.length > 0 || toolFailures.length > 0) {
        messageApi.warning(
          `更新完成，成功 ${updatedCount} 个，失败 ${repositoryFailures.length + toolFailures.length} 项`
        );
        return;
      }

      messageApi.success(`已更新 ${updatedCount} 个脚本，拉取 ${pulledCount} 个工作副本`);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "一键更新失败"));
    } finally {
      setBulkUpdating(false);
      setActionKey(null);
    }
  };

  const handleUninstall = async (tool: ScriptDefinition) => {
    setActionKey(`uninstall:${tool.id}`);
    try {
      await uninstallInstalledTool(tool.id);
      messageApi.success("已卸载");
      await loadData();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "卸载失败"));
    } finally {
      setActionKey(null);
    }
  };

  const columns: ColumnsType<ScriptDefinition> = [
    {
      title: "脚本",
      dataIndex: "id",
      key: "id",
      render: (value: string, record) => (
        <TableLinkCell to={`/scripts/${value}`}>{record.name || value}</TableLinkCell>
      )
    },
    {
      title: "来源 / 状态",
      key: "status",
      width: 200,
      render: (_value: unknown, record) => {
        const descriptor = descriptorMap.get(record.id);
        return (
          <Space wrap size={[4, 4]}>
            <ScopeTag scope={record.scope} />
            {record.scope !== "REPOSITORY" && (
              <Tag color={isScriptPublished(record) ? "green" : "gold"}>
                {isScriptPublished(record) ? "已发布" : "草稿"}
              </Tag>
            )}
            {descriptor?.localState?.updateAvailable ? <Tag color="processing">可更新</Tag> : null}
            {descriptor?.localState?.mode === "TRACKED" ? <UpstreamSyncTag state={descriptor.localState.syncState} /> : null}
            {hasScriptDraftChanges(record) ? <Tag color="gold">有草稿</Tag> : null}
          </Space>
        );
      }
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            disabled={!isRunnable(record)}
            onClick={() => navigate(`/scripts/${record.id}/run`)}
          >
            运行
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => navigate(`/scripts/new?copyFrom=${encodeURIComponent(record.id)}`)}
          >
            复制
          </Button>
          <Button
            size="small"
            icon={<ExportOutlined />}
            disabled={!isEditableAsset(record)}
            onClick={() => exportScripts([record], `已导出 ${record.name || record.id}`)}
          >
            导出
          </Button>
          {record.scope === "REPOSITORY" ? (
            <>
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={actionKey === `update:${record.id}`}
                disabled={!descriptorMap.get(record.id)?.localState?.updateAvailable}
                onClick={() => void handleUpdate(record)}
              >
                更新
              </Button>
              <ConfirmDangerAction
                title="确认卸载这个仓库脚本？"
                description="将删除本地的脚本定义及相关定时任务配置。"
                okText="卸载"
                onConfirm={() => void handleUninstall(record)}
                loading={actionKey === `uninstall:${record.id}`}
              >
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={actionKey === `uninstall:${record.id}`}
                >
                  卸载
                </Button>
              </ConfirmDangerAction>
            </>
          ) : null}
        </Space>
      )
    }
  ];

  const rowSelection: TableRowSelection<ScriptDefinition> = {
    selectedRowKeys: selectedScriptIds,
    onChange: (nextSelectedRowKeys) => setSelectedScriptIds(nextSelectedRowKeys),
    preserveSelectedRowKeys: true,
    getCheckboxProps: (record) => ({
      disabled: !isEditableAsset(record),
      name: record.id
    })
  };

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleImportChange(event)}
      />
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="脚本库"
          meta={<Text type="secondary">管理本机可运行、可编辑或从仓库安装的脚本。</Text>}
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                刷新
              </Button>
              <Button
                icon={<SyncOutlined />}
                loading={bulkUpdating}
                disabled={loading || importing}
                onClick={() => void handleUpdateAll()}
              >
                一键更新
              </Button>
              <Button icon={<DownloadOutlined />} onClick={handleExportVisible} disabled={filteredScripts.every((item) => !isEditableAsset(item))}>
                导出可编辑
              </Button>
              <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileInputRef.current?.click()}>
                导入脚本
              </Button>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate("/scripts/new")}>
                新建脚本
              </Button>
            </>
          }
        />

        <Card>
          <Space wrap size={[12, 12]} style={{ width: "100%" }}>
            <Input.Search
              allowClear
              placeholder="搜索名称、ID、描述、维护人或来源"
              value={searchText}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
              style={{ minWidth: 220, flex: "1 1 280px" }}
            />
            <Select<SourceFilter>
              value={sourceFilter}
              onChange={setSourceFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部来源" },
                { value: "PERSONAL", label: "本机" },
                { value: "REPOSITORY", label: "仓库" },
                { value: "SAMPLE", label: "示例" }
              ]}
            />
            <Select<StatusFilter>
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部状态" },
                { value: "PUBLISHED", label: "已发布" },
                { value: "DRAFT", label: "草稿" },
                { value: "UPDATE_AVAILABLE", label: "可更新" },
                { value: "REMOTE_CHANGES", label: "远端有更新" },
                { value: "DIVERGED", label: "有冲突" },
                { value: "READ_ONLY", label: "只读" }
              ]}
            />
            <Select<TypeFilter>
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部类型" },
                { value: "PYTHON", label: "Python" },
                { value: "GROOVY", label: "Groovy" }
              ]}
            />
            <Button
              icon={<DownloadOutlined />}
              disabled={selectedScriptIds.length === 0}
              onClick={handleExportSelected}
            >
              导出选中
            </Button>
            <Text type="secondary">
              共 {filteredScripts.length} 个脚本，已选 {selectedScriptIds.length} 个
            </Text>
          </Space>
        </Card>

        <Card>
          <Table<ScriptDefinition>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredScripts}
            rowSelection={rowSelection}
            scroll={{ x: 900 }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有本机脚本。可以新建脚本，或到发现脚本中安装仓库脚本。"
                />
              )
            }}
          />
        </Card>
      </Space>

      <ScriptImportDiffModal
        open={importDiffOpen}
        onCancel={() => setImportDiffOpen(false)}
        onOk={() => void handleConfirmImportDiff()}
        confirmLoading={importing}
        overwriteItems={importDiffItems}
        selectedId={selectedImportDiffId}
        onSelect={setSelectedImportDiffId}
        createCount={pendingImportCreateCount}
        totalCount={pendingImportScripts.length}
        theme={diffEditorTheme}
      />

      <ForkScriptModal
        title={fork.forkModalOpen ? "创建 Fork" : undefined}
        okText="创建 Fork"
        open={fork.forkModalOpen}
        onCancel={() => fork.setForkModalOpen(false)}
        onOk={() => void fork.handleFork()}
        confirmLoading={Boolean(fork.forkingId)}
        form={fork.forkForm}
      />
    </>
  );
}
