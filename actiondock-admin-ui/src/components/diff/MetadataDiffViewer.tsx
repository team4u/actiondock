import { Empty, Table } from "antd";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { MetadataDiffSummary } from "../../services/scriptDiff";

interface MetadataDiffViewerProps {
  diff: MetadataDiffSummary;
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function MetadataDiffViewer({ diff }: MetadataDiffViewerProps) {
  if (!diff.changed) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Metadata 无变化" />;
  }

  return (
    <Table
      size="small"
      pagination={false}
      rowKey="field"
      columns={[
        { title: "字段", dataIndex: "label", key: "label", width: 160 },
        { title: "旧值", dataIndex: "before", key: "before", render: renderValue },
        { title: "新值", dataIndex: "after", key: "after", render: renderValue },
        {
          title: "风险",
          dataIndex: "risk",
          key: "risk",
          width: 120,
          render: (value: string) => <RiskLevelTag level={value} />
        }
      ]}
      dataSource={diff.changes}
    />
  );
}
