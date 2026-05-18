import type { ReactNode } from "react";
import type { ColorMode } from "../shared/contexts/ColorModeContext";

export type AppSectionKey = "capabilities" | "resources" | "executions" | "settings";

export interface AppFeatureRoute {
  path: string;
  element: ReactNode;
  title: string;
  navKey?: AppSectionKey;
}

export interface AppFeatureDefinition {
  key: string;
  section: AppSectionKey;
  navLabel: string;
  navPath: (colorMode: ColorMode) => string;
  navItems: { label: string; path: string }[];
  routes: (colorMode: ColorMode) => AppFeatureRoute[];
}
