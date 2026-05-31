import { FileMarkdownOutlined, FileOutlined, FolderOpenOutlined } from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";
import { Alert, Button, Drawer, Empty, Form, Grid, Image, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tabs, Tag, Tree, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownDescription } from "../../../components/common/MarkdownDescription";
import { PageHeader } from "../../../components/common/PageHeader";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { ApiError } from "../../../shared/api/httpClient";
import type {
  Playbook,
  PlaybookGroup,
  PlaybookGuideView,
  PlaybookKnowledgeRef,
  RepositoryDefinition,
  RepositoryPlaybookPublishRequest,
  RepositoryProjectFileNode,
  RepositoryProjectFilePreview,
  ScriptDefinition
} from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";
import { getPublishableRepositories, pickDefaultPublishRepository } from "../../../services/repositoryPublish";
import { useDefaultOwner } from "../../../shared/hooks/useDefaultOwner";
import {
  listProjectRepositoryFiles,
  listRepositories,
  listRepositoryPlaybooks,
  previewProjectRepositoryFile,
  publishRepositoryPlaybook,
  syncRepository
} from "../../resources/api";
import { listScripts } from "../../scripts/api";
import { createPlaybook, deletePlaybook, getPlaybookGuide, listPlaybookGroups, listPlaybooks, updatePlaybook } from "../api";

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface PlaybookFormValues {
  id: string;
  groupId: string;
  name: string;
  description?: string;
  intentAliasesText?: string;
  tagsText?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  repositoryIds: string[];
  scriptIds: string[];
  guideMarkdown: string;
  stopConditionsText?: string;
  enabled: boolean;
}

interface PublishFormValues {
  repositoryId: string;
  playbookId: string;
  displayName: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
  tags: string[];
}

interface KnowledgeEditorState {
  repositoryId: string;
  notes: string[];
  files: string[];
}

interface FilePickerState {
  open: boolean;
  repositoryId?: string;
  selectedPath?: string;
}

function splitText(value?: string): string[] {
  return value?.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean) ?? [];
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

function toKnowledgeEditorState(repositoryIds: string[], refs: PlaybookKnowledgeRef[]): KnowledgeEditorState[] {
  return repositoryIds.map((repositoryId) => {
    const notes = refs
      .filter((ref) => ref.repositoryId === repositoryId && ref.type === "NOTE" && ref.markdown)
      .map((ref) => ref.markdown?.trim() ?? "")
      .filter(Boolean);
    const files = refs
      .filter((ref) => ref.repositoryId === repositoryId && ref.type === "FILE" && ref.path)
      .map((ref) => ref.path?.trim() ?? "")
      .filter(Boolean);
    return { repositoryId, notes, files };
  });
}

function fromKnowledgeEditorState(groups: KnowledgeEditorState[]): PlaybookKnowledgeRef[] {
  return groups.flatMap((group) => [
    ...group.notes
      .map((markdown) => markdown.trim())
      .filter(Boolean)
      .map((markdown) => ({ type: "NOTE" as const, repositoryId: group.repositoryId, markdown })),
    ...group.files
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => ({ type: "FILE" as const, repositoryId: group.repositoryId, path }))
  ]);
}

function upsertKnowledgeGroups(previous: KnowledgeEditorState[], repositoryIds: string[]): KnowledgeEditorState[] {
  const next = repositoryIds.map((repositoryId) => previous.find((item) => item.repositoryId === repositoryId) ?? { repositoryId, notes: [], files: [] });
  return next.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
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
  const [items, setItems] = useState<Playbook[]>([]);
  const [groups, setGroups] = useState<PlaybookGroup[]>([]);
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [knowledgeEditor, setKnowledgeEditor] = useState<KnowledgeEditorState[]>([]);
  const [filePicker, setFilePicker] = useState<FilePickerState>({ open: false });
  const [projectFileTree, setProjectFileTree] = useState<Record<string, RepositoryProjectFileNode[]>>({});
  const [projectFileChildren, setProjectFileChildren] = useState<Record<string, Record<string, RepositoryProjectFileNode[]>>>({});
  const [projectPreview, setProjectPreview] = useState<RepositoryProjectFilePreview | null>(null);
  const [projectPreviewLoading, setProjectPreviewLoading] = useState(false);
  const [projectTreeLoading, setProjectTreeLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{ groupId?: string; repositoryId?: string; tag?: string; managed?: boolean; keyword?: string }>({});
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guide, setGuide] = useState<PlaybookGuideView | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishingPlaybook, setPublishingPlaybook] = useState<Playbook | null>(null);
  const [versionHint, setVersionHint] = useState<string | null>(null);
  const [form] = Form.useForm<PlaybookFormValues>();
  const [publishForm] = Form.useForm<PublishFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const [playbookData, groupData, repositoryData, publishRepositoryData, scriptData] = await Promise.all([
        listPlaybooks(filters),
        listPlaybookGroups(),
        listRepositories("PROJECT"),
        listRepositories(),
        listScripts()
      ]);
      setItems(playbookData);
      setGroups(groupData);
      setRepositories(repositoryData);
      setPublishRepositories(publishRepositoryData);
      setScripts(scriptData);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载任务手册失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filters.groupId, filters.repositoryId, filters.tag, filters.managed, filters.keyword]);

  const groupOptions = useMemo(() => groups.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [groups]);
  const repositoryOptions = useMemo(() => repositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [repositories]);
  const repositoryNameMap = useMemo(() => new Map(repositories.map((item) => [item.id, item.name])), [repositories]);
  const publishableRepositories = useMemo(() => getPublishableRepositories(publishRepositories), [publishRepositories]);
  const publishRepositoryOptions = useMemo(() => publishableRepositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [publishableRepositories]);
  const scriptOptions = useMemo(() => scripts.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [scripts]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort(), [items]);

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
    setGuide(null);
    setKnowledgeEditor(toKnowledgeEditorState(repositoryIds, item?.knowledgeRefs ?? []));
    form.setFieldsValue({
      id: item?.id ?? "",
      groupId: item?.groupId ?? groups[0]?.id,
      name: item?.name ?? "",
      description: item?.description,
      intentAliasesText: item?.intentAliases?.join(", "),
      tagsText: item?.tags?.join(", "),
      riskLevel: item?.riskLevel,
      repositoryIds,
      scriptIds: item?.scriptRefs?.map((ref) => ref.scriptId) ?? [],
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
    const values = await form.validateFields();
    const payload: Playbook = {
      id: values.id.trim(),
      groupId: values.groupId,
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      intentAliases: splitText(values.intentAliasesText),
      tags: splitText(values.tagsText),
      riskLevel: values.riskLevel,
      repositoryIds: values.repositoryIds ?? [],
      knowledgeRefs: fromKnowledgeEditorState(knowledgeEditor),
      scriptRefs: (values.scriptIds ?? []).map((scriptId) => ({ scriptId })),
      guideMarkdown: values.guideMarkdown,
      stopConditions: splitText(values.stopConditionsText),
      enabled: values.enabled,
      managed: editing?.managed ?? false
    };
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

  const previewGuide = async (item: Playbook) => {
    try {
      setGuide(await getPlaybookGuide(item.id));
      setEditing(item);
      setDrawerOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Guide 失败"));
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

  const suggestVersion = async (repositoryId?: string, playbookId?: string) => {
    if (!repositoryId || !playbookId) {
      setVersionHint(null);
      return;
    }
    try {
      await syncRepository(repositoryId);
      const descriptors = await listRepositoryPlaybooks();
      const current = descriptors.find((descriptor) => descriptor.repositoryId === repositoryId && descriptor.playbookId === playbookId);
      const nextVersion = bumpPatchVersion(current?.version);
      if (nextVersion) {
        publishForm.setFieldValue("version", nextVersion);
        setVersionHint(current ? `目标仓库当前版本 ${current.version}，已建议 ${nextVersion}` : "目标仓库未找到同 ID 任务手册，建议 0.1.0");
      } else {
        setVersionHint(`目标仓库当前版本 ${current?.version} 无法自动递增，请手动填写版本`);
      }
    } catch (error) {
      setVersionHint(null);
      messageApi.warning(getErrorMessage(error, "同步目标仓库或读取版本失败，请手动确认版本"));
    }
  };

  const openPublishModal = (item: Playbook) => {
    const defaultRepository = pickDefaultPublishRepository(publishableRepositories);
    const playbookId = sanitizePlaybookId(item.id || item.name);
    setPublishingPlaybook(item);
    setPublishModalOpen(true);
    setVersionHint(null);
    publishForm.setFieldsValue({
      repositoryId: defaultRepository?.id,
      playbookId,
      displayName: item.name,
      version: "0.1.0",
      owner: defaultOwner,
      releaseNotes: "",
      tags: item.tags ?? []
    });
    void suggestVersion(defaultRepository?.id, playbookId);
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
        displayName: values.displayName.trim(),
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        releaseNotes: values.releaseNotes?.trim() || undefined,
        tags: values.tags ?? []
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
          <CodeEditor value={projectPreview.textContent ?? ""} onChange={() => undefined} theme="vs-light" language={projectPreview.language || "plaintext"} readOnly height={isCompactFilePicker ? "300px" : "420px"} />
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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="任务手册"
        meta="以关联知识、关联脚本、导览 Markdown 和停止条件描述任务路线。"
        actions={<Button type="primary" onClick={() => openEditor()}>新建任务手册</Button>}
      />
      <Space wrap>
        <Input.Search allowClear placeholder="搜索任务手册" style={{ width: 260 }} onSearch={(keyword) => setFilters((value) => ({ ...value, keyword }))} onChange={(event) => setFilters((value) => ({ ...value, keyword: event.target.value }))} />
        <Select allowClear placeholder="Group" style={{ width: 220 }} options={groupOptions} onChange={(groupId) => setFilters((value) => ({ ...value, groupId }))} />
        <Select allowClear placeholder="Repository" style={{ width: 220 }} options={repositoryOptions} onChange={(repositoryId) => setFilters((value) => ({ ...value, repositoryId }))} />
        <Select allowClear placeholder="Tag" style={{ width: 160 }} options={tags.map((item) => ({ value: item, label: item }))} onChange={(tag) => setFilters((value) => ({ ...value, tag }))} />
        <Select allowClear placeholder="Managed" style={{ width: 140 }} options={[{ value: true, label: "托管" }]} onChange={(managed) => setFilters((value) => ({ ...value, managed }))} />
      </Space>
      <Table<Playbook>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          { title: "ID", dataIndex: "id", width: 220 },
          { title: "名称", dataIndex: "name" },
          { title: "Group", dataIndex: "groupId", width: 180 },
          { title: "风险", dataIndex: "riskLevel", width: 100, render: (value?: string) => value ? <Tag color={value === "HIGH" ? "red" : value === "MEDIUM" ? "orange" : "green"}>{value}</Tag> : "-" },
          { title: "Tag", dataIndex: "tags", render: (value: string[]) => <Space wrap>{value?.map((item) => <Tag key={item}>{item}</Tag>)}</Space> },
          { title: "状态", key: "status", width: 150, render: (_, item) => <Space>{item.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}{item.managed ? <Tag color="blue">托管</Tag> : null}</Space> },
          {
            title: "操作",
            key: "actions",
            width: 220,
            render: (_, item) => (
              <Space>
                <Button size="small" onClick={() => void previewGuide(item)}>预览</Button>
                <Button size="small" disabled={item.managed} onClick={() => openEditor(item)}>编辑</Button>
                <Button size="small" disabled={item.managed} onClick={() => openPublishModal(item)}>发布到仓库</Button>
                <Popconfirm title="删除任务手册？" disabled={item.managed} onConfirm={() => void remove(item)}>
                  <Button size="small" danger disabled={item.managed}>删除</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Drawer title={guide ? "Guide 预览" : editing ? "编辑任务手册" : "新建任务手册"} open={drawerOpen} width={920} onClose={() => setDrawerOpen(false)} extra={!guide ? <Button type="primary" onClick={() => void save()}>保存</Button> : null}>
        {guide ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {guide.knowledgeRefs.map((ref, index) => ref.type === "NOTE" ? (
              <div key={`${ref.repositoryId}:note:${index}`}>
                <Text strong>{ref.repositoryId} 说明</Text>
                <MarkdownDescription value={ref.markdown} className="markdown-description--panel" />
              </div>
            ) : (
              <Tag key={`${ref.repositoryId}:${ref.path}`}>FILE {ref.repositoryId}:{ref.path}</Tag>
            ))}
            <Space wrap>{guide.scriptRefs.map((ref) => <Tag color="blue" key={ref.scriptId}>{ref.scriptId}</Tag>)}</Space>
            <MarkdownDescription value={guide.guideMarkdown} className="markdown-description--panel" />
            <Space wrap>{guide.stopConditions.map((item) => <Tag color="red" key={item}>{item}</Tag>)}</Space>
          </Space>
        ) : (
          <Tabs
            items={[
              {
                key: "basic",
                label: "基本信息",
                children: (
                  <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
                    <Form.Item name="id" label="ID" rules={[{ required: true, message: "请输入 ID" }]}><Input disabled={Boolean(editing)} /></Form.Item>
                    <Form.Item name="groupId" label="任务分组" rules={[{ required: true, message: "请选择任务分组" }]}><Select options={groupOptions} /></Form.Item>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input /></Form.Item>
                    <Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item>
                    <Form.Item name="intentAliasesText" label="意图别名"><Input placeholder="逗号分隔" /></Form.Item>
                    <Form.Item name="tagsText" label="Tags"><Input placeholder="逗号分隔" /></Form.Item>
                    <Form.Item name="riskLevel" label="风险等级"><Select allowClear options={["LOW", "MEDIUM", "HIGH"].map((value) => ({ value, label: value }))} /></Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                  </Form>
                )
              },
              {
                key: "knowledge",
                label: "关联知识",
                children: (
                  <Form form={form} layout="vertical">
                    <Form.Item name="repositoryIds" label="适用仓库">
                      <Select mode="multiple" options={repositoryOptions} onChange={handleRepositoryIdsChange} />
                    </Form.Item>
                    {selectedRepositoryIds.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择适用仓库，再添加知识说明和知识文件。" />
                    ) : (
                      <Space direction="vertical" size={16} style={{ width: "100%" }}>
                        {knowledgeEditor.map((group) => (
                          <div key={group.repositoryId} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 16 }}>
                            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                              <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                <Text strong>{repositoryNameMap.get(group.repositoryId) ?? group.repositoryId} ({group.repositoryId})</Text>
                                <Space>
                                  <Button size="small" onClick={() => addNote(group.repositoryId)}>添加说明</Button>
                                  <Button size="small" onClick={() => void openFilePicker(group.repositoryId)}>添加文件</Button>
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
                                      <Button size="small" danger onClick={() => removeNote(group.repositoryId, index)}>删除说明</Button>
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
                                    <Button size="small" danger onClick={() => removeFile(group.repositoryId, path)}>删除文件</Button>
                                  </Space>
                                </div>
                              ))}
                            </Space>
                          </div>
                        ))}
                      </Space>
                    )}
                  </Form>
                )
              },
              {
                key: "scripts",
                label: "关联脚本",
                children: <Form form={form} layout="vertical"><Form.Item name="scriptIds" label="脚本"><Select mode="multiple" showSearch optionFilterProp="label" options={scriptOptions} /></Form.Item></Form>
              },
              {
                key: "guide",
                label: "导览文本与停止条件",
                children: (
                  <Form form={form} layout="vertical">
                    <Form.Item name="guideMarkdown" label="Guide Markdown" rules={[{ required: true, message: "请输入导览文本" }]}><Input.TextArea rows={12} /></Form.Item>
                    <Form.Item name="stopConditionsText" label="停止条件"><Input.TextArea rows={5} placeholder="每行一个停止条件" /></Form.Item>
                  </Form>
                )
              }
            ]}
          />
        )}
      </Drawer>
      <Modal
        title="发布任务手册到仓库"
        open={publishModalOpen}
        onCancel={() => setPublishModalOpen(false)}
        onOk={() => void publish()}
        confirmLoading={publishing}
        okText="发布"
        destroyOnHidden
      >
        <Form form={publishForm} layout="vertical">
          <Form.Item name="repositoryId" label="目标仓库" rules={[{ required: true, message: "请选择目标仓库" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={publishRepositoryOptions}
              onChange={(repositoryId) => void suggestVersion(repositoryId, publishForm.getFieldValue("playbookId"))}
            />
          </Form.Item>
          <Form.Item name="playbookId" label="仓库任务手册 ID" rules={[{ required: true, message: "请输入仓库任务手册 ID" }]}>
            <Input onBlur={(event) => void suggestVersion(publishForm.getFieldValue("repositoryId"), event.target.value)} />
          </Form.Item>
          {versionHint ? <Alert type="info" showIcon message={versionHint} style={{ marginBottom: 16 }} /> : null}
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: "请输入显示名称" }]}><Input /></Form.Item>
          <Space size={12} style={{ width: "100%" }} align="start">
            <Form.Item name="version" label="版本" rules={[{ required: true, message: "请输入版本" }]} style={{ flex: 1 }}><Input /></Form.Item>
            <Form.Item name="owner" label="维护人" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
          <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[","]} /></Form.Item>
          <Form.Item name="releaseNotes" label="发布说明"><Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} /></Form.Item>
        </Form>
      </Modal>
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
