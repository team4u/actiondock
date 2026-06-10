import { Alert, Space, Typography } from "antd";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { PlaybookDiffResult } from "../../services/playbookDiff";

const { Text } = Typography;

function summarizeStructured(
  diff: PlaybookDiffResult["scriptRefs"],
  label: string
): string {
  if (!diff.available) {
    return `${label}：未纳入本次对比`;
  }
  if (!diff.changed) {
    return `${label}：无变化`;
  }
  return `${label}：新增 ${diff.added.length}，删除 ${diff.removed.length}，修改 ${diff.modified.length}`;
}

function summarizeList(diff: PlaybookDiffResult["stopConditions"], label: string): string {
  if (!diff.changed) {
    return `${label}：无变化`;
  }
  return `${label}：新增 ${diff.added.length}，删除 ${diff.removed.length}`;
}

interface PlaybookDiffSummaryProps {
  diff: PlaybookDiffResult;
}

export function PlaybookDiffSummary({ diff }: PlaybookDiffSummaryProps) {
  return (
    <Alert
      type={diff.riskLevel === "HIGH" ? "error" : diff.riskLevel === "MEDIUM" ? "warning" : "info"}
      showIcon
      message={
        <Space wrap size={[8, 8]}>
          <Text strong>{diff.comparisonMode === "INITIAL" ? "首次发布" : "变更摘要"}</Text>
          <RiskLevelTag level={diff.riskLevel} />
        </Space>
      }
      description={
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text>
            导览 Markdown：
            {diff.guideMarkdown.changed
              ? `新增 ${diff.guideMarkdown.addedLines} 行，删除 ${diff.guideMarkdown.removedLines} 行`
              : "无变化"}
          </Text>
          <Text>
            元信息：
            {diff.metadata.changed ? `${diff.metadata.changes.length} 项变更` : "无变化"}
          </Text>
          <Text>{summarizeList(diff.stopConditions, "停止条件")}</Text>
          <Text>{summarizeStructured(diff.knowledgeRefs, "知识引用")}</Text>
          <Text>{summarizeStructured(diff.scriptRefs, "脚本引用")}</Text>
          <Text>{summarizeStructured(diff.agentSkillRefs, "Skill 引用")}</Text>
          <Text>{summarizeStructured(diff.relatedPlaybookRefs, "关联手册")}</Text>
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
