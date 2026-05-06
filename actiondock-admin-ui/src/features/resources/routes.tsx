import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const RepositoryDiscoveryPage = lazy(() =>
  import("../../pages/RepositoryDiscoveryPage").then((module) => ({ default: module.RepositoryDiscoveryPage }))
);
const CapabilityPackagePublishPage = lazy(() =>
  import("../../pages/CapabilityPackagePublishPage").then((module) => ({ default: module.CapabilityPackagePublishPage }))
);
const RepositoryManagementPage = lazy(() =>
  import("../../pages/RepositoryManagementPage").then((module) => ({ default: module.RepositoryManagementPage }))
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
const SkillInstallPage = lazy(() =>
  import("../../pages/SkillInstallPage").then((module) => ({ default: module.SkillInstallPage }))
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

export const resourcesFeature: AppFeatureDefinition = {
  key: "resources",
  section: "resources",
  navLabel: "Resources",
  navPath: () => "/discover",
  routes: () => [
    { path: "/discover", element: <RepositoryDiscoveryPage />, title: "Resource Discovery", navKey: "resources" },
    { path: "/packages/publish", element: <CapabilityPackagePublishPage />, title: "Publish Package", navKey: "resources" },
    { path: "/packages/:packageId/releases/new", element: <CapabilityPackagePublishPage />, title: "Publish Package", navKey: "resources" },
    { path: "/packages/:packageId/releases/:version", element: <CapabilityPackagePublishPage />, title: "Publish Package", navKey: "resources" },
    { path: "/repositories", element: <RepositoryManagementPage />, title: "Repositories", navKey: "resources" },
    { path: "/plugins", element: <PluginManagementPage />, title: "Plugins", navKey: "resources" },
    { path: "/plugins/:pluginId", element: <PluginDetailPage />, title: "Plugin Detail", navKey: "resources" },
    { path: "/skills", element: <SkillManagementPage />, title: "Skills", navKey: "resources" },
    { path: "/skills/install", element: <SkillInstallPage />, title: "Install Skill", navKey: "resources" },
    { path: "/skills/publish", element: <SkillPublishPage />, title: "Publish Skill", navKey: "resources" },
    { path: "/skills/scan/:targetId", element: <ScanSkillsPage />, title: "Scan Target", navKey: "resources" },
    { path: "/skills/:skillId", element: <SkillDetailPage />, title: "Skill Detail", navKey: "resources" }
  ]
};
