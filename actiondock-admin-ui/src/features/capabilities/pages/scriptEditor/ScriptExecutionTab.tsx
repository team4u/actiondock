import { Alert, Button, Card, Checkbox, Drawer, Empty, Row, Space, Table, Tabs, Tag, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import type { ColumnsType } from "antd/es/table";
import type { FormInstance } from "antd";
import {
  DeleteOutlined,
  EyeOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Col } from "../../../../components/common/SafeCol";
import { ConfirmDangerAction } from "../../../../components/common/ConfirmDangerAction";
import { ExecutionResultCard } from "../../../../components/execution/ExecutionResultCard";
import { SchemaObjectEditor } from "../../../../components/schema/SchemaObjectEditor";
import { BatchRunPanel } from "../../../../components/execution/BatchRunPanel";
import type { ReactNode } from "react";
import type { SchemaFieldDefinition } from "../../../../services/schema";
import { formatDateTime, getExecutionStatusColor, isExecutionActive } from "../../../../services/utils";
import type {
  ExecutionRecord,
  ExecutionStatus,
  ScriptDefinition,
  SubmitMode,
  ValidationErrorData
} from "../../../../shared/types";
import type { BatchExecutionFetcher, BatchExecutionSubmitter } from "../../../../batch/types";
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
  supportedOutputFields: SchemaFieldDefinition[];
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
  executionDetailOpen: boolean;
  onOpenExecutionDetail: (record?: ExecutionRecord | null) => void;
  onCloseExecutionDetail: () => void;
  activeExecutionId: string | null;
  messageApi: MessageInstance;
  submitBatchExecution: BatchExecutionSubmitter;
  fetchBatchExecution: BatchExecutionFetcher;
  onBatchSessionFinished?: () => void | Promise<void>;
  presetBar: ReactNode;
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
  supportedOutputFields,
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
  executionDetailOpen,
  onOpenExecutionDetail,
  onCloseExecutionDetail,
  activeExecutionId,
  messageApi,
  submitBatchExecution,
  fetchBatchExecution,
  onBatchSessionFinished,
  presetBar
}: ScriptExecutionTabProps) {
  const historyColumns: ColumnsType<ExecutionRecord> = [
    {
      title: "ID",
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
      render: (status: ExecutionStatus) => <Tag color={getExecutionStatusColor(status)}>{status}</Tag>
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
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, record) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              onExecutionHistoryRowClick(record);
              onOpenExecutionDetail(record);
            }}
          >
            详情
          </Button>
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
        </Space>
      )
    }
  ];

  return (
    <>
      <Tabs
        defaultActiveKey="single"
        items={[
          {
            key: "single",
            label: "单次运行",
            children: (
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
                        {executionValidationError ? (
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
                        ) : null}

                        <div className="script-editor-page__execution-toolbar">
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

                        {presetBar}

                        <Checkbox
                          checked={executionMode === "ASYNC"}
                          onChange={(event) =>
                            onExecutionModeChange(event.target.checked ? "ASYNC" : "SYNC")
                          }
                        >
                          异步执行
                        </Checkbox>

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
                    <Card
                      type="inner"
                      title="执行结果列表"
                      className="equal-height-card"
                      extra={
                        <Space className="history-card-actions" size="small" wrap>
                          {pollingExecutionId ? (
                            <Tag color="processing">轮询中: {pollingExecutionId.slice(0, 8)}</Tag>
                          ) : null}
                          <Button icon={<ReloadOutlined />} onClick={onRefreshHistory} loading={historyLoading}>
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
                        scroll={{ x: 720 }}
                        locale={{ emptyText: "当前脚本暂无执行结果" }}
                        onRow={(record: ExecutionRecord) => ({
                          onClick: () => {
                            onExecutionHistoryRowClick(record);
                            onOpenExecutionDetail(record);
                          }
                        })}
                        rowClassName={(record: ExecutionRecord) =>
                          record.id === activeExecutionId
                            ? "execution-history-row execution-history-row-active"
                            : "execution-history-row"
                        }
                      />
                    </Card>
                  </Col>
                </Row>
              </Space>
            )
          },
          {
            key: "batch",
            label: "批量运行",
            children: (
              <BatchRunPanel
                surface="editor"
                scriptId={currentScript?.id ?? ""}
                scriptName={currentScript?.name ?? "script"}
                inputSchema={currentScript?.inputSchema}
                outputSchema={currentScript?.outputSchema}
                supportedFields={supportedFields}
                supportedOutputFields={supportedOutputFields}
                unsupportedFields={unsupportedFields}
                editorTheme={editorTheme}
                messageApi={messageApi}
                submitExecution={submitBatchExecution}
                fetchExecution={fetchBatchExecution}
                canExecute={Boolean(currentScript?.id)}
                disabledReason={currentScript?.id ? undefined : "请先保存脚本"}
                onSessionFinished={onBatchSessionFinished}
              />
            )
          }
        ]}
      />
      <Drawer
        title="执行详情"
        open={executionDetailOpen}
        onClose={onCloseExecutionDetail}
        width={"50vw"}
        rootClassName="execution-detail-drawer"
      >
        {currentExecution ? (
          <ExecutionResultCard
            execution={currentExecution}
            inputSchema={currentScript?.inputSchema}
            outputSchema={currentScript?.outputSchema}
            title="执行记录"
            showTriggerSource={true}
            headerActions={
              <Button
                icon={<HistoryOutlined />}
                onClick={() => onRefillCurrentExecutionInput(currentExecution)}
              >
                回填本次输入
              </Button>
            }
          />
        ) : (
          <Empty description="请选择一条执行记录查看详情。" />
        )}
      </Drawer>
    </>
  );
}
