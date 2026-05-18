import type { ConfigValue, ConfigValueDetail } from "../shared/types";

export function shouldMaskConfigValue(item: Pick<ConfigValue, "secret" | "publishMode">): boolean {
  return Boolean(item.secret) || String(item.publishMode ?? "").toUpperCase() === "PLACEHOLDER";
}

export function buildImpactSummary(detail: ConfigValueDetail): string[] {
  const usage = detail.usage;
  return [
    `受影响脚本 ${detail.impactedScripts.length} 个`,
    `直接脚本引用 ${usage.scriptReferences.length} 个`,
    `定时任务引用 ${usage.scheduleReferences.length} 个`,
    `插件配置引用 ${usage.pluginConfigReferences.length} 个`,
    `配置值依赖 ${usage.configReferences.length} 个`,
    `模板声明 ${usage.templateDeclarations.length} 个`,
    `模型引用 ${usage.modelReferences.length} 个`
  ];
}

export function buildImpactPreview(detail: ConfigValueDetail, limit = 6): string[] {
  return detail.impactedScripts.slice(0, limit).map((item) => {
    const reasons = item.reasons.slice(0, 2).join("；");
    return `${item.scriptId}${item.scriptName && item.scriptName !== item.scriptId ? ` (${item.scriptName})` : ""}: ${reasons}`;
  });
}
