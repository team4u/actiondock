import { Button, Card, Space, Spin, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { installSkillArchive } from "../features/skills/api";
import { downloadRepositorySkillArchive, getRepositorySkill } from "../features/resources/api";
import { PageHeader } from "../components/PageHeader";
import { SkillTargetSelector, useSkillTargets } from "../components/SkillTargetSelector";
import { clearSkillInstallSession, readSkillInstallSession } from "../skillInstallSession";
import { getErrorMessage } from "../utils";

const { Paragraph, Text } = Typography;

export function RepositorySkillInstallPage() {
  const navigate = useNavigate();
  const { targets, targetIds, setTargetIds, loading: targetsLoading, ensureTargets, contextHolder: targetContextHolder } = useSkillTargets();
  const [repositorySession, setRepositorySession] = useState<ReturnType<typeof readSkillInstallSession>>(null);
  const [repositoryArchive, setRepositoryArchive] = useState<File | null>(null);
  const [repositorySkillName, setRepositorySkillName] = useState("");
  const [installing, setInstalling] = useState(false);
  const [messageApi, messageContextHolder] = message.useMessage();

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

  const handleInstall = async () => {
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
      navigate("/discover");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "安装仓库 Skill 失败"));
    } finally {
      setInstalling(false);
    }
  };

  const sessionLoading = targetsLoading && targets.length === 0;

  return (
    <>
      {targetContextHolder}
      {messageContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title={repositorySession?.action === "update" ? "更新 Skill" : "安装 Skill"}
          onBack={() => {
            clearSkillInstallSession();
            navigate("/discover");
          }}
          backLabel="返回发现"
          meta="从仓库安装 Skill 到所选目标目录。"
        />
        <Card loading={sessionLoading}>
          {targets.length === 0 ? (
            <Spin />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <SkillTargetSelector
                targets={targets}
                targetIds={targetIds}
                onTargetIdsChange={setTargetIds}
              />
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
                    <Button type="primary" loading={installing} onClick={() => void handleInstall()}>
                      {repositorySession.action === "update" ? "更新所选目标" : "安装到所选目标"}
                    </Button>
                  </Space>
                </section>
              ) : (
                <Text type="secondary">未检测到仓库安装会话，请从发现页重新选择 Skill。</Text>
              )}
            </Space>
          )}
        </Card>
      </Space>
    </>
  );
}
