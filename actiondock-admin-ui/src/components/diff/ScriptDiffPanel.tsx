import { Empty, Space, Tabs, Typography } from "antd";
import { ScriptDiffSummary } from "./ScriptDiffSummary";
import { SourceDiffViewer } from "./SourceDiffViewer";
import { SchemaDiffViewer } from "./SchemaDiffViewer";
import { MetadataDiffViewer } from "./MetadataDiffViewer";
import { DependencyDiffViewer } from "./DependencyDiffViewer";
import type { ScriptDiffResult } from "../../services/scriptDiff";
import type { ScriptType } from "../../shared/types";

const { Text } = Typography;

interface ScriptDiffPanelProps {
  diff: ScriptDiffResult;
  targetType?: ScriptType;
  theme: "vs-light" | "vs-dark";
}

export function ScriptDiffPanel({ diff, targetType, theme }: ScriptDiffPanelProps) {
  if (!diff.hasChanges && diff.comparisonMode !== "INITIAL") {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可展示的差异" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {diff.comparisonMode === "INITIAL" ? (
        <Text type="secondary">这是首次发布或首次导入，将展示完整脚本内容。</Text>
      ) : null}
      <ScriptDiffSummary diff={diff} />
      <Tabs
        items={diff.tabs.map((tab) => {
          if (tab === "source") {
            return {
              key: tab,
              label: "源码",
              children: (
                <SourceDiffViewer
                  type={targetType}
                  original={diff.source.original}
                  modified={diff.source.modified}
                  theme={theme}
                />
              )
            };
          }
          if (tab === "inputSchema") {
            return {
              key: tab,
              label: "Input Schema",
              children: <SchemaDiffViewer title="Input Schema" diff={diff.inputSchema} />
            };
          }
          if (tab === "outputSchema") {
            return {
              key: tab,
              label: "Output Schema",
              children: <SchemaDiffViewer title="Output Schema" diff={diff.outputSchema} />
            };
          }
          if (tab === "metadata") {
            return {
              key: tab,
              label: "元信息",
              children: <MetadataDiffViewer diff={diff.metadata} />
            };
          }
          return {
            key: tab,
            label: "依赖",
            children: <DependencyDiffViewer diff={diff.dependencies} />
          };
        })}
      />
    </Space>
  );
}
