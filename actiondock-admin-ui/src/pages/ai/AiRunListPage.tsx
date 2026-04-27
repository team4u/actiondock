import { Space, Table, Typography } from "antd";
import { useEffect, useState } from "react";
import { listAiRuns } from "../../api";
import { AiRunStatusTag } from "../../components/ai/AiTags";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import type { AiAgentRunRecord } from "../../types";
import { formatDateTime } from "../../utils";

export function AiRunListPage() {
  const [runs, setRuns] = useState<AiAgentRunRecord[]>([]);
  useEffect(() => { void listAiRuns().then(setRuns); }, []);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader title="运行记录" meta="Agent Run 的状态、调用方和资源用量" />
      <Table<AiAgentRunRecord>
        rowKey="id"
        dataSource={runs}
        columns={[
          { title: "Run ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/runs/${id}`}>{String(id).slice(0, 8)}</TableLinkCell> },
          { title: "Agent", dataIndex: "agentProfile" },
          { title: "状态", dataIndex: "status", render: (status) => <AiRunStatusTag status={status} /> },
          { title: "调用方", dataIndex: "callerType" },
          { title: "脚本", dataIndex: "scriptId", render: (value) => value ? <Typography.Text code>{value}</Typography.Text> : "-" },
          { title: "tokens", dataIndex: "totalTokens" },
          { title: "开始时间", dataIndex: "startedAt", render: formatDateTime }
        ]}
      />
    </Space>
  );
}
