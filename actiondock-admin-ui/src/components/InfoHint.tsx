import { QuestionCircleOutlined } from "@ant-design/icons";
import { Space, Tooltip, Typography } from "antd";

const { Text } = Typography;

interface InfoHintProps {
  content: string;
  label?: string;
}

export function InfoHint({ content, label }: InfoHintProps) {
  const icon = (
    <Tooltip title={content} overlayClassName="app-info-tooltip">
      <button type="button" className="info-hint" aria-label="查看说明">
        <QuestionCircleOutlined />
      </button>
    </Tooltip>
  );

  if (!label) {
    return icon;
  }

  return (
    <Space size={6} className="info-hint-group">
      <Text type="secondary" className="info-hint-group__label">
        {label}
      </Text>
      {icon}
    </Space>
  );
}
