import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { CopyOutlined, ExperimentOutlined, ImportOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  diagnoseWorkbenchExecution,
  generateWorkbenchReleaseNotes,
  generateWorkbenchScript,
  improveWorkbenchSchema,
  improveWorkbenchScript,
  listAiAgents,
  listExecutions,
  listScripts,
  reviewWorkbenchPublish
} from "../../api";
import {
  WORKBENCH_TASKS,
  buildGeneratedScriptImportText,
  normalizeWorkbenchTask,
  workbenchResultCopyText,
  type WorkbenchTaskKey
} from "../../aiWorkbench";
import { CodeEditor } from "../../components/CodeEditor";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import { useColorMode } from "../../contexts/ColorModeContext";
import type { AiAgentProfile, AiWorkbenchCommand, AiWorkbenchResult, ExecutionRecord, ScriptDefinition } from "../../types";
import { copyText, prettyJson } from "../../utils";

const { Text, Title } = Typography;

interface WorkbenchFormValues {
  scriptId?: string;
  executionId?: string;
  agentProfile?: string;
  objective?: string;
  instructions?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function fieldText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  return typeof value === "string" ? value : prettyJson(value as Record<string, unknown>);
}

export function AiWorkbenchResultPanel({
  taskKey,
  result,
  editorTheme,
  onImportGenerated
}: {
  taskKey: WorkbenchTaskKey;
  result: AiWorkbenchResult;
  editorTheme: "vs-light" | "vs-dark";
  onImportGenerated: () => void;
}) {
  const payload = result.result;
  if (Object.keys(payload).length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无结构化结果" />;
  }
  if (taskKey === "generate") {
    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap>
          <Text strong>{String(payload.name ?? payload.id ?? "脚本草稿")}</Text>
          {payload.id ? <Text code>{String(payload.id)}</Text> : null}
        </Space>
        <CodeEditor value={String(payload.source ?? "")} language="groovy" theme={editorTheme} height="240px" onChange={() => undefined} readOnly />
        <JsonPreview title="inputSchema" value={asRecord(payload.inputSchema)} emptyDescription="无输入 Schema" />
        <JsonPreview title="outputSchema" value={asRecord(payload.outputSchema)} emptyDescription="无输出 Schema" />
        <Button icon={<ImportOutlined />} disabled={result.status !== "SUCCESS"} onClick={onImportGenerated}>导入生成脚本</Button>
      </Space>
    );
  }
  if (taskKey === "schema") {
    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <JsonPreview title="inputSchemaPatch" value={asRecord(payload.inputSchemaPatch)} emptyDescription="无输入 Schema patch" />
        <JsonPreview title="outputSchemaPatch" value={asRecord(payload.outputSchemaPatch)} emptyDescription="无输出 Schema patch" />
        <Text>{fieldText(payload.rationale)}</Text>
      </Space>
    );
  }
  if (taskKey === "diagnose") {
    return (
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <Title level={5} style={{ margin: 0 }}>{fieldText(payload.rootCause ?? payload.suggestion)}</Title>
        <Text>{fieldText(payload.suggestedFix ?? payload.rationale)}</Text>
        {payload.risk ? <Alert type="warning" showIcon message={fieldText(payload.risk)} /> : null}
        <List size="small" header="Evidence" dataSource={asList(payload.evidence)} renderItem={(item) => <List.Item>{item}</List.Item>} />
        <List size="small" header="Next Steps" dataSource={asList(payload.nextSteps)} renderItem={(item) => <List.Item>{item}</List.Item>} />
      </Space>
    );
  }
  if (taskKey === "review") {
    return (
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <Space wrap>
          {payload.riskLevel ? <Tag color={String(payload.riskLevel).toLowerCase().includes("high") ? "red" : "gold"}>{String(payload.riskLevel)}</Tag> : null}
          <Text strong>{fieldText(payload.recommendation)}</Text>
        </Space>
        <Text>{fieldText(payload.summary)}</Text>
        <List size="small" header="Findings" dataSource={asList(payload.findings)} renderItem={(item) => <List.Item>{item}</List.Item>} />
      </Space>
    );
  }
  if (taskKey === "releaseNotes") {
    return <pre className="json-preview">{String(payload.notes ?? prettyJson(payload))}</pre>;
  }
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <pre className="json-preview">{fieldText(payload.patch ?? payload.suggestion ?? payload)}</pre>
      {payload.rationale ? <Text>{fieldText(payload.rationale)}</Text> : null}
    </Space>
  );
}

export function AiWorkbenchPage() {
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<WorkbenchFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [result, setResult] = useState<AiWorkbenchResult | null>(null);
  const [running, setRunning] = useState(false);

  const activeTaskKey = normalizeWorkbenchTask(searchParams.get("task"));
  const activeTask = WORKBENCH_TASKS.find((task) => task.key === activeTaskKey) ?? WORKBENCH_TASKS[0];
  const selectedScriptId = Form.useWatch("scriptId", form);

  useEffect(() => {
    void Promise.all([listScripts(), listAiAgents()]).then(([nextScripts, nextAgents]) => {
      setScripts(nextScripts);
      setAgents(nextAgents);
    }).catch(() => messageApi.error("加载 Workbench 上下文失败"));
  }, [messageApi]);

  useEffect(() => {
    if (selectedScriptId) {
      void listExecutions(selectedScriptId).then(setExecutions).catch(() => setExecutions([]));
    }
  }, [selectedScriptId]);

  useEffect(() => {
    form.setFieldsValue({
      scriptId: searchParams.get("scriptId") || undefined,
      executionId: searchParams.get("executionId") || undefined,
      objective: searchParams.get("objective") || undefined
    });
  }, [form, searchParams]);

  const scriptOptions = useMemo(
    () => scripts.map((script) => ({ value: script.id, label: `${script.name || script.id} (${script.id})` })),
    [scripts]
  );
  const executionOptions = useMemo(
    () => executions.map((execution) => ({ value: execution.id, label: `${execution.status} ${execution.id.slice(0, 8)}` })),
    [executions]
  );
  const agentOptions = useMemo(
    () => agents.map((agent) => ({ value: agent.id, label: `${agent.name || agent.id} (${agent.id})` })),
    [agents]
  );

  const switchTask = (key: WorkbenchTaskKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("task", key);
    setSearchParams(next);
    setResult(null);
  };

  const buildPayload = (values: WorkbenchFormValues): AiWorkbenchCommand => ({
    objective: values.objective,
    instructions: values.instructions,
    agentProfile: values.agentProfile,
    scriptId: values.scriptId,
    executionId: values.executionId,
    context: {}
  });

  const runTask = async () => {
    setRunning(true);
    setResult(null);
    try {
      const values = await form.validateFields();
      const payload = buildPayload(values);
      const response =
        activeTask.key === "generate"
          ? await generateWorkbenchScript(payload)
          : activeTask.key === "improve"
            ? await improveWorkbenchScript(payload)
            : activeTask.key === "schema"
              ? await improveWorkbenchSchema(payload)
              : activeTask.key === "diagnose"
                ? await diagnoseWorkbenchExecution(values.executionId || "", payload)
                : activeTask.key === "review"
                  ? await reviewWorkbenchPublish(values.scriptId || "", payload)
                  : await generateWorkbenchReleaseNotes(values.scriptId || "", payload);
      setResult(response);
      if (response.status === "FAILED") {
        messageApi.warning(response.errorMessage || "Agent 输出未通过结构化校验");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Workbench 任务失败");
    } finally {
      setRunning(false);
    }
  };

  const openGeneratedImport = () => {
    if (!result) return;
    sessionStorage.setItem("actiondock.workbench.generatedScript", buildGeneratedScriptImportText(result.result));
    navigate("/scripts/new?importGenerated=1");
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="AI Workbench"
        meta="任务型脚本开发工作台，只生成草稿和提案"
        actions={<Button icon={<ExperimentOutlined />} onClick={() => navigate("/ai/runs")}>Agent Run</Button>}
      />
      <div className="ai-workbench-layout">
        <Card className="ai-workbench-nav" bodyStyle={{ padding: 8 }}>
          <List
            dataSource={WORKBENCH_TASKS}
            renderItem={(task) => (
              <List.Item
                className={task.key === activeTask.key ? "ai-workbench-nav__item ai-workbench-nav__item--active" : "ai-workbench-nav__item"}
                onClick={() => switchTask(task.key)}
              >
                <Space direction="vertical" size={2}>
                  <Text strong>{task.title}</Text>
                  <Text type="secondary">{task.description}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>

        <Card className="ai-workbench-form">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <div>
              <Title level={5} style={{ margin: 0 }}>{activeTask.title}</Title>
              <Text type="secondary">{activeTask.description}</Text>
            </div>
            <Form form={form} layout="vertical">
              {activeTask.needsScript || activeTask.key !== "generate" ? (
                <Form.Item name="scriptId" label="脚本" rules={activeTask.needsScript ? [{ required: true, message: "请选择脚本" }] : undefined}>
                  <Select allowClear showSearch options={scriptOptions} optionFilterProp="label" />
                </Form.Item>
              ) : null}
              {activeTask.needsExecution ? (
                <Form.Item name="executionId" label="执行记录" rules={[{ required: true, message: "请选择执行记录" }]}>
                  <Select allowClear showSearch options={executionOptions} optionFilterProp="label" />
                </Form.Item>
              ) : null}
              <Form.Item name="agentProfile" label="Agent Profile">
                <Select allowClear showSearch options={agentOptions} optionFilterProp="label" placeholder="使用 Workbench 默认 Agent" />
              </Form.Item>
              <Form.Item name="objective" label="目标" rules={[{ required: activeTask.key === "generate", message: "请填写目标" }]}>
                <Input.TextArea rows={4} placeholder="说明要生成、修复、诊断或审查的目标" />
              </Form.Item>
              <Form.Item name="instructions" label="补充说明">
                <Input.TextArea rows={5} placeholder="约束、边界条件、期望输出风格或已知问题" />
              </Form.Item>
            </Form>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => void runTask()}>
              运行任务
            </Button>
          </Space>
        </Card>

        <Card className="ai-workbench-result">
          {!result ? (
            <Alert type="info" showIcon message="暂无结果" description="运行任务后，这里会显示结构化提案、Agent Run 链接和原始输出。" />
          ) : (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Space wrap>
                <Tag color={result.status === "SUCCESS" ? "green" : "red"}>{result.status}</Tag>
                {result.agentRunId ? <TableLinkCell to={`/ai/runs/${result.agentRunId}`}>Run {result.agentRunId.slice(0, 8)}</TableLinkCell> : null}
                {result.errorMessage ? <Text type="danger">{result.errorMessage}</Text> : null}
              </Space>
              <AiWorkbenchResultPanel
                taskKey={activeTask.key}
                result={result}
                editorTheme={colorMode === "dark" ? "vs-dark" : "vs-light"}
                onImportGenerated={openGeneratedImport}
              />
              <Space wrap>
                <Button icon={<CopyOutlined />} onClick={() => void copyText(workbenchResultCopyText(activeTask.key, result)).then(() => messageApi.success("结果已复制"))}>
                  复制结果
                </Button>
              </Space>
              <Divider />
              <JsonPreview title="结构化结果" value={result.result} emptyDescription="无结构化结果" />
              <JsonPreview title="Raw Output" value={result.rawOutput} emptyDescription="无原始输出" />
            </Space>
          )}
        </Card>
      </div>
    </Space>
  );
}
