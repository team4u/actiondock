import { Button, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAiAgents } from "../../api";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import type { AiAgentProfile } from "../../types";
import { formatDateTime } from "../../utils";

export function AiAgentProfileListPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  useEffect(() => { void listAiAgents().then(setAgents); }, []);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader title="Agent Profile" meta="统一管理 Agent 的模型、工具集和策略" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/ai/agents/new")}>新建</Button>} />
      <Table<AiAgentProfile>
        rowKey="id"
        dataSource={agents}
        columns={[
          { title: "ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/agents/${id}`}>{id}</TableLinkCell> },
          { title: "名称", dataIndex: "name" },
          { title: "模型 Profile", dataIndex: "modelProfileId" },
          { title: "工具集", dataIndex: "toolsetIds", render: (items) => <Space size={[4, 4]} wrap>{items?.map((item: string) => <Tag key={item}>{item}</Tag>)}</Space> },
          { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
          { title: "更新时间", dataIndex: "updatedAt", render: formatDateTime }
        ]}
      />
    </Space>
  );
}
