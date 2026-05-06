import {
  CheckCircleOutlined,
  FolderOpenOutlined,
  GithubOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import JSZip from "jszip";
import { useMemo, useRef, useState } from "react";
import {
  importSkill,
  installSkillDirectory,
  scanGithubSkillCollection,
  validateSkillArchive,
  installGithubSkillCollection
} from "../features/skills/api";
import { SkillTargetSelector, useSkillTargets } from "./SkillTargetSelector";
import type { GithubSkillInstallResponse, GithubSkillScanItem, GithubSkillScanResponse } from "../types";
import { getErrorMessage } from "../utils";

const { Paragraph, Text } = Typography;

interface SkillInstallDrawerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function SkillInstallDrawer({ open, onClose, onSuccess }: SkillInstallDrawerProps) {
  const { targets, targetIds, setTargetIds, loading, ensureTargets, contextHolder } = useSkillTargets();
  const [directory, setDirectory] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScan, setGithubScan] = useState<GithubSkillScanResponse | null>(null);
  const [selectedGithubSkillPaths, setSelectedGithubSkillPaths] = useState<string[]>([]);
  const [githubInstallResult, setGithubInstallResult] = useState<GithubSkillInstallResponse | null>(null);
  const [installing, setInstalling] = useState(false);
  const [githubScanning, setGithubScanning] = useState(false);
  const [messageApi, messageContextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputAttributes = { webkitdirectory: "", directory: "" } as Record<string, string>;

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
      onSuccess();
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
      onSuccess();
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
      onSuccess();
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
      onSuccess();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装 GitHub Skill 集合失败"));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Drawer
        title="安装 Skill"
        open={open}
        onClose={onClose}
        width={860}
        destroyOnHidden
      >
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
        {loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加载中..." />
        ) : targets.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可安装的目标，请先创建并启用可写的 SkillTarget" />
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
      </Drawer>
    </>
  );
}
