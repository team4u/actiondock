import { CopyOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import { toSingleLineCommand } from "../utils";

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
  const singleLineCommand = toSingleLineCommand(command);
  const supportsSingleLineCopy = singleLineCommand !== command;

  return (
    <div className="command-panel">
      <div className="command-panel__header">
        <Text strong>{title}</Text>
        <Space>
          {supportsSingleLineCopy ? (
            <Button icon={<CopyOutlined />} onClick={() => onCopy(singleLineCommand)}>
              复制单行
            </Button>
          ) : null}
          <Button icon={<CopyOutlined />} onClick={() => onCopy(command)}>
            复制命令
          </Button>
        </Space>
      </div>
      <pre className="command-preview">
        <code>{command}</code>
      </pre>
    </div>
  );
}
