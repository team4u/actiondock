/**
 * 从对象中提取待过滤字段的提取器函数类型。
 */
export type Extractor<T> = (item: T) => unknown;

/**
 * 显式开启正则模式的意图前缀：以此前缀声明的意图才按正则编译，其余一律按字面子串匹配。
 * 目的：意图参数来自用户输入（CLI 与 HTTP 查询参数），直接编译正则存在灾难性回溯（ReDoS）风险。
 */
const REGEX_MODE_PREFIX = "re:";

/**
 * 将任意字符串转义为字面量匹配正则（保留 | 分隔的多关键词 OR 语义）。
 */
function escapeAsLiteralPattern(patternStr: string): string {
  return patternStr
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

/**
 * 安全地将模式字符串、数组或现有正则编译为不区分大小写的匹配正则。
 *
 * 编译策略：
 * - 显式传入 RegExp 实例：原样使用（调用方自担回溯风险）
 * - 字符串以 re: 前缀声明：按正则编译，语法非法时转义降级为字面量
 * - 其余字符串与数组：一律转义为字面量子串匹配（多关键词以 | 分隔时保留 OR 语义），
 *   消除用户可控输入的重灾回溯面
 * 
 * @param intent 意图关键词、显式正则（re: 前缀）或数组
 */
export function compileIntentRegex(
  intent?: string | string[] | RegExp | null
): RegExp | null {
  if (!intent) return null;
  if (intent instanceof RegExp) return intent;

  let patternStr: string;
  let regexMode = false;
  if (Array.isArray(intent)) {
    const valid = intent.map((s) => s.trim()).filter(Boolean);
    if (valid.length === 0) return null;
    patternStr = valid.join("|");
  } else {
    patternStr = intent.trim();
    if (!patternStr) return null;
    if (patternStr.startsWith(REGEX_MODE_PREFIX)) {
      const rest = patternStr.slice(REGEX_MODE_PREFIX.length).trim();
      if (!rest) return null;
      patternStr = rest;
      regexMode = true;
    }
  }

  if (regexMode) {
    try {
      return new RegExp(patternStr, "i");
    } catch {
      // 正则语法非法时降级为字面量匹配，保证零 Crash
    }
  }

  return new RegExp(escapeAsLiteralPattern(patternStr), "i");
}

/**
 * 递归检查某个值（包括嵌套的数组或对象结构）是否匹配给定的正则表达式。
 *
 * 防护：对象序列化长度超过 MATCH_TEXT_LIMIT 时拒绝全文匹配，避免对超大对象执行回溯敏感的正则扫描。
 * 
 * @param value 待检测的任意数据类型
 * @param regex 正则表达式
 */
const MATCH_TEXT_LIMIT = 64 * 1024;

export function matchIntent(value: unknown, regex: RegExp): boolean {
  if (value === undefined || value === null) return false;

  if (typeof value === "string") {
    if (value.length > MATCH_TEXT_LIMIT) return false;
    return regex.test(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return regex.test(String(value));
  }

  if (Array.isArray(value)) {
    for (const elem of value) {
      if (matchIntent(elem, regex)) return true;
    }
    return false;
  }

  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      if (text === undefined || text.length > MATCH_TEXT_LIMIT) return false;
      return regex.test(text);
    } catch {
      return false;
    }
  }

  return false;
}

export interface FilterResult<T> {
  items: T[];
  isFallback: boolean;
  matchedCount: number;
}

/**
 * Filters a collection of items based on an intent pattern across specified extractor functions.
 * Returns detailed result including whether a fallback was triggered when 0 items matched.
 */
export function filterWithFallbackInfo<T>(
  items: T[],
  intent?: string | string[] | RegExp | null,
  extractors?: Extractor<T>[],
  fallback = true
): FilterResult<T> {
  if (!intent) {
    return {
      items,
      isFallback: false,
      matchedCount: items.length,
    };
  }

  const regex = compileIntentRegex(intent);
  if (!regex) {
    return {
      items,
      isFallback: false,
      matchedCount: items.length,
    };
  }

  const defaultExtractors: Extractor<T>[] = [
    (item: any) =>
      typeof item === "string"
        ? item
        : item?.id || item?.name || item?.key || String(item),
  ];

  const effectiveExtractors =
    extractors && extractors.length > 0 ? extractors : defaultExtractors;

  const matched = items.filter((item) => {
    for (const extractor of effectiveExtractors) {
      try {
        const val = extractor(item);
        if (matchIntent(val, regex)) {
          return true;
        }
      } catch {
        // Ignore extraction error
      }
    }
    return false;
  });

  if (matched.length === 0 && fallback) {
    return {
      items,
      isFallback: true,
      matchedCount: 0,
    };
  }

  return {
    items: matched,
    isFallback: false,
    matchedCount: matched.length,
  };
}

/**
 * Filters a collection of items based on an intent pattern across specified extractor functions.
 * When fallback is enabled (default), returns the full list if no items match the intent.
 */
export function filterByIntent<T>(
  items: T[],
  intent?: string | string[] | RegExp | null,
  extractors?: Extractor<T>[],
  fallback = true
): T[] {
  return filterWithFallbackInfo(items, intent, extractors, fallback).items;
}
