import { RobotOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Space,
  Tabs,
  Tag,
  Typography
} from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ErrorDetailPanel } from "./ErrorDetailPanel";
import { ExecutionLogPanel } from "./ExecutionLogPanel";
import { SchemaObjectResultView } from "./SchemaObjectResultView";
import type { ExecutionRecord, ExecutionResponse } from "../types";
import { formatDateTime, getExecutionStatusColor, prettyJson } from "../utils";

const { Text } = Typography;

export type ExecutionResult = ExecutionRecord | ExecutionResponse;

export interface ExecutionResultCardProps {
  execution: ExecutionResult;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  inputOverride?: Record<string, unknown>;
  title?: string;
  headerActions?: ReactNode;
  titleExtra?: ReactNode;
  showTriggerSource?: boolean;
  pollingExecutionId?: string | null;
  emptyDescription?: string;
  errorTitle?: string;
  aiDiagnoseTo?: string;
  onAiDiagnose?: () => void;
  aiReviewTo?: string;
  onAiReview?: () => void;
}

function getTriggerSourceLabel(source: string): string {
  switch (source) {
    case "MANUAL":
      return "手工";
    case "SCHEDULED":
      return "定时";
    default:
      return source;
  }
}

function getSubmitModeLabel(mode: string): string {
  switch (mode) {
    case "SYNC":
      return "同步";
    case "ASYNC":
      return "异步";
    default:
      return mode;
  }
}

function hasInput(result: ExecutionResult): result is ExecutionRecord {
  return "input" in result;
}

export function ExecutionResultCard({
  execution,
  inputSchema,
  outputSchema,
  inputOverride,
  title = "执行结果",
  headerActions,
  titleExtra,
  showTriggerSource = false,
  pollingExecutionId,
  errorTitle = "执行失败",
  aiDiagnoseTo,
  onAiDiagnose,
  aiReviewTo,
  onAiReview
}: ExecutionResultCardProps) {
  const inputValue = inputOverride ?? (hasInput(execution) ? execution.input : undefined);
  const hasOutputSchema = Boolean(outputSchema && Object.keys(outputSchema).length > 0);
  const rawOutput = !hasOutputSchema && "debug" in execution ? execution.debug?.rawOutput : undefined;

  return (
    <Card
      className="equal-height-card"
      type="inner"
      title={
        <div className="execution-result-card__title-row">
          <span className="execution-result-card__title-text">{title}</span>
          {headerActions ? (
            <Space size={8} wrap className="execution-result-card__header-actions">
              {headerActions}
            </Space>
          ) : null}
          {titleExtra ?? (
            <Space size={8} wrap className="execution-result-card__header-extra">
              <Text code className="execution-result-card__header-id">
                {execution.id}
              </Text>
              <Tag color={getExecutionStatusColor(execution.status)}>
                {execution.status}
              </Tag>
            </Space>
          )}
        </div>
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div className="execution-result-card__meta">
          <div className="execution-result-card__meta-item">
            <Text type="secondary">方式</Text>
            <Text>{getSubmitModeLabel(execution.submitMode)}</Text>
          </div>

          {showTriggerSource ? (
            <div className="execution-result-card__meta-item">
              <Text type="secondary">触发</Text>
              <Tag color={execution.triggerSource === "SCHEDULED" ? "blue" : "default"}>
                {getTriggerSourceLabel(execution.triggerSource)}
              </Tag>
              {execution.scheduleId ? (
                <Text code className="execution-result-card__meta-code">
                  {execution.scheduleId}
                </Text>
              ) : null}
            </div>
          ) : null}

          <div className="execution-result-card__meta-item">
            <Text type="secondary">完成</Text>
            <Text>
              {pollingExecutionId ? `轮询中 ${pollingExecutionId.slice(0, 8)}` : formatDateTime(execution.finishedAt)}
            </Text>
          </div>
        </div>

        <ErrorDetailPanel
          title={errorTitle}
          message={execution.errorMessage}
          detail={execution.errorDetail}
        />

        {execution.status === "FAILED" && (aiDiagnoseTo || onAiDiagnose) ? (
          aiDiagnoseTo ? (
            <Link to={aiDiagnoseTo}>
              <Button icon={<RobotOutlined />}>AI 诊断</Button>
            </Link>
          ) : (
            <Button icon={<RobotOutlined />} onClick={onAiDiagnose}>AI 诊断</Button>
          )
        ) : null}

        {execution.status === "SUCCESS" && (aiReviewTo || onAiReview) ? (
          aiReviewTo ? (
            <Link to={aiReviewTo}>
              <Button icon={<RobotOutlined />}>AI 发布前 Review</Button>
            </Link>
          ) : (
            <Button icon={<RobotOutlined />} onClick={onAiReview}>AI 发布前 Review</Button>
          )
        ) : null}

        <Tabs
          defaultActiveKey="output"
          items={[
            {
              key: "output",
              label: "输出值",
              children: (
                <>
                  <SchemaObjectResultView
                    schema={outputSchema}
                    value={execution.output}
                  />
                  {rawOutput ? (
                    <div style={{ marginTop: 12 }}>
                      <Text strong>原始输出</Text>
                      <pre className="json-preview" style={{ marginTop: 8 }}>
                        {prettyJson(rawOutput)}
                      </pre>
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              key: "logs",
              label: "日志",
              children: <ExecutionLogPanel logs={execution.logs} />,
            },
            {
              key: "input",
              label: "输入值",
              children: (
                <SchemaObjectResultView
                  schema={inputSchema}
                  value={inputValue}
                  schemaName="inputSchema"
                  valueName="输入"
                />
              ),
            },
          ]}
        />
      </Space>
    </Card>
  );
}
