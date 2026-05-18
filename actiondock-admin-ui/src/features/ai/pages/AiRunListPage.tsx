import { Button, Modal, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAiRun, listAiRuns } from "../../ai/api";
import { AiRunStatusTag } from "../../../components/ai/AiTags";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import type { AiAgentRunRecord } from "../../../shared/types";
import { formatDateTime } from "../../../services/utils";

export function AiRunListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AiAgentRunRecord[]>([]);
  useEffect(() => { void listAiRuns().then(setRuns); }, []);
  const handleDelete = (record: AiAgentRunRecord) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除运行记录 ${String(record.id).slice(0, 8)}... 吗？此操作不可撤销。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => deleteAiRun(record.id).then(() => {
        message.success("删除成功");
        setRuns((prev) => prev.filter((r) => r.id !== record.id));
      }),
    });
  };
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
    { title: "开始时间", dataIndex: "startedAt", render: formatDateTime, sorter: (a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""), defaultSortOrder: "descend" },
    {
      title: "操作", key: "action", render: (_: unknown, record: AiAgentRunRecord) => (
        <Button type="link" danger size="small" onClick={(e) => { e.stopPropagation(); handleDelete(record); }}>删除</Button>
      )
    }
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
