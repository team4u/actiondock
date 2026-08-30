/**
 * Resolves effective intent string from an explicit option (--intent)
 * and optional positional pattern arguments.
 * Multiple terms are combined with '|' (regex OR).
 */
export function resolveIntent(
  optionsIntent?: string,
  positionalPatterns?: string[]
): string | undefined {
  const parts: string[] = [];
  if (optionsIntent && optionsIntent.trim()) {
    parts.push(optionsIntent.trim());
  }
  if (positionalPatterns && positionalPatterns.length > 0) {
    for (const p of positionalPatterns) {
      if (typeof p === "string" && p.trim()) {
        parts.push(p.trim());
      }
    }
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts.join("|");
}
