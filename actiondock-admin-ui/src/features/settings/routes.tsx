import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";
import { buildSystemSettingsSearch } from "../../services/settingsRouting";

const SystemSettingsPage = lazy(() =>
  import("./pages/SystemSettingsPage").then((module) => ({ default: module.SystemSettingsPage }))
);

export const settingsFeature: AppFeatureDefinition = {
  key: "settings",
  section: "settings",
  navLabel: "设置",
  navPath: () => `/settings${buildSystemSettingsSearch("config-values")}`,
  navItems: [],
  routes: () => [
    { path: "/settings", element: <SystemSettingsPage />, title: "系统设置", navKey: "settings" }
  ]
};
