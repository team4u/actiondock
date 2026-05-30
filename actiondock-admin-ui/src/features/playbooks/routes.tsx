import { lazy } from "react";
import type { AppFeatureDefinition } from "../../app/featureRegistry";

const PlaybookGroupPage = lazy(() =>
  import("./pages/PlaybookGroupPage").then((module) => ({ default: module.PlaybookGroupPage }))
);
const PlaybookPage = lazy(() =>
  import("./pages/PlaybookPage").then((module) => ({ default: module.PlaybookPage }))
);

export const playbooksFeature: AppFeatureDefinition = {
  key: "playbooks",
  section: "playbooks",
  navLabel: "任务手册",
  navPath: () => "/playbooks",
  navItems: [
    { label: "任务手册", path: "/playbooks" },
    { label: "任务分组", path: "/playbook-groups" }
  ],
  routes: () => [
    { path: "/playbooks", element: <PlaybookPage />, title: "任务手册", navKey: "playbooks" },
    { path: "/playbook-groups", element: <PlaybookGroupPage />, title: "任务分组", navKey: "playbooks" }
  ]
};
