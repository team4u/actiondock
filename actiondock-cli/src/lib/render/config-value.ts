import type { ConfigValueDetailView, ConfigValueView } from "../types.js";

export function renderConfigValueList(items: ConfigValueView[]): string {
  if (items.length === 0) {
    return "没有配置值。";
  }

  return items
    .map((item) => {
      const secret = item.secret ? " secret" : "";
      const managed = item.managed ? " managed" : "";
      const overridden = item.overridden ? " overridden" : "";
      const value = item.valueMasked ?? (item.hasValue ? "<set>" : "<empty>");
      return `${item.key} ${value}${secret}${managed}${overridden}`;
    })
    .join("\n");
}

export function renderConfigValueDetail(item: ConfigValueDetailView | ConfigValueView): string {
  const lines = [
    `ConfigValue: ${item.key}`,
    `Value: ${item.valueMasked ?? item.value ?? (item.hasValue ? "<set>" : "<empty>")}`,
    `Secret: ${item.secret ? "yes" : "no"}`,
    `Managed: ${item.managed ? "yes" : "no"}`,
    `Overridden: ${item.overridden ? "yes" : "no"}`,
    `PublishMode: ${item.publishMode ?? "-"}`
  ];
  if (item.description) {
    lines.push(`Description: ${item.description}`);
  }
  if (item.repositoryId) {
    lines.push(`Repository: ${item.repositoryId}${(item.repositoryScriptId ?? item.repositoryScriptId) ? `/${item.repositoryScriptId ?? item.repositoryScriptId}` : ""}${item.repositoryVersion ? `@${item.repositoryVersion}` : ""}`);
  }
  if ("impactedScripts" in item && item.impactedScripts) {
    lines.push(`ImpactedScripts: ${item.impactedScripts.length}`);
  }
  return lines.join("\n");
}
