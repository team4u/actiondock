import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import {
  getEventRecord,
  listEventRecordDispatches,
  listEventRecords
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type { EventDispatchRecord, EventRecord } from "../types";
import { formatDateTime, getErrorMessage, prettyJson } from "../utils";

const { Text } = Typography;

interface EventRecordManagementPageProps {
  embedded?: boolean;
}

export function EventRecordManagementPage({ embedded = false }: EventRecordManagementPageProps) {
  const [items, setItems] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<EventRecord | null>(null);
  const [dispatches, setDispatches] = useState<EventDispatchRecord[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = async () => {
    setLoading(true);
    try {
      setItems(await listEventRecords());
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载事件记录失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openDetail = async (recordId: string) => {
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      const [record, nextDispatches] = await Promise.all([
        getEventRecord(recordId),
        listEventRecordDispatches(recordId)
      ]);
      setCurrentRecord(record);
      setDispatches(nextDispatches);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载事件详情失败"));
      setDrawerOpen(false);
    } finally {
      setDrawerLoading(false);
    }
  };

  const columns: ColumnsType<EventRecord> = [
    {
      title: "事件",
      dataIndex: "eventId",
      render: (_value, record) => (
        <TableLinkCell title={record.eventId || record.id} onClick={() => void openDetail(record.id)}>
          <Space direction="vertical" size={0}>
            <Text strong>{record.eventId || record.id}</Text>
            <Text type="secondary">{`${record.sourceKey}${record.eventType ? ` · ${record.eventType}` : ""}`}</Text>
          </Space>
        </TableLinkCell>
      )
    },
    {
      title: "状态",
      width: 140,
      render: (_value, record) => <Tag>{record.status}</Tag>
    },
    {
      title: "Actor",
      width: 180,
      render: (_value, record) => record.actor || "-"
    },
    {
      title: "Subject",
      render: (_value, record) => record.subject || "-"
    },
    {
      title: "时间",
      width: 180,
      render: (_value, record) => formatDateTime(record.createdAt)
    }
  ];

  const dispatchColumns: ColumnsType<EventDispatchRecord> = [
    { title: "触发器", dataIndex: "triggerId", render: (value) => <Text code>{value}</Text> },
    { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
    { title: "幂等 Key", dataIndex: "idempotencyKey", render: (value) => value ? <Text code>{value}</Text> : "-" },
    { title: "执行", dataIndex: "executionId", render: (value) => value ? <Text code>{value}</Text> : "-" }
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!embedded ? (
          <PageHeader
            title="事件记录"
            meta="查看收到的原始事件、标准事件和分发结果，点开一条记录就能沿链路排查。"
            actions={<Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>刷新</Button>}
          />
        ) : (
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>刷新</Button>
          </Space>
        )}
        <Alert
          type="info"
          showIcon
          message="事件记录是排障入口：先看原始请求，再看标准事件，最后看分发和执行结果。"
          description="如果某条事件没有触发，通常先检查鉴权、标准化和过滤 Processor。"
        />
        <Card>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有事件记录" />
          ) : (
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={[...items].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 980 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title="事件详情"
        open={drawerOpen}
        width={860}
        onClose={() => setDrawerOpen(false)}
        loading={drawerLoading}
      >
        {currentRecord ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="来源">
                {currentRecord.sourceKey}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag>{currentRecord.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="事件类型">
                {currentRecord.eventType || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="外部事件 ID">
                {currentRecord.eventId || "-"}
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="原始请求">
              <pre className="json-preview">{prettyJson({
                headers: currentRecord.rawHeaders,
                query: currentRecord.rawQuery,
                body: currentRecord.rawBody
              })}</pre>
            </Card>
            <Card size="small" title="标准事件">
              <pre className="json-preview">{prettyJson((currentRecord.normalizedEvent ?? {}) as unknown as Record<string, unknown>)}</pre>
            </Card>
            <Card size="small" title="分发记录">
              {dispatches.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前事件没有分发记录" />
              ) : (
                <Table
                  rowKey="id"
                  columns={dispatchColumns}
                  dataSource={dispatches}
                  pagination={false}
                  scroll={{ x: 760 }}
                />
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
