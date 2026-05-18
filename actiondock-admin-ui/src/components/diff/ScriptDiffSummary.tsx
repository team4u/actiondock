import { Alert, Space, Typography } from "antd";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { ScriptDiffResult } from "../../services/scriptDiff";

const { Text } = Typography;

function summarizeSchema(diff: ScriptDiffResult["inputSchema"]): string {
  if (!diff.changed) {
    return "无变化";
  }
  return `新增 ${diff.addedFields.length}，删除 ${diff.removedFields.length}，修改 ${diff.modifiedFields.length}`;
}

function summarizeDependencies(diff: ScriptDiffResult["dependencies"]): string {
  if (!diff.available) {
    return "未纳入本次对比";
  }
  if (!diff.changed) {
    return "无变化";
  }
  return `新增 ${diff.added.length}，删除 ${diff.removed.length}，修改 ${diff.modified.length}`;
}

interface ScriptDiffSummaryProps {
  diff: ScriptDiffResult;
}

export function ScriptDiffSummary({ diff }: ScriptDiffSummaryProps) {
  return (
    <Alert
      type={diff.riskLevel === "HIGH" ? "error" : diff.riskLevel === "MEDIUM" ? "warning" : "info"}
      showIcon
      message={
        <Space wrap size={[8, 8]}>
          <Text strong>{diff.comparisonMode === "INITIAL" ? "首次发布 / 导入" : "变更摘要"}</Text>
          <RiskLevelTag level={diff.riskLevel} />
        </Space>
      }
      description={
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text>Source：{diff.source.changed ? `新增 ${diff.source.addedLines} 行，删除 ${diff.source.removedLines} 行` : "无变化"}</Text>
          <Text>Input Schema：{summarizeSchema(diff.inputSchema)}</Text>
          <Text>Output Schema：{summarizeSchema(diff.outputSchema)}</Text>
          <Text>Metadata：{diff.metadata.changed ? `${diff.metadata.changes.length} 项变更` : "无变化"}</Text>
          {diff.dependencies.available ? <Text>依赖：{summarizeDependencies(diff.dependencies)}</Text> : null}
          {diff.highlights.length > 0 ? (
            <Space direction="vertical" size={2}>
              {diff.highlights.map((item) => (
                <Text key={item} type="danger">
                  {item}
                </Text>
              ))}
            </Space>
          ) : null}
          {diff.warnings.length > 0 ? (
            <Space direction="vertical" size={2}>
              {diff.warnings.map((item) => (
                <Text key={item} type="warning">
                  {item}
                </Text>
              ))}
            </Space>
          ) : null}
        </Space>
      }
    />
  );
}
