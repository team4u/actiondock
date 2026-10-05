import type { RunRecord } from "@actiondock/sdk";

/**
 * 格式化渲染执行记录列表。
 */
export function renderRunsList(
  items: Array<{ id: string; actionId: string; packageId?: string; status: string; startedAt: string }>,
  scopeLabel: string = "Execution Runs",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`${scopeLabel} (${items.length}):\n`);
  if (isFallback && intent) {
    lines.push(`(No runs matched intent '${intent}', showing all runs)\n`);
  }

  lines.push(`  ${"RUN ID".padEnd(38)} ${"PACKAGE".padEnd(18)} ${"ACTION".padEnd(22)} ${"STATUS".padEnd(10)} STARTED`);
  lines.push("  " + "-".repeat(105));

  for (const r of items) {
    const time = (r.startedAt || "").replace("T", " ").slice(0, 19);
    const pkg = (r.packageId || "").padEnd(18);
    lines.push(`  ${r.id.padEnd(38)} ${pkg} ${r.actionId.padEnd(22)} ${r.status.padEnd(10)} ${time}`);
  }

  return lines.join("\n");
}

/**
 * 格式化渲染单次执行记录详情。
 */
export function renderRunDetail(run: RunRecord): string {
  const lines: string[] = [];
  lines.push(`Run:          ${run.id}`);
  lines.push(`Action:       ${run.actionId}`);
  if (run.packageId) lines.push(`Package:      ${run.packageId}`);
  if (run.requestId) lines.push(`Request ID:   ${run.requestId}`);
  lines.push(`Status:       ${run.status}`);
  if (run.parentRunId) lines.push(`Parent Run:   ${run.parentRunId}`);
  lines.push(`Started:      ${run.startedAt}`);
  if (run.finishedAt) lines.push(`Finished:     ${run.finishedAt}`);

  lines.push("\nInput:");
  lines.push(JSON.stringify(run.input, null, 2));

  if (run.output !== undefined) {
    lines.push("\nOutput:");
    lines.push(JSON.stringify(run.output, null, 2));
  }

  if (run.error) {
    lines.push("\nError:");
    lines.push(JSON.stringify(run.error, null, 2));
  }

  return lines.join("\n");
}
