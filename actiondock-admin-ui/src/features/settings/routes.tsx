import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";
import { buildSystemSettingsSearch } from "../../settingsRouting";

const SystemSettingsPage = lazy(() =>
  import("../../pages/SystemSettingsPage").then((module) => ({ default: module.SystemSettingsPage }))
);

export const settingsFeature: AppFeatureDefinition = {
  key: "settings",
  section: "settings",
  navLabel: "Settings",
  navPath: () => `/settings${buildSystemSettingsSearch("config-values")}`,
  routes: () => [
    { path: "/settings", element: <SystemSettingsPage />, title: "Settings", navKey: "settings" }
  ]
};
