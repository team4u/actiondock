import { Space, Tabs } from "antd";
import { EventRecordManagementPage } from "./EventRecordManagementPage";
import { EventSourceManagementPage } from "./EventSourceManagementPage";
import { EventTriggerManagementPage } from "./EventTriggerManagementPage";
import { ScheduleManagementPage } from "./ScheduleManagementPage";

export function TriggerCenterPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
