import { Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAiRuns } from "../../api";
import { AiRunStatusTag } from "../../components/ai/AiTags";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import type { AiAgentRunRecord } from "../../types";
import { formatDateTime } from "../../utils";

export function AiRunListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AiAgentRunRecord[]>([]);
  useEffect(() => { void listAiRuns().then(setRuns); }, []);
  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [runs]
  );
  const columns: ColumnsType<AiAgentRunRecord> = [
    { title: "Run ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/runs/${id}`}>{String(id).slice(0, 8)}</TableLinkCell> },
    { title: "Agent", dataIndex: "agentProfile" },
    { title: "状态", dataIndex: "status", render: (status) => <AiRunStatusTag status={status} /> },
    { title: "调用方", dataIndex: "callerType" },
    { title: "脚本", dataIndex: "scriptId", render: (value) => value ? <Typography.Text code>{value}</Typography.Text> : "-" },
    { title: "tokens", dataIndex: "totalTokens" },
    { title: "开始时间", dataIndex: "startedAt", render: formatDateTime, sorter: (a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""), defaultSortOrder: "descend" }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader title="运行记录" meta="Agent Run 的状态、调用方和资源用量" onBack={() => navigate("/ai")} />
      <Table<AiAgentRunRecord>
        rowKey="id"
        dataSource={sortedRuns}
        columns={columns}
        scroll={{ x: 1000 }}
      />
    </Space>
  );
}
