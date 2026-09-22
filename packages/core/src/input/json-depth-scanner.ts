/**
 * JSON 结构深度预检器。
 *
 * 采用 O(n) 流式单趟字符扫描器，实时维护字符串状态（处理转义符 \" 与 \\）以及字符串外部的容器嵌套深度（{ } 与 [ ]）。
 * 根容器深度记为 0，每深入一层嵌套加 1。当任意时刻深度超出 maxDepth 时，立即短路返回 MAX_JSON_DEPTH。
 * 标量基础类型（字符串、数字、布尔、null）不增加容器深度。
 *
 * @param text 待扫描的原始 JSON 文本
 * @param maxDepth 最大允许嵌套深度（默认为 256）
 * @returns 校验通过返回 { valid: true }，超限返回 { valid: false, reason: "MAX_JSON_DEPTH" }
 */
export function scanJsonDepth(
  text: string,
  maxDepth = 256
): { valid: true } | { valid: false; reason: string } {
  let inString = false;
  let isEscaped = false;
  let containerDepth = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === 0x5c /* \ */) {
        isEscaped = true;
      } else if (ch === 0x22 /* " */) {
        inString = false;
      }
      continue;
    }

    if (ch === 0x22 /* " */) {
      inString = true;
      continue;
    }

    if (ch === 0x7b /* { */ || ch === 0x5b /* [ */) {
      containerDepth++;
      if (containerDepth > maxDepth) {
        return { valid: false, reason: "MAX_JSON_DEPTH" };
      }
      continue;
    }

    if (ch === 0x7d /* } */ || ch === 0x5d /* ] */) {
      if (containerDepth >= 0) {
        containerDepth--;
      }
      continue;
    }
  }

  return { valid: true };
}
