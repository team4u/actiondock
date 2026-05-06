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

export const capabilitiesFeature: AppFeatureDefinition = {
  key: "capabilities",
  section: "capabilities",
  navLabel: "Capabilities",
  navPath: () => "/scripts",
  routes: (colorMode) => [
    { path: "/", element: <Navigate to="/scripts" replace />, title: "Capabilities", navKey: "capabilities" },
    { path: "/scripts", element: <ScriptLibraryPage />, title: "Capabilities", navKey: "capabilities" },
    { path: "/scripts/new", element: <ScriptEditorPage mode="create" colorMode={colorMode} />, title: "Capability Editor", navKey: "capabilities" },
    { path: "/scripts/:id", element: <ScriptEditorPage mode="edit" colorMode={colorMode} />, title: "Capability Editor", navKey: "capabilities" },
    { path: "/scripts/:id/run", element: <ScriptRunPage />, title: "Capability Run", navKey: "capabilities" }
  ]
};
