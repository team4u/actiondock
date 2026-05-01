import { Alert, Card, Space, Steps, Tabs, Typography } from "antd";
import { PageHeader } from "../components/PageHeader";
import { EventRecordManagementPage } from "./EventRecordManagementPage";
import { EventSourceManagementPage } from "./EventSourceManagementPage";
import { EventTriggerManagementPage } from "./EventTriggerManagementPage";
import { ScheduleManagementPage } from "./ScheduleManagementPage";

const { Text } = Typography;

export function TriggerCenterPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader
        title="触发器"
        meta="统一管理定时触发、事件源、事件触发和事件记录。"
      />
      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="先建事件源，再绑事件触发器，最后用测试面板验证映射结果。"
            description="事件源负责接收和标准化，事件触发器负责过滤、幂等和入参生成，事件记录负责排障。"
          />
          <Steps
            size="small"
            responsive
            items={[
              {
                title: "创建事件源",
                description: <Text type="secondary">配置 sourceKey、Webhook 和鉴权方式。</Text>
              },
              {
                title: "配置触发器",
                description: <Text type="secondary">选择事件源、目标脚本和 Processor。</Text>
              },
              {
                title: "测试与排障",
                description: <Text type="secondary">用样例事件跑测试，必要时查看事件记录。</Text>
              }
            ]}
          />
        </Space>
      </Card>
      <Tabs
        defaultActiveKey="schedules"
        items={[
          {
            key: "schedules",
            label: "定时触发",
            children: <ScheduleManagementPage embedded />
          },
          {
            key: "sources",
            label: "事件源",
            children: <EventSourceManagementPage embedded />
          },
          {
            key: "triggers",
            label: "事件触发",
            children: <EventTriggerManagementPage embedded />
          },
          {
            key: "records",
            label: "事件记录",
            children: <EventRecordManagementPage embedded />
          }
        ]}
      />
    </Space>
  );
}
