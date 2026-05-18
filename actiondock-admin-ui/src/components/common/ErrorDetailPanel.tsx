import { Alert, Collapse, Descriptions, Space, Typography } from "antd";
import type { ErrorDetail } from "../../shared/types";

const { Text } = Typography;

export function ErrorDetailPanel({
  title = "执行失败",
  message,
  detail
}: {
  title?: string;
  message?: string | null;
  detail?: ErrorDetail | null;
}) {
  if (!message && !detail) {
    return null;
  }

  const summary = message?.trim() || detail?.type || title;
  const hasStructuredDetail = Boolean(detail?.type || detail?.stackTrace);

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type="error"
        showIcon
        message={title}
        description={summary}
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
