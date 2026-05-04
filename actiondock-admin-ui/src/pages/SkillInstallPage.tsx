import {
  CheckCircleOutlined,
  FolderOpenOutlined,
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
  Typography,
  message
} from "antd";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  importSkill,
  installSkillDirectory,
  listSkillTargets,
  validateSkillArchive
} from "../api";
import { PageHeader } from "../components/PageHeader";
import type { SkillTarget } from "../types";
import { getErrorMessage } from "../utils";

const { Paragraph, Text } = Typography;

export function SkillInstallPage() {
  const navigate = useNavigate();
  const [targets, setTargets] = useState<SkillTarget[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [directory, setDirectory] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
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

  const targetOptions = useMemo(
    () => targets.map((item) => ({ value: item.id, label: `${item.name} (${item.type})` })),
    [targets]
  );

  const ensureTargets = (): string[] | null => {
    if (targetIds.length === 0) {
      messageApi.warning("请选择至少一个安装目标");
      return null;
    }
    return targetIds;
  };

  const summarizeBatchResult = (
    results: PromiseSettledResult<unknown>[],
    successMessage: string,
    failurePrefix: string
  ) => {
    const fulfilled = results.filter((item) => item.status === "fulfilled").length;
    const rejected = results.filter((item) => item.status === "rejected");
    if (rejected.length === 0) {
      messageApi.success(`${successMessage}，共 ${fulfilled} 个目标`);
      navigate("/skills");
      return;
    }
    const reasons = rejected
      .map((item) => getErrorMessage(item.reason))
      .filter((item, index, array) => array.indexOf(item) === index);
    if (fulfilled > 0) {
      messageApi.warning(`${successMessage} ${fulfilled} 个目标，失败 ${rejected.length} 个：${reasons.join("；")}`);
      return;
    }
    messageApi.error(`${failurePrefix}：${reasons.join("；")}`);
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
      const results = await Promise.allSettled(selectedTargetIds.map((targetId) => importSkill(targetId, file)));
      summarizeBatchResult(results, `Skill 已安装：${validation.displayName}`, "导入 Skill 失败");
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
      const results = await Promise.allSettled(selectedTargetIds.map((targetId) => importSkill(targetId, archive)));
      messageApi.destroy("skill-folder-upload");
      summarizeBatchResult(results, `Skill 已安装：${validation.displayName}`, "从文件夹安装 Skill 失败");
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
      const results = await Promise.allSettled(selectedTargetIds.map((targetId) => installSkillDirectory(targetId, directory.trim())));
      summarizeBatchResult(results, "Skill 已安装", "从本地目录安装 Skill 失败");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "从本地目录安装 Skill 失败"));
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
          meta="先选择目标，再从 zip、文件夹或本地目录安装。"
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
