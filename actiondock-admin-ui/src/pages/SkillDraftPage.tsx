import { CheckCircleOutlined, FileTextOutlined, FolderOpenOutlined, RocketOutlined } from "@ant-design/icons";
import { DiffEditor } from "@monaco-editor/react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Tree,
  Typography,
  message
} from "antd";
import type { DataNode } from "antd/es/tree";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  downloadInstalledSkillArchive,
  downloadRepositorySkillArchive,
  getRepositorySkill,
  installSkillDraftArchive,
  listRepositories,
  listSkillTargets,
  listSkillsByRepository,
  publishRepositorySkillArchive,
  syncRepository
} from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { PageHeader } from "../components/PageHeader";
import { useColorMode } from "../contexts/ColorModeContext";
import {
  clearSkillDraftSession,
  readInlineSkillDraftArchive,
  readSkillDraftSession
} from "../skillDraft";
import type {
  RepositoryDefinition,
  RepositorySkillDetail,
  SkillArchiveEntry,
  SkillTarget,
  SkillValidationResult
} from "../types";
import { getErrorMessage } from "../utils";

const { Paragraph, Text } = Typography;

interface PublishFormValues {
  repositoryId?: string;
  targetIds?: string[];
  version: string;
  releaseNotes?: string;
}

interface ParsedSkillArchive {
  file: File;
  validation: SkillValidationResult;
  files: SkillArchiveEntry[];
  textFiles: Record<string, string>;
}

interface SkillArchiveDiff {
  metadataChanges: Array<{ field: string; before?: string; after?: string }>;
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  entryOriginal: string;
  entryModified: string;
}

type VersionSuggestion =
  | { status: "IDLE" }
  | { status: "LOADING" }
  | { status: "NOT_FOUND" }
  | { status: "READY"; currentVersion: string; suggestedVersion: string; autoFilled: boolean }
  | { status: "MANUAL"; currentVersion: string }
  | { status: "ERROR"; message: string };

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function suggestNextVersion(value?: string): string {
  if (!value) {
    return "0.1.0";
  }
  const parts = value.split(".");
  const last = Number(parts[parts.length - 1]);
  if (Number.isNaN(last)) {
    return value;
  }
  const next = [...parts];
  next[next.length - 1] = String(last + 1);
  return next.join(".");
}

function toTree(entries: SkillArchiveEntry[]): DataNode[] {
  type NodeMap = Map<string, DataNode & { children: DataNode[] }>;
  const nodeMap: NodeMap = new Map();
  const roots: Array<DataNode & { children: DataNode[] }> = [];

  const ensureNode = (path: string, directory: boolean) => {
    if (nodeMap.has(path)) {
      return nodeMap.get(path)!;
    }
    const name = path.split("/").filter(Boolean).pop() ?? path;
    const node: DataNode & { children: DataNode[] } = {
      key: path,
      title: name,
      isLeaf: !directory,
      children: []
    };
    nodeMap.set(path, node);
    const parentPath = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
    if (!parentPath) {
      roots.push(node);
    } else {
      const parent = ensureNode(parentPath, true);
      if (!parent.children.some((child) => child.key === path)) {
        parent.children.push(node);
      }
    }
    return node;
  };

  [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((entry) => {
      ensureNode(entry.path, entry.directory);
    });

  return roots;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const normalized = new Uint8Array(bytes.byteLength);
  normalized.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", normalized);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function computePublishDigest(parsed: ParsedSkillArchive, version: string): Promise<string> {
  const zip = await JSZip.loadAsync(parsed.file);
  const files = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .sort((left, right) => left.name.localeCompare(right.name));
  const chunks: number[] = [];
  for (const file of files) {
    const relative = file.name.split("/").slice(1).join("/") || file.name;
    if (!relative) {
      continue;
    }
    const pathBytes = new TextEncoder().encode(relative);
    chunks.push(...pathBytes, 0);
    let contentBytes: Uint8Array;
    if (relative === "skill.json") {
      const manifest = {
        schemaVersion: 1,
        skillId: parsed.validation.skillId,
        displayName: parsed.validation.displayName,
        version,
        description: parsed.validation.description,
        owner: parsed.validation.owner,
        tags: parsed.validation.tags,
        riskLevel: parsed.validation.riskLevel,
        entrypointPath: parsed.validation.entrypointPath
      };
      contentBytes = new TextEncoder().encode(JSON.stringify(manifest));
    } else {
      contentBytes = new Uint8Array(await file.async("arraybuffer"));
    }
    chunks.push(...contentBytes, 0);
  }
  return sha256Hex(new Uint8Array(chunks));
}

async function parseSkillArchive(file: File): Promise<ParsedSkillArchive> {
  const zip = await JSZip.loadAsync(file);
  const rootNames = new Set(
    Object.keys(zip.files)
      .map((name) => name.split("/")[0])
      .filter(Boolean)
  );
  const rootName = [...rootNames][0];
  const skillJsonPath = rootName ? `${rootName}/skill.json` : "skill.json";
  const skillMdPath = rootName ? `${rootName}/SKILL.md` : "SKILL.md";
  const skillJsonEntry = zip.file(skillJsonPath);
  const skillMdEntry = zip.file(skillMdPath);
  if (!skillJsonEntry || !skillMdEntry) {
    throw new Error("Skill 压缩包缺少 skill.json 或 SKILL.md");
  }

  const manifest = JSON.parse(await skillJsonEntry.async("text")) as Record<string, unknown>;
  const textFiles: Record<string, string> = {};
  const files: SkillArchiveEntry[] = [];

  await Promise.all(Object.values(zip.files).map(async (entry) => {
    const relative = entry.name.split("/").slice(1).join("/") || entry.name;
    if (!relative) {
      return;
    }
    if (entry.dir) {
      files.push({ path: relative, directory: true });
      return;
    }
    const buffer = await entry.async("arraybuffer");
    const bytes = new Uint8Array(buffer);
    const contentType = relative.endsWith(".md")
      ? "text/markdown"
      : relative.endsWith(".json")
        ? "application/json"
        : relative.endsWith(".txt")
          ? "text/plain"
          : relative.endsWith(".png")
            ? "image/png"
            : relative.endsWith(".jpg") || relative.endsWith(".jpeg")
              ? "image/jpeg"
              : undefined;
    files.push({
      path: relative,
      directory: false,
      size: bytes.byteLength,
      contentType
    });
    if (!contentType || contentType.startsWith("text/") || contentType === "application/json") {
      textFiles[relative] = await entry.async("text");
    }
  }));

  return {
    file,
    validation: {
      skillId: normalizeText(manifest.skillId) ?? "skill",
      displayName: normalizeText(manifest.displayName) ?? normalizeText(manifest.skillId) ?? "skill",
      version: normalizeText(manifest.version) ?? "1.0.0",
      description: normalizeText(manifest.description) ?? "",
      owner: normalizeText(manifest.owner),
      tags: normalizeStringArray(manifest.tags),
      riskLevel: normalizeText(manifest.riskLevel),
      entrypointPath: normalizeText(manifest.entrypointPath) ?? "SKILL.md",
      digest: normalizeText(manifest.digest) ?? "",
      warnings: []
    },
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    textFiles
  };
}

function renderVersionSuggestion(suggestion: VersionSuggestion) {
  if (suggestion.status === "LOADING") {
    return <Text type="secondary">正在同步目标仓库并拉取当前版本</Text>;
  }
  if (suggestion.status === "READY") {
    return (
      <Text type="secondary">
        仓库当前版本 {suggestion.currentVersion}，建议发布 {suggestion.suggestedVersion}
        {suggestion.autoFilled ? "，已自动填入。" : "；你已手动修改，未覆盖。"}
      </Text>
    );
  }
  if (suggestion.status === "MANUAL") {
    return <Text type="warning">仓库当前版本 {suggestion.currentVersion} 无法自动递增，请手动填写新版本。</Text>;
  }
  if (suggestion.status === "NOT_FOUND") {
    return <Text type="secondary">目标仓库暂无该 Skill，默认沿用文件版本。</Text>;
  }
  if (suggestion.status === "ERROR") {
    return <Text type="danger">{suggestion.message}</Text>;
  }
  return null;
}

function buildSkillArchiveDiff(base: ParsedSkillArchive | null, next: ParsedSkillArchive): SkillArchiveDiff | null {
  if (!base) {
    return null;
  }
  const metadataChanges: SkillArchiveDiff["metadataChanges"] = [];
  const pairs: Array<[string, string | undefined, string | undefined]> = [
    ["displayName", base.validation.displayName, next.validation.displayName],
    ["description", base.validation.description, next.validation.description],
    ["owner", base.validation.owner, next.validation.owner],
    ["riskLevel", base.validation.riskLevel, next.validation.riskLevel],
    ["entrypointPath", base.validation.entrypointPath, next.validation.entrypointPath],
    ["tags", base.validation.tags.join(", "), next.validation.tags.join(", ")]
  ];
  pairs.forEach(([field, before, after]) => {
    if ((before ?? "") !== (after ?? "")) {
      metadataChanges.push({ field, before, after });
    }
  });

  const baseFiles = new Map(base.files.filter((item) => !item.directory).map((item) => [item.path, item]));
  const nextFiles = new Map(next.files.filter((item) => !item.directory).map((item) => [item.path, item]));
  const addedFiles = [...nextFiles.keys()].filter((item) => !baseFiles.has(item)).sort();
  const removedFiles = [...baseFiles.keys()].filter((item) => !nextFiles.has(item)).sort();
  const modifiedFiles = [...nextFiles.keys()].filter((path) => {
    const current = nextFiles.get(path);
    const previous = baseFiles.get(path);
    if (!current || !previous) {
      return false;
    }
    const beforeText = base.textFiles[path];
    const afterText = next.textFiles[path];
    if (beforeText !== undefined || afterText !== undefined) {
      return (beforeText ?? "") !== (afterText ?? "");
    }
    return (previous.size ?? 0) !== (current.size ?? 0);
  }).sort();

  return {
    metadataChanges,
    addedFiles,
    removedFiles,
    modifiedFiles,
    entryOriginal: base.textFiles[base.validation.entrypointPath] ?? "",
    entryModified: next.textFiles[next.validation.entrypointPath] ?? ""
  };
}

export function SkillDraftPage() {
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [form] = Form.useForm<PublishFormValues>();
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [targets, setTargets] = useState<SkillTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [parsedArchive, setParsedArchive] = useState<ParsedSkillArchive | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>();
  const [repositorySkillDetail, setRepositorySkillDetail] = useState<RepositorySkillDetail | null>(null);
  const [repositoryArchive, setRepositoryArchive] = useState<ParsedSkillArchive | null>(null);
  const [repositorySyncing, setRepositorySyncing] = useState(false);
  const [versionSuggestion, setVersionSuggestion] = useState<VersionSuggestion>({ status: "IDLE" });
  const [contentUnchanged, setContentUnchanged] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const versionManuallyEditedRef = useRef(false);

  const watchedRepositoryId = Form.useWatch("repositoryId", form);
  const watchedVersion = Form.useWatch("version", form);
  const watchedReleaseNotes = Form.useWatch("releaseNotes", form);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [repositoryData, targetData] = await Promise.all([listRepositories(), listSkillTargets()]);
        setRepositories(repositoryData.filter((item) => item.enabled));
        setTargets(targetData.filter((item) => item.enabled));
        form.setFieldsValue({
          repositoryId: repositoryData.find((item) => item.enabled && item.usage !== "DEVELOPMENT")?.id ?? repositoryData[0]?.id,
          targetIds: targetData.filter((item) => item.enabled).map((item) => item.id)
        });
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载 Skill 草稿元数据失败"));
      } finally {
        setLoading(false);
      }
    })();
  }, [form, messageApi]);

  useEffect(() => {
    void (async () => {
      setArchiveLoading(true);
      try {
        const session = readSkillDraftSession();
        if (!session) {
          setParsedArchive(null);
          return;
        }
        let archive: Blob;
        let archiveName = "skill.zip";
        if (session.source === "INLINE_ARCHIVE") {
          const file = readInlineSkillDraftArchive(session);
          if (!file) {
            throw new Error("草稿归档损坏");
          }
          archive = file;
          archiveName = file.name;
        } else if (session.source === "REPOSITORY_REF") {
          archive = await downloadRepositorySkillArchive(session.repositoryId, session.skillId);
          archiveName = `${session.skillId}.zip`;
        } else {
          archive = await downloadInstalledSkillArchive(session.skillId);
          archiveName = `${session.skillId}.zip`;
        }
        const file = archive instanceof File ? archive : new File([archive], archiveName, { type: "application/zip" });
        const parsed = await parseSkillArchive(file);
        setParsedArchive(parsed);
        setSelectedFile(parsed.validation.entrypointPath);
        form.setFieldsValue({ version: parsed.validation.version, releaseNotes: "" });
        versionManuallyEditedRef.current = false;
        clearSkillDraftSession();
      } catch (error) {
        setParsedArchive(null);
        messageApi.error(getErrorMessage(error, "加载 Skill 草稿失败"));
      } finally {
        setArchiveLoading(false);
      }
    })();
  }, [form, messageApi]);

  useEffect(() => {
    if (!watchedRepositoryId || !parsedArchive) {
      setRepositorySkillDetail(null);
      setRepositoryArchive(null);
      setVersionSuggestion({ status: "IDLE" });
      setContentUnchanged(false);
      return;
    }
    let cancelled = false;
    setRepositorySyncing(true);
    setVersionSuggestion({ status: "LOADING" });
    void (async () => {
      try {
        await syncRepository(watchedRepositoryId);
        const items = await listSkillsByRepository(watchedRepositoryId);
        if (cancelled) {
          return;
        }
        const descriptor = items.find((item) => item.skillId === parsedArchive.validation.skillId);
        if (!descriptor) {
          setRepositorySkillDetail(null);
          setRepositoryArchive(null);
          setContentUnchanged(false);
          if (!versionManuallyEditedRef.current) {
            form.setFieldsValue({ version: parsedArchive.validation.version });
          }
          setVersionSuggestion({ status: "NOT_FOUND" });
          return;
        }
        const detail = await getRepositorySkill(watchedRepositoryId, parsedArchive.validation.skillId);
        const archive = await downloadRepositorySkillArchive(watchedRepositoryId, parsedArchive.validation.skillId);
        if (cancelled) {
          return;
        }
        setRepositorySkillDetail(detail);
        setRepositoryArchive(await parseSkillArchive(new File([archive], `${parsedArchive.validation.skillId}.zip`, { type: "application/zip" })));
        const nextVersion = suggestNextVersion(descriptor.version);
        if (nextVersion === descriptor.version) {
          setVersionSuggestion({ status: "MANUAL", currentVersion: descriptor.version });
        } else {
          const autoFilled = !versionManuallyEditedRef.current;
          if (autoFilled) {
            form.setFieldsValue({ version: nextVersion });
          }
          setVersionSuggestion({
            status: "READY",
            currentVersion: descriptor.version,
            suggestedVersion: nextVersion,
            autoFilled
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setRepositorySkillDetail(null);
        setRepositoryArchive(null);
        setContentUnchanged(false);
        setVersionSuggestion({
          status: "ERROR",
          message: getErrorMessage(error, "拉取仓库版本失败")
        });
      } finally {
        if (!cancelled) {
          setRepositorySyncing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form, parsedArchive, watchedRepositoryId]);

  useEffect(() => {
    if (!parsedArchive || !watchedVersion?.trim()) {
      setContentUnchanged(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const digest = await computePublishDigest(parsedArchive, watchedVersion.trim());
        if (!cancelled) {
          const currentDigest = repositorySkillDetail?.descriptor.digest;
          setContentUnchanged(Boolean(currentDigest) && currentDigest === digest);
        }
      } catch {
        if (!cancelled) {
          setContentUnchanged(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parsedArchive, repositorySkillDetail?.descriptor.digest, watchedVersion]);

  const repositoryOptions = useMemo(
    () => repositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [repositories]
  );

  const targetOptions = useMemo(
    () => targets.map((item) => ({ value: item.id, label: `${item.name} (${item.type})` })),
    [targets]
  );

  const treeData = useMemo(() => toTree(parsedArchive?.files ?? []), [parsedArchive?.files]);
  const selectedText = parsedArchive && selectedFile ? parsedArchive.textFiles[selectedFile] : "";
  const repositoryDiff = useMemo(
    () => (parsedArchive ? buildSkillArchiveDiff(repositoryArchive, parsedArchive) : null),
    [parsedArchive, repositoryArchive]
  );

  const handlePublish = async () => {
    if (!parsedArchive) {
      messageApi.warning("当前没有可发布的 Skill 草稿");
      return;
    }
    const values = await form.validateFields();
    if (!values.repositoryId) {
      messageApi.warning("请选择仓库");
      return;
    }
    if (contentUnchanged) {
      messageApi.warning("仓库当前内容与本次发布一致，无需重复发布");
      return;
    }
    setPublishing(true);
    try {
      await publishRepositorySkillArchive(values.repositoryId, {
        version: values.version.trim(),
        releaseNotes: values.releaseNotes?.trim() || undefined,
        archive: parsedArchive.file
      });
      messageApi.success("Skill 已发布到仓库");
      navigate("/discover");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "发布 Skill 失败"));
    } finally {
      setPublishing(false);
    }
  };

  const handleInstall = async () => {
    if (!parsedArchive) {
      messageApi.warning("当前没有可安装的 Skill 草稿");
      return;
    }
    const values = await form.validateFields();
    if (!values.targetIds?.length) {
      messageApi.warning("请选择至少一个 SkillTarget");
      return;
    }
    setInstalling(true);
    try {
      await installSkillDraftArchive({
        targetIds: values.targetIds,
        repositoryId: values.repositoryId,
        archive: parsedArchive.file
      });
      messageApi.success("Skill 已安装");
      navigate("/skills");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装 Skill 失败"));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="Skill 草稿"
          onBack={() => navigate(-1)}
          backLabel="返回"
          meta="Skill 草稿页只做完整 Skill 包的只读评审。发布版本与 release notes 可以调整，Skill 内容本身不可修改。"
          actions={parsedArchive ? (
            <>
              <Button icon={<CheckCircleOutlined />} loading={installing} onClick={() => void handleInstall()}>
                安装到目标
              </Button>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={publishing}
                disabled={contentUnchanged || repositorySyncing}
                onClick={() => void handlePublish()}
              >
                发布到仓库
              </Button>
            </>
          ) : undefined}
        />

        {loading || archiveLoading ? (
          <Card><div className="page-loading"><Spin size="large" /></div></Card>
        ) : !parsedArchive ? (
          <Card>
            <Empty description="当前没有可用的 Skill 草稿来源">
              <Paragraph type="secondary">请从脚本命令页、插件详情、仓库 Skill 详情或已安装 Skill 详情进入。</Paragraph>
            </Empty>
          </Card>
        ) : (
          <>
            <Card>
              <Form
                form={form}
                layout="vertical"
                onValuesChange={(changedValues) => {
                  if (Object.prototype.hasOwnProperty.call(changedValues, "version")) {
                    versionManuallyEditedRef.current = true;
                  }
                }}
              >
                <Space size={16} style={{ width: "100%" }} direction="vertical">
                  <Space style={{ width: "100%" }} wrap>
                    <Form.Item label="仓库" name="repositoryId" style={{ minWidth: 300 }}>
                      <Select allowClear options={repositoryOptions} placeholder="选择发布仓库" />
                    </Form.Item>
                    <Form.Item label="安装目标" name="targetIds" style={{ minWidth: 300 }}>
                      <Select mode="multiple" allowClear options={targetOptions} placeholder="选择 SkillTarget" />
                    </Form.Item>
                  </Space>
                  <Space style={{ width: "100%" }} wrap align="start">
                    <Form.Item
                      label="发布版本"
                      name="version"
                      rules={[{ required: true, message: "请输入发布版本" }]}
                      extra={renderVersionSuggestion(versionSuggestion)}
                      style={{ minWidth: 220, flex: "1 1 220px" }}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item label="发布说明" name="releaseNotes" style={{ minWidth: 360, flex: "2 1 360px" }}>
                      <Input.TextArea rows={3} placeholder="本次发布的变更说明，支持 Markdown 语法" />
                    </Form.Item>
                  </Space>
                  {contentUnchanged ? (
                    <Alert type="info" showIcon message="仓库当前内容与本次 Skill 包完全一致，发布按钮已禁用。" />
                  ) : null}
                </Space>
              </Form>
            </Card>

            <Card title="Skill 元信息">
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="skillId">{parsedArchive.validation.skillId}</Descriptions.Item>
                <Descriptions.Item label="文件版本">{parsedArchive.validation.version}</Descriptions.Item>
                <Descriptions.Item label="显示名称">{parsedArchive.validation.displayName}</Descriptions.Item>
                <Descriptions.Item label="维护人">{parsedArchive.validation.owner || "-"}</Descriptions.Item>
                <Descriptions.Item label="入口文件">{parsedArchive.validation.entrypointPath}</Descriptions.Item>
                <Descriptions.Item label="风险等级">{parsedArchive.validation.riskLevel || "-"}</Descriptions.Item>
                <Descriptions.Item label="标签" span={2}>
                  <Space wrap>{parsedArchive.validation.tags.length > 0 ? parsedArchive.validation.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : "-"}</Space>
                </Descriptions.Item>
                <Descriptions.Item label="描述" span={2}>{parsedArchive.validation.description || "-"}</Descriptions.Item>
              </Descriptions>
            </Card>

            {repositorySkillDetail ? (
              <Card title="仓库对照">
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="当前仓库版本">{repositorySkillDetail.descriptor.version}</Descriptions.Item>
                  <Descriptions.Item label="仓库显示名称">{repositorySkillDetail.descriptor.displayName}</Descriptions.Item>
                  <Descriptions.Item label="仓库描述" span={2}>{repositorySkillDetail.descriptor.description || "-"}</Descriptions.Item>
                </Descriptions>
              </Card>
            ) : null}

            {repositoryDiff ? (
              <Card title="变更 Diff">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Alert
                    type={repositoryDiff.metadataChanges.length > 0 || repositoryDiff.addedFiles.length > 0 || repositoryDiff.removedFiles.length > 0 || repositoryDiff.modifiedFiles.length > 0 ? "info" : "success"}
                    showIcon
                    message={repositoryDiff.metadataChanges.length > 0 || repositoryDiff.addedFiles.length > 0 || repositoryDiff.removedFiles.length > 0 || repositoryDiff.modifiedFiles.length > 0 ? "检测到 Skill 包差异" : "仓库内容与当前 Skill 包一致"}
                    description={
                      <Space direction="vertical" size={4}>
                        <Text>元信息变更：{repositoryDiff.metadataChanges.length}</Text>
                        <Text>新增文件：{repositoryDiff.addedFiles.length}</Text>
                        <Text>删除文件：{repositoryDiff.removedFiles.length}</Text>
                        <Text>修改文件：{repositoryDiff.modifiedFiles.length}</Text>
                      </Space>
                    }
                  />

                  {repositoryDiff.metadataChanges.length > 0 ? (
                    <Card type="inner" title="元信息变更">
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {repositoryDiff.metadataChanges.map((item) => (
                          <Text key={item.field}>
                            <Text code>{item.field}</Text>: {item.before || "-"} -&gt; {item.after || "-"}
                          </Text>
                        ))}
                      </Space>
                    </Card>
                  ) : null}

                  {repositoryDiff.addedFiles.length > 0 || repositoryDiff.removedFiles.length > 0 || repositoryDiff.modifiedFiles.length > 0 ? (
                    <Card type="inner" title="文件清单变更">
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {repositoryDiff.addedFiles.map((item) => <Text key={`add:${item}`}>新增: <Text code>{item}</Text></Text>)}
                        {repositoryDiff.removedFiles.map((item) => <Text key={`remove:${item}`}>删除: <Text code>{item}</Text></Text>)}
                        {repositoryDiff.modifiedFiles.map((item) => <Text key={`modify:${item}`}>修改: <Text code>{item}</Text></Text>)}
                      </Space>
                    </Card>
                  ) : null}

                  <Card type="inner" title={`入口文件 Diff (${parsedArchive.validation.entrypointPath})`}>
                    <div className="script-diff-source-viewer">
                      <DiffEditor
                        height="clamp(360px, 62vh, 720px)"
                        language="markdown"
                        original={repositoryDiff.entryOriginal}
                        modified={repositoryDiff.entryModified}
                        theme={editorTheme}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          fontSize: 13,
                          automaticLayout: true,
                          scrollBeyondLastLine: false,
                          lineNumbersMinChars: 3,
                          renderSideBySide: true
                        }}
                      />
                    </div>
                  </Card>
                </Space>
              </Card>
            ) : null}

            <Card title="文件预览">
              <div className="script-import-diff-layout">
                <div className="script-import-diff-sidebar">
                  <Tree
                    treeData={treeData}
                    selectedKeys={selectedFile ? [selectedFile] : []}
                    onSelect={(keys) => {
                      const next = typeof keys[0] === "string" ? keys[0] : undefined;
                      if (next && parsedArchive.files.some((item) => item.path === next && !item.directory)) {
                        setSelectedFile(next);
                      }
                    }}
                  />
                </div>
                <div className="script-import-diff-main">
                  {selectedFile ? (
                    selectedText !== undefined ? (
                      <Card
                        type="inner"
                        title={<Space><FileTextOutlined /><span>{selectedFile}</span></Space>}
                      >
                        <CodeEditor
                          height="560px"
                          language={selectedFile.endsWith(".json") ? "json" : "markdown"}
                          theme={editorTheme}
                          value={selectedText ?? ""}
                          onChange={() => {}}
                          readOnly
                        />
                      </Card>
                    ) : (
                      <Card type="inner" title={<Space><FolderOpenOutlined /><span>{selectedFile}</span></Space>}>
                        <Alert
                          type="info"
                          showIcon
                          message="当前文件不是可直接文本预览的类型"
                          description="二进制资产会在发布和安装时原样保留。"
                        />
                      </Card>
                    )
                  ) : (
                    <Empty description="请选择一个文件" />
                  )}
                </div>
              </div>
            </Card>
          </>
        )}
      </Space>
    </>
  );
}
