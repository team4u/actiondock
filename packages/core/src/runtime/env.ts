import type { ConfigItemDefinition, ConfigValueType } from "../project/types";

export interface ResolvedEnv {
  value: unknown;
  envKey: string;
  source: "env";
}

/**
 * Converts a string to uppercase SNAKE_CASE.
 * Handles camelCase, kebab-case, dot-notation, and whitespace.
 * e.g. "apiKey" -> "API_KEY", "team4u.github-tools" -> "TEAM4U_GITHUB_TOOLS"
 */
export function toSnakeUpperCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-.\s/]+/g, "_")
    .toUpperCase();
}

/**
 * Infer config value type from default value if not explicitly declared.
 */
export function inferTypeFromDefault(defaultVal: unknown): ConfigValueType | undefined {
  if (defaultVal === undefined || defaultVal === null) return undefined;
  if (typeof defaultVal === "boolean") return "boolean";
  if (typeof defaultVal === "number") return "number";
  if (Array.isArray(defaultVal)) return "array";
  if (typeof defaultVal === "object") return "object";
  if (typeof defaultVal === "string") return "string";
  return undefined;
}

/**
 * Coerces a raw string from process.env into target typed value.
 */
export function coerceEnvValue(
  rawValue: string,
  targetType?: ConfigValueType
): unknown {
  if (targetType === "boolean") {
    const lower = rawValue.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lower)) return true;
    if (["false", "0", "no", "off"].includes(lower)) return false;
    return Boolean(rawValue);
  }

  if (targetType === "number") {
    const trimmed = rawValue.trim();
    const num = Number(trimmed);
    return isNaN(num) ? rawValue : num;
  }

  if (targetType === "object" || targetType === "array") {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }

  if (targetType === "string") {
    return rawValue;
  }

  // Smart auto-detection when no type is explicitly specified
  const trimmed = rawValue.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fallback to string
    }
  }

  return rawValue;
}

/**
 * Resolves configuration value from process.env following standard multi-tier fallback:
 * 1. Explicit env binding in actiondock.json (itemDef.env)
 * 2. Package-namespaced variable: ACTIONDOCK_<PACKAGE>_<KEY> and <PACKAGE>_<KEY>
 * 3. Standard SNAKE_CASE variable: <KEY> in uppercase snake_case
 * 4. Exact original key name
 */
export function resolveEnvValue(
  key: string,
  itemDef?: ConfigItemDefinition,
  packageId?: string
): ResolvedEnv | undefined {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }

  const candidateKeys = new Set<string>();

  // 1. Explicit env declared in actiondock.json
  if (itemDef?.env) {
    if (Array.isArray(itemDef.env)) {
      for (const e of itemDef.env) {
        if (typeof e === "string" && e.trim()) {
          candidateKeys.add(e.trim());
        }
      }
    } else if (typeof itemDef.env === "string" && itemDef.env.trim()) {
      candidateKeys.add(itemDef.env.trim());
    }
  }

  // 2. Package-prefixed environment variable
  const snakeKey = toSnakeUpperCase(key);
  if (packageId) {
    const cleanPkg = toSnakeUpperCase(packageId);
    candidateKeys.add(`ACTIONDOCK_${cleanPkg}_${snakeKey}`);
    candidateKeys.add(`${cleanPkg}_${snakeKey}`);
  }

  // 3. Standard uppercase snake_case key
  candidateKeys.add(snakeKey);

  // 4. Exact original key
  candidateKeys.add(key);

  // Check candidates in order
  const effectiveType = itemDef?.type || inferTypeFromDefault(itemDef?.default);

  for (const envKey of candidateKeys) {
    const rawVal = process.env[envKey];
    if (rawVal !== undefined) {
      const coerced = coerceEnvValue(rawVal, effectiveType);
      return {
        value: coerced,
        envKey,
        source: "env",
      };
    }
  }

  return undefined;
}
