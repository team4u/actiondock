import { Tag, Typography } from "antd";
import type { ExecutionLogEntry, ExecutionLogLevel } from "../../shared/types";
import { formatDateTime } from "../../services/utils";

const { Text } = Typography;

export interface ExecutionLogPanelProps {
  logs?: ExecutionLogEntry[];
}

function getLogLevelColor(level: ExecutionLogLevel): string {
  switch (level) {
    case "DEBUG":
      return "default";
    case "INFO":
      return "blue";
    case "WARN":
      return "gold";
    case "ERROR":
      return "red";
    default:
      return "default";
  }
}

export function ExecutionLogPanel({ logs = [] }: ExecutionLogPanelProps) {
  return (
    <div className="execution-log-panel">
      <Text strong>执行日志</Text>
      {logs.length === 0 ? (
        <div className="execution-log-panel__empty">
          <Text type="secondary">暂无日志</Text>
        </div>
      ) : (
        <div className="execution-log-list">
          {logs.map((item, index) => (
            <div
              key={`${item.createdAt ?? "unknown"}-${item.level}-${index}`}
              className="execution-log-entry"
            >
              <div className="execution-log-entry__meta">
                <Text type="secondary">{formatDateTime(item.createdAt) || "-"}</Text>
                <Tag color={getLogLevelColor(item.level)}>{item.level}</Tag>
              </div>
              <pre className="execution-log-entry__message">{item.message}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
