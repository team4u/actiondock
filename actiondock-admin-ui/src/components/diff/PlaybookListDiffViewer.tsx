import { Card, Empty, Space, Tag, Typography } from "antd";
import type { ListDiffSummary } from "../../services/playbookDiff";

const { Text } = Typography;

interface PlaybookListDiffViewerProps {
  title: string;
  diff: ListDiffSummary;
}

export function PlaybookListDiffViewer({ title, diff }: PlaybookListDiffViewerProps) {
  if (!diff.changed) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${title}无变化`} />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {diff.added.length > 0 ? (
        <Card type="inner" title={`新增 (${diff.added.length})`}>
          <Space wrap>
            {diff.added.map((item) => (
              <Tag key={`add-${item}`} color="green">
                {item}
              </Tag>
            ))}
          </Space>
        </Card>
      ) : null}
      {diff.removed.length > 0 ? (
        <Card type="inner" title={`删除 (${diff.removed.length})`}>
          <Space wrap>
            {diff.removed.map((item) => (
              <Tag key={`del-${item}`} color="red">
                <Text delete>{item}</Text>
              </Tag>
            ))}
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}
