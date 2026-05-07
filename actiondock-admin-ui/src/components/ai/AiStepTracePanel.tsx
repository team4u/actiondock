import { Alert, Collapse, Empty, Typography } from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { AiAgentStep, AiStepType } from "../../shared/types";
import { AiToolPermissionTag } from "./AiTags";
import { formatDateTime, prettyJson } from "../../services/utils";

const { Text } = Typography;

function getStepTypeLabel(stepType: AiStepType): string {
  switch (stepType) {
    case "MODEL_REASONING": return "推理";
    case "TOOL_CALL":       return "工具调用";
    case "TOOL_RESULT":     return "工具结果";
    case "APPROVAL":        return "审批";
    case "INTERRUPT":       return "中断";
    default:                return stepType;
  }
}

function hasContent(value?: Record<string, unknown>): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

export interface AiStepTracePanelProps {
  steps: AiAgentStep[];
}

export function AiStepTracePanel({ steps }: AiStepTracePanelProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (steps.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行步骤" />;
  }

  return (
    <div className="ai-step-trace">
      {steps.map((step) => {
        const expanded = expandedKeys.has(step.id);
        return (
          <div key={step.id} className="ai-step-trace__card">
            <div className="ai-step-trace__header" onClick={() => toggle(step.id)}>
              <Text type="secondary" className="ai-step-trace__index">{step.stepIndex}</Text>
              <Text strong>{getStepTypeLabel(step.stepType)}</Text>
              {step.toolName ? <Text code>{step.toolName}</Text> : null}
              {step.toolPermission ? <AiToolPermissionTag permission={step.toolPermission} /> : null}
              {step.latencyMs != null ? <Text type="secondary">{step.latencyMs}ms</Text> : null}
              {step.errorMessage ? <Text type="danger">Error</Text> : null}
              <span className="ai-step-trace__spacer" />
              {expanded ? <DownOutlined style={{ fontSize: 10, color: "#bbb" }} /> : <RightOutlined style={{ fontSize: 10, color: "#bbb" }} />}
            </div>
            {expanded ? (
              <div className="ai-step-trace__body">
                {step.errorMessage ? <Alert type="error" showIcon message={step.errorMessage} /> : null}
                {hasContent(step.toolInput) ? (
                  <Collapse
                    ghost
                    size="small"
                    defaultActiveKey={["input"]}
                    items={[{
                      key: "input",
                      label: "工具输入",
                      children: <pre className="json-preview">{prettyJson(step.toolInput)}</pre>
                    }]}
                  />
                ) : null}
                {hasContent(step.toolOutput) ? (
                  <Collapse
                    ghost
                    size="small"
                    defaultActiveKey={["output"]}
                    items={[{
                      key: "output",
                      label: "工具输出",
                      children: <pre className="json-preview">{prettyJson(step.toolOutput)}</pre>
                    }]}
                  />
                ) : null}
                {step.createdAt ? <Text type="secondary">{formatDateTime(step.createdAt)}</Text> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
