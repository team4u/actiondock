import {
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  UndoOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { disableSkill, getSkillDetail, previewSkillFile, restoreSkill } from "../api";
import { PageHeader } from "../components/PageHeader";
import { SkillFileBrowser } from "../components/SkillFileBrowser";
import { useColorMode } from "../contexts/ColorModeContext";
import { writeSkillDraftSession } from "../skillDraft";
import type { SkillDetail, SkillFilePreview } from "../types";
import { formatDateTime, getErrorMessage } from "../utils";

const { Text } = Typography;

export function SkillDetailPage() {
  const navigate = useNavigate();
  const { installationId } = useParams();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabling, setDisabling] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadDetail = async () => {
    if (!installationId) {
      return;
    }
    setLoading(true);
    try {
      setDetail(await getSkillDetail(installationId));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Skill 详情失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [installationId]);

  const handlePreviewFile = useCallback(async (path: string): Promise<SkillFilePreview | null> => {
    if (!installationId) {
      return null;
    }
    return previewSkillFile(installationId, path);
  }, [installationId]);

  const handleDisable = async () => {
    if (!installationId || !detail?.installation.enabled) {
      return;
    }
    setDisabling(true);
    try {
      const installation = await disableSkill(installationId);
      setDetail((current) => current ? { ...current, installation } : current);
      messageApi.success("Skill 已停用");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "停用 Skill 失败"));
    } finally {
      setDisabling(false);
    }
  };

  const handleRestore = async () => {
    if (!installationId || detail?.installation.enabled) {
      return;
    }
    setDisabling(true);
    try {
      const installation = await restoreSkill(installationId);
      setDetail((current) => current ? { ...current, installation } : current);
      messageApi.success("Skill 已恢复");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "恢复 Skill 失败"));
    } finally {
      setDisabling(false);
    }
  };

  const handlePublish = async () => {
    if (!installationId || !detail) {
      return;
    }
    writeSkillDraftSession({
      source: "INSTALLATION_REF",
      installationId
    });
    navigate("/skills/draft");
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title={detail?.installation.displayName || detail?.installation.skillId || "Skill 详情"}
          onBack={() => navigate("/skills")}
          backLabel="返回管理"
          meta={detail?.installation.description || "查看安装信息、受管副本内容与文件预览。"}
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadDetail()} loading={loading}>
                刷新
              </Button>
              <Button icon={<RocketOutlined />} onClick={() => void handlePublish()}>
                发布到仓库
              </Button>
              {detail?.installation.enabled ? (
                <Button icon={<StopOutlined />} loading={disabling} onClick={() => void handleDisable()}>
                  停用
                </Button>
              ) : (
                <Button icon={<UndoOutlined />} loading={disabling} onClick={() => void handleRestore()}>
                  恢复
                </Button>
              )}
            </>
          }
        />

        <Card loading={loading}>
          {!detail ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到 Skill 详情" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Descriptions column={{ xs: 1, md: 2, xl: 4 }} size="small">
                <Descriptions.Item label="skillId"><Text code>{detail.installation.skillId}</Text></Descriptions.Item>
                <Descriptions.Item label="版本">{detail.installation.version}</Descriptions.Item>
                <Descriptions.Item label="状态">{detail.installation.enabled ? <Tag color="processing">启用</Tag> : <Tag>停用</Tag>}</Descriptions.Item>
                <Descriptions.Item label="来源">{detail.installation.repositoryId || "本地导入"}</Descriptions.Item>
                <Descriptions.Item label="目标目录"><Text code>{detail.installation.targetPath}</Text></Descriptions.Item>
                <Descriptions.Item label="安装路径"><Text code>{detail.installation.installedPath}</Text></Descriptions.Item>
                <Descriptions.Item label="受管副本"><Text code>{detail.managedPath}</Text></Descriptions.Item>
                <Descriptions.Item label="更新时间">{formatDateTime(detail.installation.updatedAt)}</Descriptions.Item>
              </Descriptions>

              <SkillFileBrowser
                files={detail.files}
                onPreviewFile={handlePreviewFile}
                editorTheme={editorTheme}
                loading={loading}
              />
            </Space>
          )}
        </Card>
      </Space>
    </>
  );
}
