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
  Form,
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
import {
  ApiError,
  createScript,
  forkRepositoryTool,
  getRepositoryTool,
  listPlugins,
  listRepositories,
  listRepositoryTools,
  listScripts,
  listToolsByRepository,
  pullDevelopmentScript,
  syncRepository,
  uninstallInstalledTool,
  updateRepositoryTool,
  updateScript
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { ScopeTag, getScopeLabel } from "../components/ScopeTag";
import { TableLinkCell } from "../components/TableLinkCell";
import {
  analyzeScriptImport,
  buildScriptExportBundle,
  downloadJsonFile,
  formatScriptExportFileName,
  parseScriptImportBundle
} from "../scriptTransfer";
import type { DevelopmentSyncState, PluginDependency, PluginView, RepositoryToolDescriptor, ScriptDefinition, ScriptScope, ScriptStatus, ScriptType } from "../types";
import { formatDateTime, getErrorMessage } from "../utils";

const { Text } = Typography;

type SourceFilter = "ALL" | Exclude<ScriptScope, undefined>;
type StatusFilter = "ALL" | ScriptStatus | "UPDATE_AVAILABLE" | "REMOTE_CHANGES" | "DIVERGED" | "READ_ONLY";
type TypeFilter = "ALL" | ScriptType;

interface ForkFormValues {
  id: string;
  name: string;
}


function isEditableAsset(script: ScriptDefinition): boolean {
  return script.scope !== "REPOSITORY";
}

function isRunnable(script: ScriptDefinition): boolean {
  return script.status === "PUBLISHED";
}

function renderPluginDependencies(dependencies: PluginDependency[]) {
  if (dependencies.length === 0) {
    return <Text type="secondary">该工具没有声明插件依赖。</Text>;
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

export function ToolLibraryPage() {
  const navigate = useNavigate();
  const [forkForm] = Form.useForm<ForkFormValues>();
  const [loading, setLoading] = useState(true);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [toolDescriptors, setToolDescriptors] = useState<RepositoryToolDescriptor[]>([]);
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [selectedScriptIds, setSelectedScriptIds] = useState<Key[]>([]);
  const [searchText, setSearchText] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [forkTarget, setForkTarget] = useState<ScriptDefinition | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadData = async () => {
    setLoading(true);
    try {
      const [scriptData, descriptorData, pluginData] = await Promise.all([
        listScripts(),
        listRepositoryTools(),
        listPlugins().catch(() => [])
      ]);
      const sortedScripts = [...scriptData].sort((left, right) =>
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
      messageApi.error(getErrorMessage(error, "加载工具库失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const descriptorMap = useMemo(() => {
    const next = new Map<string, RepositoryToolDescriptor>();
    toolDescriptors.forEach((item) => {
      next.set(item.installedScriptId, item);
      if (item.developmentScriptId) {
        next.set(item.developmentScriptId, item);
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
      if (statusFilter === "DRAFT" && script.status !== "DRAFT") {
        return false;
      }
      if (statusFilter === "PUBLISHED" && script.status !== "PUBLISHED") {
        return false;
      }
      if (statusFilter === "UPDATE_AVAILABLE" && !descriptor?.updateAvailable) {
        return false;
      }
      if (statusFilter === "REMOTE_CHANGES" && descriptor?.developmentSyncState !== "REMOTE_CHANGES") {
        return false;
      }
      if (statusFilter === "DIVERGED" && descriptor?.developmentSyncState !== "DIVERGED") {
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
        script.repositoryToolId ?? "",
        descriptor?.repositoryId ?? "",
        descriptor?.toolId ?? ""
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
      messageApi.error("导出工具失败");
    }
  };

  const handleExportSelected = () => {
    const selectedScripts = editableScripts.filter((script) => selectedScriptIds.includes(script.id));
    exportScripts(selectedScripts, `已导出 ${selectedScripts.length} 个选中工具`);
  };

  const handleExportVisible = () => {
    const targetScripts = filteredScripts.filter(isEditableAsset);
    exportScripts(targetScripts, `已导出 ${targetScripts.length} 个可编辑工具`);
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
        messageApi.success(`导入完成，成功处理 ${successes.length} 个工具`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分工具处理失败",
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
      const overwritePreview = analysis.overwriteIds.slice(0, 10);

      await modal.confirm({
        title: "确认导入工具",
        okText: "开始导入",
        cancelText: "取消",
        width: 680,
        content: (
          <div className="script-import-summary">
            <Text>共解析到 {analysis.scripts.length} 个工具。</Text>
            <Text>新增 {analysis.createIds.length} 个，覆盖 {analysis.overwriteIds.length} 个。</Text>
            {analysis.overwriteIds.length > 0 ? (
              <>
                <Text strong>将被覆盖的工具 ID</Text>
                <pre className="script-import-result__code">{overwritePreview.join("\n")}</pre>
              </>
            ) : null}
          </div>
        ),
        onOk: () => runImport(analysis.scripts)
      });
    } catch (error) {
      messageApi.error(getErrorMessage(error, "导入工具失败"));
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

  const openForkModal = (tool: ScriptDefinition) => {
    forkForm.setFieldsValue({
      id: `${tool.repositoryToolId ?? tool.id}-fork`,
      name: `${tool.name} Fork`
    });
    setForkTarget(tool);
  };

  const handleFork = async () => {
    if (!forkTarget) {
      return;
    }
    try {
      const values = await forkForm.validateFields();
      setActionKey(`fork:${forkTarget.id}`);
      const created = await forkRepositoryTool(forkTarget.id, {
        id: values.id.trim(),
        name: values.name.trim()
      });
      setForkTarget(null);
      forkForm.resetFields();
      messageApi.success("Fork 已创建");
      navigate(`/scripts/${created.id}`);
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      messageApi.error(getErrorMessage(error, "创建 Fork 失败"));
    } finally {
      setActionKey(null);
    }
  };

  const handleUpdate = async (tool: ScriptDefinition) => {
    if (bulkUpdating) {
      return;
    }
    const descriptor = descriptorMap.get(tool.id);
    if (!descriptor || !tool.repositoryId || !tool.repositoryToolId) {
      messageApi.warning("缺少仓库来源信息，无法更新");
      return;
    }

    let installSchedules = false;
    let installPluginDependencies = Boolean(descriptor?.pluginDependencies.length);
    let scheduleCount = 0;

    try {
      const detail = await getRepositoryTool(tool.repositoryId, tool.repositoryToolId);
      scheduleCount = detail.scheduleTemplate.length;
    } catch {
      scheduleCount = 0;
    }

    await modal.confirm({
      title: "更新仓库安装工具",
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
            <Text type="secondary">该工具没有额外定时模板可同步。</Text>
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
            <Text type="secondary">该工具没有声明插件依赖。</Text>
          )}
        </Space>
      )
    });

    setActionKey(`update:${tool.id}`);
    try {
      await updateRepositoryTool(tool.repositoryId, tool.repositoryToolId, { installSchedules, installPluginDependencies });
      messageApi.success("工具已更新");
      await loadData();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "更新工具失败"));
    } finally {
      setActionKey(null);
    }
  };

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

      const updateTargets: RepositoryToolDescriptor[] = [];
      const developmentPullTargets: RepositoryToolDescriptor[] = [];
      for (const repositoryId of syncedRepositoryIds) {
        try {
          const repositoryTools = await listToolsByRepository(repositoryId);
          updateTargets.push(
            ...repositoryTools.filter((tool) => tool.installed && tool.updateAvailable)
          );
          developmentPullTargets.push(
            ...repositoryTools.filter((tool) =>
              tool.repositoryUsage === "DEVELOPMENT"
              && Boolean(tool.developmentScriptId)
              && tool.developmentSyncState === "REMOTE_CHANGES"
            )
          );
        } catch (error) {
          repositoryFailures.push(`${repositoryId}: ${getErrorMessage(error, "读取工具失败")}`);
        }
      }

      for (const tool of updateTargets) {
        try {
          await updateRepositoryTool(tool.repositoryId, tool.toolId, {
            installSchedules: true,
            installPluginDependencies: true
          });
          updatedCount += 1;
        } catch (error) {
          toolFailures.push(`${tool.installedScriptId}: ${getErrorMessage(error, "更新失败")}`);
        }
      }

      let pulledCount = 0;
      for (const tool of developmentPullTargets) {
        try {
          await pullDevelopmentScript(tool.developmentScriptId!);
          pulledCount += 1;
        } catch (error) {
          toolFailures.push(`${tool.developmentScriptId}: ${getErrorMessage(error, "拉取失败")}`);
        }
      }

      await loadData();

      if (updateTargets.length === 0 && developmentPullTargets.length === 0 && repositoryFailures.length === 0) {
        messageApi.success("已是最新");
        return;
      }

      if (repositoryFailures.length > 0 || toolFailures.length > 0) {
        messageApi.warning(
          `更新完成，成功 ${updatedCount} 个，失败 ${repositoryFailures.length + toolFailures.length} 项`
        );
        return;
      }

      messageApi.success(`已更新 ${updatedCount} 个工具，拉取 ${pulledCount} 个开发脚本`);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "一键更新失败"));
    } finally {
      setBulkUpdating(false);
      setActionKey(null);
    }
  };

  const columns: ColumnsType<ScriptDefinition> = [
    {
      title: "工具",
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
              <Tag color={record.status === "PUBLISHED" ? "green" : "gold"}>
                {record.status === "PUBLISHED" ? "已发布" : "草稿"}
              </Tag>
            )}
            {descriptor?.updateAvailable ? <Tag color="processing">可更新</Tag> : null}
            {record.scope === "DEVELOPMENT" ? getDevelopmentSyncTag(descriptor?.developmentSyncState) : null}
            {record.hasUnpublishedChanges ? <Tag color="gold">有草稿</Tag> : null}
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
            onClick={() => navigate(`/run/${record.id}`)}
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
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={actionKey === `update:${record.id}`}
              disabled={!descriptorMap.get(record.id)?.updateAvailable}
              onClick={() => void handleUpdate(record)}
            >
              更新
            </Button>
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
          title="工具库"
          meta={<Text type="secondary">管理本机可运行、可编辑或从仓库安装的工具。</Text>}
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
                导入工具
              </Button>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate("/scripts/new")}>
                新建工具
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
              onChange={(event) => setSearchText(event.target.value)}
              style={{ minWidth: 220, flex: "1 1 280px" }}
            />
            <Select<SourceFilter>
              value={sourceFilter}
              onChange={setSourceFilter}
              style={{ minWidth: 130 }}
              options={[
                { value: "ALL", label: "全部来源" },
                { value: "PERSONAL", label: "本机" },
                { value: "FORK", label: "Fork" },
                { value: "REPOSITORY", label: "仓库" },
                { value: "DEVELOPMENT", label: "开发" },
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
              共 {filteredScripts.length} 个工具，已选 {selectedScriptIds.length} 个
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
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有本机工具。可以新建工具，或到发现工具中安装仓库工具。"
                />
              )
            }}
          />
        </Card>
      </Space>

      <Modal
        title={forkTarget ? `Fork ${forkTarget.name}` : "创建 Fork"}
        open={Boolean(forkTarget)}
        onCancel={() => {
          setForkTarget(null);
          forkForm.resetFields();
        }}
        onOk={() => void handleFork()}
        okText="创建 Fork"
        cancelText="取消"
        confirmLoading={Boolean(forkTarget && actionKey === `fork:${forkTarget.id}`)}
        destroyOnHidden
      >
        <Text type="secondary">
          Fork 会复制脚本和定时任务；复制出的定时任务默认停用，配置值继续共享现有全局 Key。
        </Text>
        <Form form={forkForm} layout="vertical">
          <Form.Item
            label="新工具 ID"
            name="id"
            rules={[
              { required: true, message: "请输入新的工具 ID" },
              { pattern: /^[A-Za-z0-9._-]+$/, message: "仅支持字母、数字、点、中横线和下划线" }
            ]}
          >
            <Input placeholder="例如 clear-cache-fork" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="例如 清理缓存 Fork" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
