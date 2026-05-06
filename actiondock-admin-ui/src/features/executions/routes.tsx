import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const TriggerCenterPage = lazy(() =>
  import("../../pages/TriggerCenterPage").then((module) => ({ default: module.TriggerCenterPage }))
);
const ScheduleEditorPage = lazy(() =>
  import("../../pages/ScheduleEditorPage").then((module) => ({ default: module.ScheduleEditorPage }))
);
const AiOverviewPage = lazy(() =>
  import("../../pages/ai/AiOverviewPage").then((module) => ({ default: module.AiOverviewPage }))
);
const AiModelProfileListPage = lazy(() =>
  import("../../pages/ai/AiModelProfileListPage").then((module) => ({ default: module.AiModelProfileListPage }))
);
const AiAgentProfileListPage = lazy(() =>
  import("../../pages/ai/AiAgentProfileListPage").then((module) => ({ default: module.AiAgentProfileListPage }))
);
const AiToolsetListPage = lazy(() =>
  import("../../pages/ai/AiToolsetListPage").then((module) => ({ default: module.AiToolsetListPage }))
);
const AiToolsetDetailPage = lazy(() =>
  import("../../pages/ai/AiToolsetDetailPage").then((module) => ({ default: module.AiToolsetDetailPage }))
);
const AiRunListPage = lazy(() =>
  import("../../pages/ai/AiRunListPage").then((module) => ({ default: module.AiRunListPage }))
);
const AiRunDetailPage = lazy(() =>
  import("../../pages/ai/AiRunDetailPage").then((module) => ({ default: module.AiRunDetailPage }))
);
const AiModelProfileDetailPage = lazy(() =>
  import("../../pages/ai/AiProfileDetailPage").then((module) => ({ default: module.AiModelProfileDetailPage }))
);
const AiAgentProfileDetailPage = lazy(() =>
  import("../../pages/ai/AiProfileDetailPage").then((module) => ({ default: module.AiAgentProfileDetailPage }))
);

export const executionsFeature: AppFeatureDefinition = {
  key: "executions",
  section: "executions",
  navLabel: "触发",
  navPath: () => "/triggers",
  navItems: [],
  routes: (colorMode) => [
    { path: "/triggers", element: <TriggerCenterPage />, title: "触发中心", navKey: "executions" },
    { path: "/schedules/new", element: <ScheduleEditorPage mode="create" colorMode={colorMode} />, title: "定时任务编辑器", navKey: "executions" },
    { path: "/schedules/:id", element: <ScheduleEditorPage mode="edit" colorMode={colorMode} />, title: "定时任务编辑器", navKey: "executions" }
  ]
};
