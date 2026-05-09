import { Button, Drawer, Space, Spin, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { installSkillArchive } from "../../features/skills/api";
import { downloadRepositorySkillArchive, getRepositorySkill } from "../../features/resources/api";
import { SkillTargetSelector, useSkillTargets } from "../skill/SkillTargetSelector";
import { getErrorMessage } from "../../services/utils";
import type { RepositorySkillDescriptor } from "../../shared/types";

const { Paragraph, Text } = Typography;

interface RepositorySkillInstallDrawerProps {
  open: boolean;
  descriptor: Pick<RepositorySkillDescriptor, 'repositoryId' | 'skillId' | 'displayName' | 'installed' | 'updateAvailable' | 'version' | 'trusted' | 'riskLevel'> & { description?: string | null; owner?: string | null } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RepositorySkillInstallDrawer({ open, descriptor, onClose, onSuccess }: RepositorySkillInstallDrawerProps) {
  const { targets, targetIds, setTargetIds, loading: targetsLoading, loadTargets, ensureTargets, contextHolder } = useSkillTargets();
  const [archive, setArchive] = useState<File | null>(null);
  const [skillName, setSkillName] = useState("");
  const [installing, setInstalling] = useState(false);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [messageApi, messageContextHolder] = message.useMessage();

  useEffect(() => {
    if (!open || !descriptor) {
      setArchive(null);
      setSkillName("");
      return;
    }
    void (async () => {
      setLoadingArchive(true);
      try {
        const [, detail, archiveData] = await Promise.all([
          loadTargets(),
          getRepositorySkill(descriptor.repositoryId, descriptor.skillId),
          downloadRepositorySkillArchive(descriptor.repositoryId, descriptor.skillId)
        ]);
        setArchive(new File([archiveData], `${descriptor.skillId}.zip`, { type: "application/zip" }));
        setSkillName(detail.descriptor.displayName || detail.descriptor.skillId);
      } catch (error) {
        setArchive(null);
        messageApi.error(getErrorMessage(error, "加载仓库 Skill 安装内容失败"));
      } finally {
        setLoadingArchive(false);
      }
    })();
  }, [open, descriptor, loadTargets, messageApi]);

  const handleInstall = async () => {
    const selectedTargetIds = ensureTargets();
    if (!selectedTargetIds || !descriptor || !archive) {
      return;
    }
    setInstalling(true);
    try {
      await installSkillArchive({
        targetIds: selectedTargetIds,
        repositoryId: descriptor.repositoryId,
        archive
      });
      messageApi.success(`Skill 已${descriptor.installed ? "更新" : "安装"}：${skillName || descriptor.skillId}`);
      onSuccess();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装仓库 Skill 失败"));
    } finally {
      setInstalling(false);
    }
  };

  const action = descriptor?.installed ? "update" : "install";

  return (
    <>
      {contextHolder}
      <Drawer
        title={action === "update" ? "更新 Skill" : "安装 Skill"}
        open={open}
        onClose={onClose}
        width={640}
        destroyOnHidden
      >
        {messageContextHolder}
        {loadingArchive ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : !archive ? (
          <Text type="secondary">未检测到仓库安装内容，请从发现页重新选择 Skill。</Text>
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <SkillTargetSelector
              targets={targets}
              targetIds={targetIds}
              onTargetIdsChange={setTargetIds}
            />
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Space direction="vertical" size={4}>
                <Text strong>{action === "update" ? "从仓库更新 Skill" : "从仓库安装 Skill"}</Text>
                <Paragraph type="secondary">
                  当前已载入仓库 Skill 归档，安装会同步更新受管副本和所选目标目录。
                </Paragraph>
              </Space>
              <Space wrap size={[8, 8]}>
                <Tag color="blue">{skillName || descriptor?.skillId}</Tag>
                <Tag>{descriptor?.repositoryId}</Tag>
              </Space>
              <Button type="primary" loading={installing} onClick={() => void handleInstall()}>
                {action === "update" ? "更新所选目标" : "安装到所选目标"}
              </Button>
            </Space>
          </Space>
        )}
      </Drawer>
    </>
  );
}
