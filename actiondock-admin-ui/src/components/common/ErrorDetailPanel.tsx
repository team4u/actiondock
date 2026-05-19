import { CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Descriptions, Space, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import type { ErrorDetail } from "../../shared/types";
import { copyText } from "../../services/utils";

const { Text } = Typography;

function formatErrorText(message?: string | null, detail?: ErrorDetail | null): string {
  const parts: string[] = [];
  if (message?.trim()) {
    parts.push(message.trim());
  }
  if (detail?.type) {
    parts.push(`异常类型: ${detail.type}`);
  }
  if (detail?.stackTrace) {
    parts.push(detail.stackTrace);
  }
  return parts.join("\n\n");
}

export function ErrorDetailPanel({
  title = "执行失败",
  message,
  detail,
  messageApi
}: {
  title?: string;
  message?: string | null;
  detail?: ErrorDetail | null;
  messageApi?: MessageInstance;
}) {
  if (!message && !detail) {
    return null;
  }

  const summary = message?.trim() || detail?.type || title;
  const hasStructuredDetail = Boolean(detail?.type || detail?.stackTrace);

  const handleCopy = () => {
    const text = formatErrorText(message, detail);
    void copyText(text)
      .then(() => messageApi?.success("已复制错误信息"))
      .catch(() => messageApi?.error("复制失败"));
  };

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type="error"
        showIcon
        message={title}
        description={summary}
        action={
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={handleCopy}>
            复制
          </Button>
        }
      />
      {hasStructuredDetail ? (
        <Collapse
          size="small"
          items={[
            {
              key: "error-detail",
              label: "查看异常详情",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Descriptions size="small" column={1}>
                    {detail?.type ? (
                      <Descriptions.Item label="异常类型">
                        <Text code>{detail.type}</Text>
                      </Descriptions.Item>
                    ) : null}
                  </Descriptions>
                  {detail?.stackTrace ? (
                    <pre className="error-detail-panel__stack-trace">{detail.stackTrace}</pre>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
      ) : null}
    </Space>
  );
}
