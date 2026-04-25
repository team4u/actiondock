import {
  DownloadOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Card, Empty, Modal, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { ChangeEvent, Key } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  createSchedule,
  deleteSchedule,
  disableSchedule,
  enableSchedule,
  listSchedules,
  updateSchedule
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import { useActionWithLoading } from "../hooks/useActionWithLoading";
import {
  analyzeScheduleImport,
  buildScheduleExportBundle,
  downloadJsonFile,
  formatScheduleExportFileName,
  parseScheduleImportBundle
} from "../scriptTransfer";
import type { ScriptSchedule } from "../types";
import { formatDateTime, getExecutionStatusColor, getErrorMessage } from "../utils";

const { Text } = Typography;

export function ScheduleManagementPage() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Key[]>([]);
  const { actionId, withAction } = useActionWithLoading();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadData = async () => {
    setLoading(true);
    try {
      const scheduleData = await listSchedules();
      const sorted = [...scheduleData].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
      setSchedules(sorted);
      setSelectedScheduleIds((previous) => previous.filter((id) => sorted.some((schedule) => schedule.id === id)));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载定时任务失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const upsertSchedule = (nextSchedule: ScriptSchedule) => {
    setSchedules((previous) => {
      const hasExisting = previous.some((schedule) => schedule.id === nextSchedule.id);
      const next = hasExisting
        ? previous.map((schedule) => (schedule.id === nextSchedule.id ? nextSchedule : schedule))
        : [nextSchedule, ...previous];
      return [...next].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    });
  };

  const exportSchedules = (targetSchedules: ScriptSchedule[], successMessage: string) => {
    try {
      const bundle = buildScheduleExportBundle(targetSchedules);
      downloadJsonFile(formatScheduleExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出定时任务失败");
    }
  };

  const handleExportAll = () => {
    exportSchedules(schedules, `已导出 ${schedules.length} 个定时任务`);
  };

  const handleExportSelected = () => {
    const selectedSchedules = schedules.filter((schedule) => selectedScheduleIds.includes(schedule.id));
    exportSchedules(selectedSchedules, `已导出 ${selectedSchedules.length} 个选中定时任务`);
  };

  const runImport = async (importedSchedules: ScriptSchedule[]) => {
    setImporting(true);
    const currentIds = new Set(schedules.map((schedule) => schedule.id));
    const successes: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    try {
      for (const schedule of importedSchedules) {
        const payload = {
          scriptId: schedule.scriptId,
          name: schedule.name,
          cronExpression: schedule.cronExpression,
          input: schedule.input,
          enabled: schedule.enabled
        };
        try {
          if (currentIds.has(schedule.id)) {
            await updateSchedule(schedule.id, payload);
          } else {
            await createSchedule(payload);
          }
          successes.push(schedule.id);
        } catch (error) {
          const detail = error instanceof ApiError ? error.message : "导入失败";
          failures.push({ id: schedule.id, reason: detail });
        }
      }

      if (successes.length > 0) {
        await loadData();
      }

      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个定时任务`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分定时任务处理失败",
        width: 640,
        content: (
          <div className="script-import-result">
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre className="script-import-result__code">
              {failures.slice(0, 10).map((item) => `${item.id}: ${item.reason}`).join("\n")}
            </pre>
            {failures.length > 10 ? <Text type="secondary">仅展示前 10 条失败明细。</Text> : null}
          </div>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedSchedules = parseScheduleImportBundle(await file.text());
      const analysis = analyzeScheduleImport(importedSchedules, schedules);
      const overwritePreview = analysis.overwriteIds.slice(0, 10);

      await modal.confirm({
        title: "确认导入定时任务",
        okText: "开始导入",
        cancelText: "取消",
        width: 680,
        content: (
          <div className="script-import-summary">
            <Text>共解析到 {analysis.schedules.length} 个定时任务。</Text>
            <Text>新增 {analysis.createIds.length} 个，覆盖 {analysis.overwriteIds.length} 个。</Text>
            {analysis.createIds.length > 0 ? (
              <Text type="secondary">不存在的任务会按导入内容新建，系统会重新分配实际 ID。</Text>
            ) : null}
            {analysis.overwriteIds.length > 0 ? (
              <>
                <Text strong>将被覆盖的定时任务 ID</Text>
                <pre className="script-import-result__code">{overwritePreview.join("\n")}</pre>
                {analysis.overwriteIds.length > overwritePreview.length ? (
                  <Text type="secondary">
                    仅展示前 {overwritePreview.length} 个，剩余 {analysis.overwriteIds.length - overwritePreview.length} 个将在导入时一并覆盖。
                  </Text>
                ) : null}
              </>
            ) : null}
          </div>
        ),
        onOk: () => runImport(analysis.schedules)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "导入定时任务失败";
      messageApi.error(detail);
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      messageApi.error("仅支持导入 .json 文件");
      return;
    }

    await handleImportFile(file);
  };

  const columns: ColumnsType<ScriptSchedule> = [
    {
      title: "任务名称",
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (value: string, record) => (
        <TableLinkCell to={`/schedules/${record.id}`} title={value} ellipsis>
          {value}
        </TableLinkCell>
      )
    },
    {
      title: "状态",
      key: "enabled",
      width: 120,
      render: (_: unknown, record) => (
        <Tag color={record.enabled ? "green" : "default"}>{record.enabled ? "已启用" : "已停用"}</Tag>
      )
    },
    {
      title: "下次执行",
      dataIndex: "nextRunAt",
      key: "nextRunAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "最近触发",
      dataIndex: "lastTriggeredAt",
      key: "lastTriggeredAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "最近执行",
      key: "lastExecution",
      width: 180,
      render: (_: unknown, record) =>
        record.lastExecutionId ? (
          <Space direction="vertical" size={2}>
            <Tag color={getExecutionStatusColor(record.lastExecutionStatus)}>
              {record.lastExecutionStatus ?? "UNKNOWN"}
            </Tag>
            <Text type="secondary" code>
              {record.lastExecutionId}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">暂无</Text>
        )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, record) => (
        <Space wrap>
          {record.enabled ? (
            <Button
              size="small"
              icon={<PauseCircleOutlined />}
              loading={actionId === record.id}
              onClick={() =>
                void withAction(record.id, async () => {
                  upsertSchedule(await disableSchedule(record.id));
                  messageApi.success("定时任务已停用");
                })
              }
            >
              停用
            </Button>
          ) : (
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              loading={actionId === record.id}
              onClick={() =>
                void withAction(record.id, async () => {
                  upsertSchedule(await enableSchedule(record.id));
                  messageApi.success("定时任务已启用");
                })
              }
            >
              启用
            </Button>
          )}
          <Popconfirm
            title="确认删除这个定时任务？"
            okText="删除"
            cancelText="取消"
            onConfirm={() =>
              withAction(record.id, async () => {
                await deleteSchedule(record.id);
                setSchedules((previous) => previous.filter((schedule) => schedule.id !== record.id));
                messageApi.success("定时任务已删除");
              })
            }
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={actionId === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const rowSelection: TableRowSelection<ScriptSchedule> = {
    selectedRowKeys: selectedScheduleIds,
    onChange: (nextSelectedRowKeys) => setSelectedScheduleIds(nextSelectedRowKeys),
    preserveSelectedRowKeys: true
  };

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleImportChange(event)}
      />
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          actions={
            <>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/schedules/new")}>
                新建任务
              </Button>
              <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileInputRef.current?.click()}>
                导入任务
              </Button>
              <Button icon={<DownloadOutlined />} disabled={loading || importing || schedules.length === 0} onClick={handleExportAll}>
                导出全部
              </Button>
              <Button
                icon={<DownloadOutlined />}
                type="primary"
                ghost
                disabled={loading || importing || selectedScheduleIds.length === 0}
                onClick={handleExportSelected}
              >
                导出选中
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                刷新
              </Button>
            </>
          }
        />
        <Card>

          {schedules.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有定时任务" />
          ) : (
            <Table
              rowKey="id"
              loading={loading || importing}
              rowSelection={rowSelection}
              columns={columns}
              dataSource={schedules}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 1140 }}
            />
          )}

        </Card>
      </Space>
    </>
  );
}
