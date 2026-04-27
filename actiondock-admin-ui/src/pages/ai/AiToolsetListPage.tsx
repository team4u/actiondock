import { Button, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAiToolsets } from "../../api";
import { AiToolPermissionTag } from "../../components/ai/AiTags";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import type { AiToolset } from "../../types";
import { formatDateTime } from "../../utils";

export function AiToolsetListPage() {
  const navigate = useNavigate();
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  useEffect(() => { void listAiToolsets().then(setToolsets); }, []);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader title="工具集" meta="Agent 可用工具的分组和权限上限" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/ai/toolsets/new")}>新建</Button>} />
      <Table<AiToolset>
        rowKey="id"
        dataSource={toolsets}
        columns={[
          { title: "ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/toolsets/${id}`}>{id}</TableLinkCell> },
          { title: "名称", dataIndex: "name" },
          { title: "工具数量", dataIndex: "toolNames", render: (items) => items?.length ?? 0 },
          { title: "权限上限", dataIndex: "maxPermission", render: (permission) => <AiToolPermissionTag permission={permission} /> },
          { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
          { title: "更新时间", dataIndex: "updatedAt", render: formatDateTime }
        ]}
      />
    </Space>
  );
}
