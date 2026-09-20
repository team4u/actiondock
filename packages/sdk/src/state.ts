/**
 * 转义状态键分段中的特殊字符（\ 和 :）。
 *
 * 工具独立性声明：状态键编解码是 sdk 零依赖公共包的自备最小实现，
 * 有意独立于 core；core 的存储层反向依赖 sdk 引入本组函数，
 * 故此处为单一事实源而非重复副本。
 */
export function escapeStateSegment(segment: string): string {
  return segment.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

/**
 * 反转义状态键分段。
 */
export function unescapeStateSegment(segment: string): string {
  return segment.replace(/\\(:|\\)/g, "$1");
}

/**
 * 将 namespace 与 key 编码为无歧义的复合状态键名。
 */
export function encodeStateKey(namespace: string, key: string): string {
  if (!namespace) {
    return escapeStateSegment(key);
  }
  return `${escapeStateSegment(namespace)}:${escapeStateSegment(key)}`;
}

/**
 * 解析复合状态键名。若复合键存在歧义（多个未转义冒号），抛出错误。
 */
export function decodeStateKey(fullKey: string): { namespace: string; key: string } {
  const unescapedColonIndices: number[] = [];
  for (let i = 0; i < fullKey.length; i++) {
    if (fullKey[i] === ":") {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && fullKey[j] === "\\"; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        unescapedColonIndices.push(i);
      }
    }
  }

  if (unescapedColonIndices.length === 0) {
    return { namespace: "", key: unescapeStateSegment(fullKey) };
  }

  if (unescapedColonIndices.length === 1) {
    const idx = unescapedColonIndices[0];
    return {
      namespace: unescapeStateSegment(fullKey.slice(0, idx)),
      key: unescapeStateSegment(fullKey.slice(idx + 1)),
    };
  }

  throw new Error(`Ambiguous state key '${fullKey}': contains multiple unescaped colon delimiters`);
}
