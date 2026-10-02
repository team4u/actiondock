import { createHash } from "node:crypto";

/**
 * 解析 JSON 文本并在检测到重复键时抛出错误。
 * 遵循 RFC 8785 清单校验规范:解析阶段必须率先拦截并拒绝重复键。
 *
 * 实现策略:JSON.parse 主解析 + 轻量键名扫描器做重复键检测。
 * 扫描器以状态机遍历原始文本,仅在对象键位置(冒号前的字符串字面量)记录键名,
 * 同一对象层级内出现重复键名即抛错;字符串内部与转义字符不参与键名提取。
 */
export function parseJsonWithoutDuplicates<T = unknown>(jsonText: string): T {
  detectDuplicateKeys(jsonText);
  return JSON.parse(jsonText) as T;
}

/**
 * 扫描 JSON 文本,检测同一对象层级内的重复键名。
 *
 * 状态机只关心「是否处于字符串内」与「对象层级」:
 * - 遇到未转义引号时切换 inString 状态;
 * - 字符串闭合后若紧邻(跳过空白)冒号,则该字符串是键:提取键名登记到当前层级;
 * - 对象层级入栈出栈维护各自已见键集合。
 */
function detectDuplicateKeys(jsonText: string): void {
  const len = jsonText.length;
  let pos = 0;
  let inString = false;
  let depth = -1;
  // 每层对象的已见键集合;keyStartStack 记录每个未闭合字符串字面量的起点
  const seenPerDepth: Set<string>[] = [];
  const keyStartStack: number[] = [];

  while (pos < len) {
    const ch = jsonText[pos];

    if (inString) {
      if (ch === "\\") {
        pos += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        const start = keyStartStack.pop();
        // 判断该字符串是否为对象键:向后跳过空白,若紧邻冒号则为键
        let look = pos + 1;
        while (look < len && /\s/.test(jsonText[look])) look++;
        if (start !== undefined && look < len && jsonText[look] === ":") {
          registerKey(jsonText, start, pos, seenPerDepth, depth);
        }
      }
      pos++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      keyStartStack.push(pos + 1);
      pos++;
      continue;
    }

    if (ch === "{") {
      depth++;
      if (seenPerDepth.length <= depth) seenPerDepth.push(new Set());
      else seenPerDepth[depth] = new Set();
      pos++;
      continue;
    }

    if (ch === "}") {
      depth--;
      pos++;
      continue;
    }

    pos++;
  }
}

/**
 * 登记一个对象键:回溯提取键名,在当前层级做重复检测。
 */
function registerKey(
  jsonText: string,
  start: number,
  quoteEndPos: number,
  seenPerDepth: Set<string>[],
  depth: number
): void {
  if (depth < 0) return;
  // quoteEndPos 是闭合引号的位置,键内容为 [start, quoteEndPos)
  if (quoteEndPos <= start) return;
  const raw = jsonText.slice(start, quoteEndPos);
  const key = unescapeJsonKey(raw);
  const seen = seenPerDepth[depth];
  if (seen.has(key)) {
    throw new SyntaxError(`Duplicate key '${key}' in object at depth ${depth}`);
  }
  seen.add(key);
}

/**
 * 反转义 JSON 键名字符串字面量内容。
 */
function unescapeJsonKey(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * 依据 RFC 8785 规范化 JSON 数据。
 * 规则：
 * - 对象属性依据 UTF-16 代码单元进行升序排序；
 * - 符号与键值之间不包含多余空白字符；
 * - 浮点数与整数遵循 ECMAScript 规范序列化（负零转为零，拒绝非有限数）；
 * - 字符串转义严格遵循标准规范；
 * - 数组保持原有顺序且元素递归规范化。
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const type = typeof value;

  if (type === "boolean") {
    return value ? "true" : "false";
  }

  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("RFC 8785 JSON 规范化拒绝非有限数值 (NaN 或 Infinity)");
    }
    if (Object.is(value, -0) || value === 0) {
      return "0";
    }
    return JSON.stringify(value);
  }

  if (type === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        return "null";
      }
      return canonicalizeJson(item);
    });
    return `[${items.join(",")}]`;
  }

  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];

    for (const key of keys) {
      const val = obj[key];
      if (val === undefined || typeof val === "function" || typeof val === "symbol") {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
    }

    return `{${entries.join(",")}}`;
  }

  return "null";
}

/**
 * 计算任意 JSON 结构或 JSON 字符串的 SHA-256 规范化摘要。
 * 输出格式为 sha256-<hex>。
 */
export function computeDigest(value: unknown): string {
  let canonicalText: string;
  if (typeof value === "string") {
    const parsed = parseJsonWithoutDuplicates(value);
    canonicalText = canonicalizeJson(parsed);
  } else {
    canonicalText = canonicalizeJson(value);
  }

  const hash = createHash("sha256").update(canonicalText, "utf8").digest("hex");
  return `sha256-${hash}`;
}

/**
 * 计算 Action 清单对象的唯一确定性 RFC 8785 摘要。
 * 清单中的等价空格变化与字段顺序不会改变摘要结果。
 */
export function computeManifestDigest(manifest: unknown): string {
  return computeDigest(manifest);
}

/**
 * 校验给定清单的摘要是否与期望值一致。
 */
export function verifyManifestDigest(manifest: unknown, expectedDigest: string): boolean {
  if (!expectedDigest || typeof expectedDigest !== "string") {
    return false;
  }
  return computeManifestDigest(manifest) === expectedDigest;
}
