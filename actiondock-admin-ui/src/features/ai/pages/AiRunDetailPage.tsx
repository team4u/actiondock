import { Button, Card, Descriptions, Space, Typography, message } from "antd";
import { StopOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelAiRun, getAiRun, resumeAiRun } from "../../ai/api";
import { ApiError } from "../../../shared/api/httpClient";
import { AiRunStatusTag } from "../../../components/ai/AiTags";
import { AiStepTracePanel } from "../../../components/ai/AiStepTracePanel";
import { JsonPreview } from "../../../components/common/JsonPreview";
import { PageHeader } from "../../../components/common/PageHeader";
import type { AiAgentRunSnapshot } from "../../../shared/types";
import { formatDateTime } from "../../../services/utils";

export function AiRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<AiAgentRunSnapshot | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [actionLoading, setActionLoading] = useState<"cancel" | "resume" | null>(null);
  const loadRun = async () => {
    if (!runId) return null;
    const next = await getAiRun(runId);
    setRun(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      if (!runId) return;
      try {
        const next = await getAiRun(runId);
        if (!active) return;
        setRun(next);
        if (next.status === "RUNNING" || next.status === "WAITING_APPROVAL") {
          timer = window.setTimeout(() => void poll(), 1500);
        }
      } catch (error) {
        if (active) {
          messageApi.error(error instanceof ApiError ? error.message : "加载 Run 失败");
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [messageApi, runId]);
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
  const outputText = typeof run.outputSummary?.text === "string" ? run.outputSummary.text as string : "";
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="Agent Run"
        meta={run.id}
        onBack={() => navigate("/ai/runs")}
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
        <AiStepTracePanel steps={run.steps} />
      </Card>
      <Card title="输出摘要">
        {outputText ? (
          <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: "展开" }} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {outputText}
          </Typography.Paragraph>
        ) : (
          <JsonPreview title="Output" value={run.outputSummary} emptyDescription="无输出" />
        )}
      </Card>
    </Space>
  );
}
