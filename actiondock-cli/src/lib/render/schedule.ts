import type { ScriptScheduleView, ExecutionPresetView } from "../types.js";
import { formatValue, indent } from "./shared.js";

export function renderScheduleList(items: ScriptScheduleView[]): string {
  if (items.length === 0) {
    return "没有定时任务。";
  }

  return items
    .map((item) => {
      const script = item.scriptId ? ` ${item.scriptId}` : "";
      const name = item.name ? ` ${item.name}` : "";
      const enabled = typeof item.enabled === "boolean" ? ` ${item.enabled ? "enabled" : "disabled"}` : "";
      const cron = item.cronExpression ? ` ${item.cronExpression}` : "";
      return `${item.id}${script}${name}${enabled}${cron}`;
    })
    .join("\n");
}

export function renderScheduleDetail(item: ScriptScheduleView): string {
  const lines = [
    `Schedule: ${item.id}`,
    `Script: ${item.scriptId}`,
    `Name: ${item.name ?? "-"}`,
    `Enabled: ${item.enabled ? "yes" : "no"}`,
    `Cron: ${item.cronExpression ?? "-"}`
  ];
  if (item.nextRunAt) {
    lines.push(`NextRunAt: ${item.nextRunAt}`);
  }
  if (item.lastTriggeredAt) {
    lines.push(`LastTriggeredAt: ${item.lastTriggeredAt}`);
  }
  if (item.lastExecutionId) {
    lines.push(`LastExecution: ${item.lastExecutionId}${item.lastExecutionStatus ? ` ${item.lastExecutionStatus}` : ""}`);
  }
  if (item.input !== undefined) {
    lines.push("Input:");
    lines.push(indent(formatValue(item.input)));
  }
  return lines.join("\n");
}

export function renderExecutionPresetList(items: ExecutionPresetView[]): string {
  if (items.length === 0) {
    return "没有执行参数预设。";
  }

  return items
    .map((item) => {
      const name = item.name ? ` ${item.name}` : "";
      const managed = item.managed ? " managed" : "";
      return `${item.id}${name}${managed}`;
    })
    .join("\n");
}

export function renderExecutionPresetDetail(item: ExecutionPresetView): string {
  const lines = [
    `Preset: ${item.id}`,
    `Script: ${item.scriptId}`,
    `Name: ${item.name}`,
    `Managed: ${item.managed ? "yes" : "no"}`,
    `Editable: ${item.editable === false ? "no" : "yes"}`,
    "Input:",
    indent(formatValue(item.input ?? {}))
  ];
  if (item.repositoryId) {
    lines.push(`Repository: ${item.repositoryId}`);
  }
  if (item.repositoryPackageId) {
    lines.push(`Package: ${item.repositoryPackageId}${item.repositoryVersion ? `@${item.repositoryVersion}` : ""}`);
  }
  return lines.join("\n");
}
