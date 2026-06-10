import { Alert, Card, Empty, Space, Table, Tag, Typography } from "antd";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { SchemaDiffSummary } from "../../services/scriptDiff";

const { Text } = Typography;

interface SchemaDiffViewerProps {
  title: string;
  diff: SchemaDiffSummary;
}

function renderValue(value: unknown): string {
  if (value === undefined) {
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

export function SchemaDiffViewer({ title, diff }: SchemaDiffViewerProps) {
  if (!diff.changed) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${title} 无变化`} />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {diff.fallbackToRaw ? (
        <Alert
          type="warning"
          showIcon
          message="当前 Schema 包含复杂结构"
          description="结构化 Diff 仅覆盖顶层字段，同时保留原始 JSON 供进一步核对。"
        />
      ) : null}

      {diff.addedFields.length > 0 ? (
        <Card type="inner" title={`新增字段 (${diff.addedFields.length})`}>
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            columns={[
              { title: "字段", dataIndex: "name", key: "name" },
              { title: "类型", dataIndex: "type", key: "type", render: (value?: string) => value || "-" },
              {
                title: "必填",
                dataIndex: "required",
                key: "required",
                width: 100,
                render: (value?: boolean) => (value ? "required" : "optional")
              },
              {
                title: "风险",
                dataIndex: "risk",
                key: "risk",
                width: 120,
                render: (value: string) => <RiskLevelTag level={value} />
              }
            ]}
            dataSource={diff.addedFields}
          />
        </Card>
      ) : null}

      {diff.removedFields.length > 0 ? (
        <Card type="inner" title={`删除字段 (${diff.removedFields.length})`}>
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            columns={[
              { title: "字段", dataIndex: "name", key: "name" },
              { title: "类型", dataIndex: "type", key: "type", render: (value?: string) => value || "-" },
              {
                title: "风险",
                dataIndex: "risk",
                key: "risk",
                width: 120,
                render: (value: string) => <RiskLevelTag level={value} />
              }
            ]}
            dataSource={diff.removedFields}
          />
        </Card>
      ) : null}

      {diff.modifiedFields.length > 0 ? (
        <Card type="inner" title={`修改字段 (${diff.modifiedFields.length})`}>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {diff.modifiedFields.map((field) => (
              <div key={field.name} className="script-diff-block">
                <Space wrap size={[8, 8]}>
                  <Text strong>{field.name}</Text>
                </Space>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(record: any) => `${field.name}-${record.property}`}
                  columns={[
                    { title: "属性", dataIndex: "property", key: "property", width: 120 },
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
                  dataSource={field.changes}
                />
              </div>
            ))}
          </Space>
        </Card>
      ) : null}

      {diff.fallbackToRaw ? (
        <Card type="inner" title="原始 JSON 对比">
          <div className="script-diff-raw-grid">
            <div>
              <Text strong>旧值</Text>
              <pre className="script-import-result__code">{diff.rawBeforeText}</pre>
            </div>
            <div>
              <Text strong>新值</Text>
              <pre className="script-import-result__code">{diff.rawAfterText}</pre>
            </div>
          </div>
        </Card>
      ) : null}

      {diff.warnings.length > 0 ? (
        <Space direction="vertical" size={4}>
          {diff.warnings.map((item) => (
            <Tag key={item} color="gold">
              {item}
            </Tag>
          ))}
        </Space>
      ) : null}
    </Space>
  );
}
