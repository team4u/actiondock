/**
 * Parses duration strings like "500ms", "30s", "5m", "1h" or pure numbers into milliseconds.
 */
export function parseDuration(input?: string): number | undefined {
  if (!input || !input.trim()) {
    return undefined;
  }

  const str = input.trim();
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration format: '${input}'. Supported formats: 500ms, 30s, 5m, 1h`
    );
  }

  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "ms":
      return Math.round(val);
    case "s":
      return Math.round(val * 1000);
    case "m":
      return Math.round(val * 60 * 1000);
    case "h":
      return Math.round(val * 60 * 60 * 1000);
    case "d":
      return Math.round(val * 24 * 60 * 60 * 1000);
    default:
      return undefined;
  }
}
