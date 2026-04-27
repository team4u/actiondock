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
import {
  CopyOutlined,
  EyeOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  ImportOutlined,
  PlayCircleOutlined
} from "@ant-design/icons";
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
  buildWorkbenchExecutionPrefill,
  buildWorkbenchReleaseNotesDraft,
  buildWorkbenchSchemaPatchApplication,
  buildWorkbenchScriptPatchApplication,
  buildGeneratedScriptImportText,
  normalizeWorkbenchTask,
  workbenchResultCopyText,
  type WorkbenchTaskKey
} from "../../aiWorkbench";
import { CodeEditor } from "../../components/CodeEditor";
import { ScriptDiffDrawer } from "../../components/diff/ScriptDiffDrawer";
import { JsonPreview } from "../../components/JsonPreview";
import { PageHeader } from "../../components/PageHeader";
import { TableLinkCell } from "../../components/TableLinkCell";
import { useColorMode } from "../../contexts/ColorModeContext";
import { buildScriptDiff, toDiffTarget } from "../../scriptDiff";
import type {
  AiAgentProfile,
  AiWorkbenchCommand,
  AiWorkbenchResult,
  ExecutionRecord,
  ScriptDefinition,
  ScriptType
} from "../../types";
import { copyText, prettyJson } from "../../utils";
import {
  applyJsonMergePatch,
  saveWorkbenchExecutionPrefill,
  saveWorkbenchReleaseNotesDraft,
  saveWorkbenchSchemaPatchApplication,
  saveWorkbenchScriptPatchApplication
} from "../../workbenchSession";

const { Text, Title } = Typography;

interface WorkbenchFormValues {
  scriptId?: string;
  executionId?: string;
  agentProfile?: string;
  objective?: string;
  instructions?: string;
}

interface DiffPreviewState {
  diff: ReturnType<typeof buildScriptDiff>;
  scriptId: string;
  targetType?: ScriptType;
  title: string;
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
  if (taskKey === "improve") {
    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {typeof payload.updatedSource === "string" && payload.updatedSource.trim() ? (
          <CodeEditor value={payload.updatedSource} language="groovy" theme={editorTheme} height="240px" onChange={() => undefined} readOnly />
        ) : null}
        <pre className="json-preview">{fieldText(payload.patch ?? payload.suggestion ?? payload)}</pre>
        {payload.rationale ? <Text>{fieldText(payload.rationale)}</Text> : null}
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
  const [diffPreview, setDiffPreview] = useState<DiffPreviewState | null>(null);

  const activeTaskKey = normalizeWorkbenchTask(searchParams.get("task"));
  const activeTask = WORKBENCH_TASKS.find((task) => task.key === activeTaskKey) ?? WORKBENCH_TASKS[0];
  const selectedScriptId = Form.useWatch("scriptId", form);
  const selectedExecutionId = Form.useWatch("executionId", form);

  useEffect(() => {
    void Promise.all([listScripts(), listAiAgents()]).then(([nextScripts, nextAgents]) => {
      setScripts(nextScripts);
      setAgents(nextAgents);
    }).catch(() => messageApi.error("加载 Workbench 上下文失败"));
  }, [messageApi]);

  useEffect(() => {
    if (selectedScriptId) {
      void listExecutions(selectedScriptId).then(setExecutions).catch(() => setExecutions([]));
      return;
    }
    setExecutions([]);
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
  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId]
  );
  const selectedExecution = useMemo(
    () => executions.find((execution) => execution.id === selectedExecutionId) ?? null,
    [executions, selectedExecutionId]
  );
  const canApplyToDraft = Boolean(selectedScript && selectedScript.editable !== false);

  const switchTask = (key: WorkbenchTaskKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("task", key);
    setSearchParams(next);
    setDiffPreview(null);
    setResult(null);
  };

  const buildPayload = (values: WorkbenchFormValues, context: Record<string, unknown> = {}): AiWorkbenchCommand => ({
    objective: values.objective,
    instructions: values.instructions,
    agentProfile: values.agentProfile,
    scriptId: values.scriptId,
    executionId: values.executionId,
    context
  });

  const validateTaskValues = (taskKey: WorkbenchTaskKey, values: WorkbenchFormValues) => {
    if (taskKey === "generate" && !values.objective?.trim()) {
      throw new Error("请填写目标");
    }
    if (["improve", "schema", "review", "releaseNotes"].includes(taskKey) && !values.scriptId) {
      throw new Error("请选择脚本");
    }
    if (taskKey === "diagnose" && !values.executionId) {
      throw new Error("请选择执行记录");
    }
  };

  const executeTask = async (
    taskKey: WorkbenchTaskKey,
    overrides: Partial<WorkbenchFormValues> = {},
    context: Record<string, unknown> = {}
  ) => {
    setRunning(true);
    setResult(null);
    try {
      const values = { ...(form.getFieldsValue(true) as WorkbenchFormValues), ...overrides };
      validateTaskValues(taskKey, values);
      form.setFieldsValue(values);
      const payload = buildPayload(values, context);
      const response =
        taskKey === "generate"
          ? await generateWorkbenchScript(payload)
          : taskKey === "improve"
            ? await improveWorkbenchScript(payload)
            : taskKey === "schema"
              ? await improveWorkbenchSchema(payload)
              : taskKey === "diagnose"
                ? await diagnoseWorkbenchExecution(values.executionId || "", payload)
                : taskKey === "review"
                  ? await reviewWorkbenchPublish(values.scriptId || "", payload)
                  : await generateWorkbenchReleaseNotes(values.scriptId || "", payload);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("task", taskKey);
      if (values.scriptId) {
        nextParams.set("scriptId", values.scriptId);
      }
      if (values.executionId) {
        nextParams.set("executionId", values.executionId);
      }
      setSearchParams(nextParams, { replace: true });
      setResult(response);
      if (response.status === "FAILED") {
        messageApi.warning(response.errorMessage || "Agent 输出未通过结构化校验");
      }
      return response;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Workbench 任务失败");
      return null;
    } finally {
      setRunning(false);
    }
  };

  const runTask = async () => {
    const values = await form.validateFields();
    void executeTask(activeTask.key, values);
  };

  const openGeneratedImport = () => {
    if (!result) return;
    sessionStorage.setItem("actiondock.workbench.generatedScript", buildGeneratedScriptImportText(result.result));
    navigate("/scripts/new?importGenerated=1");
  };

  const openScriptPatchDiff = () => {
    const patch = buildWorkbenchScriptPatchApplication(result);
    if (!selectedScript || !patch) {
      messageApi.warning("当前结果缺少可预览的脚本 patch");
      return;
    }
    setDiffPreview({
      scriptId: selectedScript.id,
      targetType: selectedScript.type,
      title: "AI 脚本 patch Diff",
      diff: buildScriptDiff(
        toDiffTarget(selectedScript),
        {
          ...toDiffTarget(selectedScript),
          source: patch.updatedSource
        },
        { context: "import" }
      )
    });
  };

  const openSchemaPatchDiff = () => {
    const patch = buildWorkbenchSchemaPatchApplication(selectedScript?.id, result);
    if (!selectedScript || !patch) {
      messageApi.warning("当前结果缺少可预览的 Schema patch");
      return;
    }
    const nextInputSchema = patch.inputSchemaPatch
      ? applyJsonMergePatch(selectedScript.inputSchema, patch.inputSchemaPatch)
      : selectedScript.inputSchema;
    const nextOutputSchema = patch.outputSchemaPatch
      ? applyJsonMergePatch(selectedScript.outputSchema, patch.outputSchemaPatch)
      : selectedScript.outputSchema;
    setDiffPreview({
      scriptId: selectedScript.id,
      targetType: selectedScript.type,
      title: "AI Schema Patch Diff",
      diff: buildScriptDiff(
        {
          ...toDiffTarget(selectedScript),
          rawInputSchemaText: prettyJson(selectedScript.inputSchema),
          rawOutputSchemaText: prettyJson(selectedScript.outputSchema)
        },
        {
          ...toDiffTarget(selectedScript),
          inputSchema: nextInputSchema,
          outputSchema: nextOutputSchema,
          rawInputSchemaText: prettyJson(nextInputSchema),
          rawOutputSchemaText: prettyJson(nextOutputSchema)
        },
        { context: "import" }
      )
    });
  };

  const applyScriptPatch = (goToExecution: boolean) => {
    const patch = buildWorkbenchScriptPatchApplication(result);
    if (!selectedScript || !patch) {
      messageApi.warning("当前结果缺少可应用的脚本 patch");
      return;
    }
    if (!canApplyToDraft) {
      messageApi.warning("当前脚本不可直接应用 AI 修改，请先 Fork");
      return;
    }
    saveWorkbenchScriptPatchApplication(patch);
    const nextParams = new URLSearchParams();
    nextParams.set("workbenchApply", "scriptPatch");
    if (goToExecution) {
      nextParams.set("tab", "execution");
      nextParams.set("workbenchAutoSave", "1");
      const prefill = buildWorkbenchExecutionPrefill(selectedScript.id, selectedExecution?.input, "失败执行输入");
      if (prefill) {
        saveWorkbenchExecutionPrefill(prefill);
        nextParams.set("workbenchPrefill", "1");
      }
    }
    navigate(`/scripts/${encodeURIComponent(selectedScript.id)}?${nextParams.toString()}`);
  };

  const applySchemaPatch = (goToExecution: boolean) => {
    const patch = buildWorkbenchSchemaPatchApplication(selectedScript?.id, result);
    if (!selectedScript || !patch) {
      messageApi.warning("当前结果缺少可应用的 Schema patch");
      return;
    }
    if (!canApplyToDraft) {
      messageApi.warning("当前脚本不可直接应用 AI 修改，请先 Fork");
      return;
    }
    saveWorkbenchSchemaPatchApplication(patch);
    const nextParams = new URLSearchParams();
    nextParams.set("workbenchApply", "schemaPatch");
    if (goToExecution) {
      nextParams.set("tab", "execution");
      nextParams.set("workbenchAutoSave", "1");
      const prefill = buildWorkbenchExecutionPrefill(selectedScript.id, selectedExecution?.input, "失败执行输入");
      if (prefill) {
        saveWorkbenchExecutionPrefill(prefill);
        nextParams.set("workbenchPrefill", "1");
      }
    }
    navigate(`/scripts/${encodeURIComponent(selectedScript.id)}?${nextParams.toString()}`);
  };

  const applyReleaseNotes = () => {
    const releaseNotes = buildWorkbenchReleaseNotesDraft(selectedScript?.id, result);
    if (!selectedScript || !releaseNotes) {
      messageApi.warning("当前结果缺少可写入的发布日志");
      return;
    }
    saveWorkbenchReleaseNotesDraft(releaseNotes);
    navigate(`/scripts/${encodeURIComponent(selectedScript.id)}?workbenchReleaseNotes=1`);
  };

  const renderResultActions = () => {
    if (!result) {
      return null;
    }
    if (activeTask.key === "diagnose") {
      return (
        <Button
          icon={<PlayCircleOutlined />}
          disabled={result.status !== "SUCCESS"}
          onClick={() => void executeTask("improve", {}, { executionDiagnosis: result.result })}
        >
          生成修复 Patch
        </Button>
      );
    }
    if (activeTask.key === "improve") {
      return (
        <>
          <Button icon={<EyeOutlined />} disabled={result.status !== "SUCCESS"} onClick={openScriptPatchDiff}>
            预览 Diff
          </Button>
          <Button icon={<ImportOutlined />} disabled={result.status !== "SUCCESS" || !canApplyToDraft} onClick={() => applyScriptPatch(false)}>
            应用到草稿
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} disabled={result.status !== "SUCCESS" || !canApplyToDraft} onClick={() => applyScriptPatch(true)}>
            应用并去执行调试
          </Button>
        </>
      );
    }
    if (activeTask.key === "schema") {
      return (
        <>
          <Button icon={<EyeOutlined />} disabled={result.status !== "SUCCESS"} onClick={openSchemaPatchDiff}>
            预览 Schema 变更
          </Button>
          <Button icon={<ImportOutlined />} disabled={result.status !== "SUCCESS" || !canApplyToDraft} onClick={() => applySchemaPatch(false)}>
            应用到草稿
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} disabled={result.status !== "SUCCESS" || !canApplyToDraft} onClick={() => applySchemaPatch(true)}>
            应用并去执行调试
          </Button>
        </>
      );
    }
    if (activeTask.key === "review") {
      return (
        <Button
          icon={<FileTextOutlined />}
          disabled={result.status !== "SUCCESS"}
          onClick={() => void executeTask("releaseNotes", {}, { publishReview: result.result })}
        >
          生成 Release Notes
        </Button>
      );
    }
    if (activeTask.key === "releaseNotes") {
      return (
        <Button icon={<ImportOutlined />} disabled={result.status !== "SUCCESS"} onClick={applyReleaseNotes}>
          写入发布日志
        </Button>
      );
    }
    return null;
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      {diffPreview ? (
        <ScriptDiffDrawer
          open={true}
          onClose={() => setDiffPreview(null)}
          diff={diffPreview.diff}
          scriptId={diffPreview.scriptId}
          title={diffPreview.title}
          theme={colorMode === "dark" ? "vs-dark" : "vs-light"}
          targetType={diffPreview.targetType}
        />
      ) : null}
      <PageHeader
        title="AI Workbench"
        meta="任务型脚本开发工作台，只生成草稿和提案"
        onBack={() => navigate("/ai")}
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
                {renderResultActions()}
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
