import type { RunRecord } from "@actiondock/sdk";

export interface RenderRunsListFilterOptions {
  total?: number;
  limit?: number;
  offset?: number;
  channel?: string;
  status?: string;
  view?: string;
  since?: string;
  until?: string;
  rootRunId?: string;
  parentRunId?: string;
}

/**
 * 格式化渲染执行记录列表。
 */
export function renderRunsList(
  items: Array<{ id: string; actionId: string; packageId?: string; status: string; startedAt: string }>,
  scopeLabel: string = "Execution Runs",
  isFallback: boolean = false,
  intent?: string,
  filterOptions?: RenderRunsListFilterOptions
): string {
  const lines: string[] = [];

  const filterBadges: string[] = [];
  if (filterOptions?.channel) filterBadges.push(`channel='${filterOptions.channel}'`);
  if (filterOptions?.status) filterBadges.push(`status='${filterOptions.status}'`);
  if (filterOptions?.view) filterBadges.push(`view='${filterOptions.view}'`);
  if (filterOptions?.since) filterBadges.push(`since='${filterOptions.since}'`);
  if (filterOptions?.until) filterBadges.push(`until='${filterOptions.until}'`);
  if (filterOptions?.rootRunId) filterBadges.push(`rootRunId='${filterOptions.rootRunId}'`);
  if (filterOptions?.parentRunId) filterBadges.push(`parentRunId='${filterOptions.parentRunId}'`);

  const filterSummary = filterBadges.length > 0 ? ` [${filterBadges.join(", ")}]` : "";

  if (typeof filterOptions?.total === "number") {
    lines.push(`${scopeLabel} (showing ${items.length} of ${filterOptions.total}${filterSummary}):\n`);
  } else {
    lines.push(`${scopeLabel} (${items.length}${filterSummary}):\n`);
  }

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
  if (run.origin) {
    lines.push(`Origin:       channel=${run.origin.channel} view=${run.origin.viewName} authenticated=${run.origin.authenticated}`);
  }
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
