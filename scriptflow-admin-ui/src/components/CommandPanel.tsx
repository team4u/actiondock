import { CopyOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";

const { Text } = Typography;

export function CommandPanel({
  command,
  onCopy,
  title
}: {
  command: string;
  onCopy: (value: string) => void;
  title: string;
}) {
  return (
    <div className="command-panel">
      <div className="command-panel__header">
        <Text strong>{title}</Text>
        <Button icon={<CopyOutlined />} onClick={() => onCopy(command)}>
          复制命令
        </Button>
      </div>
      <pre className="command-preview">
        <code>{command}</code>
      </pre>
    </div>
  );
}
