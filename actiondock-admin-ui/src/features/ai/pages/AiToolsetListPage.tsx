import { Button, Input, Space, Table, Tag, message } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAiToolset, listAiAgents, listAiToolsets } from "../../ai/api";
import { AiToolPermissionTag } from "../../../components/ai/AiTags";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import type { AiAgentProfile, AiToolset } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

export function AiToolsetListPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextToolsets, nextAgents] = await Promise.all([listAiToolsets(), listAiAgents()]);
      setToolsets(nextToolsets);
      setAgents(nextAgents);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载工具集失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const filteredToolsets = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return toolsets;
    return toolsets.filter((item) =>
      [item.id, item.name, item.description ?? "", item.maxPermission, ...item.toolNames, JSON.stringify(item.toolOptions ?? {})]
        .some((field) => field.toLowerCase().includes(keyword))
    );
  }, [toolsets, searchText]);

  const referencingAgents = (toolsetId: string) => agents.filter((agent) => (agent.toolsetIds ?? []).includes(toolsetId));

  const handleDelete = async (toolset: AiToolset) => {
    setDeletingId(toolset.id);
    try {
      await deleteAiToolset(toolset.id);
      setToolsets((previous) => previous.filter((item) => item.id !== toolset.id));
      messageApi.success("工具集已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除工具集失败"));
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ColumnsType<AiToolset> = [
    { title: "ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/toolsets/${id}`}>{id}</TableLinkCell> },
    { title: "名称", dataIndex: "name" },
    { title: "工具数量", dataIndex: "toolNames", render: (items) => items?.length ?? 0 },
    { title: "已配置", dataIndex: "toolOptions", render: (options) => Object.keys(options ?? {}).length },
    { title: "权限上限", dataIndex: "maxPermission", render: (permission) => <AiToolPermissionTag permission={permission} /> },
    { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
    { title: "引用 Agent", render: (_, item) => referencingAgents(item.id).length },
    { title: "更新时间", dataIndex: "updatedAt", render: formatDateTime },
    {
      title: "操作",
      fixed: "right",
      render: (_, item) => {
        const refs = referencingAgents(item.id);
        return (
          <Space>
            <Button size="small" onClick={() => navigate(`/ai/toolsets/${item.id}`)}>编辑</Button>
            <ConfirmDangerAction
              title="确认删除这个工具集？"
              description={refs.length > 0 ? `当前被 ${refs.length} 个 Agent 引用，后端会拒绝删除。` : "删除后不可恢复。"}
              onConfirm={() => handleDelete(item)}
              disabled={refs.length > 0}
            >
              <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === item.id} disabled={refs.length > 0}>
                删除
              </Button>
            </ConfirmDangerAction>
          </Space>
        );
      }
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="工具集"
        meta="Agent 可用工具的分组和权限上限"
        onBack={() => navigate("/ai")}
        actions={(
          <>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/ai/toolsets/new")}>新建</Button>
          </>
        )}
      />
      <Input.Search
        allowClear
        placeholder="搜索 ID、名称、说明、权限或工具名"
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
      />
      <Table<AiToolset>
        rowKey="id"
        loading={loading}
        dataSource={filteredToolsets}
        columns={columns}
        scroll={{ x: 1100 }}
      />
    </Space>
  );
}
