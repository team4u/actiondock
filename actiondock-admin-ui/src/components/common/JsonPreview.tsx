import { Empty, Typography } from "antd";
import { prettyJson } from "../../services/utils";

const { Text } = Typography;

export function JsonPreview({
  title,
  value,
  emptyDescription
}: {
  title: string;
  value?: Record<string, unknown>;
  emptyDescription: string;
}) {
  const hasValue = Boolean(value && Object.keys(value).length > 0);

  return (
    <div className="execution-json-panel">
      <Text strong>{title}</Text>
      {hasValue ? (
        <pre className="json-preview">{prettyJson(value)}</pre>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
      )}
    </div>
  );
}
