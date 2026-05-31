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
  import("../plugins/pages/PluginManagementPage").then((module) => ({ default: module.PluginManagementPage }))
);
const PluginDetailPage = lazy(() =>
  import("../plugins/pages/PluginDetailPage").then((module) => ({ default: module.PluginDetailPage }))
);
const SkillManagementPage = lazy(() =>
  import("../skills/pages/SkillManagementPage").then((module) => ({ default: module.SkillManagementPage }))
);
const SkillInstallPage = lazy(() =>
  import("../skills/pages/SkillInstallPage").then((module) => ({ default: module.SkillInstallPage }))
);
const SkillPublishPage = lazy(() =>
  import("../skills/pages/SkillPublishPage").then((module) => ({ default: module.SkillPublishPage }))
);
const SkillDetailPage = lazy(() =>
  import("../skills/pages/SkillDetailPage").then((module) => ({ default: module.SkillDetailPage }))
);
const ScanSkillsPage = lazy(() =>
  import("../skills/pages/ScanSkillsPage").then((module) => ({ default: module.ScanSkillsPage }))
);
const PlaybookPage = lazy(() =>
  import("../playbooks/pages/PlaybookPage").then((module) => ({ default: module.PlaybookPage }))
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

export const capabilitiesFeature: AppFeatureDefinition = {
  key: "capabilities",
  section: "capabilities",
  navLabel: "能力",
  navPath: () => "/scripts",
  navItems: [
    { label: "脚本", path: "/scripts" },
    { label: "任务手册", path: "/playbooks" },
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
    { path: "/playbooks", element: <PlaybookPage />, title: "任务手册", navKey: "capabilities" },
    { path: "/plugins", element: <PluginManagementPage />, title: "插件", navKey: "capabilities" },
    { path: "/plugins/:pluginId", element: <PluginDetailPage />, title: "插件详情", navKey: "capabilities" },
    { path: "/skills", element: <SkillManagementPage />, title: "Skills", navKey: "capabilities" },
    { path: "/skills/install", element: <SkillInstallPage />, title: "安装技能", navKey: "capabilities" },
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
