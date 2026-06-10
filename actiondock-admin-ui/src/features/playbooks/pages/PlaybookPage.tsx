import { DownloadOutlined, ExportOutlined, FileMarkdownOutlined, FileOutlined, FolderOpenOutlined, UploadOutlined, PlusOutlined, DeleteOutlined, DownOutlined } from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Dropdown, Empty, Form, Grid, Image, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tabs, Tag, Tree, Typography, message } from "antd";
import type { ChangeEvent, Key } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownDescription } from "../../../components/common/MarkdownDescription";
import { PageHeader } from "../../../components/common/PageHeader";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { ApiError } from "../../../shared/api/httpClient";
import type {
  Playbook,
  RepositoryDefinition,
  RepositoryPlaybookPublishRequest,
  RepositoryProjectFileNode,
  RepositoryProjectFilePreview,
  ScriptDefinition
} from "../../../shared/types";
import { formatDateTime, getErrorMessage, prettyJson } from "../../../services/utils";
import { getPublishableRepositories, pickDefaultPublishRepository } from "../../../services/repositoryPublish";
import { useDefaultOwner } from "../../../shared/hooks/useDefaultOwner";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import {
  analyzePlaybookImport,
  buildPlaybookExportBundle,
  formatPlaybookExportFileName,
  parsePlaybookImportBundle,
  type PlaybookImportAnalysis
} from "../../../services/playbookTransfer";
import { downloadJsonFile } from "../../../services/scriptTransfer";
import {
  getRepositoryPlaybook,
  listProjectRepositoryFiles,
  listRepositories,
  listRepositoryPlaybooks,
  previewProjectRepositoryFile,
  publishRepositoryPlaybook,
  syncRepository
} from "../../resources/api";
import { listScripts } from "../../scripts/api";
import { createPlaybook, deletePlaybook, listPlaybooks, updatePlaybook } from "../api";
import { PlaybookDiffPanel } from "../../../components/diff/PlaybookDiffPanel";
import {
  buildPlaybookDiff,
  buildPlaybookDiffTarget,
  toRepositoryPlaybookDiffTarget,
  type PlaybookDiffResult
} from "../../../services/playbookDiff";
import {
  buildPlaybookSavePayload,
  splitText,
  toKnowledgeEditorState,
  upsertKnowledgeGroups,
  type KnowledgeEditorState,
  type PlaybookFormValues
} from "../../../services/playbookEditor";

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface PublishFormValues {
  repositoryId: string;
  playbookId: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
}

interface FilePickerState {
  open: boolean;
  repositoryId?: string;
  selectedPath?: string;
}

function sanitizePlaybookId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function bumpPatchVersion(version?: string): string | null {
  if (!version) {
    return "0.1.0";
  }
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "" || Number.isNaN(Number(part)))) {
    return null;
  }
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

function getRiskColor(risk?: string | null): string {
  switch (risk) {
    case "HIGH":
      return "red";
    case "MEDIUM":
      return "orange";
    case "LOW":
      return "green";
    default:
      return "default";
  }
}

function fileNodeToTree(nodes: RepositoryProjectFileNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.path,
    title: node.name,
    icon: node.directory ? <FolderOpenOutlined /> : node.path.toLowerCase().endsWith(".md") ? <FileMarkdownOutlined /> : <FileOutlined />,
    isLeaf: !node.directory,
    children: node.directory ? [] : undefined
  }));
}

export function PlaybookPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const screens = useBreakpoint();
  const isCompactFilePicker = !screens.md;
  const defaultOwner = useDefaultOwner();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Playbook[]>([]);
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [selectedPlaybookIds, setSelectedPlaybookIds] = useState<Key[]>([]);
  const [importing, setImporting] = useState(false);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [pendingImportAnalysis, setPendingImportAnalysis] = useState<PlaybookImportAnalysis | null>(null);
  const [knowledgeEditor, setKnowledgeEditor] = useState<KnowledgeEditorState[]>([]);
  const [filePicker, setFilePicker] = useState<FilePickerState>({ open: false });
  const [projectFileTree, setProjectFileTree] = useState<Record<string, RepositoryProjectFileNode[]>>({});
  const [projectFileChildren, setProjectFileChildren] = useState<Record<string, Record<string, RepositoryProjectFileNode[]>>>({});
  const [projectPreview, setProjectPreview] = useState<RepositoryProjectFilePreview | null>(null);
  const [projectPreviewLoading, setProjectPreviewLoading] = useState(false);
  const [projectTreeLoading, setProjectTreeLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{ repositoryId?: string; tag?: string; managed?: boolean; intent?: string }>({});
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishingPlaybook, setPublishingPlaybook] = useState<Playbook | null>(null);
  const [versionHint, setVersionHint] = useState<string | null>(null);
  const [playbookDiff, setPlaybookDiff] = useState<PlaybookDiffResult | null>(null);
  const [playbookDiffLoading, setPlaybookDiffLoading] = useState(false);
  const [form] = Form.useForm<PlaybookFormValues>();
  const [publishForm] = Form.useForm<PublishFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const [playbookData, repositoryData, publishRepositoryData, scriptData] = await Promise.all([
        listPlaybooks(filters),
        listRepositories("PROJECT"),
        listRepositories(),
        listScripts()
      ]);
      setItems(playbookData);
      setRepositories(repositoryData);
      setPublishRepositories(publishRepositoryData);
      setScripts(scriptData);
      setSelectedPlaybookIds((previous) =>
        previous.filter((id) => playbookData.some((item) => item.id === id && !item.managed))
      );
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载任务手册失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filters.repositoryId, filters.tag, filters.managed, filters.intent]);

  const repositoryOptions = useMemo(() => repositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [repositories]);
  const repositoryNameMap = useMemo(() => new Map(repositories.map((item) => [item.id, item.name])), [repositories]);
  const publishableRepositories = useMemo(() => getPublishableRepositories(publishRepositories), [publishRepositories]);
  const publishRepositoryOptions = useMemo(() => publishableRepositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [publishableRepositories]);
  const scriptOptions = useMemo(() => scripts.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [scripts]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort(), [items]);
  const editablePlaybooks = useMemo(() => items.filter((item) => !item.managed), [items]);

  const loadProjectRoot = useCallback(async (repositoryId: string) => {
    if (projectFileTree[repositoryId]) {
      return;
    }
    setProjectTreeLoading(true);
    try {
      const rootNodes = await listProjectRepositoryFiles(repositoryId);
      setProjectFileTree((value) => ({ ...value, [repositoryId]: rootNodes }));
      setProjectFileChildren((value) => ({ ...value, [repositoryId]: {} }));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载项目仓库文件失败"));
    } finally {
      setProjectTreeLoading(false);
    }
  }, [messageApi, projectFileTree]);

  const loadProjectChildren = useCallback(async (repositoryId: string, path: string) => {
    if (projectFileChildren[repositoryId]?.[path]) {
      return;
    }
    try {
      const children = await listProjectRepositoryFiles(repositoryId, path);
      setProjectFileChildren((value) => ({
        ...value,
        [repositoryId]: {
          ...(value[repositoryId] ?? {}),
          [path]: children
        }
      }));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载目录失败"));
    }
  }, [messageApi, projectFileChildren]);

  const openEditor = (item?: Playbook) => {
    const repositoryIds = item?.repositoryIds ?? [];
    setEditing(item ?? null);
    setReadOnly(Boolean(item?.managed));
    setKnowledgeEditor(toKnowledgeEditorState(repositoryIds, item?.knowledgeRefs ?? []));
    form.resetFields();
    form.setFieldsValue({
      id: item?.id ?? "",
      name: item?.name ?? "",
      description: item?.description,
      tagsText: item?.tags?.join(", "),
      riskLevel: item?.riskLevel,
      repositoryIds,
      scriptRefs: item?.scriptRefs ?? [],
      agentSkillRefs: item?.agentSkillRefs ?? [],
      relatedPlaybookRefs: item?.relatedPlaybookRefs ?? [],
      guideMarkdown: item?.guideMarkdown ?? "",
      stopConditionsText: item?.stopConditions?.join("\n"),
      enabled: item?.enabled ?? true
    });
    setDrawerOpen(true);
  };

  const handleRepositoryIdsChange = (nextIds: string[]) => {
    const currentGroups = knowledgeEditor.filter((item) => !nextIds.includes(item.repositoryId));
    if (currentGroups.some((item) => item.notes.length > 0 || item.files.length > 0)) {
      Modal.confirm({
        title: "移除适用仓库",
        content: "移除仓库后，会同时删除该仓库下的知识说明和文件引用。",
        onOk: () => {
          form.setFieldValue("repositoryIds", nextIds);
          setKnowledgeEditor((value) => upsertKnowledgeGroups(value, nextIds));
        }
      });
      return;
    }
    form.setFieldValue("repositoryIds", nextIds);
    setKnowledgeEditor((value) => upsertKnowledgeGroups(value, nextIds));
  };

  const save = async () => {
    await form.validateFields();
    const values = form.getFieldsValue(true);
    const payload = buildPlaybookSavePayload({ values, knowledgeEditor, scripts, editing });
    try {
      if (editing) {
        await updatePlaybook(editing.id, payload);
      } else {
        await createPlaybook(payload);
      }
      setDrawerOpen(false);
      messageApi.success("任务手册已保存");
      await load();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存任务手册失败"));
    }
  };

  const remove = async (item: Playbook) => {
    try {
      await deletePlaybook(item.id);
      messageApi.success("任务手册已删除");
      await load();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除任务手册失败"));
    }
  };

  const exportPlaybooks = (targetPlaybooks: Playbook[], successMessage: string) => {
    if (targetPlaybooks.length === 0) {
      messageApi.warning("没有可导出的任务手册");
      return;
    }
    try {
      const bundle = buildPlaybookExportBundle(targetPlaybooks);
      downloadJsonFile(formatPlaybookExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出任务手册失败");
    }
  };

  const handleExportSelected = () => {
    const selectedPlaybooks = editablePlaybooks.filter((item) => selectedPlaybookIds.includes(item.id));
    exportPlaybooks(selectedPlaybooks, `已导出 ${selectedPlaybooks.length} 个选中任务手册`);
  };

  const handleExportVisible = () => {
    const targetPlaybooks = items.filter((item) => !item.managed);
    exportPlaybooks(targetPlaybooks, `已导出 ${targetPlaybooks.length} 个可编辑任务手册`);
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedPlaybooks = parsePlaybookImportBundle(await file.text());
      const analysis = analyzePlaybookImport(importedPlaybooks, items, scripts);
      setPendingImportAnalysis(analysis);
      setImportPreviewOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "导入任务手册失败"));
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

  const runImport = async () => {
    if (!pendingImportAnalysis) {
      return;
    }
    setImporting(true);
    const blockedIds = new Set([
      ...pendingImportAnalysis.managedConflictIds,
      ...pendingImportAnalysis.missingScriptRefs.map((item) => item.playbookId),
      ...pendingImportAnalysis.missingRelatedPlaybookRefs.map((item) => item.playbookId),
      ...pendingImportAnalysis.circularIds
    ]);
    const currentIds = new Set(items.map((item) => item.id));
    const successes: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    try {
      for (const playbook of pendingImportAnalysis.playbooks) {
        if (blockedIds.has(playbook.id)) {
          continue;
        }
        try {
          if (currentIds.has(playbook.id)) {
            await updatePlaybook(playbook.id, playbook);
          } else {
            await createPlaybook(playbook);
            currentIds.add(playbook.id);
          }
          successes.push(playbook.id);
        } catch (error) {
          const detail = error instanceof ApiError ? error.message : getErrorMessage(error, "导入失败");
          failures.push({ id: playbook.id, reason: detail });
        }
      }

      setImportPreviewOpen(false);
      setPendingImportAnalysis(null);
      if (successes.length > 0) {
        await load();
      }
      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个任务手册`);
        return;
      }
      Modal.warning({
        title: "导入已完成，部分任务手册处理失败",
        width: 640,
        content: (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {failures.slice(0, 10).map((item) => `${item.id}: ${item.reason}`).join("\n")}
            </pre>
          </Space>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const selectedRepositoryId = Form.useWatch("repositoryId", publishForm);
  const selectedPublishPlaybookId = Form.useWatch("playbookId", publishForm);
  const diffRequestRef = useRef(0);
  const syncedRepositoryIdsRef = useRef<Set<string>>(new Set());

  // 与脚本发布一致：以 useEffect 声明式驱动 diff 计算，自动响应 form 字段变化，
  // 并通过 diffRequestRef 防止旧请求的响应覆盖新请求的 state。
  useEffect(() => {
    if (!publishModalOpen || !selectedRepositoryId || !selectedPublishPlaybookId?.trim() || !publishingPlaybook) {
      setVersionHint(null);
      setPlaybookDiff(null);
      setPlaybookDiffLoading(false);
      return;
    }
    const requestId = diffRequestRef.current + 1;
    diffRequestRef.current = requestId;
    setPlaybookDiffLoading(true);
    setVersionHint(null);

    const repositoryId = selectedRepositoryId;
    const playbookId = selectedPublishPlaybookId.trim();

    void (async () => {
      let syncFailed = false;
      if (!syncedRepositoryIdsRef.current.has(repositoryId)) {
        try {
          await syncRepository(repositoryId);
          syncedRepositoryIdsRef.current.add(repositoryId);
        } catch (syncError) {
          syncFailed = true;
          if (diffRequestRef.current === requestId) {
            messageApi.warning(getErrorMessage(syncError, "同步目标仓库失败，将基于已缓存的远端版本信息继续生成 Diff"));
          }
        }
      }
      if (diffRequestRef.current !== requestId) {
        return;
      }

      let descriptors: Awaited<ReturnType<typeof listRepositoryPlaybooks>> = [];
      try {
        descriptors = await listRepositoryPlaybooks();
      } catch (listError) {
        if (diffRequestRef.current === requestId) {
          setVersionHint(getErrorMessage(listError, "读取仓库任务手册列表失败"));
          setPlaybookDiff(null);
          setPlaybookDiffLoading(false);
        }
        return;
      }
      if (diffRequestRef.current !== requestId) {
        return;
      }

      // 双向 sanitize，兼容大小写/特殊字符差异
      const normalizedPlaybookId = sanitizePlaybookId(playbookId);
      const current = descriptors.find(
        (descriptor) =>
          descriptor.repositoryId === repositoryId &&
          sanitizePlaybookId(descriptor.playbookId) === normalizedPlaybookId
      );
      const nextVersion = bumpPatchVersion(current?.version);
      if (nextVersion) {
        publishForm.setFieldValue("version", nextVersion);
      }
      if (diffRequestRef.current === requestId) {
        setVersionHint(
          current
            ? `目标仓库当前版本 ${current.version}，已建议 ${nextVersion ?? current.version}`
            : syncFailed
              ? "同步失败且目标仓库未找到同 ID 任务手册，请手动确认版本"
              : "目标仓库未找到同 ID 任务手册，建议 0.1.0"
        );
      }

      // useEffect 闭包自动拿到最新的 publishingPlaybook，不再有陈旧值问题
      const localTarget = buildPlaybookDiffTarget(publishingPlaybook);
      if (current) {
        try {
          const detail = await getRepositoryPlaybook(repositoryId, playbookId);
          if (diffRequestRef.current === requestId) {
            const remoteTarget = toRepositoryPlaybookDiffTarget(detail);
            setPlaybookDiff(buildPlaybookDiff(remoteTarget, localTarget));
          }
        } catch (detailError) {
          if (diffRequestRef.current === requestId) {
            setPlaybookDiff(null);
            messageApi.warning(getErrorMessage(detailError, "读取远端任务手册详情失败，无法生成 Diff"));
          }
        }
      } else if (diffRequestRef.current === requestId) {
        setPlaybookDiff(buildPlaybookDiff(undefined, localTarget));
      }
      if (diffRequestRef.current === requestId) {
        setPlaybookDiffLoading(false);
      }
    })();
  }, [messageApi, publishForm, publishModalOpen, publishingPlaybook, selectedPublishPlaybookId, selectedRepositoryId]);

  const openPublishModal = (item: Playbook) => {
    const defaultRepository = pickDefaultPublishRepository(publishableRepositories);
    const playbookId = sanitizePlaybookId(item.id || item.name);
    setPublishingPlaybook(item);
    setPublishModalOpen(true);
    setVersionHint(null);
    setPlaybookDiff(null);
    setPlaybookDiffLoading(false);
    diffRequestRef.current += 1;
    syncedRepositoryIdsRef.current = new Set();
    publishForm.setFieldsValue({
      repositoryId: defaultRepository?.id,
      playbookId,
      version: "0.1.0",
      owner: defaultOwner,
      releaseNotes: ""
    });
  };

  const publish = async () => {
    if (!publishingPlaybook) {
      return;
    }
    const values = await publishForm.validateFields();
    setPublishing(true);
    try {
      const payload: RepositoryPlaybookPublishRequest = {
        sourceId: publishingPlaybook.id,
        playbookId: values.playbookId.trim(),
        displayName: publishingPlaybook.name,
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        releaseNotes: values.releaseNotes?.trim() || undefined,
        tags: publishingPlaybook.tags ?? []
      };
      await publishRepositoryPlaybook(values.repositoryId, payload);
      messageApi.success("任务手册已发布");
      setPublishModalOpen(false);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "发布任务手册失败"));
    } finally {
      setPublishing(false);
    }
  };

  const addNote = (repositoryId: string) => {
    setKnowledgeEditor((value) => value.map((item) => item.repositoryId === repositoryId ? { ...item, notes: [...item.notes, ""] } : item));
  };

  const updateNote = (repositoryId: string, index: number, markdown: string) => {
    setKnowledgeEditor((value) => value.map((item) => item.repositoryId === repositoryId ? {
      ...item,
      notes: item.notes.map((current, currentIndex) => currentIndex === index ? markdown : current)
    } : item));
  };

  const removeNote = (repositoryId: string, index: number) => {
    setKnowledgeEditor((value) => value.map((item) => item.repositoryId === repositoryId ? {
      ...item,
      notes: item.notes.filter((_, currentIndex) => currentIndex !== index)
    } : item));
  };

  const openFilePicker = async (repositoryId: string) => {
    setFilePicker({ open: true, repositoryId });
    setProjectPreview(null);
    setExpandedKeys([]);
    await loadProjectRoot(repositoryId);
  };

  const previewProjectFile = async (repositoryId: string, path: string) => {
    setProjectPreviewLoading(true);
    try {
      const preview = await previewProjectRepositoryFile(repositoryId, path);
      setProjectPreview(preview);
    } catch (error) {
      setProjectPreview(null);
      messageApi.error(getErrorMessage(error, "预览项目文件失败"));
    } finally {
      setProjectPreviewLoading(false);
    }
  };

  const handleTreeExpand = async (keys: React.Key[]) => {
    setExpandedKeys(keys);
    const repositoryId = filePicker.repositoryId;
    if (!repositoryId) {
      return;
    }
    for (const key of keys) {
      if (typeof key !== "string") {
        continue;
      }
      const rootNodes = projectFileTree[repositoryId] ?? [];
      const childNodes = projectFileChildren[repositoryId]?.[key];
      const targetNode = [...rootNodes, ...(Object.values(projectFileChildren[repositoryId] ?? {}).flat())].find((item) => item.path === key);
      if (targetNode?.directory && !childNodes) {
        await loadProjectChildren(repositoryId, key);
      }
    }
  };

  const buildPickerTree = useMemo(() => {
    const repositoryId = filePicker.repositoryId;
    if (!repositoryId) {
      return [];
    }
    const attachChildren = (nodes: RepositoryProjectFileNode[]): DataNode[] => nodes.map((node) => ({
      key: node.path,
      title: node.name,
      icon: node.directory ? <FolderOpenOutlined /> : node.path.toLowerCase().endsWith(".md") ? <FileMarkdownOutlined /> : <FileOutlined />,
      isLeaf: !node.directory,
      children: node.directory ? attachChildren(projectFileChildren[repositoryId]?.[node.path] ?? []) : undefined
    }));
    return attachChildren(projectFileTree[repositoryId] ?? []);
  }, [filePicker.repositoryId, projectFileChildren, projectFileTree]);

  const handleTreeSelect = async (keys: React.Key[]) => {
    const key = keys[0];
    const repositoryId = filePicker.repositoryId;
    if (typeof key !== "string" || !repositoryId) {
      return;
    }
    setFilePicker((value) => ({ ...value, selectedPath: key }));
    await previewProjectFile(repositoryId, key);
  };

  const confirmFileSelection = () => {
    const repositoryId = filePicker.repositoryId;
    const selectedPath = filePicker.selectedPath;
    if (!repositoryId || !selectedPath || !projectPreview || projectPreview.directory) {
      return;
    }
    if (selectedPath === "ACTIONDOCK.md") {
      messageApi.warning("ACTIONDOCK.md 会默认读取，无需显式添加");
      return;
    }
    setKnowledgeEditor((value) => value.map((item) => item.repositoryId === repositoryId ? {
      ...item,
      files: item.files.includes(selectedPath) ? item.files : [...item.files, selectedPath]
    } : item));
    setFilePicker({ open: false });
    setProjectPreview(null);
  };

  const removeFile = (repositoryId: string, path: string) => {
    setKnowledgeEditor((value) => value.map((item) => item.repositoryId === repositoryId ? {
      ...item,
      files: item.files.filter((current) => current !== path)
    } : item));
  };

  const renderProjectPreview = () => {
    if (projectPreviewLoading) {
      return <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>;
    }
    if (!projectPreview) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择文件预览" />;
    }
    if (projectPreview.previewType === "MARKDOWN") {
      return (
        <div className="skill-preview-panel">
          {projectPreview.truncated ? <Alert type="warning" showIcon message="文件内容过长，当前只展示前 200000 个字符。" /> : null}
          <MarkdownDescription value={projectPreview.textContent} className="markdown-description--panel" emptyText="文件为空" />
        </div>
      );
    }
    if (projectPreview.previewType === "TEXT") {
      return (
        <div className="skill-preview-panel">
          {projectPreview.truncated ? <Alert type="warning" showIcon message="文件内容过长，当前只展示前 200000 个字符。" /> : null}
          <CodeEditor value={projectPreview.textContent ?? ""} onChange={() => undefined} theme={editorTheme} language={projectPreview.language || "plaintext"} readOnly height={isCompactFilePicker ? "300px" : "420px"} />
        </div>
      );
    }
    if (projectPreview.previewType === "IMAGE") {
      return <Image src={projectPreview.dataUrl} alt={projectPreview.name} />;
    }
    if (projectPreview.previewType === "DIRECTORY") {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目录没有直接预览内容" />;
    }
    return <Alert type="info" showIcon message="当前文件类型不支持在线预览" description={<Text code>{projectPreview.contentType}</Text>} />;
  };

  const selectedRepositoryIds = Form.useWatch("repositoryIds", form) ?? [];
  const pendingImportBlockedIds = pendingImportAnalysis ? new Set([
    ...pendingImportAnalysis.managedConflictIds,
    ...pendingImportAnalysis.missingScriptRefs.map((item) => item.playbookId),
    ...pendingImportAnalysis.missingRelatedPlaybookRefs.map((item) => item.playbookId),
    ...pendingImportAnalysis.circularIds
  ]) : new Set<string>();

  const bulkActionMenu = {
    items: [
      {
        key: "import",
        label: "导入任务手册",
        icon: <UploadOutlined />,
        onClick: () => fileInputRef.current?.click()
      },
      {
        key: "exportEditable",
        label: "导出可编辑",
        icon: <DownloadOutlined />,
        disabled: editablePlaybooks.length === 0,
        onClick: handleExportVisible
      },
      {
        key: "exportSelected",
        label: "导出选中",
        icon: <ExportOutlined />,
        disabled: selectedPlaybookIds.length === 0,
        onClick: handleExportSelected
      }
    ]
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={(event) => void handleImportChange(event)}
      />
      <PageHeader
        title="任务手册"
        meta="以关联知识、关联脚本、导览 Markdown 和停止条件描述任务路线。"
        actions={(
          <Space wrap>
            <Dropdown menu={bulkActionMenu}>
              <Button>
                批量操作 <DownOutlined />
              </Button>
            </Dropdown>
            <Button type="primary" onClick={() => openEditor()}>新建任务手册</Button>
          </Space>
        )}
      />
      <Tabs
        items={[
          {
            key: "playbooks",
            label: "任务手册",
            children: (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Space wrap>
                  <Input.Search
                    allowClear
                    placeholder="按意图搜索"
                    style={{ width: 260 }}
                    onSearch={(intent) => setFilters((value) => ({ ...value, intent: intent.trim() || undefined }))}
                  />
                  <Select allowClear placeholder="Repository" style={{ width: 220 }} options={repositoryOptions} onChange={(repositoryId) => setFilters((value) => ({ ...value, repositoryId }))} />
                  <Select allowClear placeholder="Tag" style={{ width: 160 }} options={tags.map((item) => ({ value: item, label: item }))} onChange={(tag) => setFilters((value) => ({ ...value, tag }))} />
                  <Select allowClear placeholder="Managed" style={{ width: 140 }} options={[{ value: true, label: "托管" }]} onChange={(managed) => setFilters((value) => ({ ...value, managed }))} />
                </Space>
                <Table<Playbook>
                  rowKey="id"
                  loading={loading}
                  dataSource={items}
                  rowSelection={{
                    selectedRowKeys: selectedPlaybookIds,
                    onChange: setSelectedPlaybookIds,
                    getCheckboxProps: (record) => ({ disabled: record.managed })
                  }}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: "ID", dataIndex: "id", width: 220, render: (value, item) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEditor(item)}>{value}</Button> },
                    { title: "名称", dataIndex: "name" },
                    { title: "状态", key: "status", width: 150, render: (_, item) => <Space>{item.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}{item.managed ? <Tag color="blue">托管</Tag> : null}</Space> },
                    {
                      title: "操作",
                      key: "actions",
                      width: 180,
                      fixed: "right",
                      render: (_, item) => {
                        const menuItems = [
                          {
                            key: "publish",
                            label: "发布到仓库",
                            disabled: item.managed,
                            onClick: () => openPublishModal(item)
                          },
                          {
                            key: "export",
                            label: "导出",
                            disabled: item.managed,
                            onClick: () => exportPlaybooks([item], `已导出 ${item.name || item.id}`)
                          }
                        ];

                        return (
                          <Space size="middle">
                            <Dropdown menu={{ items: menuItems }}>
                              <Button type="link" size="small" style={{ padding: 0 }}>
                                更多 <DownOutlined />
                              </Button>
                            </Dropdown>
                            <Popconfirm
                              title="确认删除任务手册？"
                              description={`你确定要删除任务手册 "${item.name || item.id}" 吗？`}
                              okText="删除"
                              okType="danger"
                              cancelText="取消"
                              disabled={item.managed}
                              onConfirm={() => void remove(item)}
                            >
                              <Button type="link" size="small" danger disabled={item.managed} style={{ padding: 0 }}>
                                删除
                              </Button>
                            </Popconfirm>
                          </Space>
                        );
                      }
                    }
                  ]}
                />
              </Space>
            )
          }
        ]}
      />
      <Modal
        title="确认导入任务手册"
        open={importPreviewOpen}
        onCancel={() => {
          setImportPreviewOpen(false);
          setPendingImportAnalysis(null);
        }}
        onOk={() => void runImport()}
        okText="继续导入"
        cancelText="取消"
        confirmLoading={importing}
        okButtonProps={{
          disabled: !pendingImportAnalysis || pendingImportAnalysis.playbooks.length === pendingImportBlockedIds.size
        }}
        destroyOnHidden
      >
        {pendingImportAnalysis ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text>共解析到 {pendingImportAnalysis.playbooks.length} 个任务手册。</Text>
            <Space wrap>
              <Tag color="green">新增 {pendingImportAnalysis.createIds.length}</Tag>
              <Tag color="orange">覆盖 {pendingImportAnalysis.overwriteIds.length}</Tag>
              <Tag color="red">托管冲突 {pendingImportAnalysis.managedConflictIds.length}</Tag>
              <Tag color="red">缺失脚本 {pendingImportAnalysis.missingScriptRefs.length}</Tag>
              <Tag color="red">缺失相关手册 {pendingImportAnalysis.missingRelatedPlaybookRefs.length}</Tag>
              <Tag color="red">循环引用 {pendingImportAnalysis.circularIds.length}</Tag>
            </Space>
            {pendingImportAnalysis.managedConflictIds.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="以下 ID 已存在为仓库托管任务手册，导入时会跳过"
                description={pendingImportAnalysis.managedConflictIds.join(", ")}
              />
            ) : null}
            {pendingImportAnalysis.missingScriptRefs.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="以下任务手册引用了当前不存在的脚本，导入时会跳过"
                description={pendingImportAnalysis.missingScriptRefs.map((item) => `${item.playbookId}: ${item.scriptIds.join(", ")}`).join("\n")}
              />
            ) : null}
            {pendingImportAnalysis.missingRelatedPlaybookRefs.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="以下任务手册引用了不存在的外部相关任务手册，导入时会跳过"
                description={pendingImportAnalysis.missingRelatedPlaybookRefs.map((item) => `${item.playbookId}: ${item.missingPlaybookIds.join(", ")}`).join("\n")}
              />
            ) : null}
            {pendingImportAnalysis.circularIds.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="以下新建任务手册之间存在循环引用，导入时会跳过"
                description={pendingImportAnalysis.circularIds.join(", ")}
              />
            ) : null}
          </Space>
        ) : null}
      </Modal>
      <Drawer
        title={readOnly ? "查看任务手册" : editing ? "编辑任务手册" : "新建任务手册"}
        open={drawerOpen}
        width={920}
        onClose={() => { setDrawerOpen(false); setReadOnly(false); }}
        extra={readOnly ? <Button onClick={() => { setDrawerOpen(false); setReadOnly(false); }}>关闭</Button> : <Button type="primary" onClick={() => void save()}>保存</Button>}
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }} disabled={readOnly}>
            <Tabs
              items={[
                {
                  key: "basic",
                  label: "基本信息",
                  forceRender: true,
                  children: (
                    <>
                      <Form.Item name="id" label="ID" rules={[{ required: true, message: "请输入 ID" }]}><Input disabled={Boolean(editing)} /></Form.Item>
                      <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input /></Form.Item>
                      <Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item>
                      <Form.Item name="tagsText" label="Tags"><Input placeholder="逗号分隔" /></Form.Item>
                      <Form.Item name="riskLevel" label="风险等级"><Select allowClear options={["LOW", "MEDIUM", "HIGH"].map((value) => ({ value, label: value }))} /></Form.Item>
                      <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                    </>
                  )
                },
                {
                  key: "rules",
                  label: "运行规则",
                  forceRender: true,
                  children: (
                    <>
                      <Form.Item name="guideMarkdown" label="导览 Markdown" rules={[{ required: true, message: "请输入导览文本" }]}>
                        <CodeEditor theme={editorTheme} language="markdown" height="360px" readOnly={readOnly} />
                      </Form.Item>
                      <Form.Item name="stopConditionsText" label="停止条件" style={{ marginTop: 16 }}><Input.TextArea rows={5} placeholder="每行一个停止条件" /></Form.Item>
                    </>
                  )
                },
                {
                  key: "knowledge",
                  label: "关联知识",
                  forceRender: true,
                  children: (
                    <>
                      <Form.Item name="repositoryIds" label="适用仓库">
                        <Select mode="multiple" options={repositoryOptions} onChange={handleRepositoryIdsChange} />
                      </Form.Item>
                      {selectedRepositoryIds.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择适用仓库，再添加知识说明 and 知识文件。" />
                      ) : (
                        <Space direction="vertical" size={16} style={{ width: "100%" }}>
                          {knowledgeEditor.map((group) => (
                            <div key={group.repositoryId} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 16 }}>
                              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                                <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                  <Text strong>{repositoryNameMap.get(group.repositoryId) ?? group.repositoryId} ({group.repositoryId})</Text>
                                  <Space>
                                    <Button size="small" onClick={() => addNote(group.repositoryId)} disabled={readOnly}>添加说明</Button>
                                    <Button size="small" onClick={() => void openFilePicker(group.repositoryId)} disabled={readOnly}>添加文件</Button>
                                  </Space>
                                </Space>
                                {group.notes.length === 0 && group.files.length === 0 ? (
                                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有添加知识说明或文件引用" />
                                ) : null}
                                {group.notes.map((note, index) => (
                                  <div key={`${group.repositoryId}:note:${index}`} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
                                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                      <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                        <Tag color="gold">NOTE</Tag>
                                        <Button size="small" danger onClick={() => removeNote(group.repositoryId, index)} disabled={readOnly}>删除说明</Button>
                                      </Space>
                                      <Input.TextArea rows={6} value={note} onChange={(event) => updateNote(group.repositoryId, index, event.target.value)} placeholder="输入针对该知识库的额外阅读指引（Markdown）" />
                                    </Space>
                                  </div>
                                ))}
                                {group.files.map((path) => (
                                  <div key={`${group.repositoryId}:${path}`} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
                                    <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                      <Space>
                                        <Tag color="blue">FILE</Tag>
                                        <Text code>{path}</Text>
                                      </Space>
                                      <Button size="small" danger onClick={() => removeFile(group.repositoryId, path)} disabled={readOnly}>删除文件</Button>
                                    </Space>
                                  </div>
                                ))}
                              </Space>
                            </div>
                          ))}
                        </Space>
                      )}
                    </>
                  )
                },
                {
                  key: "scripts",
                  label: "关联脚本",
                  forceRender: true,
                  children: (
                    <Form.List name="scriptRefs">
                      {(fields, { add, remove }) => (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {fields.map(({ key, name, ...restField }) => (
                            <Space key={key} style={{ display: "flex", width: "100%" }} align="baseline">
                              <Form.Item
                                {...restField}
                                name={[name, "scriptId"]}
                                rules={[{ required: true, message: "请选择脚本" }]}
                                style={{ width: 260, marginBottom: 0 }}
                              >
                                <Select
                                  showSearch
                                  placeholder="选择关联脚本"
                                  optionFilterProp="label"
                                  options={scriptOptions}
                                />
                              </Form.Item>
                              <Form.Item noStyle shouldUpdate>
                                {() => {
                                  const scriptId = form.getFieldValue(["scriptRefs", name, "scriptId"]);
                                  const script = scripts.find((s) => s.id === scriptId);
                                  return (
                                    <Form.Item
                                      {...restField}
                                      name={[name, "purpose"]}
                                      style={{ width: 340, marginBottom: 0 }}
                                    >
                                      <Input placeholder={script ? `默认：${script.name}` : "脚本用途说明（可空，默认使用脚本名称）"} />
                                    </Form.Item>
                                  );
                                }}
                              </Form.Item>
                              <Button type="text" danger onClick={() => remove(name)} icon={<DeleteOutlined />} title="删除关联" disabled={readOnly} />
                            </Space>
                          ))}
                          <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} disabled={readOnly}>
                              添加关联脚本
                            </Button>
                          </Form.Item>
                        </div>
                      )}
                    </Form.List>
                  )
                },
                {
                  key: "agentSkills",
                  label: "关联Skill",
                  forceRender: true,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Form.List name="agentSkillRefs">
                        {(fields, { add, remove }) => (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {fields.map(({ key, name, ...restField }) => (
                              <Space key={key} style={{ display: "flex", width: "100%" }} align="baseline">
                                <Form.Item
                                  {...restField}
                                  name={[name, "skillId"]}
                                  rules={[{ required: true, message: "请输入 Skill ID" }]}
                                  style={{ width: 240, marginBottom: 0 }}
                                >
                                  <Input placeholder="Agent 外部 Skill ID" />
                                </Form.Item>
                                <Form.Item
                                  {...restField}
                                  name={[name, "purpose"]}
                                  style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
                                >
                                  <Input placeholder="使用场景说明（可空）" />
                                </Form.Item>
                                <Form.Item
                                  {...restField}
                                  name={[name, "required"]}
                                  valuePropName="checked"
                                  style={{ marginBottom: 0 }}
                                >
                                  <Switch checkedChildren="必需" unCheckedChildren="可选" />
                                </Form.Item>
                                <Button type="text" danger onClick={() => remove(name)} icon={<DeleteOutlined />} title="删除引用" disabled={readOnly} />
                              </Space>
                            ))}
                            <Form.Item style={{ marginBottom: 0 }}>
                              <Button type="dashed" onClick={() => add({ required: false })} block icon={<PlusOutlined />} disabled={readOnly}>
                                添加关联Skill
                              </Button>
                            </Form.Item>
                          </div>
                        )}
                      </Form.List>
                    </Space>
                  )
                },
                {
                  key: "relatedPlaybooks",
                  label: "关联任务手册",
                  forceRender: true,
                  children: (
                    <Form.List name="relatedPlaybookRefs">
                      {(fields, { add, remove }) => (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {fields.map(({ key, name, ...restField }) => (
                            <Space key={key} style={{ display: "flex", width: "100%" }} align="baseline">
                              <Form.Item
                                {...restField}
                                name={[name, "playbookId"]}
                                rules={[{ required: true, message: "请选择或输入任务手册 ID" }]}
                                style={{ width: 260, marginBottom: 0 }}
                              >
                                <Select
                                  showSearch
                                  placeholder="相关任务手册"
                                  optionFilterProp="label"
                                  options={items
                                    .filter((item) => item.id !== editing?.id)
                                    .map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))}
                                />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, "relation"]}
                                rules={[{ required: true, message: "请选择关系" }]}
                                style={{ width: 160, marginBottom: 0 }}
                              >
                                <Select
                                  options={[
                                    { value: "RELATED", label: "相关" },
                                    { value: "FOLLOW_UP", label: "后续" },
                                    { value: "FALLBACK", label: "兜底" }
                                  ]}
                                />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, "purpose"]}
                                style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
                              >
                                <Input placeholder="跳转或参考说明（可空）" />
                              </Form.Item>
                              <Button type="text" danger onClick={() => remove(name)} icon={<DeleteOutlined />} title="删除引用" disabled={readOnly} />
                            </Space>
                          ))}
                          <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="dashed" onClick={() => add({ relation: "RELATED" })} block icon={<PlusOutlined />} disabled={readOnly}>
                              添加关联任务手册
                            </Button>
                          </Form.Item>
                        </div>
                      )}
                    </Form.List>
                  )
                }
              ]}
            />
          </Form>
      </Drawer>
      <Drawer
        title="发布任务手册到仓库"
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        width={960}
        extra={(
          <Button
            type="primary"
            loading={publishing}
            onClick={() => void publish()}
            disabled={playbookDiff !== null && !playbookDiff.hasChanges && playbookDiff.comparisonMode !== "INITIAL"}
          >
            发布
          </Button>
        )}
        destroyOnClose
      >
        {playbookDiffLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spin />
          </div>
        ) : playbookDiff ? (
          <Card type="inner" title="变更明细" style={{ marginBottom: 16 }}>
            <PlaybookDiffPanel diff={playbookDiff} theme={editorTheme} />
          </Card>
        ) : null}
        <Form form={publishForm} layout="vertical">
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="关联脚本和知识源不会自动随任务手册一起发布"
            description="发布时会检查目标仓库里是否已经存在 scriptRefs 对应脚本，以及 knowledgeRefs 对应知识源；缺失时会直接阻断，请先分别发布。"
          />
          <Form.Item name="repositoryId" label="目标仓库" rules={[{ required: true, message: "请选择目标仓库" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={publishRepositoryOptions}
            />
          </Form.Item>
          <Form.Item name="playbookId" label="仓库任务手册 ID" rules={[{ required: true, message: "请输入仓库任务手册 ID" }]}>
            <Input />
          </Form.Item>
          {versionHint ? <Alert type="info" showIcon message={versionHint} style={{ marginBottom: 16 }} /> : null}
          <Space size={12} style={{ width: "100%" }} align="start">
            <Form.Item name="version" label="版本" rules={[{ required: true, message: "请输入版本" }]} style={{ flex: 1 }}><Input /></Form.Item>
            <Form.Item name="owner" label="维护人" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
          <Form.Item name="releaseNotes" label="发布说明"><Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} /></Form.Item>
        </Form>
      </Drawer>
      <Modal
        title={filePicker.repositoryId ? `选择知识文件 - ${repositoryNameMap.get(filePicker.repositoryId) ?? filePicker.repositoryId}` : "选择知识文件"}
        open={filePicker.open}
        onCancel={() => {
          setFilePicker({ open: false });
          setProjectPreview(null);
        }}
        onOk={confirmFileSelection}
        okButtonProps={{
          disabled: !projectPreview || projectPreview.directory || filePicker.selectedPath === "ACTIONDOCK.md" || Boolean(filePicker.repositoryId && knowledgeEditor.find((item) => item.repositoryId === filePicker.repositoryId)?.files.includes(filePicker.selectedPath ?? ""))
        }}
        width={isCompactFilePicker ? "calc(100vw - 24px)" : 960}
        destroyOnHidden
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isCompactFilePicker ? "minmax(0, 1fr)" : "280px minmax(0, 1fr)",
            gridTemplateRows: isCompactFilePicker ? "220px minmax(0, 1fr)" : undefined,
            gap: 16,
            minHeight: isCompactFilePicker ? 560 : 480
          }}
        >
          <div
            style={{
              borderRight: isCompactFilePicker ? "none" : "1px solid #f0f0f0",
              borderBottom: isCompactFilePicker ? "1px solid #f0f0f0" : "none",
              paddingRight: isCompactFilePicker ? 0 : 16,
              paddingBottom: isCompactFilePicker ? 16 : 0,
              overflow: "auto",
              minHeight: 0
            }}
          >
            {projectTreeLoading ? <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div> : (
              buildPickerTree.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可浏览的文件" /> : (
                <Tree
                  showIcon
                  blockNode
                  expandedKeys={expandedKeys}
                  selectedKeys={filePicker.selectedPath ? [filePicker.selectedPath] : []}
                  treeData={buildPickerTree}
                  onExpand={(keys) => void handleTreeExpand(keys)}
                  onSelect={(keys) => void handleTreeSelect(keys)}
                />
              )
            )}
          </div>
          <div
            style={{
              minWidth: 0,
              overflow: "auto",
              maxHeight: isCompactFilePicker ? "calc(100vh - 360px)" : undefined
            }}
          >
            {filePicker.selectedPath === "ACTIONDOCK.md" ? <Alert type="info" showIcon message="ACTIONDOCK.md 会默认读取，无需显式添加到知识引用。" style={{ marginBottom: 12 }} /> : null}
            {filePicker.repositoryId && filePicker.selectedPath && knowledgeEditor.find((item) => item.repositoryId === filePicker.repositoryId)?.files.includes(filePicker.selectedPath) ? (
              <Alert type="warning" showIcon message="该文件已添加为知识引用。" style={{ marginBottom: 12 }} />
            ) : null}
            {renderProjectPreview()}
          </div>
        </div>
      </Modal>
    </Space>
  );
}
