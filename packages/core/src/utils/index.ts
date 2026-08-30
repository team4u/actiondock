import { homedir } from "node:os";

/**
 * Parses duration strings like "500ms", "30s", "5m", "1h", "1d" or pure numbers into milliseconds.
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

/**
 * Extracts a concise slug from a package or action identifier (e.g. '@scope/pkg' -> 'pkg', 'team.action' -> 'action').
 */
export function getPackageSlug(id: string): string {
  if (id.includes("/")) {
    return id.split("/").pop()!;
  }
  if (id.includes(".")) {
    return id.split(".").pop()!;
  }
  return id;
}

/**
 * Resolves the root ActionDock user home directory based on customHome, ACTIONDOCK_HOME, or user homedir.
 */
export function getActionDockHome(customHome?: string): string {
  return customHome || process.env.ACTIONDOCK_HOME || homedir();
}
