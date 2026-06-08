import type { ExecutionResponse } from "../types.js";
import { formatValue, indent } from "./shared.js";

export function renderExecution(response: ExecutionResponse): string {
  const lines: string[] = [];
  if (response.id) {
    lines.push(`Execution: ${response.id}`);
  }
  if (response.scriptId) {
    lines.push(`Script: ${response.scriptId}`);
  }
  if (response.status) {
    lines.push(`Status: ${response.status}`);
  }
  if (response.submitMode) {
    lines.push(`Mode: ${response.submitMode}`);
  }
  if (response.triggerSource) {
    lines.push(`Trigger: ${response.triggerSource}`);
  }
  if (response.webhookId) {
    lines.push(`Webhook: ${response.webhookId}`);
  }
  if (response.errorMessage) {
    lines.push(`Error: ${response.errorMessage}`);
  }
  if (response.input !== undefined) {
    lines.push("Input:");
    lines.push(indent(formatValue(response.input)));
  }
  if (response.output !== undefined) {
    lines.push("Output:");
    lines.push(indent(formatValue(response.output)));
  }
  if (response.debug) {
    lines.push("Debug:");
    lines.push(indent(formatValue(response.debug)));
  }
  if (response.logs && response.logs.length > 0) {
    lines.push(`Logs: ${response.logs.length}`);
  }
  return lines.join("\n");
}

export function renderExecutionList(items: ExecutionResponse[]): string {
  if (items.length === 0) {
    return "没有执行记录。";
  }

  return items
    .map((item) => {
      const script = item.scriptId ? ` ${item.scriptId}` : "";
      const status = item.status ? ` ${item.status}` : "";
      const mode = item.submitMode ? ` ${item.submitMode}` : "";
      return `${item.id ?? "-"}${script}${status}${mode}`;
    })
    .join("\n");
}
