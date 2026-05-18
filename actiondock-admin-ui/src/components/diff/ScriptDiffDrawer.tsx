import { Drawer, Space, Typography } from "antd";
import { ScriptDiffPanel } from "./ScriptDiffPanel";
import type { ScriptDiffResult } from "../../services/scriptDiff";
import type { ScriptType } from "../../shared/types";

const { Text, Title } = Typography;

interface ScriptDiffDrawerProps {
  open: boolean;
  onClose: () => void;
  diff: ScriptDiffResult;
  scriptId?: string;
  title?: string;
  theme: "vs-light" | "vs-dark";
  targetType?: ScriptType;
}

export function ScriptDiffDrawer({
  open,
  onClose,
  diff,
  scriptId,
  title = "脚本变更",
  theme,
  targetType
}: ScriptDiffDrawerProps) {
  return (
    <Drawer
      title={
        <Space direction="vertical" size={2}>
          <Title level={5} style={{ margin: 0 }}>
            {title}
          </Title>
          {scriptId ? <Text type="secondary">{scriptId}</Text> : null}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={1100}
      destroyOnHidden
    >
      <ScriptDiffPanel diff={diff} theme={theme} targetType={targetType} />
    </Drawer>
  );
}
