import type { ColorMode } from "../contexts/ColorModeContext";
import { appFeatures } from "./features";
import type { AppFeatureRoute, AppSectionKey } from "./featureRegistry";

export interface AppNavItem {
  key: AppSectionKey;
  label: string;
  getPath: (colorMode: ColorMode) => string;
}

export const appNavItems: AppNavItem[] = appFeatures.map((feature) => ({
  key: feature.section,
  label: feature.navLabel,
  getPath: feature.navPath
}));

function flattenRoutes(colorMode: ColorMode = "light"): AppFeatureRoute[] {
  return appFeatures.flatMap((feature) => feature.routes(colorMode));
}

function matchRoute(pathname: string): AppFeatureRoute | undefined {
  return flattenRoutes().find((route) => {
    if (route.path === pathname) {
      return true;
    }
    const pattern = route.path
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([^/]+)/g, "[^/]+");
    return new RegExp(`^${pattern}$`).test(pathname);
  });
}

export function resolveSelectedNavKey(pathname: string): AppSectionKey | "" {
  return matchRoute(pathname)?.navKey ?? "";
}

export function resolveTitle(pathname: string, selectedNavKey: AppSectionKey | ""): string {
  return matchRoute(pathname)?.title
    ?? appNavItems.find((item) => item.key === selectedNavKey)?.label
    ?? "Capabilities";
}
