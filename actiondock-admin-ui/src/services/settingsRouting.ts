export const SYSTEM_SETTINGS_TABS = ["config-values", "shared-state", "access-tokens", "console-token", "data-backup"] as const;

export type SystemSettingsTab = (typeof SYSTEM_SETTINGS_TABS)[number];

const DEFAULT_SYSTEM_SETTINGS_TAB: SystemSettingsTab = "config-values";

export function resolveSystemSettingsTab(search: URLSearchParams | string): SystemSettingsTab {
  const searchParams = typeof search === "string" ? new URLSearchParams(search) : search;
  const requestedTab = searchParams.get("tab");
  return SYSTEM_SETTINGS_TABS.includes(requestedTab as SystemSettingsTab)
    ? requestedTab as SystemSettingsTab
    : DEFAULT_SYSTEM_SETTINGS_TAB;
}

export function buildSystemSettingsSearch(tab: SystemSettingsTab): string {
  const searchParams = new URLSearchParams();
  searchParams.set("tab", tab);
  return `?${searchParams.toString()}`;
}

export function isSystemSettingsRoute(pathname: string): boolean {
  return pathname === "/settings";
}
