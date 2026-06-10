export const SKILL_MANAGEMENT_TABS = ["skills", "targets"] as const;

export type SkillManagementTab = (typeof SKILL_MANAGEMENT_TABS)[number];

const DEFAULT_SKILL_MANAGEMENT_TAB: SkillManagementTab = "skills";

export function resolveSkillManagementTab(search: URLSearchParams | string): SkillManagementTab {
  const searchParams = typeof search === "string" ? new URLSearchParams(search) : search;
  const requestedTab = searchParams.get("tab");
  return SKILL_MANAGEMENT_TABS.includes(requestedTab as SkillManagementTab)
    ? requestedTab as SkillManagementTab
    : DEFAULT_SKILL_MANAGEMENT_TAB;
}

export function buildSkillManagementSearch(tab: SkillManagementTab): string {
  const searchParams = new URLSearchParams();
  searchParams.set("tab", tab);
  return `?${searchParams.toString()}`;
}
