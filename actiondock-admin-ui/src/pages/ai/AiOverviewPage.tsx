import { Card, Col, Row, Space, Statistic, Table, Typography } from "antd";
import { useEffect, useState } from "react";
import { listAiAgents, listAiModels, listAiRuns, listAiTools } from "../../api";
import { PageHeader } from "../../components/PageHeader";
import { AiRunStatusTag } from "../../components/ai/AiTags";
import type { AiAgentProfile, AiAgentRunRecord, AiModelProfile, AiTool } from "../../types";
import { formatDateTime } from "../../utils";

export function AiOverviewPage() {
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [runs, setRuns] = useState<AiAgentRunRecord[]>([]);

  useEffect(() => {
    void Promise.all([listAiModels(), listAiAgents(), listAiTools(), listAiRuns()]).then(([nextModels, nextAgents, nextTools, nextRuns]) => {
      setModels(nextModels);
      setAgents(nextAgents);
      setTools(nextTools);
      setRuns(nextRuns);
    });
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader title="AI 能力" meta="模型 Profile、Agent Profile、工具集和运行记录" />
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card><Statistic title="启用模型" value={models.filter((item) => item.enabled).length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="启用 Agent" value={agents.filter((item) => item.enabled).length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="注册工具" value={tools.length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Agent Run" value={runs.length} /></Card></Col>
      </Row>
      <Card title="最近 Agent Run">
        <Table<AiAgentRunRecord>
          rowKey="id"
          size="small"
          dataSource={runs.slice(0, 8)}
          pagination={false}
          columns={[
            { title: "Run ID", dataIndex: "id", render: (value) => <Typography.Text code>{String(value).slice(0, 8)}</Typography.Text> },
            { title: "Agent", dataIndex: "agentProfile" },
            { title: "状态", dataIndex: "status", render: (status) => <AiRunStatusTag status={status} /> },
            { title: "开始时间", dataIndex: "startedAt", render: formatDateTime }
          ]}
        />
      </Card>
    </Space>
  );
}
