import { Button, Input, Space, Table, message } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAiModel, listAiAgents, listAiModels } from "../../ai/api";
import { AiCapabilityTag } from "../../../components/ai/AiTags";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import type { AiAgentProfile, AiModelProfile } from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

export function AiModelProfileListPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextModels, nextAgents] = await Promise.all([listAiModels(), listAiAgents()]);
      setModels(nextModels);
      setAgents(nextAgents);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载模型 Profile 失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const filteredModels = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter((item) =>
      [item.id, item.name, item.modelProvider, item.modelName, item.baseUrl ?? "", item.apiKeyConfigKey ?? ""]
        .some((field) => field.toLowerCase().includes(keyword))
    );
  }, [models, searchText]);

  const referencingAgents = (modelId: string) => agents.filter((agent) => agent.modelProfileId === modelId);

  const handleDelete = async (model: AiModelProfile) => {
    setDeletingId(model.id);
    try {
      await deleteAiModel(model.id);
      setModels((previous) => previous.filter((item) => item.id !== model.id));
      messageApi.success("模型 Profile 已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除模型 Profile 失败"));
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ColumnsType<AiModelProfile> = [
    { title: "ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/models/${id}`}>{id}</TableLinkCell> },
    { title: "名称", dataIndex: "name" },
    { title: "能力", dataIndex: "capabilities", render: (items) => <Space size={[4, 4]} wrap>{items?.map((item: AiModelProfile["capabilities"][number]) => <AiCapabilityTag key={item} capability={item} />)}</Space> },
    { title: "引用 Agent", render: (_, item) => referencingAgents(item.id).length },
    {
      title: "操作",
      fixed: "right",
      render: (_, item) => {
        const refs = referencingAgents(item.id);
        return (
          <ConfirmDangerAction
            title="确认删除这个模型 Profile？"
            description={refs.length > 0 ? `当前被 ${refs.length} 个 Agent 引用，后端会拒绝删除。` : "删除后不可恢复。"}
            onConfirm={() => handleDelete(item)}
            disabled={refs.length > 0}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === item.id} disabled={refs.length > 0}>
              删除
            </Button>
          </ConfirmDangerAction>
        );
      }
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="模型 Profile"
        meta="统一管理模型供应商、能力和运行限制"
        onBack={() => navigate("/ai")}
        actions={(
          <>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/ai/models/new")}>新建</Button>
          </>
        )}
      />
      <Input.Search
        allowClear
        placeholder="搜索 ID、名称、供应商、模型名、Base URL 或 API Key 配置项"
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
      />
      <Table<AiModelProfile>
        rowKey="id"
        loading={loading}
        dataSource={filteredModels}
        columns={columns}
        scroll={{ x: 1200 }}
      />
    </Space>
  );
}
