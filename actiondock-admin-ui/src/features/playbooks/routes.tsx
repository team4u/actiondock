import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const PlaybookPage = lazy(() =>
  import("./pages/PlaybookPage").then((module) => ({ default: module.PlaybookPage }))
);

export const playbooksFeature: AppFeatureDefinition = {
  key: "playbooks",
  section: "playbooks",
  navLabel: "任务手册",
  navPath: () => "/playbooks",
  navItems: [],
  routes: () => [
    { path: "/playbooks", element: <PlaybookPage />, title: "任务手册", navKey: "playbooks" }
  ]
};
