import {
  CheckCircleOutlined,
  FolderOpenOutlined,
  GithubOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
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
import {
  importSkill,
  installSkillArchive,
  installGithubSkillCollection,
  installSkillDirectory,
  listSkillTargets,
  scanGithubSkillCollection,
  validateSkillArchive
} from "../features/skills/api";
import { downloadRepositorySkillArchive, getRepositorySkill } from "../features/resources/api";
import { PageHeader } from "../components/PageHeader";
import type { GithubSkillInstallResponse, GithubSkillScanItem, GithubSkillScanResponse, SkillTarget } from "../types";
import { getErrorMessage } from "../utils";
import { clearSkillInstallSession, readSkillInstallSession } from "../skillInstallSession";

const { Paragraph, Text } = Typography;

export function SkillInstallPage() {
  const navigate = useNavigate();
  const [targets, setTargets] = useState<SkillTarget[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [directory, setDirectory] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScan, setGithubScan] = useState<GithubSkillScanResponse | null>(null);
  const [selectedGithubSkillPaths, setSelectedGithubSkillPaths] = useState<string[]>([]);
  const [githubInstallResult, setGithubInstallResult] = useState<GithubSkillInstallResponse | null>(null);
  const [repositoryArchive, setRepositoryArchive] = useState<File | null>(null);
  const [repositorySession, setRepositorySession] = useState<ReturnType<typeof readSkillInstallSession>>(null);
  const [repositorySkillName, setRepositorySkillName] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [githubScanning, setGithubScanning] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputAttributes = { webkitdirectory: "", directory: "" } as Record<string, string>;

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const targetData = await listSkillTargets();
        const available = targetData.filter((item) => item.enabled && item.writable);
        setTargets(available);
        setTargetIds(available.map((item) => item.id));
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载 SkillTarget 失败"));
      } finally {
        setLoading(false);
      }
    })();
  }, [messageApi]);

  useEffect(() => {
    void (async () => {
      const session = readSkillInstallSession();
      if (!session) {
        setRepositorySession(null);
        setRepositoryArchive(null);
        setRepositorySkillName("");
        return;
      }
      try {
        const [detail, archive] = await Promise.all([
          getRepositorySkill(session.repositoryId, session.skillId),
          downloadRepositorySkillArchive(session.repositoryId, session.skillId)
        ]);
        setRepositorySession(session);
        setRepositoryArchive(new File([archive], `${session.skillId}.zip`, { type: "application/zip" }));
        setRepositorySkillName(detail.descriptor.displayName || detail.descriptor.skillId);
      } catch (error) {
        setRepositorySession(null);
        setRepositoryArchive(null);
        setRepositorySkillName("");
        clearSkillInstallSession();
        messageApi.error(getErrorMessage(error, "加载仓库 Skill 安装内容失败"));
      }
    })();
  }, [messageApi]);

  const targetOptions = useMemo(
    () => targets.map((item) => ({ value: item.id, label: `${item.name} (${item.type})` })),
    [targets]
  );

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

  const ensureTargets = (): string[] | null => {
    if (targetIds.length === 0) {
      messageApi.warning("请选择至少一个安装目标");
      return null;
    }
    return targetIds;
  };

  const handleUploadFile = async (file?: File) => {
    if (!file) {
      return;
    }
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds) {
      return;
    }
    setInstalling(true);
    try {
      const validation = await validateSkillArchive(file);
      await importSkill(selectedTargetIds, file);
      messageApi.success(`Skill 已安装：${validation.displayName}，共 ${selectedTargetIds.length} 个目标`);
      navigate("/skills");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "导入 Skill 失败"));
    } finally {
      setInstalling(false);
    }
  };

  const handleUploadFolder = async (files?: FileList | File[]) => {
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds) {
      return;
    }
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
      content: `正在打包并上传文件夹，共 ${selectedFiles.length} 个文件`,
      duration: 0
    });
    try {
      const zip = new JSZip();
      for (const file of selectedFiles) {
        zip.file(file.webkitRelativePath || file.name, file);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const archive = new File([blob], archiveName, { type: "application/zip" });
      const validation = await validateSkillArchive(archive);
      messageApi.destroy("skill-folder-upload");
      await importSkill(selectedTargetIds, archive);
      messageApi.success(`Skill 已安装：${validation.displayName}，共 ${selectedTargetIds.length} 个目标`);
      navigate("/skills");
    } catch (error) {
      messageApi.destroy("skill-folder-upload");
      messageApi.error(getErrorMessage(error, "从文件夹安装 Skill 失败"));
    } finally {
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

  const handleInstallRepositoryArchive = async () => {
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds || !repositorySession || !repositoryArchive) {
      return;
    }
    setInstalling(true);
    try {
      await installSkillArchive({
        targetIds: selectedTargetIds,
        repositoryId: repositorySession.repositoryId,
        archive: repositoryArchive
      });
      clearSkillInstallSession();
      messageApi.success(`Skill 已${repositorySession.action === "update" ? "更新" : "安装"}：${repositorySkillName || repositorySession.skillId}`);
      navigate(repositorySession.returnTo || "/skills");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装仓库 Skill 失败"));
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

  return (
    <>
      {contextHolder}
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
          meta="先选择目标，再从 GitHub、zip、文件夹或本地目录安装。"
        />

        <Card loading={loading}>
          {targets.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可安装的目标，请先创建并启用可写的 SkillTarget" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Alert
                showIcon
                type="info"
                message="只展示已启用且可写的目标目录。安装后会同步写入目标目录和 ActionDock 受管副本。"
              />
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Text strong>安装目标</Text>
                <Select
                  mode="multiple"
                  value={targetIds}
                  options={targetOptions}
                  onChange={setTargetIds}
                  maxTagCount="responsive"
                  style={{ width: "100%", maxWidth: 420 }}
                />
              </Space>
              {repositorySession && repositoryArchive ? (
                <section className="skill-install-panel skill-install-panel--wide">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Space direction="vertical" size={4}>
                      <Text strong>{repositorySession.action === "update" ? "从仓库更新 Skill" : "从仓库安装 Skill"}</Text>
                      <Paragraph type="secondary">
                        当前已载入仓库 Skill 归档，安装会同步更新受管副本和所选目标目录。
                      </Paragraph>
                    </Space>
                    <Space wrap size={[8, 8]}>
                      <Tag color="blue">{repositorySkillName || repositorySession.skillId}</Tag>
                      <Tag>{repositorySession.repositoryId}</Tag>
                    </Space>
                    <Button type="primary" loading={installing} onClick={() => void handleInstallRepositoryArchive()}>
                      {repositorySession.action === "update" ? "更新所选目标" : "安装到所选目标"}
                    </Button>
                  </Space>
                </section>
              ) : null}
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
                    <Text strong>从压缩包安装</Text>
                    <Paragraph type="secondary">适合仓库导出包或本地已有 zip。</Paragraph>
                    <Button icon={<UploadOutlined />} loading={installing} onClick={() => fileInputRef.current?.click()}>
                      选择 zip
                    </Button>
                  </Space>
                </section>
                <section className="skill-install-panel">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Text strong>从文件夹安装</Text>
                    <Paragraph type="secondary">浏览器会先打包当前文件夹，再上传安装。</Paragraph>
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
