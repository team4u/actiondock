export const SYSTEM_SETTINGS_TABS = ["api-key"] as const;

export type SystemSettingsTab = (typeof SYSTEM_SETTINGS_TABS)[number];

const DEFAULT_SYSTEM_SETTINGS_TAB: SystemSettingsTab = "api-key";

export function resolveSystemSettingsTab(search: URLSearchParams | string): SystemSettingsTab {
  const searchParams = typeof search === "string" ? new URLSearchParams(search) : search;
  const requestedTab = searchParams.get("tab");
  return requestedTab === "api-key" ? requestedTab : DEFAULT_SYSTEM_SETTINGS_TAB;
}

export function buildSystemSettingsSearch(tab: SystemSettingsTab): string {
  const searchParams = new URLSearchParams();
  searchParams.set("tab", tab);
  return `?${searchParams.toString()}`;
}

export function isApiKeySettingsRoute(pathname: string, search: string): boolean {
  return pathname === "/settings/api-key"
    || (pathname === "/settings" && resolveSystemSettingsTab(search) === "api-key");
}
