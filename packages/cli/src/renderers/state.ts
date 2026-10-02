/**
 * 格式化渲染状态键列表。
 */
export function renderStateList(
  keys: string[],
  scopeLabel: string = "Current State",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`State keys for ${scopeLabel} (${keys.length}):\n`);
  if (isFallback && intent) {
    lines.push(`(No state keys matched intent '${intent}', showing all keys)\n`);
  }
  if (keys.length === 0) {
    lines.push("  (no state keys found)");
  } else {
    for (const k of keys) {
      lines.push(`  - ${k}`);
    }
  }
  return lines.join("\n");
}
