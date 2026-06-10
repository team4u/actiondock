import { Card, Empty, Space, Table, Typography } from "antd";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { StructuredDiffSummary } from "../../services/playbookDiff";

const { Text } = Typography;

export interface StructuredColumn {
  title: string;
  dataIndex: string;
  width?: number;
  render?: (value: unknown) => React.ReactNode;
}

interface PlaybookStructuredDiffViewerProps {
  title: string;
  diff: StructuredDiffSummary;
  columns: StructuredColumn[];
  idField?: string;
}

function defaultRender(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function PlaybookStructuredDiffViewer({
  title,
  diff,
  columns,
  idField = "_id"
}: PlaybookStructuredDiffViewerProps) {
  if (!diff.available) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${title}未纳入本次对比`} />;
  }
  if (!diff.changed) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${title}无变化`} />;
  }

  const tableColumns = columns.map((column) => ({
    title: column.title,
    dataIndex: column.dataIndex,
    key: column.dataIndex,
    width: column.width,
    render: column.render ?? ((value: unknown) => defaultRender(value))
  }));

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {diff.added.length > 0 ? (
        <Card type="inner" title={`新增 (${diff.added.length})`}>
          <Table
            size="small"
            pagination={false}
            rowKey={idField}
            columns={tableColumns}
            dataSource={diff.added}
          />
        </Card>
      ) : null}
      {diff.removed.length > 0 ? (
        <Card type="inner" title={`删除 (${diff.removed.length})`}>
          <Table
            size="small"
            pagination={false}
            rowKey={idField}
            columns={tableColumns}
            dataSource={diff.removed}
          />
        </Card>
      ) : null}
      {diff.modified.length > 0 ? (
        <Card type="inner" title={`修改 (${diff.modified.length})`}>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {diff.modified.map((item) => (
              <div key={item.id} className="playbook-diff-block">
                <Text strong>{item.label}</Text>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="field"
                  columns={[
                    { title: "属性", dataIndex: "label", key: "label", width: 140 },
                    { title: "旧值", dataIndex: "before", key: "before", render: (value: unknown) => defaultRender(value) },
                    { title: "新值", dataIndex: "after", key: "after", render: (value: unknown) => defaultRender(value) },
                    {
                      title: "风险",
                      dataIndex: "risk",
                      key: "risk",
                      width: 120,
                      render: (value: string) => <RiskLevelTag level={value} />
                    }
                  ]}
                  dataSource={item.changes}
                />
              </div>
            ))}
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}
