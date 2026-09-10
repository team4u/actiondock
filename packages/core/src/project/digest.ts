import { createHash } from "node:crypto";

/**
 * 解析 JSON 文本并在检测到重复键时抛出错误。
 * 遵循 RFC 8785 清单校验规范：解析阶段必须率先拦截并拒绝重复键。
 */
export function parseJsonWithoutDuplicates<T = unknown>(jsonText: string): T {
  let pos = 0;
  const len = jsonText.length;

  function skipWhitespace(): void {
    while (pos < len) {
      const ch = jsonText.charCodeAt(pos);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        pos++;
      } else {
        break;
      }
    }
  }

  function parseString(): string {
    if (jsonText[pos] !== '"') {
      throw new SyntaxError(`Expected string at position ${pos}`);
    }
    const start = pos;
    pos++; // 跳过开头的引号
    let result = "";
    while (pos < len) {
      const ch = jsonText[pos];
      if (ch === '"') {
        pos++; // 跳过结束的引号
        return result;
      }
      if (ch === "\\") {
        pos++;
        if (pos >= len) {
          throw new SyntaxError(`Unterminated escape sequence in string at ${pos}`);
        }
        const esc = jsonText[pos];
        if (esc === '"' || esc === "\\" || esc === "/") {
          result += esc;
          pos++;
        } else if (esc === "b") {
          result += "\b";
          pos++;
        } else if (esc === "f") {
          result += "\f";
          pos++;
        } else if (esc === "n") {
          result += "\n";
          pos++;
        } else if (esc === "r") {
          result += "\r";
          pos++;
        } else if (esc === "t") {
          result += "\t";
          pos++;
        } else if (esc === "u") {
          pos++;
          const hex = jsonText.slice(pos, pos + 4);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new SyntaxError(`Invalid unicode escape sequence \\u${hex} at ${pos}`);
          }
          result += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
        } else {
          throw new SyntaxError(`Invalid escape character '\\${esc}' at ${pos}`);
        }
      } else {
        result += ch;
        pos++;
      }
    }
    throw new SyntaxError(`Unterminated string starting at ${start}`);
  }

  function parseNumber(): number {
    const start = pos;
    if (jsonText[pos] === "-") {
      pos++;
    }
    if (pos >= len) {
      throw new SyntaxError(`Expected digits at position ${pos}`);
    }
    if (jsonText[pos] === "0") {
      pos++;
    } else if (jsonText[pos] >= "1" && jsonText[pos] <= "9") {
      while (pos < len && jsonText[pos] >= "0" && jsonText[pos] <= "9") {
        pos++;
      }
    } else {
      throw new SyntaxError(`Invalid number at position ${pos}`);
    }

    if (pos < len && jsonText[pos] === ".") {
      pos++;
      if (pos >= len || jsonText[pos] < "0" || jsonText[pos] > "9") {
        throw new SyntaxError(`Expected digit after decimal point at position ${pos}`);
      }
      while (pos < len && jsonText[pos] >= "0" && jsonText[pos] <= "9") {
        pos++;
      }
    }

    if (pos < len && (jsonText[pos] === "e" || jsonText[pos] === "E")) {
      pos++;
      if (pos < len && (jsonText[pos] === "+" || jsonText[pos] === "-")) {
        pos++;
      }
      if (pos >= len || jsonText[pos] < "0" || jsonText[pos] > "9") {
        throw new SyntaxError(`Expected digit after exponent at position ${pos}`);
      }
      while (pos < len && jsonText[pos] >= "0" && jsonText[pos] <= "9") {
        pos++;
      }
    }

    const numStr = jsonText.slice(start, pos);
    const num = Number(numStr);
    if (!Number.isFinite(num)) {
      throw new SyntaxError(`Number out of range: ${numStr}`);
    }
    return num;
  }

  function parseObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const keys = new Set<string>();
    pos++; // 跳过 '{'
    skipWhitespace();

    if (pos < len && jsonText[pos] === "}") {
      pos++;
      return obj;
    }

    while (pos < len) {
      skipWhitespace();
      if (jsonText[pos] !== '"') {
        throw new SyntaxError(`Expected string key in object at position ${pos}`);
      }
      const key = parseString();
      if (keys.has(key)) {
        throw new Error(`Duplicate key '${key}' detected in JSON`);
      }
      keys.add(key);

      skipWhitespace();
      if (pos >= len || jsonText[pos] !== ":") {
        throw new SyntaxError(`Expected ':' after key '${key}' at position ${pos}`);
      }
      pos++; // 跳过 ':'

      skipWhitespace();
      const val = parseValue();
      obj[key] = val;

      skipWhitespace();
      if (pos >= len) {
        throw new SyntaxError("Unexpected end of JSON in object");
      }
      if (jsonText[pos] === ",") {
        pos++;
        skipWhitespace();
      } else if (jsonText[pos] === "}") {
        pos++;
        return obj;
      } else {
        throw new SyntaxError(`Expected ',' or '}' in object at position ${pos}`);
      }
    }
    throw new SyntaxError("Unterminated object in JSON");
  }

  function parseArray(): unknown[] {
    const arr: unknown[] = [];
    pos++; // 跳过 '['
    skipWhitespace();

    if (pos < len && jsonText[pos] === "]") {
      pos++;
      return arr;
    }

    while (pos < len) {
      skipWhitespace();
      const val = parseValue();
      arr.push(val);

      skipWhitespace();
      if (pos >= len) {
        throw new SyntaxError("Unexpected end of JSON in array");
      }
      if (jsonText[pos] === ",") {
        pos++;
        skipWhitespace();
      } else if (jsonText[pos] === "]") {
        pos++;
        return arr;
      } else {
        throw new SyntaxError(`Expected ',' or ']' in array at position ${pos}`);
      }
    }
    throw new SyntaxError("Unterminated array in JSON");
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (pos >= len) {
      throw new SyntaxError("Unexpected end of JSON input");
    }
    const ch = jsonText[pos];
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"') return parseString();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return parseNumber();
    if (jsonText.startsWith("true", pos)) {
      pos += 4;
      return true;
    }
    if (jsonText.startsWith("false", pos)) {
      pos += 5;
      return false;
    }
    if (jsonText.startsWith("null", pos)) {
      pos += 4;
      return null;
    }
    throw new SyntaxError(`Unexpected token '${ch}' at position ${pos}`);
  }

  const result = parseValue() as T;
  skipWhitespace();
  if (pos < len) {
    throw new SyntaxError(`Unexpected trailing characters at position ${pos}`);
  }
  return result;
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
