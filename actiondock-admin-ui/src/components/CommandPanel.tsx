import { useEffect, useMemo, useState } from "react";
import { CopyOutlined } from "@ant-design/icons";
import { Button, Segmented, Space, Typography } from "antd";

const { Text } = Typography;

export interface CommandPreset {
  command: string;
  environment: string;
  family: string;
  key: string;
}

export function CommandPanel({
  onCopy,
  presets,
  title,
}: {
  onCopy: (value: string) => void;
  presets: CommandPreset[];
  title: string;
}) {
  const families = useMemo(() => Array.from(new Set(presets.map((item) => item.family))), [presets]);
  const [activeFamily, setActiveFamily] = useState(families[0]);
  const familyPresets = useMemo(
    () => presets.filter((item) => item.family === activeFamily),
    [activeFamily, presets]
  );
  const environments = useMemo(
    () => Array.from(new Set(familyPresets.map((item) => item.environment))),
    [familyPresets]
  );
  const [activeEnvironment, setActiveEnvironment] = useState(environments[0]);

  useEffect(() => {
    if (families.length > 0 && !families.includes(activeFamily)) {
      setActiveFamily(families[0]);
    }
  }, [activeFamily, families]);

  useEffect(() => {
    if (environments.length > 0 && !environments.includes(activeEnvironment)) {
      setActiveEnvironment(environments[0]);
    }
  }, [activeEnvironment, environments]);

  const activePreset = familyPresets.find((item) => item.environment === activeEnvironment) ?? familyPresets[0] ?? presets[0];
  const resolvedCommand = activePreset?.command ?? "";

  return (
    <div className="command-panel">
      <div className="command-panel__header">
        <Text strong>{title}</Text>
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => onCopy(resolvedCommand)} disabled={!resolvedCommand}>
            复制命令
          </Button>
        </Space>
      </div>
      {presets.length > 0 ? (
        <div className="command-panel__selectors">
          {families.length > 1 ? (
            <div className="command-panel__variants">
              <Text type="secondary">命令方式</Text>
              <Segmented<string>
                size="small"
                value={activeFamily}
                onChange={(nextFamily) => setActiveFamily(nextFamily)}
                options={families.map((item) => ({
                  label: item,
                  value: item
                }))}
              />
            </div>
          ) : null}
          {environments.length > 0 ? (
            <div className="command-panel__variants">
              <Text type="secondary">终端环境</Text>
              <Segmented<string>
                size="small"
                value={activePreset?.environment}
                onChange={(nextEnvironment) => setActiveEnvironment(nextEnvironment)}
                options={environments.map((item) => ({
                  label: item,
                  value: item
                }))}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {presets.length > 0 ? (
        <pre className="command-preview">
          <code>{resolvedCommand}</code>
        </pre>
      ) : null}
    </div>
  );
}
