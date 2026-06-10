import {
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  SyncOutlined,
  UndoOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { disableSkill, getSkillDetail, previewSkillFile, removeSkillFromTarget, restoreSkill, updateSkillVersion } from "../../skills/api";
import { getRepositorySkill } from "../../resources/api";
import { PageHeader } from "../../../components/common/PageHeader";
import { SkillFileBrowser } from "../../../components/skill/SkillFileBrowser";
import { RepositorySkillInstallDrawer } from "../../../components/repository/RepositorySkillInstallDrawer";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { writeSkillPublishSession } from "../../../services/skillPublishSession";
import type { RepositorySkillDescriptor, SkillDeployment, SkillDetail, SkillFilePreview } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

const { Text } = Typography;

export function SkillDetailPage() {
  const navigate = useNavigate();
  const { skillId } = useParams<{ skillId: string }>();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionDraft, setVersionDraft] = useState("");
  const [repositoryDescriptor, setRepositoryDescriptor] = useState<RepositorySkillDescriptor | null>(null);
  const [repositoryUpdateOpen, setRepositoryUpdateOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadDetail = async () => {
    if (!skillId) {
      return;
    }
    setLoading(true);
    try {
      const loaded = await getSkillDetail(skillId);
      setDetail(loaded);
      if (loaded.skill.repositoryId) {
        try {
          const repositoryDetail = await getRepositorySkill(loaded.skill.repositoryId, skillId);
          setRepositoryDescriptor(repositoryDetail.descriptor);
        } catch {
          setRepositoryDescriptor(null);
        }
      } else {
        setRepositoryDescriptor(null);
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Skill 详情失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [skillId]);

  const handlePreviewFile = useCallback(async (path: string): Promise<SkillFilePreview | null> => {
    if (!skillId) {
      return null;
    }
    return previewSkillFile(skillId, path);
  }, [skillId]);

  const handleDisable = async () => {
    if (!skillId || !detail || detail.skill.enabledTargetCount === 0) {
      return;
    }
    setActing(true);
    try {
      const skill = await disableSkill(skillId);
      setDetail((current) => current ? { ...current, skill } : current);
      messageApi.success("Skill 已停用");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "停用 Skill 失败"));
    } finally {
      setActing(false);
    }
  };

  const handleRestore = async () => {
    if (!skillId || !detail || detail.skill.enabledTargetCount > 0) {
      return;
    }
    setActing(true);
    try {
      const skill = await restoreSkill(skillId);
      setDetail((current) => current ? { ...current, skill } : current);
      messageApi.success("Skill 已恢复");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "恢复 Skill 失败"));
    } finally {
      setActing(false);
    }
  };

  const handleRemoveTarget = async (targetId: string) => {
    if (!skillId) {
      return;
    }
    setActing(true);
    try {
      await removeSkillFromTarget(skillId, targetId);
      await loadDetail();
      messageApi.success(`已从目标 ${targetId} 移除`);
      if (detail && detail.skill.targets.length === 1) {
        navigate("/skills");
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, "移除目标失败"));
    } finally {
      setActing(false);
    }
  };

  const handlePublish = async () => {
    if (!skillId || !detail) {
      return;
    }
    writeSkillPublishSession({
      source: "INSTALLED_SKILL_REF",
      skillId
    });
    navigate("/skills/publish");
  };

  const handleRepositoryUpdate = () => {
    if (!skillId || !detail?.skill.repositoryId) {
      return;
    }
    setRepositoryUpdateOpen(true);
  };

  const openVersionModal = () => {
    setVersionDraft(detail?.skill.version ?? "");
    setVersionModalOpen(true);
  };

  const handleUpdateVersion = async () => {
    if (!skillId) {
      return;
    }
    const nextVersion = versionDraft.trim();
    if (!nextVersion) {
      messageApi.warning("请输入版本号");
      return;
    }
    setActing(true);
    try {
      const skill = await updateSkillVersion(skillId, nextVersion);
      setDetail((current) => current ? { ...current, skill } : current);
      setVersionModalOpen(false);
      messageApi.success("Skill 版本已更新");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "更新 Skill 版本失败"));
    } finally {
      setActing(false);
    }
  };

  const targetColumns: ColumnsType<SkillDeployment> = [
    { title: "目标", dataIndex: "targetId", key: "targetId" },
    {
      title: "目标目录",
      dataIndex: "targetPath",
      key: "targetPath",
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "安装路径",
      dataIndex: "installedPath",
      key: "installedPath",
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "状态",
      key: "enabled",
      render: (_value, record) => (record.enabled ? <Tag color="processing">启用</Tag> : <Tag>停用</Tag>)
    },
    {
      title: "更新时间",
      key: "updatedAt",
      width: 180,
      render: (_value, record) => formatDateTime(record.updatedAt)
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_value, record) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          loading={acting}
          onClick={() => void handleRemoveTarget(record.targetId)}
        >
          移除
        </Button>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title={detail?.skill.displayName || detail?.skill.skillId || "Skill 详情"}
          onBack={() => navigate("/skills")}
          backLabel="返回管理"
          meta={detail?.skill.description || "查看唯一受管副本、文件预览与多目标部署。"}
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadDetail()} loading={loading}>
                刷新
              </Button>
              <Button icon={<RocketOutlined />} onClick={() => void handlePublish()}>
                发布到仓库
              </Button>
              {detail?.skill.repositoryId ? (
                <Button
                  icon={<SyncOutlined />}
                  type={repositoryDescriptor?.updateAvailable ? "primary" : "default"}
                  ghost={Boolean(repositoryDescriptor?.updateAvailable)}
                  disabled={!repositoryDescriptor?.updateAvailable}
                  onClick={handleRepositoryUpdate}
                >
                  {repositoryDescriptor?.updateAvailable ? "从仓库更新" : "已是最新"}
                </Button>
              ) : null}
              <Button icon={<EditOutlined />} onClick={openVersionModal} disabled={!detail}>
                编辑版本
              </Button>
              {detail?.skill.enabledTargetCount ? (
                <Button icon={<StopOutlined />} loading={acting} onClick={() => void handleDisable()}>
                  停用
                </Button>
              ) : (
                <Button icon={<UndoOutlined />} loading={acting} onClick={() => void handleRestore()}>
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
                <Descriptions.Item label="skillId"><Text code>{detail.skill.skillId}</Text></Descriptions.Item>
                <Descriptions.Item label="版本">{detail.skill.version}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Space wrap size={[4, 4]}>
                    {detail.skill.enabledTargetCount > 0 ? <Tag color="processing">启用 {detail.skill.enabledTargetCount}</Tag> : <Tag>全部停用</Tag>}
                    {detail.skill.disabledTargetCount > 0 ? <Tag>停用 {detail.skill.disabledTargetCount}</Tag> : null}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="来源">{detail.skill.repositoryId || "本地导入"}</Descriptions.Item>
                <Descriptions.Item label="部署目标">{detail.skill.targets.length}</Descriptions.Item>
                <Descriptions.Item label="受管副本"><Text code>{detail.managedPath}</Text></Descriptions.Item>
                <Descriptions.Item label="摘要"><Text code>{detail.skill.digest}</Text></Descriptions.Item>
                <Descriptions.Item label="更新时间">{formatDateTime(detail.skill.updatedAt)}</Descriptions.Item>
              </Descriptions>

              <Table<SkillDeployment>
                rowKey="targetId"
                title={() => "目标部署"}
                columns={targetColumns}
                dataSource={detail.skill.targets}
                pagination={false}
                scroll={{ x: 980 }}
              />

              <SkillFileBrowser
                files={detail.files}
                onPreviewFile={handlePreviewFile}
                editorTheme={editorTheme}
                loading={loading}
              />
            </Space>
          )}
        </Card>
        <Modal
          title="编辑本地版本"
          open={versionModalOpen}
          onCancel={() => setVersionModalOpen(false)}
          onOk={() => void handleUpdateVersion()}
          confirmLoading={acting}
          okText="保存"
          cancelText="取消"
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text type="secondary">版本会保存为 ActionDock 本地受管元数据；发布时将读取这个本地版本。</Text>
            <Input value={versionDraft} onChange={(event) => setVersionDraft(event.target.value)} placeholder="例如 1.2.0" />
          </Space>
        </Modal>

        <RepositorySkillInstallDrawer
          open={repositoryUpdateOpen}
          descriptor={repositoryDescriptor && detail?.skill.repositoryId ? {
            repositoryId: detail.skill.repositoryId,
            skillId: detail.skill.skillId,
            displayName: detail.skill.displayName || detail.skill.skillId,
            installed: true,
            updateAvailable: repositoryDescriptor.updateAvailable,
            version: repositoryDescriptor.version,
            description: null,
            owner: null,
            trusted: repositoryDescriptor.trusted,
            riskLevel: repositoryDescriptor.riskLevel
          } : null}
          onClose={() => setRepositoryUpdateOpen(false)}
          onSuccess={() => {
            setRepositoryUpdateOpen(false);
            void loadDetail();
          }}
        />
      </Space>
    </>
  );
}
