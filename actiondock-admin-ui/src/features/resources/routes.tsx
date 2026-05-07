import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const RepositoryDiscoveryPage = lazy(() =>
  import("./pages/RepositoryDiscoveryPage").then((module) => ({ default: module.RepositoryDiscoveryPage }))
);
const CapabilityPackagePublishPage = lazy(() =>
  import("./pages/CapabilityPackagePublishPage").then((module) => ({ default: module.CapabilityPackagePublishPage }))
);
const RepositoryManagementPage = lazy(() =>
  import("./pages/RepositoryManagementPage").then((module) => ({ default: module.RepositoryManagementPage }))
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

export const resourcesFeature: AppFeatureDefinition = {
  key: "resources",
  section: "resources",
  navLabel: "资源",
  navPath: () => "/discover",
  navItems: [
    { label: "发现", path: "/discover" },
    { label: "仓库", path: "/repositories" }
  ],
  routes: () => [
    { path: "/discover", element: <RepositoryDiscoveryPage />, title: "发现", navKey: "resources" },
    { path: "/packages/publish", element: <CapabilityPackagePublishPage />, title: "能力包发布", navKey: "resources" },
    { path: "/packages/:packageId/releases/new", element: <CapabilityPackagePublishPage />, title: "能力包发布", navKey: "resources" },
    { path: "/packages/:packageId/releases/:version", element: <CapabilityPackagePublishPage />, title: "能力包发布", navKey: "resources" },
    { path: "/repositories", element: <RepositoryManagementPage />, title: "仓库", navKey: "resources" }
  ]
};
