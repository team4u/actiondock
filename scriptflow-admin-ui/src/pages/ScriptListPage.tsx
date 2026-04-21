import { Button, Card, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, listScripts } from "../api";
import { formatDateTime } from "../utils";
import type { ScriptDefinition } from "../types";

const { Text } = Typography;

export function ScriptListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  const loadScripts = async () => {
    setLoading(true);
    try {
      const data = await listScripts();
      setScripts(
        [...data].sort((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
        )
      );
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载脚本失败";
      messageApi.error(detail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadScripts();
  }, []);

  const columns: ColumnsType<ScriptDefinition> = [
    {
      title: "脚本 ID",
      dataIndex: "id",
      key: "id",
      render: (value: string) => (
        <Button type="link" onClick={() => navigate(`/scripts/${value}`)} style={{ padding: 0 }}>
          {value}
        </Button>
      )
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name"
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 120
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: ScriptDefinition["status"]) => (
        <Tag color={status === "PUBLISHED" ? "green" : "gold"}>{status}</Tag>
      )
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 100
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    }
  ];

  return (
    <>
      {contextHolder}
      <Card
        title="脚本列表"
        extra={<Text type="secondary">共 {scripts.length} 个脚本</Text>}
      >
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={scripts}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </>
  );
}
