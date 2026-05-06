import { lazy } from "react";
import { Navigate } from "react-router-dom";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const ScriptLibraryPage = lazy(() =>
  import("./pages/ScriptLibraryPage").then((module) => ({ default: module.ScriptLibraryPage }))
);
const ScriptEditorPage = lazy(() =>
  import("./pages/ScriptEditorPage").then((module) => ({ default: module.ScriptEditorPage }))
);
const ScriptRunPage = lazy(() =>
  import("./pages/ScriptRunPage").then((module) => ({ default: module.ScriptRunPage }))
);
const PluginManagementPage = lazy(() =>
  import("../../pages/PluginManagementPage").then((module) => ({ default: module.PluginManagementPage }))
);
const PluginDetailPage = lazy(() =>
  import("../../pages/PluginDetailPage").then((module) => ({ default: module.PluginDetailPage }))
);
const SkillManagementPage = lazy(() =>
  import("../../pages/SkillManagementPage").then((module) => ({ default: module.SkillManagementPage }))
);
const SkillPublishPage = lazy(() =>
  import("../../pages/SkillPublishPage").then((module) => ({ default: module.SkillPublishPage }))
);
const SkillDetailPage = lazy(() =>
  import("../../pages/SkillDetailPage").then((module) => ({ default: module.SkillDetailPage }))
);
const ScanSkillsPage = lazy(() =>
  import("../../pages/ScanSkillsPage").then((module) => ({ default: module.ScanSkillsPage }))
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

export const capabilitiesFeature: AppFeatureDefinition = {
  key: "capabilities",
  section: "capabilities",
  navLabel: "能力",
  navPath: () => "/scripts",
  navItems: [
    { label: "脚本", path: "/scripts" },
    { label: "插件", path: "/plugins" },
    { label: "Skills", path: "/skills" },
    { label: "AI", path: "/ai" }
  ],
  routes: (colorMode) => [
    { path: "/", element: <Navigate to="/scripts" replace />, title: "能力", navKey: "capabilities" },
    { path: "/scripts", element: <ScriptLibraryPage />, title: "脚本", navKey: "capabilities" },
    { path: "/scripts/new", element: <ScriptEditorPage mode="create" colorMode={colorMode} />, title: "脚本编辑器", navKey: "capabilities" },
    { path: "/scripts/:id", element: <ScriptEditorPage mode="edit" colorMode={colorMode} />, title: "脚本编辑器", navKey: "capabilities" },
    { path: "/scripts/:id/run", element: <ScriptRunPage />, title: "脚本运行", navKey: "capabilities" },
    { path: "/plugins", element: <PluginManagementPage />, title: "插件", navKey: "capabilities" },
    { path: "/plugins/:pluginId", element: <PluginDetailPage />, title: "插件详情", navKey: "capabilities" },
    { path: "/skills", element: <SkillManagementPage />, title: "Skills", navKey: "capabilities" },
    { path: "/skills/publish", element: <SkillPublishPage />, title: "发布技能", navKey: "capabilities" },
    { path: "/skills/scan/:targetId", element: <ScanSkillsPage />, title: "扫描目标", navKey: "capabilities" },
    { path: "/skills/:skillId", element: <SkillDetailPage />, title: "技能详情", navKey: "capabilities" },
    { path: "/ai", element: <AiOverviewPage />, title: "AI 概览", navKey: "capabilities" },
    { path: "/ai/models", element: <AiModelProfileListPage />, title: "模型配置", navKey: "capabilities" },
    { path: "/ai/models/new", element: <AiModelProfileDetailPage />, title: "模型配置", navKey: "capabilities" },
    { path: "/ai/models/:id", element: <AiModelProfileDetailPage />, title: "模型配置", navKey: "capabilities" },
    { path: "/ai/agents", element: <AiAgentProfileListPage />, title: "Agent 配置", navKey: "capabilities" },
    { path: "/ai/agents/new", element: <AiAgentProfileDetailPage />, title: "Agent 配置", navKey: "capabilities" },
    { path: "/ai/agents/:id", element: <AiAgentProfileDetailPage />, title: "Agent 配置", navKey: "capabilities" },
    { path: "/ai/toolsets", element: <AiToolsetListPage />, title: "Toolset", navKey: "capabilities" },
    { path: "/ai/toolsets/new", element: <AiToolsetDetailPage />, title: "Toolset", navKey: "capabilities" },
    { path: "/ai/toolsets/:id", element: <AiToolsetDetailPage />, title: "Toolset", navKey: "capabilities" },
    { path: "/ai/runs", element: <AiRunListPage />, title: "运行记录", navKey: "capabilities" },
    { path: "/ai/runs/:runId", element: <AiRunDetailPage />, title: "运行记录", navKey: "capabilities" }
  ]
};
