import { Empty, Space, Tabs, Typography } from "antd";
import { PlaybookDiffSummary } from "./PlaybookDiffSummary";
import { SourceDiffViewer } from "./SourceDiffViewer";
import { MetadataDiffViewer } from "./MetadataDiffViewer";
import { PlaybookListDiffViewer } from "./PlaybookListDiffViewer";
import { PlaybookStructuredDiffViewer } from "./PlaybookStructuredDiffViewer";
import type { PlaybookDiffResult } from "../../services/playbookDiff";

const { Text } = Typography;

interface PlaybookDiffPanelProps {
  diff: PlaybookDiffResult;
  theme: "vs-light" | "vs-dark";
}

export function PlaybookDiffPanel({ diff, theme }: PlaybookDiffPanelProps) {
  if (!diff.hasChanges && diff.comparisonMode !== "INITIAL") {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可展示的差异" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {diff.comparisonMode === "INITIAL" ? (
        <Text type="secondary">这是首次发布，将展示完整任务手册内容。</Text>
      ) : null}
      <PlaybookDiffSummary diff={diff} />
      <Tabs
        items={diff.tabs.map((tab) => {
          if (tab === "guideMarkdown") {
            return {
              key: tab,
              label: "导览 Markdown",
              children: (
                <SourceDiffViewer
                  language="markdown"
                  original={diff.guideMarkdown.original}
                  modified={diff.guideMarkdown.modified}
                  theme={theme}
                />
              )
            };
          }
          if (tab === "metadata") {
            return {
              key: tab,
              label: "元信息",
              children: <MetadataDiffViewer diff={diff.metadata} />
            };
          }
          if (tab === "stopConditions") {
            return {
              key: tab,
              label: "停止条件",
              children: <PlaybookListDiffViewer title="停止条件" diff={diff.stopConditions} />
            };
          }
          if (tab === "knowledgeRefs") {
            return {
              key: tab,
              label: "知识引用",
              children: (
                <PlaybookStructuredDiffViewer
                  title="知识引用"
                  diff={diff.knowledgeRefs}
                  columns={[
                    { title: "类型", dataIndex: "type", width: 100 },
                    { title: "仓库", dataIndex: "repositoryId", width: 200 },
                    { title: "路径", dataIndex: "path" },
                    { title: "笔记摘要", dataIndex: "markdown" }
                  ]}
                />
              )
            };
          }
          if (tab === "scriptRefs") {
            return {
              key: tab,
              label: "脚本引用",
              children: (
                <PlaybookStructuredDiffViewer
                  title="脚本引用"
                  diff={diff.scriptRefs}
                  columns={[
                    { title: "脚本 ID", dataIndex: "scriptId" },
                    { title: "用途", dataIndex: "purpose" }
                  ]}
                />
              )
            };
          }
          if (tab === "agentSkillRefs") {
            return {
              key: tab,
              label: "Skill 引用",
              children: (
                <PlaybookStructuredDiffViewer
                  title="Skill 引用"
                  diff={diff.agentSkillRefs}
                  columns={[
                    { title: "Skill ID", dataIndex: "skillId" },
                    { title: "用途", dataIndex: "purpose" },
                    { title: "必需", dataIndex: "required", width: 100, render: (value) => (value ? "是" : "否") }
                  ]}
                />
              )
            };
          }
          return {
            key: tab,
            label: "关联手册",
            children: (
              <PlaybookStructuredDiffViewer
                title="关联手册"
                diff={diff.relatedPlaybookRefs}
                columns={[
                  { title: "手册 ID", dataIndex: "playbookId" },
                  { title: "关联类型", dataIndex: "relation", width: 140 },
                  { title: "用途", dataIndex: "purpose" }
                ]}
              />
            )
          };
        })}
      />
    </Space>
  );
}
