/**
 * 从对象中提取待过滤字段的提取器函数类型。
 */
export type Extractor<T> = (item: T) => unknown;

/**
 * 安全地将模式字符串、数组或现有正则编译为不区分大小写的 RegExp 正则表达式。
 * 若正则语法不合法，自动对特殊字符进行转义并降级为字面量匹配正则，保证零 Crash。
 * 
 * @param intent 意图关键词、正则或数组
 */
export function compileIntentRegex(
  intent?: string | string[] | RegExp | null
): RegExp | null {
  if (!intent) return null;
  if (intent instanceof RegExp) return intent;

  let patternStr: string;
  if (Array.isArray(intent)) {
    const valid = intent.map((s) => s.trim()).filter(Boolean);
    if (valid.length === 0) return null;
    patternStr = valid.join("|");
  } else {
    patternStr = intent.trim();
    if (!patternStr) return null;
  }

  try {
    return new RegExp(patternStr, "i");
  } catch {
    const escaped = patternStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  }
}

/**
 * 递归检查某个值（包括嵌套的数组或对象结构）是否匹配给定的正则表达式。
 * 
 * @param value 待检测的任意数据类型
 * @param regex 正则表达式
 */
export function matchIntent(value: unknown, regex: RegExp): boolean {
  if (value === undefined || value === null) return false;

  if (typeof value === "string") {
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
      return regex.test(JSON.stringify(value));
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
