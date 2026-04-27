import { Button, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAiModels } from "../../api";
import { AiCapabilityTag } from "../../components/ai/AiTags";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import type { AiModelProfile } from "../../types";
import { formatDateTime } from "../../utils";

export function AiModelProfileListPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<AiModelProfile[]>([]);
  useEffect(() => { void listAiModels().then(setModels); }, []);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader title="模型 Profile" meta="统一管理模型供应商、能力和运行限制" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/ai/models/new")}>新建</Button>} />
      <Table<AiModelProfile>
        rowKey="id"
        dataSource={models}
        columns={[
          { title: "ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/models/${id}`}>{id}</TableLinkCell> },
          { title: "名称", dataIndex: "name" },
          { title: "模型供应商", dataIndex: "modelProvider" },
          { title: "模型名", dataIndex: "modelName", render: (value) => <Typography.Text code>{value}</Typography.Text> },
          { title: "能力", dataIndex: "capabilities", render: (items) => <Space size={[4, 4]} wrap>{items?.map((item: AiModelProfile["capabilities"][number]) => <AiCapabilityTag key={item} capability={item} />)}</Space> },
          { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
          { title: "更新时间", dataIndex: "updatedAt", render: formatDateTime }
        ]}
      />
    </Space>
  );
}
