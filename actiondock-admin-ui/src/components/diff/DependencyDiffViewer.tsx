import { Card, Empty, Space, Table, Typography } from "antd";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { DependencyDiffSummary } from "../../services/scriptDiff";

const { Text } = Typography;

interface DependencyDiffViewerProps {
  diff: DependencyDiffSummary;
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

function dependencyLabel(record: { dependencyType: "PLUGIN" | "SCRIPT"; dependencyId: string }): string {
  return record.dependencyType === "PLUGIN" ? "插件" : "脚本";
}

export function DependencyDiffViewer({ diff }: DependencyDiffViewerProps) {
  if (!diff.available) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次对比未包含依赖信息" />;
  }

  if (!diff.changed) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="依赖无变化" />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {diff.added.length > 0 ? (
        <Card type="inner" title={`新增依赖 (${diff.added.length})`}>
          <Table
            size="small"
            pagination={false}
            rowKey={(record) => `${record.dependencyType}:${record.dependencyId}`}
            columns={[
              { title: "类型", key: "dependencyType", render: (_value, record) => dependencyLabel(record) },
              { title: "标识", dataIndex: "dependencyId", key: "dependencyId" },
              { title: "目标", dataIndex: "target", key: "target", render: renderValue },
              { title: "版本范围", dataIndex: "versionRange", key: "versionRange", render: renderValue },
              {
                title: "动作",
                dataIndex: "requiredActions",
                key: "requiredActions",
                render: (value: string[]) => value.length > 0 ? value.join(", ") : "-"
              },
              {
                title: "风险",
                dataIndex: "risk",
                key: "risk",
                width: 120,
                render: (value: string) => <RiskLevelTag level={value} />
              }
            ]}
            dataSource={diff.added}
          />
          <Text type="secondary">新增依赖时，请确认目标环境已安装并配置对应脚本或插件。</Text>
        </Card>
      ) : null}

      {diff.removed.length > 0 ? (
        <Card type="inner" title={`删除依赖 (${diff.removed.length})`}>
          <Table
            size="small"
            pagination={false}
            rowKey={(record) => `${record.dependencyType}:${record.dependencyId}`}
            columns={[
              { title: "类型", key: "dependencyType", render: (_value, record) => dependencyLabel(record) },
              { title: "标识", dataIndex: "dependencyId", key: "dependencyId" },
              { title: "目标", dataIndex: "target", key: "target", render: renderValue },
              { title: "版本范围", dataIndex: "versionRange", key: "versionRange", render: renderValue },
              {
                title: "动作",
                dataIndex: "requiredActions",
                key: "requiredActions",
                render: (value: string[]) => value.length > 0 ? value.join(", ") : "-"
              },
              {
                title: "风险",
                dataIndex: "risk",
                key: "risk",
                width: 120,
                render: (value: string) => <RiskLevelTag level={value} />
              }
            ]}
            dataSource={diff.removed}
          />
        </Card>
      ) : null}

      {diff.modified.length > 0 ? (
        <Card type="inner" title={`修改依赖 (${diff.modified.length})`}>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {diff.modified.map((item) => (
              <div key={`${item.dependencyType}:${item.dependencyId}`} className="script-diff-block">
                <Text strong>{`${dependencyLabel(item)} ${item.dependencyId}`}</Text>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(record: any) => `${item.dependencyType}-${item.dependencyId}-${record.field}`}
                  columns={[
                    { title: "属性", dataIndex: "field", key: "field", width: 140 },
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
