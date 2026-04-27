import { Button, Card, Descriptions, Space, Timeline, Typography, message } from "antd";
import { StopOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, cancelAiRun, getAiRun, resumeAiRun } from "../../api";
import { AiRunStatusTag, AiToolPermissionTag } from "../../components/ai/AiTags";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import type { AiAgentRunSnapshot } from "../../types";
import { formatDateTime } from "../../utils";

export function AiRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<AiAgentRunSnapshot | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [actionLoading, setActionLoading] = useState<"cancel" | "resume" | null>(null);
  const loadRun = async () => {
    if (runId) setRun(await getAiRun(runId));
  };
  useEffect(() => { void loadRun(); }, [runId]);
  const handleCancel = async () => {
    if (!runId) return;
    setActionLoading("cancel");
    try {
      await cancelAiRun(runId);
      await loadRun();
      messageApi.success("Run 已取消");
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : "取消 Run 失败");
    } finally {
      setActionLoading(null);
    }
  };
  const handleResume = async () => {
    if (!runId) return;
    setActionLoading("resume");
    try {
      await resumeAiRun(runId);
      await loadRun();
      messageApi.success("恢复请求已提交");
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : "恢复 Run 失败");
    } finally {
      setActionLoading(null);
    }
  };
  if (!run) {
    return <>{contextHolder}<PageHeader title="Agent Run" meta="加载中" /></>;
  }
  const canCancel = run.status === "RUNNING" || run.status === "WAITING_APPROVAL";
  const canResume = run.status === "WAITING_APPROVAL" || run.status === "INTERRUPTED";
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="Agent Run"
        meta={run.id}
        actions={
          <>
            <Button icon={<ReloadOutlined />} disabled={!canResume} loading={actionLoading === "resume"} onClick={() => void handleResume()}>恢复</Button>
            <Button danger icon={<StopOutlined />} disabled={!canCancel} loading={actionLoading === "cancel"} onClick={() => void handleCancel()}>取消</Button>
          </>
        }
      />
      <Card>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="状态"><AiRunStatusTag status={run.status} /></Descriptions.Item>
          <Descriptions.Item label="Agent">{run.agentProfile}</Descriptions.Item>
          <Descriptions.Item label="调用方">{run.callerType || "-"}</Descriptions.Item>
          <Descriptions.Item label="脚本">{run.scriptId || "-"}</Descriptions.Item>
          <Descriptions.Item label="执行">{run.executionId || "-"}</Descriptions.Item>
          <Descriptions.Item label="tokens">{run.totalTokens ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="开始">{formatDateTime(run.startedAt)}</Descriptions.Item>
          <Descriptions.Item label="结束">{formatDateTime(run.finishedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Step Trace">
        <Timeline
          items={run.steps.map((step) => ({
            children: (
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Space wrap>
                  <Typography.Text strong>{step.stepIndex}. {step.stepType}</Typography.Text>
                  {step.toolName ? <Typography.Text code>{step.toolName}</Typography.Text> : null}
                  {step.toolPermission ? <AiToolPermissionTag permission={step.toolPermission} /> : null}
                </Space>
                {step.errorMessage ? <Typography.Text type="danger">{step.errorMessage}</Typography.Text> : null}
                {step.toolInput ? <JsonPreview title="工具输入" value={step.toolInput} emptyDescription="无工具输入" /> : null}
                {step.toolOutput ? <JsonPreview title="工具输出" value={step.toolOutput} emptyDescription="无工具输出" /> : null}
              </Space>
            )
          }))}
        />
      </Card>
      <Card title="输出摘要">
        <JsonPreview title="Output" value={run.outputSummary} emptyDescription="无输出" />
      </Card>
      <Card title="Raw JSON">
        <JsonPreview title="Run JSON" value={run as unknown as Record<string, unknown>} emptyDescription="无数据" />
      </Card>
    </Space>
  );
}
