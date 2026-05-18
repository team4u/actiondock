import {
  CheckCircleOutlined,
  ClearOutlined,
  FolderOpenOutlined,
  GithubOutlined,
  UploadOutlined
} from "@ant-design/icons";
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
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { PageHeader } from "../../../components/common/PageHeader";
import { SkillTargetSelector, useSkillTargets } from "../../../components/skill/SkillTargetSelector";
import {
  importSkill,
  installSkillDirectory,
  installGithubSkillCollection,
  validateSkillArchive,
  scanGithubSkillCollection
} from "../../skills/api";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import type { GithubSkillInstallResponse, GithubSkillScanItem, GithubSkillScanResponse } from "../../../shared/types";
import {
  buildEditableSkillArchive,
  parseSkillArchive,
  type ParsedSkillArchive
} from "../../../services/skillArchive";
import {
  clearSkillInstallSession,
  readInlineSkillInstallArchive,
  readSkillInstallSession
} from "../../../services/skillInstallSession";
import { getErrorMessage } from "../../../services/utils";

const { Paragraph, Text } = Typography;

interface DraftFormValues {
  skillId: string;
  displayName: string;
  version: string;
  description: string;
}

function getPreviewFileOptions(parsedArchive: ParsedSkillArchive | null): Array<{ label: string; value: string }> {
  if (!parsedArchive) {
    return [];
  }
  const filePaths = new Set(parsedArchive.files.filter((item) => !item.directory).map((item) => item.path));
  filePaths.add("skill.json");
  return [...filePaths].sort((left, right) => left.localeCompare(right)).map((path) => ({
    label: path,
    value: path
  }));
}

function buildGeneratedManifest(values: DraftFormValues, parsedArchive: ParsedSkillArchive): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      skillId: values.skillId,
      displayName: values.displayName,
      version: values.version,
      description: values.description,
      owner: parsedArchive.validation.owner,
      tags: parsedArchive.validation.tags,
      riskLevel: parsedArchive.validation.riskLevel,
      entrypointPath: "SKILL.md"
    },
    null,
    2
  );
}

export function SkillInstallPage() {
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const { targets, targetIds, setTargetIds, loading, loadTargets, ensureTargets, contextHolder } = useSkillTargets();
  const [form] = Form.useForm<DraftFormValues>();
  const [directory, setDirectory] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScan, setGithubScan] = useState<GithubSkillScanResponse | null>(null);
  const [selectedGithubSkillPaths, setSelectedGithubSkillPaths] = useState<string[]>([]);
  const [githubInstallResult, setGithubInstallResult] = useState<GithubSkillInstallResponse | null>(null);
  const [parsedArchive, setParsedArchive] = useState<ParsedSkillArchive | null>(null);
  const [skillMarkdown, setSkillMarkdown] = useState("");
  const [selectedPreviewPath, setSelectedPreviewPath] = useState("SKILL.md");
  const [installing, setInstalling] = useState(false);
  const [githubScanning, setGithubScanning] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [messageApi, messageContextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputAttributes = { webkitdirectory: "", directory: "" } as Record<string, string>;

  const watchedDraftValues = Form.useWatch([], form) as DraftFormValues | undefined;
  const previewFileOptions = useMemo(() => getPreviewFileOptions(parsedArchive), [parsedArchive]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void (async () => {
      setArchiveLoading(true);
      try {
        const session = readSkillInstallSession();
        if (!session) {
          setParsedArchive(null);
          return;
        }
        const archive = readInlineSkillInstallArchive(session);
        clearSkillInstallSession();
        if (!archive) {
          throw new Error("Skill 安装草稿损坏");
        }
        const parsed = await parseSkillArchive(archive);
        setParsedArchive(parsed);
        setSkillMarkdown(parsed.textFiles[parsed.validation.entrypointPath] ?? parsed.textFiles["SKILL.md"] ?? "");
        form.setFieldsValue({
          skillId: parsed.validation.skillId,
          displayName: parsed.validation.displayName,
          version: parsed.validation.version,
          description: parsed.validation.description
        });
        setSelectedPreviewPath("SKILL.md");
      } catch (error) {
        setParsedArchive(null);
        messageApi.error(getErrorMessage(error, "加载 Skill 安装草稿失败"));
      } finally {
        setArchiveLoading(false);
      }
    })();
  }, [form, messageApi]);

  const githubSkillColumns: ColumnsType<GithubSkillScanItem> = useMemo(
    () => [
      {
        title: "Skill",
        dataIndex: "displayName",
        key: "displayName",
        render: (value: string, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{value || record.skillId}</Text>
            <Text type="secondary" code>{record.path}</Text>
          </Space>
        )
      },
      {
        title: "版本",
        dataIndex: "version",
        key: "version",
        width: 120,
        render: (value?: string) => value ? <Tag color="blue">{value}</Tag> : <Text type="secondary">-</Text>
      },
      {
        title: "描述",
        dataIndex: "description",
        key: "description",
        ellipsis: true,
        render: (value?: string) => value || <Text type="secondary">无描述</Text>
      },
      {
        title: "提示",
        dataIndex: "warnings",
        key: "warnings",
        width: 160,
        render: (warnings: string[]) => warnings?.length ? <Tag color="gold">{warnings.length} 条警告</Tag> : <Tag>正常</Tag>
      }
    ],
    []
  );

  const loadDraftArchive = async (archive: File) => {
    setInstalling(true);
    try {
      const parsed = await parseSkillArchive(archive);
      setParsedArchive(parsed);
      setSkillMarkdown(parsed.textFiles[parsed.validation.entrypointPath] ?? parsed.textFiles["SKILL.md"] ?? "");
      form.setFieldsValue({
        skillId: parsed.validation.skillId,
        displayName: parsed.validation.displayName,
        version: parsed.validation.version,
        description: parsed.validation.description
      });
      setSelectedPreviewPath("SKILL.md");
      messageApi.success(`已载入 Skill 草稿：${parsed.validation.displayName}`);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "读取 Skill 归档失败"));
    } finally {
      setInstalling(false);
    }
  };

  const handleUploadFile = async (file?: File) => {
    if (!file) {
      return;
    }
    await loadDraftArchive(file);
  };

  const handleUploadFolder = async (files?: FileList | File[]) => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) {
      return;
    }
    const hasSkillMd = selectedFiles.some((file) => (file.webkitRelativePath || file.name).toLowerCase().endsWith("skill.md"));
    if (!hasSkillMd) {
      messageApi.error("选择的文件夹中未找到 SKILL.md");
      return;
    }
    const rootName = selectedFiles[0]?.webkitRelativePath?.split("/")[0] || selectedFiles[0]?.name || "skill";
    const archiveName = rootName.toLowerCase().endsWith(".zip") ? rootName : `${rootName}.zip`;

    setInstalling(true);
    messageApi.open({
      key: "skill-folder-upload",
      type: "loading",
      content: `正在打包文件夹，共 ${selectedFiles.length} 个文件`,
      duration: 0
    });
    try {
      const zip = new JSZip();
      for (const file of selectedFiles) {
        zip.file(file.webkitRelativePath || file.name, file);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const archive = new File([blob], archiveName, { type: "application/zip" });
      messageApi.destroy("skill-folder-upload");
      await loadDraftArchive(archive);
    } catch (error) {
      messageApi.destroy("skill-folder-upload");
      messageApi.error(getErrorMessage(error, "从文件夹生成 Skill 草稿失败"));
      setInstalling(false);
    }
  };

  const handleInstallDirectory = async () => {
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds) {
      return;
    }
    if (!directory.trim()) {
      messageApi.warning("请输入本地目录");
      return;
    }
    setInstalling(true);
    try {
      await installSkillDirectory(selectedTargetIds, directory.trim());
      messageApi.success(`Skill 已安装，共 ${selectedTargetIds.length} 个目标`);
      navigate("/skills");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "从本地目录安装 Skill 失败"));
    } finally {
      setInstalling(false);
    }
  };

  const handleScanGithubCollection = async () => {
    if (!githubUrl.trim()) {
      messageApi.warning("请输入 GitHub 仓库或目录链接");
      return;
    }
    setGithubScanning(true);
    setGithubScan(null);
    setSelectedGithubSkillPaths([]);
    setGithubInstallResult(null);
    try {
      const scan = await scanGithubSkillCollection(githubUrl.trim());
      setGithubScan(scan);
      setSelectedGithubSkillPaths(scan.skills.map((item) => item.path));
      messageApi.success(`已扫描到 ${scan.skills.length} 个 Skill`);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "扫描 GitHub Skill 集合失败"));
    } finally {
      setGithubScanning(false);
    }
  };

  const handleInstallGithubCollection = async () => {
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds) {
      return;
    }
    if (!githubUrl.trim()) {
      messageApi.warning("请输入 GitHub 仓库或目录链接");
      return;
    }
    if (selectedGithubSkillPaths.length === 0) {
      messageApi.warning("请选择至少一个 GitHub Skill");
      return;
    }
    setInstalling(true);
    setGithubInstallResult(null);
    try {
      const result = await installGithubSkillCollection({
        url: githubUrl.trim(),
        targetIds: selectedTargetIds,
        skillPaths: selectedGithubSkillPaths
      });
      setGithubInstallResult(result);
      const successCount = result.results.filter((item) => item.status === "SUCCESS").length;
      const failedCount = result.results.filter((item) => item.status === "FAILED").length;
      if (failedCount > 0) {
        messageApi.warning(`GitHub Skill 安装完成：成功 ${successCount}，失败 ${failedCount}`);
      } else {
        messageApi.success(`GitHub Skill 已安装：成功 ${successCount}`);
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装 GitHub Skill 集合失败"));
    } finally {
      setInstalling(false);
    }
  };

  const handleInstallDraft = async () => {
    if (!parsedArchive) {
      return;
    }
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds) {
      return;
    }
    const values = await form.validateFields();
    setInstalling(true);
    try {
      const archive = await buildEditableSkillArchive({
        base: parsedArchive,
        skillId: values.skillId.trim(),
        displayName: values.displayName.trim(),
        version: values.version.trim(),
        description: values.description.trim(),
        skillMarkdown
      });
      const validation = await validateSkillArchive(archive);
      await importSkill(selectedTargetIds, archive);
      messageApi.success(`Skill 已安装：${validation.displayName}，共 ${selectedTargetIds.length} 个目标`);
      navigate("/skills");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装 Skill 草稿失败"));
    } finally {
      setInstalling(false);
    }
  };

  const handleClearDraft = () => {
    setParsedArchive(null);
    setSkillMarkdown("");
    setSelectedPreviewPath("SKILL.md");
    form.resetFields();
  };

  const selectedPreviewContent = useMemo(() => {
    if (!parsedArchive || !watchedDraftValues) {
      return "";
    }
    if (selectedPreviewPath === "SKILL.md") {
      return skillMarkdown;
    }
    if (selectedPreviewPath === "skill.json") {
      return buildGeneratedManifest(watchedDraftValues, parsedArchive);
    }
    return parsedArchive.textFiles[selectedPreviewPath] ?? "";
  }, [parsedArchive, selectedPreviewPath, skillMarkdown, watchedDraftValues]);

  const selectedPreviewType = useMemo(() => {
    if (selectedPreviewPath === "SKILL.md") {
      return "markdown";
    }
    if (selectedPreviewPath === "skill.json" || selectedPreviewPath.endsWith(".json")) {
      return "json";
    }
    if (selectedPreviewPath.endsWith(".md")) {
      return "markdown";
    }
    if (selectedPreviewPath.endsWith(".txt")) {
      return "plaintext";
    }
    return "plaintext";
  }, [selectedPreviewPath]);

  return (
    <>
      {contextHolder}
      {messageContextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handleUploadFile(file);
        }}
      />
      <input
        {...folderInputAttributes}
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          void handleUploadFolder(files);
        }}
      />
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="安装 Skill"
          onBack={() => navigate("/skills")}
          backLabel="返回管理"
          meta={parsedArchive ? "编辑 Skill 内容与元信息后安装到所选目标。" : "先选择目标，再从 GitHub、zip、文件夹或本地目录安装。"}
          actions={parsedArchive ? (
            <>
              <Button icon={<UploadOutlined />} loading={installing} onClick={() => fileInputRef.current?.click()}>
                更换 zip
              </Button>
              <Button icon={<CheckCircleOutlined />} loading={installing} onClick={() => folderInputRef.current?.click()}>
                更换文件夹
              </Button>
              <Button icon={<ClearOutlined />} onClick={handleClearDraft}>
                清除草稿
              </Button>
              <Button type="primary" loading={installing} onClick={() => void handleInstallDraft()}>
                安装到所选目标
              </Button>
            </>
          ) : undefined}
        />

        <Card loading={loading || archiveLoading}>
          {targets.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可安装的目标，请先创建并启用可写的 SkillTarget" />
          ) : parsedArchive ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <SkillTargetSelector
                targets={targets}
                targetIds={targetIds}
                onTargetIdsChange={setTargetIds}
              />
              {parsedArchive.validation.warnings.length > 0 ? (
                <Alert
                  showIcon
                  type="warning"
                  message="当前草稿包含提示信息"
                  description={parsedArchive.validation.warnings.join("；")}
                />
              ) : null}
              <Card size="small" title="安装元信息">
                <Form form={form} layout="vertical">
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Form.Item
                      label="skillId"
                      name="skillId"
                      rules={[
                        { required: true, message: "请输入 skillId" },
                        { pattern: /^[a-z0-9-]+$/, message: "skillId 仅支持小写字母、数字和 -" }
                      ]}
                    >
                      <Input placeholder="actiondock-script-example" />
                    </Form.Item>
                    <Form.Item label="显示名称" name="displayName" rules={[{ required: true, message: "请输入显示名称" }]}>
                      <Input placeholder="Skill 名称" />
                    </Form.Item>
                    <Form.Item label="版本" name="version" rules={[{ required: true, message: "请输入版本号" }]}>
                      <Input placeholder="1.0.0" />
                    </Form.Item>
                    <Form.Item label="描述" name="description">
                      <Input.TextArea rows={3} placeholder="Skill 描述" />
                    </Form.Item>
                  </Space>
                </Form>
              </Card>
              <Card size="small" title="内容编辑">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Alert
                    showIcon
                    type="info"
                    message="本页允许修改 SKILL.md、skillId、显示名、版本和描述；其他文件保持只读并会原样打包。"
                  />
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="文件数">{parsedArchive.files.filter((item) => !item.directory).length}</Descriptions.Item>
                    <Descriptions.Item label="入口文件">SKILL.md</Descriptions.Item>
                    <Descriptions.Item label="维护人">{parsedArchive.validation.owner || "-"}</Descriptions.Item>
                    <Descriptions.Item label="风险等级">{parsedArchive.validation.riskLevel || "-"}</Descriptions.Item>
                  </Descriptions>
                  <Form.Item label="SKILL.md">
                    <CodeEditor
                      value={skillMarkdown}
                      onChange={setSkillMarkdown}
                      theme={editorTheme}
                      language="markdown"
                      height="420px"
                    />
                  </Form.Item>
                </Space>
              </Card>
              <Card size="small" title="文件预览">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Select
                    value={selectedPreviewPath}
                    options={previewFileOptions}
                    onChange={setSelectedPreviewPath}
                    style={{ width: "100%" }}
                  />
                  {selectedPreviewPath === "SKILL.md" ? (
                    <Alert showIcon type="info" message="当前正在编辑 SKILL.md；下方展示的是实时内容。" />
                  ) : null}
                  {selectedPreviewPath !== "SKILL.md" && !selectedPreviewContent && parsedArchive.textFiles[selectedPreviewPath] === undefined ? (
                    <Alert
                      showIcon
                      type="info"
                      message="当前文件不支持在线文本预览"
                      description={<Text code>{selectedPreviewPath}</Text>}
                    />
                  ) : (
                    <CodeEditor
                      value={selectedPreviewContent}
                      onChange={() => undefined}
                      theme={editorTheme}
                      language={selectedPreviewType}
                      readOnly
                      height="320px"
                    />
                  )}
                </Space>
              </Card>
            </Space>
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <SkillTargetSelector
                targets={targets}
                targetIds={targetIds}
                onTargetIdsChange={setTargetIds}
              />
              <section className="skill-install-panel skill-install-panel--wide">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Space direction="vertical" size={4}>
                    <Text strong>从 GitHub 集合安装</Text>
                    <Paragraph type="secondary">
                      支持公开 GitHub 仓库根链接，或指向集合目录的 <Text code>/tree/ref/path</Text> 链接；系统会先扫描目录下的 Skill，再按选择安装。
                    </Paragraph>
                  </Space>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      value={githubUrl}
                      placeholder="https://github.com/owner/repo 或 https://github.com/owner/repo/tree/main/skills"
                      onChange={(event) => setGithubUrl(event.target.value)}
                      onPressEnter={() => void handleScanGithubCollection()}
                    />
                    <Button icon={<GithubOutlined />} loading={githubScanning} onClick={() => void handleScanGithubCollection()}>
                      扫描
                    </Button>
                  </Space.Compact>
                  {githubScan ? (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Text type="secondary">
                        来源：<Text code>{githubScan.owner}/{githubScan.repo}#{githubScan.ref}</Text>，集合目录 <Text code>{githubScan.rootPath}</Text>
                      </Text>
                      <Table<GithubSkillScanItem>
                        rowKey="path"
                        size="small"
                        columns={githubSkillColumns}
                        dataSource={githubScan.skills}
                        pagination={false}
                        rowSelection={{
                          selectedRowKeys: selectedGithubSkillPaths,
                          onChange: (keys) => setSelectedGithubSkillPaths(keys.map(String))
                        }}
                        scroll={{ x: true }}
                      />
                      <Space wrap>
                        <Button
                          type="primary"
                          loading={installing}
                          disabled={selectedGithubSkillPaths.length === 0}
                          onClick={() => void handleInstallGithubCollection()}
                        >
                          安装选中的 {selectedGithubSkillPaths.length} 个 Skill
                        </Button>
                        <Button onClick={() => setSelectedGithubSkillPaths(githubScan.skills.map((item) => item.path))}>
                          全选
                        </Button>
                        <Button onClick={() => setSelectedGithubSkillPaths([])}>
                          清空
                        </Button>
                      </Space>
                    </Space>
                  ) : null}
                  {githubInstallResult ? (
                    <Alert
                      showIcon
                      type={githubInstallResult.results.some((item) => item.status === "FAILED") ? "warning" : "success"}
                      message="GitHub Skill 安装结果"
                      description={(
                        <Space direction="vertical" size={4}>
                          {githubInstallResult.results.map((item) => (
                            <Text key={item.path}>
                              <Tag color={item.status === "SUCCESS" ? "green" : item.status === "FAILED" ? "red" : "default"}>{item.status}</Tag>
                              <Text code>{item.path}</Text> {item.message}
                            </Text>
                          ))}
                        </Space>
                      )}
                    />
                  ) : null}
                </Space>
              </section>
              <div className="skill-install-grid">
                <section className="skill-install-panel">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Text strong>从压缩包载入草稿</Text>
                    <Paragraph type="secondary">适合仓库导出包或本地已有 zip。载入后可以先修改再安装。</Paragraph>
                    <Button icon={<UploadOutlined />} loading={installing} onClick={() => fileInputRef.current?.click()}>
                      选择 zip
                    </Button>
                  </Space>
                </section>
                <section className="skill-install-panel">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Text strong>从文件夹载入草稿</Text>
                    <Paragraph type="secondary">浏览器会先打包当前文件夹，再进入可编辑安装页。</Paragraph>
                    <Button icon={<CheckCircleOutlined />} loading={installing} onClick={() => folderInputRef.current?.click()}>
                      选择文件夹
                    </Button>
                  </Space>
                </section>
                <section className="skill-install-panel">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Text strong>从本地目录安装</Text>
                    <Paragraph type="secondary">适合服务端本机已有 Skill 目录的场景。</Paragraph>
                    <Input
                      value={directory}
                      placeholder="输入本地 Skill 目录绝对路径"
                      onChange={(event) => setDirectory(event.target.value)}
                    />
                    <Button icon={<FolderOpenOutlined />} loading={installing} onClick={() => void handleInstallDirectory()}>
                      安装目录
                    </Button>
                  </Space>
                </section>
              </div>
            </Space>
          )}
        </Card>
      </Space>
    </>
  );
}
