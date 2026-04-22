import {
  Alert,
  Card,
  Descriptions,
  Empty,
  Space,
  Tag,
  Typography
} from "antd";
import type { ReactNode } from "react";
import { ErrorDetailPanel } from "./ErrorDetailPanel";
import { SchemaObjectResultView } from "./SchemaObjectResultView";
import type { ExecutionRecord, ExecutionResponse, ExecutionStatus } from "../types";
import { formatDateTime, prettyJson } from "../utils";

const { Text } = Typography;

export type ExecutionResult = ExecutionRecord | ExecutionResponse;

export interface ExecutionResultCardProps {
  execution: ExecutionResult;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  inputOverride?: Record<string, unknown>;
  title?: string;
  titleExtra?: ReactNode;
  showTriggerSource?: boolean;
  pollingExecutionId?: string | null;
  emptyDescription?: string;
  errorTitle?: string;
}

function getExecutionStatusColor(status?: ExecutionStatus): string {
  switch (status) {
    case "SUCCESS":
      return "green";
    case "FAILED":
      return "red";
    case "RUNNING":
      return "processing";
    case "PENDING":
      return "gold";
    default:
      return "default";
  }
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

function hasInput(result: ExecutionResult): result is ExecutionRecord {
  return "input" in result;
}

export function ExecutionResultCard({
  execution,
  inputSchema,
  outputSchema,
  inputOverride,
  title = "执行结果",
  titleExtra,
  showTriggerSource = false,
  pollingExecutionId,
  emptyDescription = "执行后将在这里查看结果详情。",
  errorTitle = "执行失败"
}: ExecutionResultCardProps) {
  const inputValue = inputOverride ?? (hasInput(execution) ? execution.input : undefined);
  const hasOutputSchema = Boolean(outputSchema && Object.keys(outputSchema).length > 0);
  const rawOutput = !hasOutputSchema && "debug" in execution ? execution.debug?.rawOutput : undefined;

  return (
    <Card
      type="inner"
      title={title}
      extra={
        titleExtra ?? (
          <Tag color={getExecutionStatusColor(execution.status)}>
            {execution.status}
          </Tag>
        )
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Descriptions
          size="small"
          column={{
            xs: 1,
            sm: 2,
            lg: showTriggerSource ? 4 : 3
          }}
        >
          <Descriptions.Item label="执行 ID">
            <Text code>{execution.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={getExecutionStatusColor(execution.status)}>{execution.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="提交方式">
            {execution.submitMode}
          </Descriptions.Item>
          {showTriggerSource ? (
            <Descriptions.Item label="触发来源">
              <Space direction="vertical" size={2}>
                <Tag color={execution.triggerSource === "SCHEDULED" ? "blue" : "default"}>
                  {getTriggerSourceLabel(execution.triggerSource)}
                </Tag>
                {execution.scheduleId ? (
                  <Text type="secondary" code>
                    {execution.scheduleId}
                  </Text>
                ) : null}
              </Space>
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="完成时间">
            {pollingExecutionId ? `轮询中: ${pollingExecutionId.slice(0, 8)}` : formatDateTime(execution.finishedAt)}
          </Descriptions.Item>
        </Descriptions>

        <ErrorDetailPanel
          title={errorTitle}
          message={execution.errorMessage}
          detail={execution.errorDetail}
        />

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Text strong>输入值</Text>
            <div style={{ marginTop: 8 }}>
              <SchemaObjectResultView
                schema={inputSchema}
                value={inputValue}
                schemaName="inputSchema"
                valueName="输入"
              />
            </div>
          </div>

          <div>
            <Text strong>输出值</Text>
            <div style={{ marginTop: 8 }}>
              <SchemaObjectResultView
                schema={outputSchema}
                value={execution.output}
              />
            </div>
          </div>

          {rawOutput ? (
            <div>
              <Text strong>原始输出</Text>
              <pre className="json-preview" style={{ marginTop: 8 }}>
                {prettyJson(rawOutput)}
              </pre>
            </div>
          ) : null}
        </Space>
      </Space>
    </Card>
  );
}
