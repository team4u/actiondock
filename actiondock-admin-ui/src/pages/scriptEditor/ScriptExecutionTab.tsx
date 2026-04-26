import { Alert, Button, Card, Empty, Radio, Row, Space, Spin, Table, Tag, Typography } from "antd";
import { Col } from "../../components/SafeCol";
import { DeleteOutlined, HistoryOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { ConfirmDangerAction } from "../../components/ConfirmDangerAction";
import { ExecutionResultCard } from "../../components/ExecutionResultCard";
import { SchemaObjectEditor } from "../../components/SchemaObjectEditor";
import type { ColumnsType } from "antd/es/table";
import type { FormInstance } from "antd";
import type { ExecutionRecord, ExecutionStatus, ScriptDefinition, SubmitMode, ValidationErrorData } from "../../types";
import { formatDateTime, getExecutionStatusColor, isExecutionActive } from "../../utils";
import type { SchemaFieldDefinition } from "../../schema";
import type { ExecutionInputMode } from "./types";

const { Text } = Typography;

function getTriggerSourceLabel(source: string): string {
  return source === "SCHEDULED" ? "定时任务" : "手动触发";
}

interface ScriptExecutionTabProps {
  currentScript: ScriptDefinition | null;
  executionForm: FormInstance<Record<string, unknown>>;
  executionMode: SubmitMode;
  onExecutionModeChange: (mode: SubmitMode) => void;
  executionInputMode: ExecutionInputMode;
  executionJsonInput: string;
  onExecutionJsonInputChange: (text: string) => void;
  onExecutionInputModeChange: (mode: string) => void;
  executionValidationError: ValidationErrorData | null;
  supportedFields: SchemaFieldDefinition[];
  unsupportedFields: string[];
  executing: boolean;
  currentExecution: ExecutionRecord | null;
  executionHistory: ExecutionRecord[];
  historyLoading: boolean;
  deletingExecutionId: string | null;
  clearingExecutionHistory: boolean;
  pollingExecutionId: string | null;
  hasActiveExecutionHistory: boolean;
  editorTheme: "vs-light" | "vs-dark";
  onExecute: () => Promise<void>;
  onResetExecutionInput: () => void;
  onDeleteExecution: (record: ExecutionRecord) => Promise<void>;
  onClearExecutionHistory: () => Promise<void>;
  onRefreshHistory: () => void;
  onExecutionHistoryRowClick: (record: ExecutionRecord) => void;
  onRefillCurrentExecutionInput: (record: ExecutionRecord) => void;
  activeExecutionId: string | null;
}

export function ScriptExecutionTab({
  currentScript,
  executionForm,
  executionMode,
  onExecutionModeChange,
  executionInputMode,
  executionJsonInput,
  onExecutionJsonInputChange,
  onExecutionInputModeChange,
  executionValidationError,
  supportedFields,
  unsupportedFields,
  executing,
  currentExecution,
  executionHistory,
  historyLoading,
  deletingExecutionId,
  clearingExecutionHistory,
  pollingExecutionId,
  hasActiveExecutionHistory,
  editorTheme,
  onExecute,
  onResetExecutionInput,
  onDeleteExecution,
  onClearExecutionHistory,
  onRefreshHistory,
  onExecutionHistoryRowClick,
  onRefillCurrentExecutionInput,
  activeExecutionId
}: ScriptExecutionTabProps) {
  const historyColumns: ColumnsType<ExecutionRecord> = [
    {
      title: "执行 ID",
      dataIndex: "id",
      key: "id",
      width: 280,
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: ExecutionStatus) => (
        <Tag color={getExecutionStatusColor(status)}>{status}</Tag>
      )
    },
    {
      title: "方式",
      dataIndex: "submitMode",
      key: "submitMode",
      width: 120
    },
    {
      title: "来源",
      key: "triggerSource",
      width: 160,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.triggerSource === "SCHEDULED" ? "blue" : "default"}>
            {getTriggerSourceLabel(record.triggerSource)}
          </Tag>
          {record.scheduleId ? (
            <Text type="secondary" code>{record.scheduleId}</Text>
          ) : null}
        </Space>
      )
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "完成时间",
      dataIndex: "finishedAt",
      key: "finishedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, record) => (
        <ConfirmDangerAction
          title="确认删除这条执行记录？"
          onConfirm={() => void onDeleteExecution(record)}
          loading={deletingExecutionId === record.id}
          disabled={isExecutionActive(record.status)}
        >
          <Button
            type="link"
            danger
            size="small"
            icon={<DeleteOutlined />}
            disabled={isExecutionActive(record.status)}
            onClick={(event) => event.stopPropagation()}
          >
            删除
          </Button>
        </ConfirmDangerAction>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]} align="stretch" className="equal-height-row">
        <Col xs={24} xl={10} className="equal-height-col">
          <Card
            type="inner"
            title="执行入参"
            extra={<Text type="secondary">根据 inputSchema 自动生成</Text>}
            className="equal-height-card"
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {executionValidationError && (
                <Alert
                  type="error"
                  showIcon
                  message="参数校验失败"
                  description={
                    <div>
                      {executionValidationError.fieldErrors.map((fieldError) => (
                        <div key={`${fieldError.field}-${fieldError.reason}`}>
                          <Text code>{fieldError.field}</Text>
                          {" - "}
                          {fieldError.message}
                        </div>
                      ))}
                    </div>
                  }
                />
              )}

              <div className="script-editor-page__execution-toolbar">
                <Radio.Group
                  value={executionMode}
                  optionType="button"
                  buttonStyle="solid"
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => onExecutionModeChange(event.target.value as SubmitMode)}
                  options={[
                    { label: "同步执行", value: "SYNC" },
                    { label: "异步执行", value: "ASYNC" }
                  ]}
                />

                <Space size={12} wrap className="script-editor-page__execution-actions">
                  <Button icon={<ReloadOutlined />} onClick={onResetExecutionInput}>
                    重置
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => void onExecute()}
                    loading={executing}
                  >
                    执行
                  </Button>
                </Space>
              </div>

              <SchemaObjectEditor
                form={executionForm}
                supportedFields={supportedFields}
                unsupportedFields={unsupportedFields}
                inputMode={executionInputMode}
                onInputModeChange={onExecutionInputModeChange}
                jsonText={executionJsonInput}
                onJsonTextChange={onExecutionJsonInputChange}
                jsonLabel="执行入参 JSON"
                jsonExtra="直接输入 JSON 对象执行，不依赖 inputSchema。"
                noSchemaExtra="当前脚本没有可渲染的 inputSchema，请直接输入 JSON 对象。"
                editorTheme={editorTheme}
              />
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={14} className="equal-height-col">
          {currentExecution ? (
            <ExecutionResultCard
              execution={currentExecution}
              inputSchema={currentScript?.inputSchema}
              outputSchema={currentScript?.outputSchema}
              showTriggerSource={true}
              headerActions={
                <Button
                  icon={<HistoryOutlined />}
                  onClick={() => onRefillCurrentExecutionInput(currentExecution)}
                >
                  回填本次输入
                </Button>
              }
              titleExtra={
                currentExecution ? (
                  <Space size={8} wrap className="execution-result-card__header-extra">
                    <Text code className="execution-result-card__header-id">
                      {currentExecution.id}
                    </Text>
                    <Tag color={getExecutionStatusColor(currentExecution.status)}>
                      {currentExecution.status}
                    </Tag>
                  </Space>
                ) : (
                  <Text type="secondary">暂无结果</Text>
                )
              }
            />
          ) : (
            <Card type="inner" title="执行结果" className="equal-height-card">
              <Empty description="执行后将在这里查看结果详情。" />
            </Card>
          )}
        </Col>
      </Row>

      <Card
        type="inner"
        title="历史执行结果"
        extra={
          <Space className="history-card-actions" size="small" wrap>
            {pollingExecutionId && (
              <Tag color="processing">轮询中: {pollingExecutionId.slice(0, 8)}</Tag>
            )}
            <Button
              icon={<ReloadOutlined />}
              onClick={onRefreshHistory}
              loading={historyLoading}
            >
              刷新记录
            </Button>
            <ConfirmDangerAction
              title="确认清空当前脚本的历史执行结果？"
              okText="清空"
              onConfirm={() => void onClearExecutionHistory()}
              loading={clearingExecutionHistory}
              disabled={executionHistory.length === 0 || hasActiveExecutionHistory}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={executionHistory.length === 0 || hasActiveExecutionHistory}
                onClick={(event) => event.stopPropagation()}
              >
                全部删除
              </Button>
            </ConfirmDangerAction>
          </Space>
        }
      >
        <Table
          className="execution-history-table"
          rowKey="id"
          loading={historyLoading}
          columns={historyColumns}
          dataSource={executionHistory}
          pagination={{ pageSize: 5 }}
          scroll={{ x: 900 }}
          locale={{ emptyText: "当前脚本暂无执行记录" }}
          onRow={(record: ExecutionRecord) => ({
            onClick: () => onExecutionHistoryRowClick(record)
          })}
          rowClassName={(record: ExecutionRecord) =>
            record.id === activeExecutionId
              ? "execution-history-row execution-history-row-active"
              : "execution-history-row"
          }
        />
      </Card>
    </Space>
  );
}
