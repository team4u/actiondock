import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import type { SchemaFieldDefinition } from "../schema";
import type { ExecutionRecord, SubmitMode } from "../types";
import { CodeEditor } from "./CodeEditor";
import { ExecutionResultCard } from "./ExecutionResultCard";
import {
  buildAutoCsvMapping,
  buildDraftFromCsvSource,
  buildDraftFromObjectRows,
  parseCsvSource,
  parseJsonArraySource,
  parseJsonLinesSource
} from "../batch/parser";
import type {
  BatchExecutionFetcher,
  BatchExecutionSubmitter,
  BatchInputSource,
  BatchSessionItem,
  BatchSurface,
  CsvColumnMapping,
  CsvSourceData
} from "../batch/types";
import { summarizeBatchObject } from "../batch/session";
import { useBatchExecution } from "../batch/useBatchExecution";
import {
  buildBatchResultCsvRows,
  buildCsvTemplate,
  downloadTextFile,
  exportBatchSessionAsCsv,
  exportBatchSessionAsJson,
  formatBatchExportFileName
} from "../batch/export";
import { copyText, getExecutionStatusColor, prettyJson } from "../utils";

const { Text, Title } = Typography;

type DataSourceState = {
  sourceType: BatchInputSource;
  text: string;
};

function formatSourceLabel(sourceType: BatchInputSource): string {
  switch (sourceType) {
    case "JSON_ARRAY":
      return "JSON 数组";
    case "JSONL":
      return "JSONL";
    case "CSV":
      return "CSV";
    default:
      return sourceType;
  }
}

function createDefaultBatchName(scriptName: string): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${scriptName}-${month}${day}-${hour}${minute}`;
}

function getEditorLanguage(sourceType: BatchInputSource): string {
  return sourceType === "JSON_ARRAY" ? "json" : "plaintext";
}

function readFileSourceType(name: string, fallback: BatchInputSource): BatchInputSource {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".csv")) return "CSV";
  if (lowerName.endsWith(".jsonl")) return "JSONL";
  if (lowerName.endsWith(".json")) return "JSON_ARRAY";
  return fallback;
}

function buildFailureExportPayload(items: BatchSessionItem[]): Array<Record<string, unknown>> {
  return items.map((item) => ({
    rowIndex: item.rowIndex,
    status: item.status,
    input: item.input,
    errorMessage: item.errorMessage,
    validationErrors: item.errors,
    backendValidationErrors: item.backendValidationErrors
  }));
}

export interface BatchRunPanelProps {
  surface: BatchSurface;
  scriptId: string;
  scriptName: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  supportedFields: SchemaFieldDefinition[];
  supportedOutputFields: SchemaFieldDefinition[];
  unsupportedFields: string[];
  editorTheme: "vs-light" | "vs-dark";
  messageApi: MessageInstance;
  submitExecution: BatchExecutionSubmitter;
  fetchExecution: BatchExecutionFetcher;
  canExecute?: boolean;
  disabledReason?: string;
  onSessionFinished?: () => void | Promise<void>;
}

export function BatchRunPanel({
  surface,
  scriptId,
  scriptName,
  inputSchema,
  outputSchema,
  supportedFields,
  supportedOutputFields,
  unsupportedFields,
  editorTheme,
  messageApi,
  submitExecution,
  fetchExecution,
  canExecute = true,
  disabledReason,
  onSessionFinished
}: BatchRunPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dataSource, setDataSource] = useState<DataSourceState>({
    sourceType: "JSON_ARRAY",
    text: ""
  });
  const [batchName, setBatchName] = useState(() => createDefaultBatchName(scriptName));
  const [submitMode, setSubmitMode] = useState<SubmitMode>("ASYNC");
  const [concurrency, setConcurrency] = useState(3);
  const [failStrategy, setFailStrategy] = useState<"CONTINUE" | "STOP_ON_FAILURE">("CONTINUE");
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping>({});
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const {
    session,
    stats,
    running,
    startBatch,
    clearSession,
    retryFailed,
    retrySingle
  } = useBatchExecution({
    surface,
    scriptId,
    scriptName,
    submitExecution,
    fetchExecution,
    onSessionFinished
  });

  const parsedCsvState = useMemo(() => {
    if (dataSource.sourceType !== "CSV" || !dataSource.text.trim()) {
      return {
        data: null as CsvSourceData | null,
        error: null as string | null
      };
    }

    try {
      return {
        data: parseCsvSource(dataSource.text),
        error: null
      };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : "CSV 解析失败"
      };
    }
  }, [dataSource]);

  useEffect(() => {
    if (!parsedCsvState.data) {
      setCsvMapping({});
      return;
    }

    const csvData = parsedCsvState.data;
    const suggested = buildAutoCsvMapping(csvData.headers, supportedFields);
    setCsvMapping((previous) => {
      const next: CsvColumnMapping = {};
      for (const header of csvData.headers) {
        next[header] = previous[header] ?? suggested[header] ?? null;
      }
      return next;
    });
  }, [parsedCsvState.data, supportedFields]);

  const preview = useMemo(() => {
    const text = dataSource.text.trim();
    if (!text) {
      return {
        error: null as string | null,
        items: [],
        summary: {
          totalCount: 0,
          validCount: 0,
          invalidCount: 0,
          warningCount: 0
        }
      };
    }

    try {
      if (dataSource.sourceType === "JSON_ARRAY") {
        return {
          error: null,
          ...buildDraftFromObjectRows(parseJsonArraySource(dataSource.text), supportedFields)
        };
      }
      if (dataSource.sourceType === "JSONL") {
        return {
          error: null,
          ...buildDraftFromObjectRows(parseJsonLinesSource(dataSource.text), supportedFields)
        };
      }

      if (parsedCsvState.error) {
        throw new Error(parsedCsvState.error);
      }

      return {
        error: null,
        ...buildDraftFromCsvSource({
          csv: parsedCsvState.data ?? parseCsvSource(dataSource.text),
          mapping: csvMapping,
          supportedFields,
          unsupportedFields
        })
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "批量输入解析失败",
        items: [],
        summary: {
          totalCount: 0,
          validCount: 0,
          invalidCount: 0,
          warningCount: 0
        }
      };
    }
  }, [csvMapping, dataSource, parsedCsvState, supportedFields, unsupportedFields]);

  useEffect(() => {
    if (session?.items.length) {
      if (!selectedItemId || !session.items.some((item) => item.id === selectedItemId)) {
        setSelectedItemId(session.items[0]?.id ?? null);
      }
      return;
    }
    setSelectedItemId(null);
  }, [selectedItemId, session]);

  const selectedItem = useMemo(
    () => session?.items.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, session]
  );

  const previewColumns: ColumnsType<(typeof preview.items)[number]> = [
    {
      title: "行号",
      dataIndex: "rowIndex",
      key: "rowIndex",
      width: 80
    },
    {
      title: "校验状态",
      key: "status",
      width: 120,
      render: (_value, record) => (
        <Tag color={record.errors.length === 0 ? "green" : "red"}>
          {record.errors.length === 0 ? "通过" : "失败"}
        </Tag>
      )
    },
    {
      title: "输入摘要",
      key: "input",
      render: (_value, record) => summarizeBatchObject(record.input)
    },
    {
      title: "问题",
      key: "issues",
      render: (_value, record) => {
        const messages = [...record.errors, ...record.warnings];
        return messages.length > 0 ? messages.join("；") : "-";
      }
    }
  ];

  const resultColumns: ColumnsType<BatchSessionItem> = [
    {
      title: "行号",
      dataIndex: "rowIndex",
      key: "rowIndex",
      width: 80
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (status: BatchSessionItem["status"]) => (
        <Tag color={getExecutionStatusColor(status === "SUBMIT_FAILED" ? "FAILED" : status === "SKIPPED" || status === "INTERRUPTED" ? "FAILED" : status === "INVALID" ? "FAILED" : (status as ExecutionRecord["status"]))}>
          {status}
        </Tag>
      )
    },
    {
      title: "executionId",
      key: "executionId",
      width: 240,
      render: (_value, record) => <Text code>{record.executionId ?? "-"}</Text>
    },
    {
      title: "输入摘要",
      key: "input",
      render: (_value, record) => summarizeBatchObject(record.input)
    },
    {
      title: "输出摘要",
      key: "output",
      render: (_value, record) => summarizeBatchObject(record.execution?.output)
    },
    {
      title: "错误",
      key: "errorMessage",
      render: (_value, record) => record.errorMessage ?? (record.errors.join("；") || "-")
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_value, record) => (
        <Space size="small" wrap>
          <Button
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedItemId(record.id);
            }}
          >
            查看
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              void copyText(prettyJson(record.input))
                .then(() => messageApi.success("已复制输入"))
                .catch(() => messageApi.error("复制输入失败"));
            }}
          >
            输入
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={!record.execution}
            onClick={(event) => {
              event.stopPropagation();
              void copyText(prettyJson(record.execution?.output))
                .then(() => messageApi.success("已复制输出"))
                .catch(() => messageApi.error("复制输出失败"));
            }}
          >
            输出
          </Button>
          <Button
            size="small"
            disabled={running}
            onClick={(event) => {
              event.stopPropagation();
              void retrySingle(record.id);
            }}
          >
            重试此行
          </Button>
        </Space>
      )
    }
  ];

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const nextSourceType = readFileSourceType(file.name, dataSource.sourceType);
      setDataSource({
        sourceType: nextSourceType,
        text
      });
      messageApi.success(`已导入 ${file.name}`);
    } catch {
      messageApi.error("读取文件失败");
    }
  };

  const handleStart = async () => {
    if (!canExecute) {
      messageApi.warning(disabledReason || "当前脚本不可执行");
      return;
    }
    if (preview.error) {
      messageApi.error(preview.error);
      return;
    }
    if (preview.items.length === 0) {
      messageApi.warning("请先提供批量输入数据");
      return;
    }

    await startBatch({
      batchName: batchName.trim() || createDefaultBatchName(scriptName),
      sourceType: dataSource.sourceType,
      submitMode,
      failStrategy,
      concurrency,
      items: preview.items
    });
    messageApi.success("批量运行已开始");
  };

  const handleExportAllJson = () => {
    if (!session) return;
    exportBatchSessionAsJson(session);
  };

  const handleExportAllCsv = () => {
    if (!session) return;
    exportBatchSessionAsCsv({
      session,
      inputFields: supportedFields,
      outputFields: supportedOutputFields
    });
  };

  const handleExportFailedJson = () => {
    if (!session) return;
    const failedItems = session.items.filter((item) => item.status !== "SUCCESS");
    const fileName = `${formatBatchExportFileName(scriptId, "failures")}.json`;
    downloadTextFile(fileName, JSON.stringify(buildFailureExportPayload(failedItems), null, 2), "application/json;charset=utf-8");
  };

  const handleExportFailedCsv = () => {
    if (!session) return;
    const csv = buildBatchResultCsvRows(session, supportedFields, supportedOutputFields, true);
    downloadTextFile(
      `${formatBatchExportFileName(scriptId, "failures")}.csv`,
      csv.length > 0 ? exportRowsToCsv(csv) : "rowIndex,status,errorMessage\n",
      "text/csv;charset=utf-8"
    );
  };

  const handleDownloadTemplate = () => {
    if (supportedFields.length === 0) {
      messageApi.warning("当前脚本没有简单字段可生成 CSV 模板");
      return;
    }
    downloadTextFile(
      `${formatBatchExportFileName(scriptId, "template")}.csv`,
      buildCsvTemplate(supportedFields),
      "text/csv;charset=utf-8"
    );
  };

  const sourceExtra = (
    <Space size="small" wrap>
      <Button icon={<UploadOutlined />} onClick={handleUploadClick}>
        上传文件
      </Button>
      <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
        下载 CSV 模板
      </Button>
    </Space>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonl,.csv,application/json,text/plain,text/csv"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {!canExecute ? (
        <Alert
          type="warning"
          showIcon
          message={disabledReason || "当前脚本不可执行"}
        />
      ) : null}

      <Card
        type="inner"
        title="数据来源"
        extra={sourceExtra}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Tabs
            activeKey={dataSource.sourceType}
            onChange={(key) => setDataSource((current) => ({ ...current, sourceType: key as BatchInputSource }))}
            items={[
              { key: "JSON_ARRAY", label: "JSON 数组" },
              { key: "JSONL", label: "JSONL" },
              { key: "CSV", label: "CSV" }
            ]}
          />

          {unsupportedFields.length > 0 ? (
            <Alert
              type="info"
              showIcon
              message="复杂字段说明"
              description={
                dataSource.sourceType === "CSV"
                  ? `CSV 仅支持简单顶层字段；以下复杂字段请改用 JSON/JSONL：${unsupportedFields.join("、")}`
                  : `以下复杂字段不会做前端预校验，仍会在提交时由后端校验：${unsupportedFields.join("、")}`
              }
            />
          ) : null}

          {preview.error ? (
            <Alert type="error" showIcon message={preview.error} />
          ) : null}

          <CodeEditor
            value={dataSource.text}
            onChange={(text) => setDataSource((current) => ({ ...current, text }))}
            theme={editorTheme}
            language={getEditorLanguage(dataSource.sourceType)}
            height="260px"
            placeholder={`请输入或上传${formatSourceLabel(dataSource.sourceType)}数据`}
          />

          {dataSource.sourceType === "CSV" && parsedCsvState.data ? (
            <Card type="inner" title="参数映射">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {parsedCsvState.data.headers.map((header) => (
                  <div key={header} className="batch-run-panel__mapping-row">
                    <Text code>{header}</Text>
                    <Select
                      value={csvMapping[header] ?? null}
                      onChange={(value) =>
                        setCsvMapping((current) => ({
                          ...current,
                          [header]: value
                        }))
                      }
                      style={{ minWidth: 220 }}
                      options={[
                        { value: null, label: "忽略此列" },
                        ...supportedFields.map((field) => ({
                          value: field.name,
                          label: `${field.label} (${field.name})`
                        }))
                      ]}
                    />
                  </div>
                ))}
              </Space>
            </Card>
          ) : null}
        </Space>
      </Card>

      <Card type="inner" title="执行设置">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Input
            value={batchName}
            onChange={(event) => setBatchName(event.target.value)}
            placeholder="请输入批次名称"
          />

          <Space size={12} wrap>
            <Radio.Group
              value={submitMode}
              optionType="button"
              buttonStyle="solid"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSubmitMode(event.target.value as SubmitMode)}
              options={[
                { label: "同步执行", value: "SYNC" },
                { label: "异步执行", value: "ASYNC" }
              ]}
            />

            <Select
              value={concurrency}
              style={{ width: 120 }}
              onChange={setConcurrency}
              options={[
                { value: 1, label: "并发 1" },
                { value: 3, label: "并发 3" },
                { value: 5, label: "并发 5" }
              ]}
            />

            <Select
              value={failStrategy}
              style={{ width: 180 }}
              onChange={(value) => setFailStrategy(value)}
              options={[
                { value: "CONTINUE", label: "继续执行" },
                { value: "STOP_ON_FAILURE", label: "遇错停止" }
              ]}
            />

            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => void handleStart()}
              disabled={!canExecute || running}
            >
              开始批量运行
            </Button>
          </Space>
        </Space>
      </Card>

      <Card type="inner" title="数据预览">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space size="small" wrap>
            <Tag color="blue">共 {preview.summary.totalCount} 条</Tag>
            <Tag color="green">有效 {preview.summary.validCount} 条</Tag>
            <Tag color="red">错误 {preview.summary.invalidCount} 条</Tag>
            {preview.summary.warningCount > 0 ? (
              <Tag color="gold">警告 {preview.summary.warningCount} 条</Tag>
            ) : null}
          </Space>

          <Table
            rowKey="id"
            columns={previewColumns}
            dataSource={preview.items}
            pagination={{ pageSize: 5 }}
            scroll={{ x: 900 }}
            locale={{ emptyText: "等待导入批量数据" }}
          />
        </Space>
      </Card>

      <Card
        type="inner"
        title="批量结果"
        extra={
          <Space size="small" wrap>
            <Button
              icon={<ReloadOutlined />}
              disabled={!session || running}
              onClick={() => void retryFailed()}
            >
              重试失败项
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!session}
              onClick={handleExportAllJson}
            >
              导出全部 JSON
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!session}
              onClick={handleExportAllCsv}
            >
              导出全部 CSV
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!session}
              onClick={handleExportFailedJson}
            >
              导出失败 JSON
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!session}
              onClick={handleExportFailedCsv}
            >
              导出失败 CSV
            </Button>
            <Button
              icon={<DeleteOutlined />}
              disabled={!session || running}
              onClick={clearSession}
            >
              清空结果
            </Button>
          </Space>
        }
      >
        {!session ? (
          <Empty description="批量运行后将在这里汇总结果、导出和重试。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" bordered column={{ xs: 1, md: 2, xl: 4 }}>
              <Descriptions.Item label="批次名称">{session.batchName}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={session.status === "SUCCESS" ? "green" : session.status === "RUNNING" ? "processing" : "red"}>
                  {session.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="输入来源">{formatSourceLabel(session.sourceType)}</Descriptions.Item>
              <Descriptions.Item label="提交模式">{session.submitMode}</Descriptions.Item>
              <Descriptions.Item label="进度">{stats.finished} / {stats.total}</Descriptions.Item>
              <Descriptions.Item label="成功">{stats.success}</Descriptions.Item>
              <Descriptions.Item label="失败">{stats.failed}</Descriptions.Item>
              <Descriptions.Item label="跳过 / 中断">{stats.skipped + stats.interrupted}</Descriptions.Item>
            </Descriptions>

            <Table
              rowKey="id"
              columns={resultColumns}
              dataSource={session.items}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1200 }}
          onRow={(record: BatchSessionItem) => ({
            onClick: () => setSelectedItemId(record.id)
          })}
          rowClassName={(record: BatchSessionItem) =>
            record.id === selectedItemId
              ? "execution-history-row execution-history-row-active"
              : "execution-history-row"
          }
        />

            {selectedItem ? (
              selectedItem.execution ? (
                <ExecutionResultCard
                  execution={selectedItem.execution}
                  inputSchema={inputSchema}
                  outputSchema={outputSchema}
                  title={`第 ${selectedItem.rowIndex} 行详情`}
                />
              ) : (
                <Card type="inner" title={`第 ${selectedItem.rowIndex} 行详情`}>
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>输入</Title>
                    <pre className="json-preview">{prettyJson(selectedItem.input)}</pre>
                    <Title level={5} style={{ margin: 0 }}>问题</Title>
                    <Text>{selectedItem.errorMessage ?? ([...selectedItem.errors, ...selectedItem.warnings].join("；") || "-")}</Text>
                  </Space>
                </Card>
              )
            ) : null}
          </Space>
        )}
      </Card>
    </Space>
  );
}

function exportRowsToCsv(rows: Array<Record<string, unknown>>): string {
  const headers = Array.from(
    rows.reduce<Set<string>>((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>())
  );
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((header) => escapeCsvCell(row[header]));
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function escapeCsvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}
