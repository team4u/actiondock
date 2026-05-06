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
  navLabel: "Executions",
  navPath: () => "/triggers",
  routes: (colorMode) => [
    { path: "/triggers", element: <TriggerCenterPage />, title: "Executions", navKey: "executions" },
    { path: "/schedules/new", element: <ScheduleEditorPage mode="create" colorMode={colorMode} />, title: "Schedule Editor", navKey: "executions" },
    { path: "/schedules/:id", element: <ScheduleEditorPage mode="edit" colorMode={colorMode} />, title: "Schedule Editor", navKey: "executions" },
    { path: "/ai", element: <AiOverviewPage />, title: "AI Capabilities", navKey: "executions" },
    { path: "/ai/models", element: <AiModelProfileListPage />, title: "Model Profiles", navKey: "executions" },
    { path: "/ai/models/new", element: <AiModelProfileDetailPage />, title: "Model Profile", navKey: "executions" },
    { path: "/ai/models/:id", element: <AiModelProfileDetailPage />, title: "Model Profile", navKey: "executions" },
    { path: "/ai/agents", element: <AiAgentProfileListPage />, title: "Agent Profiles", navKey: "executions" },
    { path: "/ai/agents/new", element: <AiAgentProfileDetailPage />, title: "Agent Profile", navKey: "executions" },
    { path: "/ai/agents/:id", element: <AiAgentProfileDetailPage />, title: "Agent Profile", navKey: "executions" },
    { path: "/ai/toolsets", element: <AiToolsetListPage />, title: "Toolsets", navKey: "executions" },
    { path: "/ai/toolsets/new", element: <AiToolsetDetailPage />, title: "Toolset", navKey: "executions" },
    { path: "/ai/toolsets/:id", element: <AiToolsetDetailPage />, title: "Toolset", navKey: "executions" },
    { path: "/ai/runs", element: <AiRunListPage />, title: "AI Runs", navKey: "executions" },
    { path: "/ai/runs/:runId", element: <AiRunDetailPage />, title: "AI Run Detail", navKey: "executions" }
  ]
};
