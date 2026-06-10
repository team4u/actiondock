import { Alert, Button, Card, Row, Space, Statistic, Table, Tag, Typography, message } from "antd";
import {
  ApiOutlined,
  FunctionOutlined,
  PlusOutlined,
  RobotOutlined
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { listAiAgents, listAiModels, listAiRuns, listAiTools, listAiToolsets } from "../../ai/api";
import { getAgentToolSummary } from "../../../services/aiAgentTools";
import { Col } from "../../../components/common/SafeCol";
import { PageHeader } from "../../../components/common/PageHeader";
import { AiRunStatusTag } from "../../../components/ai/AiTags";
import type { AiAgentProfile, AiAgentRunRecord, AiModelProfile, AiTool, AiToolset } from "../../../shared/types";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

const { Text, Title } = Typography;

interface ManagementCardProps {
  title: string;
  value: number;
  meta: string;
  icon: ReactNode;
  onManage: () => void;
  onCreate?: () => void;
  warning?: string;
}

export function AiManagementCard({ title, value, meta, icon, onManage, onCreate, warning }: ManagementCardProps) {
  return (
    <Card className="ai-management-card">
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
          <Space align="start">
            <div className="ai-management-card__icon">{icon}</div>
            <Space direction="vertical" size={0}>
              <Title level={5} style={{ margin: 0 }}>{title}</Title>
              <Text type="secondary">{meta}</Text>
            </Space>
          </Space>
          <Statistic value={value} />
        </Space>
        {warning ? <Alert type="warning" showIcon message={warning} /> : null}
        <Space wrap>
          <Button type="primary" onClick={onManage}>管理</Button>
          {onCreate ? <Button icon={<PlusOutlined />} onClick={onCreate}>新建</Button> : null}
        </Space>
      </Space>
    </Card>
  );
}

export function AiOverviewPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [runs, setRuns] = useState<AiAgentRunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([listAiModels(), listAiAgents(), listAiToolsets(), listAiTools(), listAiRuns()])
      .then(([nextModels, nextAgents, nextToolsets, nextTools, nextRuns]) => {
        setModels(nextModels);
        setAgents(nextAgents);
        setToolsets(nextToolsets);
        setTools(nextTools);
        setRuns(nextRuns);
      })
      .catch((error) => messageApi.error(getErrorMessage(error, "加载 AI 能力概览失败")))
      .finally(() => setLoading(false));
  }, [messageApi]);

  const enabledModels = models.filter((item) => item.enabled);
  const enabledAgents = agents.filter((item) => item.enabled);
  const enabledToolsets = toolsets.filter((item) => item.enabled);
  const modelIds = useMemo(() => new Set(models.map((model) => model.id)), [models]);
  const toolsetIds = useMemo(() => new Set(toolsets.map((toolset) => toolset.id)), [toolsets]);
  const missingModelAgents = agents.filter((agent) => !modelIds.has(agent.modelProfileId));
  const invalidToolAgents = agents.filter((agent) => {
    const summary = getAgentToolSummary(agent, toolsets, tools);
    return (agent.toolsetIds ?? []).some((toolsetId) => !toolsetIds.has(toolsetId))
      || summary.missingToolNames.length > 0
      || summary.conflicts.length > 0;
  });
  const modelsMissingApiKey = models.filter((model) => model.enabled && model.modelProvider !== "OLLAMA" && !model.apiKeyConfigKey);
  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).slice(0, 8),
    [runs]
  );
  const runColumns: ColumnsType<AiAgentRunRecord> = [
    { title: "Run ID", dataIndex: "id", render: (id) => <TableLinkCell to={`/ai/runs/${id}`}>{String(id).slice(0, 8)}</TableLinkCell> },
    { title: "Agent", dataIndex: "agentProfile" },
    { title: "状态", dataIndex: "status", render: (status) => <AiRunStatusTag status={status} /> },
    { title: "调用方", dataIndex: "callerType", render: (value) => value ? <Tag>{value}</Tag> : "-" },
    { title: "开始时间", dataIndex: "startedAt", render: formatDateTime }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="AI 能力"
        meta="模型 Profile、Agent Profile、工具目录、工具集和运行记录"
      />
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12} xl={6}>
          <AiManagementCard
            title="模型管理"
            value={enabledModels.length}
            meta={`${models.length} 个模型 Profile`}
            icon={<ApiOutlined />}
            warning={modelsMissingApiKey.length > 0 ? `${modelsMissingApiKey.length} 个启用模型未引用 API Key 配置值` : undefined}
            onManage={() => navigate("/ai/models")}
            onCreate={() => navigate("/ai/models/new")}
          />
        </Col>
        <Col xs={24} lg={12} xl={6}>
          <AiManagementCard
            title="Agent 管理"
            value={enabledAgents.length}
            meta={`${agents.length} 个 Agent Profile`}
            icon={<RobotOutlined />}
            warning={missingModelAgents.length > 0 ? `${missingModelAgents.length} 个 Agent 引用缺失模型` : undefined}
            onManage={() => navigate("/ai/agents")}
            onCreate={() => navigate("/ai/agents/new")}
          />
        </Col>
        <Col xs={24} lg={12} xl={6}>
          <AiManagementCard
            title="工具集管理"
            value={enabledToolsets.length}
            meta={`${tools.length} 个注册工具`}
            icon={<FunctionOutlined />}
            warning={invalidToolAgents.length > 0 ? `${invalidToolAgents.length} 个 Agent 存在工具引用异常` : undefined}
            onManage={() => navigate("/ai/toolsets")}
            onCreate={() => navigate("/ai/toolsets/new")}
          />
        </Col>
      </Row>
      <Card
        title="最近 Agent Run"
        loading={loading}
        extra={<Button size="small" onClick={() => navigate("/ai/runs")}>查看全部</Button>}
      >
        <Table<AiAgentRunRecord>
          rowKey="id"
          size="small"
          dataSource={recentRuns}
          pagination={false}
          columns={runColumns}
          scroll={{ x: 900 }}
        />
      </Card>
    </Space>
  );
}
