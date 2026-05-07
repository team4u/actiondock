import { CopyOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";

const { Paragraph, Text } = Typography;

export function SkillExamplePanel({
  description,
  onCopy,
  onOpenPublish,
  title,
  value,
}: {
  description?: string;
  onCopy: (value: string) => void;
  onOpenPublish?: (value: string) => void;
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
          {onOpenPublish ? (
            <Button icon={<EditOutlined />} onClick={() => onOpenPublish(value)} disabled={!value}>
              保存为 Skill
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
