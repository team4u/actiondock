import { CopyOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";

const { Paragraph, Text } = Typography;

export function SkillExamplePanel({
  description,
  onCopy,
  onOpenInstall,
  title,
  value,
}: {
  description?: string;
  onCopy: (value: string) => void;
  onOpenInstall?: (value: string) => void;
  title?: string;
  value: string;
}) {
  return (
    <div className="command-panel skill-example-panel">
      <div className="command-panel__header">
        <div className="skill-example-panel__title">
          {title ? <Text strong>{title}</Text> : null}
          {description ? (
            <Paragraph type="secondary" className="skill-example-panel__description">
              {description}
            </Paragraph>
          ) : null}
        </div>
        <Space>
          {onOpenInstall ? (
            <Button icon={<EditOutlined />} onClick={() => onOpenInstall(value)} disabled={!value}>
              安装为 Skill
            </Button>
          ) : null}
          <Button icon={<CopyOutlined />} onClick={() => onCopy(value)} disabled={!value}>
            复制 Skill
          </Button>
        </Space>
      </div>
      <pre className="command-preview skill-example-panel__preview">
        <code>{value}</code>
      </pre>
    </div>
  );
}
