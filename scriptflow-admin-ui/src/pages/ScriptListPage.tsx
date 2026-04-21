import { CheckCircleOutlined, EditOutlined, RocketOutlined } from "@ant-design/icons";
import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, listScripts, publishScript, validateScript } from "../api";
import { formatDateTime } from "../utils";
import type { ScriptDefinition } from "../types";

const { Text } = Typography;

export function ScriptListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const [actionKey, setActionKey] = useState<string>("");

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

  const runValidate = async (id: string) => {
    setActionKey(`validate:${id}`);
    try {
      await validateScript(id);
      messageApi.success("校验通过");
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "校验失败";
      messageApi.error(detail);
    } finally {
      setActionKey("");
    }
  };

  const runPublish = async (id: string) => {
    setActionKey(`publish:${id}`);
    try {
      await publishScript(id);
      messageApi.success("发布成功");
      await loadScripts();
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "发布失败";
      messageApi.error(detail);
    } finally {
      setActionKey("");
    }
  };

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
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/scripts/${record.id}`)}>
            编辑
          </Button>
          <Button
            icon={<CheckCircleOutlined />}
            loading={actionKey === `validate:${record.id}`}
            onClick={() => void runValidate(record.id)}
          >
            校验
          </Button>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            loading={actionKey === `publish:${record.id}`}
            onClick={() => void runPublish(record.id)}
          >
            发布
          </Button>
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Card
        title="脚本列表"
        extra={
          <Space>
            <Text type="secondary">共 {scripts.length} 个脚本</Text>
            <Button type="primary">
              <Link to="/scripts/new">新建脚本</Link>
            </Button>
          </Space>
        }
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
