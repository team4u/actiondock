import { useState } from "react";
import { CopyOutlined } from "@ant-design/icons";
import { Button, Segmented, Space, Typography } from "antd";

const { Text } = Typography;

interface CommandVariant {
  command: string;
  key: string;
  label: string;
}

export function CommandPanel({
  command,
  onCopy,
  title,
  variants
}: {
  command: string;
  onCopy: (value: string) => void;
  title: string;
  variants?: CommandVariant[];
}) {
  const [activeVariantKey, setActiveVariantKey] = useState(variants?.[0]?.key);
  const activeVariant = variants?.find((item) => item.key === activeVariantKey) ?? variants?.[0];
  const resolvedCommand = activeVariant?.command ?? command;

  return (
    <div className="command-panel">
      <div className="command-panel__header">
        <Text strong>{title}</Text>
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => onCopy(resolvedCommand)}>
            复制命令
          </Button>
        </Space>
      </div>
      {variants && variants.length > 0 ? (
        <div className="command-panel__variants">
          <Segmented<string>
            size="small"
            value={activeVariant?.key}
            onChange={(nextMode) => setActiveVariantKey(nextMode)}
            options={variants.map((item) => ({
              label: item.label,
              value: item.key
            }))}
          />
        </div>
      ) : null}
      <pre className="command-preview">
        <code>{resolvedCommand}</code>
      </pre>
    </div>
  );
}
