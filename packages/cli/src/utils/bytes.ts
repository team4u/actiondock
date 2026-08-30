/**
 * Parses human-readable byte size string into number of bytes.
 * e.g. "1mb" -> 1048576, "500kb" -> 512000, "1048576" -> 1048576
 */
export function parseByteSize(str: string): number {
  const trimmed = str.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (!match) {
    const num = Number(trimmed);
    if (!isNaN(num) && num > 0) return num;
    throw new Error(`Invalid byte size format: '${str}'. Examples: '1mb', '500kb', '1048576'`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || "b";

  switch (unit) {
    case "b":
    case "bytes":
      return Math.floor(value);
    case "k":
    case "kb":
    case "kib":
      return Math.floor(value * 1024);
    case "m":
    case "mb":
    case "mib":
      return Math.floor(value * 1024 * 1024);
    case "g":
    case "gb":
    case "gib":
      return Math.floor(value * 1024 * 1024 * 1024);
    default:
      throw new Error(`Unsupported byte size unit '${unit}' in '${str}'`);
  }
}
