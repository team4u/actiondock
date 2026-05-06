import { Alert, Empty, Select, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { message } from "antd";
import { listSkillTargets } from "../features/skills/api";
import type { SkillTarget } from "../types";
import { getErrorMessage } from "../utils";

const { Text } = Typography;

export function useSkillTargets() {
  const [targets, setTargets] = useState<SkillTarget[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await listSkillTargets();
        const available = data.filter((t) => t.enabled && t.writable);
        setTargets(available);
        setTargetIds(available.map((t) => t.id));
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载 SkillTarget 失败"));
      } finally {
        setLoading(false);
      }
    })();
  }, [messageApi]);

  const ensureTargets = (): string[] | null => {
    if (targetIds.length === 0) {
      messageApi.warning("请选择至少一个安装目标");
      return null;
    }
    return targetIds;
  };

  return { targets, targetIds, setTargetIds, loading, ensureTargets, contextHolder };
}

interface SkillTargetSelectorProps {
  targets: SkillTarget[];
  targetIds: string[];
  onTargetIdsChange: (ids: string[]) => void;
}

export function SkillTargetSelector({ targets, targetIds, onTargetIdsChange }: SkillTargetSelectorProps) {
  const targetOptions = useMemo(
    () => targets.map((t) => ({ value: t.id, label: `${t.name} (${t.type})` })),
    [targets]
  );

  if (targets.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可安装的目标，请先创建并启用可写的 SkillTarget" />;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
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
          onChange={onTargetIdsChange}
          maxTagCount="responsive"
          style={{ width: "100%", maxWidth: 420 }}
        />
      </Space>
    </Space>
  );
}
