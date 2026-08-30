import type { ConfigItemDefinition, ConfigValueType } from "../project/types";

/**
 * 从环境变量成功解析后的结构体。
 */
export interface ResolvedEnv {
  /** 转换类型后的配置值 */
  value: unknown;
  /** 命中的具体环境变量键名 */
  envKey: string;
  /** 数据来源标识 */
  source: "env";
}

/**
 * 将任意命名格式的字符串转换为标准的大写蛇形命名（UPPER_SNAKE_CASE）。
 * 兼容处理 camelCase、kebab-case、点号分隔以及斜杠等符号。
 * 
 * @param str 输入字符串，如 "apiKey"、"team4u.github-tools"
 * @returns 转换后的字符串，如 "API_KEY"、"TEAM4U_GITHUB_TOOLS"
 */
export function toSnakeUpperCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-.\s/]+/g, "_")
    .toUpperCase();
}

/**
 * 当未显式声明类型时，根据默认值的值类型智能推断目标配置类型。
 * 
 * @param defaultVal 默认值
 * @returns 推断出的 ConfigValueType 或 undefined
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
 * 将从 process.env 获取的原始字符串安全转换为目标类型。
 * 
 * 支持类型：
 * - boolean: "true"/"1"/"yes"/"on" -> true; "false"/"0"/"no"/"off" -> false
 * - number: 自动转换为数字，非数字时回退为原始字符串
 * - object / array: 自动尝试 JSON.parse 反序列化
 * - 自动探测: 当 targetType 未指定时，自动识别布尔值及 JSON 对象/数组
 * 
 * @param rawValue process.env 中的原始字符串
 * @param targetType 期望转换的目标类型
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

  // 智能自动探测
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
      // 保持为字符串
    }
  }

  return rawValue;
}

/**
 * 从操作系统环境变量 (process.env) 中解析配置值。
 * 严格遵循多层回退候选链：
 * 1. actiondock.json 中声明的显式环境变量绑定 (itemDef.env)
 * 2. 带包名前缀的变量: `ACTIONDOCK_<PACKAGE>_<KEY>` 以及 `<PACKAGE>_<KEY>`
 * 3. 标准大写蛇形变量: `<KEY>` (SNAKE_CASE)
 * 4. 原始键名原样匹配
 * 
 * @param key 配置键名
 * @param itemDef 配置项元数据定义
 * @param packageId 所属包 ID
 * @returns 命中的 ResolvedEnv 对象或 undefined
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

  // 1. actiondock.json 中显式声明的 env 变量名
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

  // 2. 包名前缀的环境变量 (例如 ACTIONDOCK_GITHUB_TOOLS_API_KEY)
  const snakeKey = toSnakeUpperCase(key);
  if (packageId) {
    const cleanPkg = toSnakeUpperCase(packageId);
    candidateKeys.add(`ACTIONDOCK_${cleanPkg}_${snakeKey}`);
    candidateKeys.add(`${cleanPkg}_${snakeKey}`);
  }

  // 3. 标准大写蛇形变量名 (例如 API_KEY)
  candidateKeys.add(snakeKey);

  // 4. 原始键名 (例如 apiKey)
  candidateKeys.add(key);

  // 按优先级顺序依次检索环境变量
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
