import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const WebhookManagementPage = lazy(() =>
  import("./pages/WebhookManagementPage").then((module) => ({ default: module.WebhookManagementPage }))
);
const ScheduleManagementPage = lazy(() =>
  import("./pages/ScheduleManagementPage").then((module) => ({ default: module.ScheduleManagementPage }))
)
const ScheduleEditorPage = lazy(() =>
  import("./pages/ScheduleEditorPage").then((module) => ({ default: module.ScheduleEditorPage }))
);
const AiOverviewPage = lazy(() =>
  import("../ai/pages/AiOverviewPage").then((module) => ({ default: module.AiOverviewPage }))
);
const AiModelProfileListPage = lazy(() =>
  import("../ai/pages/AiModelProfileListPage").then((module) => ({ default: module.AiModelProfileListPage }))
);
const AiAgentProfileListPage = lazy(() =>
  import("../ai/pages/AiAgentProfileListPage").then((module) => ({ default: module.AiAgentProfileListPage }))
);
const AiToolsetListPage = lazy(() =>
  import("../ai/pages/AiToolsetListPage").then((module) => ({ default: module.AiToolsetListPage }))
);
const AiToolsetDetailPage = lazy(() =>
  import("../ai/pages/AiToolsetDetailPage").then((module) => ({ default: module.AiToolsetDetailPage }))
);
const AiRunListPage = lazy(() =>
  import("../ai/pages/AiRunListPage").then((module) => ({ default: module.AiRunListPage }))
);
const AiRunDetailPage = lazy(() =>
  import("../ai/pages/AiRunDetailPage").then((module) => ({ default: module.AiRunDetailPage }))
);
const AiModelProfileDetailPage = lazy(() =>
  import("../ai/pages/AiProfileDetailPage").then((module) => ({ default: module.AiModelProfileDetailPage }))
);
const AiAgentProfileDetailPage = lazy(() =>
  import("../ai/pages/AiProfileDetailPage").then((module) => ({ default: module.AiAgentProfileDetailPage }))
);

export const executionsFeature: AppFeatureDefinition = {
  key: "executions",
  section: "executions",
  navLabel: "触发",
  navPath: () => "/webhooks",
  navItems: [
    { label: "Webhook", path: "/webhooks" },
    { label: "定时任务", path: "/schedules" }
  ],
  routes: (colorMode) => [
    { path: "/webhooks", element: <WebhookManagementPage />, title: "Webhook", navKey: "executions" },
    { path: "/schedules", element: <ScheduleManagementPage />, title: "定时任务", navKey: "executions" },
    { path: "/schedules/new", element: <ScheduleEditorPage mode="create" colorMode={colorMode} />, title: "定时任务编辑器", navKey: "executions" },
    { path: "/schedules/:id", element: <ScheduleEditorPage mode="edit" colorMode={colorMode} />, title: "定时任务编辑器", navKey: "executions" }
  ]
};
