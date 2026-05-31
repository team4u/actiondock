import type { ColorMode } from "../shared/contexts/ColorModeContext";
import { appFeatures } from "./features";
import type { AppFeatureRoute, AppSectionKey } from "./featureRegistry";

export interface AppNavItem {
  key: AppSectionKey;
  label: string;
  getPath: (colorMode: ColorMode) => string;
  children: AppNavChildItem[];
}

export interface AppNavChildItem {
  key: string;
  label: string;
  path: string;
}

const SECTION_LABELS: Record<AppSectionKey, string> = {
  capabilities: "能力",
  resources: "资源",
  executions: "触发",
  settings: "设置"
};

export const appNavItems: AppNavItem[] = appFeatures.map((feature) => ({
  key: feature.section,
  label: SECTION_LABELS[feature.section] ?? feature.navLabel,
  getPath: feature.navPath,
  children: feature.navItems.map((item) => ({
    key: item.path,
    label: item.label,
    path: item.path
  }))
}));

function flattenRoutes(colorMode: ColorMode = "light"): AppFeatureRoute[] {
  return appFeatures.flatMap((feature) => feature.routes(colorMode));
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function isChildPathMatch(pathname: string, childPath: string): boolean {
  const normalizedPath = normalizePath(pathname);
  const normalizedChildPath = normalizePath(childPath);
  return normalizedPath === normalizedChildPath || normalizedPath.startsWith(`${normalizedChildPath}/`);
}

function matchRoute(pathname: string): AppFeatureRoute | undefined {
  const normalizedPath = normalizePath(pathname);
  return flattenRoutes().find((route) => {
    if (normalizePath(route.path) === normalizedPath) {
      return true;
    }
    const pattern = route.path
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([^/]+)/g, "[^/]+");
    return new RegExp(`^${pattern}$`).test(normalizedPath);
  });
}

export function resolveSelectedNavKey(pathname: string): AppSectionKey | "" {
  return matchRoute(pathname)?.navKey ?? "";
}

export function resolveSelectedMenuKey(pathname: string): string {
  const selectedNavKey = resolveSelectedNavKey(pathname);
  const selectedFeature = appNavItems.find((item) => item.key === selectedNavKey);
  if (!selectedFeature?.children.length) {
    return selectedNavKey;
  }
  const matchedChild = [...selectedFeature.children]
    .map((item) => item.path)
    .filter((path) => isChildPathMatch(pathname, path))
    .sort((left, right) => right.length - left.length)[0];
  return matchedChild ?? selectedNavKey;
}

export function resolveTitle(pathname: string, selectedNavKey: AppSectionKey | ""): string {
  return matchRoute(pathname)?.title
    ?? appNavItems.find((item) => item.key === selectedNavKey)?.label
    ?? "能力";
}
