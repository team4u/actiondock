import { Button, Input, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAiAgent, listAiAgents, listAiModels, listAiTools, listAiToolsets } from "../../ai/api";
import { getAgentToolSummary } from "../../../services/aiAgentTools";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import type { AiAgentProfile, AiModelProfile, AiTool, AiToolset } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

export function AiAgentProfileListPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextAgents, nextModels, nextToolsets, nextTools] = await Promise.all([listAiAgents(), listAiModels(), listAiToolsets(), listAiTools()]);
      setAgents(nextAgents);
      setModels(nextModels);
      setToolsets(nextToolsets);
      setTools(nextTools);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Agent Profile 失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const filteredAgents = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return agents;
    return agents.filter((item) =>
      [item.id, item.name, item.description ?? "", item.modelProfileId, item.systemPrompt ?? "", ...(item.toolsetIds ?? []), ...(item.directToolNames ?? [])]
        .concat(item.skillIds ?? [])
        .some((field) => field.toLowerCase().includes(keyword))
    );
  }, [agents, searchText]);

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);

  const handleDelete = async (agent: AiAgentProfile) => {
    setDeletingId(agent.id);
    try {
      await deleteAiAgent(agent.id);
      setAgents((previous) => previous.filter((item) => item.id !== agent.id));
      messageApi.success("Agent Profile 已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除 Agent Profile 失败"));
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ColumnsType<AiAgentProfile> = [
    { title: "ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/agents/${id}`}>{id}</TableLinkCell> },
    { title: "名称", dataIndex: "name" },
    {
      title: "说明",
      dataIndex: "description",
      render: (value) => value ? (
        <Typography.Paragraph ellipsis={{ rows: 2, tooltip: value }} style={{ marginBottom: 0, maxWidth: 280 }}>
          {value}
        </Typography.Paragraph>
      ) : <Typography.Text type="secondary">-</Typography.Text>
    },
    {
      title: "模型 Profile",
      dataIndex: "modelProfileId",
      render: (value) => modelById.has(value)
        ? <TableLinkCell to={`/ai/models/${value}`}>{value}</TableLinkCell>
        : <Typography.Text type="danger">{value}（缺失）</Typography.Text>
    },
    {
      title: "工具",
      render: (_, item) => {
        const summary = getAgentToolSummary(item, toolsets, tools);
        return (
          <Space size={[4, 4]} wrap>
            {(item.toolsetIds ?? []).map((toolsetId) => <Tag key={`${item.id}-${toolsetId}`}>{toolsetId}</Tag>)}
            {(item.directToolNames ?? []).length > 0 ? <Tag color="blue">{item.directToolNames.length} 个直接工具</Tag> : null}
            {(item.skillIds ?? []).length > 0 ? <Tag color="cyan">{item.skillIds.length} 个 Skill</Tag> : null}
            {summary.mergedToolCount > 0 ? <Tag color="green">{summary.mergedToolCount} 个自动合并</Tag> : null}
            {summary.conflicts.length > 0 ? <Tag color="red">{summary.conflicts.length} 个冲突</Tag> : null}
          </Space>
        );
      }
    },
    { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
    { title: "更新时间", dataIndex: "updatedAt", render: formatDateTime },
    {
      title: "操作",
      fixed: "right",
      render: (_, item) => (
        <ConfirmDangerAction
          title="确认删除这个 Agent Profile？"
          description="删除后不可恢复，历史 Run 记录会保留。"
          onConfirm={() => handleDelete(item)}
        >
          <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === item.id}>
            删除
          </Button>
        </ConfirmDangerAction>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="Agent Profile"
        meta="统一管理 Agent 的模型、工具集、直接工具和策略"
        onBack={() => navigate("/ai")}
        actions={(
          <>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/ai/agents/new")}>新建</Button>
          </>
        )}
      />
      <Input.Search
        allowClear
        placeholder="搜索 ID、名称、说明、模型 Profile、工具引用或 System Prompt"
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
      />
      <Table<AiAgentProfile>
        rowKey="id"
        loading={loading}
        dataSource={filteredAgents}
        columns={columns}
        scroll={{ x: 1000 }}
      />
    </Space>
  );
}
