/**
 * 格式化渲染 Playbook 列表。
 */
export function renderPlaybookList(
  items: Array<{ id: string; description?: string; packageId?: string }>,
  title: string = "Playbooks",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`${title}:\n`);
  if (isFallback && intent) {
    lines.push(`(No playbooks matched intent '${intent}', showing all playbooks)\n`);
  }
  if (items.length === 0) {
    lines.push("  (no playbooks found)");
  } else {
    for (const p of items) {
      const pkgDesc = p.packageId ? ` (Package: ${p.packageId})` : "";
      lines.push(`  - ${p.id.padEnd(26)} ${p.description}${pkgDesc}`);
    }
  }
  lines.push("\nTip: Run 'ad playbook show <id>' to inspect procedure steps before execution.");
  return lines.join("\n");
}

/**
 * 格式化渲染 Playbook 详情。
 */
export function renderPlaybookDetail(pb: {
  id: string;
  packageId?: string;
  description?: string;
  actions?: string[];
  filePath?: string;
  content?: string;
}): string {
  const lines: string[] = [];
  const pkgDesc = pb.packageId ? ` (Package: ${pb.packageId})` : "";
  lines.push(`Playbook:    ${pb.id}${pkgDesc}`);
  if (pb.description) lines.push(`Description: ${pb.description}`);
  if (pb.actions && pb.actions.length > 0) {
    lines.push(`Actions:     ${pb.actions.join(", ")}`);
  }
  if (pb.filePath) lines.push(`File:        ${pb.filePath}\n`);
  if (pb.content) {
    lines.push("--- Content ---");
    lines.push(pb.content);
  }
  lines.push("\nTip: Follow steps sequentially. Invoke constituent actions using 'ad run <action> [options] -- <assignments...>'.");
  return lines.join("\n");
}
