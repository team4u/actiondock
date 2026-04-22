import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  deleteSchedule,
  disableSchedule,
  enableSchedule,
  listSchedules
} from "../api";
import { TableLinkCell } from "../components/TableLinkCell";
import type { ExecutionStatus, ScriptSchedule } from "../types";
import { formatDateTime } from "../utils";

const { Text } = Typography;

export function ScheduleManagementPage() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = async () => {
    setLoading(true);
    try {
      const scheduleData = await listSchedules();
      setSchedules(
        [...scheduleData].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      );
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载定时任务失败";
      messageApi.error(detail);
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

  const withAction = async (scheduleId: string, action: () => Promise<void>) => {
    setActiveScheduleId(scheduleId);
    try {
      await action();
    } finally {
      setActiveScheduleId(null);
    }
  };

  const getExecutionStatusColor = (status?: ExecutionStatus): string => {
    switch (status) {
      case "SUCCESS":
        return "green";
      case "FAILED":
        return "red";
      case "RUNNING":
        return "processing";
      case "PENDING":
        return "gold";
      default:
        return "default";
    }
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
        <Tag color={record.enabled ? "green" : "default"}>{record.enabled ? "ENABLED" : "DISABLED"}</Tag>
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
              loading={activeScheduleId === record.id}
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
              loading={activeScheduleId === record.id}
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
            <Button size="small" danger icon={<DeleteOutlined />} loading={activeScheduleId === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Card title="定时任务列表">
        <div className="script-list-toolbar">
          <Space direction="vertical" size={2} className="script-list-toolbar__meta">
            <Text type="secondary">共 {schedules.length} 个定时任务</Text>
            <Text type="secondary">启用中 {schedules.filter((schedule) => schedule.enabled).length} 个</Text>
          </Space>
          <Space wrap className="script-list-toolbar__actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/schedules/new")}>
              新建定时任务
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>

        {schedules.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有定时任务" />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={schedules}
            pagination={{ pageSize: 10, responsive: true }}
            scroll={{ x: 1140 }}
          />
        )}

      </Card>
    </>
  );
}
