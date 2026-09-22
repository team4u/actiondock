import type { JsonValue } from "@actiondock/sdk";

/** 默认 JSON 最大嵌套深度限制（防止恶意超深结构） */
export const DEFAULT_MAX_JSON_DEPTH = 256;

/**
 * JSON 结构校验选项。
 */
export interface ValidateJsonOptions {
  /** 最大允许嵌套深度（默认 256） */
  maxDepth?: number;
}

type StackFrame =
  | { type: "ENTER"; value: unknown; depth: number }
  | { type: "EXIT"; target: object };

/**
 * 校验值是否为合法的 JSON 兼容结构。
 *
 * 核心特性：
 * - 迭代式显式栈遍历：采用堆内存数组模拟调用栈，杜绝深层结构造成的 RangeError: Maximum call stack size exceeded。
 * - 严格数值有限性：全链路检查所有数值满足 Number.isFinite，严禁 NaN 与 Infinity。
 * - 路径栈环路检测：仅在对象当前子树遍历期间在祖先集合中标记，遍历完毕立即移出，完美放行有向无环（DAG）共享子结构。
 * - 最大深度防护：支持配置最大嵌套深度限制。
 *
 * @param value 待校验的目标值
 * @param options 校验配置选项
 * @returns 校验结果对象
 */
export function validateJsonValue(
  value: unknown,
  options?: ValidateJsonOptions
): { valid: true } | { valid: false; reason: string } {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const ancestors = new WeakSet<object>();

  const stack: StackFrame[] = [{ type: "ENTER", value, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop()!;

    if (frame.type === "EXIT") {
      ancestors.delete(frame.target);
      continue;
    }

    const { value: val, depth } = frame;

    if (val === null || typeof val === "boolean" || typeof val === "string") {
      continue;
    }

    if (typeof val === "number") {
      if (!Number.isFinite(val) || Number.isNaN(val)) {
        return { valid: false, reason: `Number is non-finite or NaN (${val})` };
      }
      continue;
    }

    if (
      typeof val === "undefined" ||
      typeof val === "function" ||
      typeof val === "symbol" ||
      typeof val === "bigint"
    ) {
      return { valid: false, reason: `Unsupported JSON type '${typeof val}'` };
    }

    if (typeof val === "object") {
      if (ancestors.has(val as object)) {
        return { valid: false, reason: "Circular reference detected in object structure" };
      }

      if (depth > maxDepth) {
        return { valid: false, reason: `Max JSON depth limit (${maxDepth}) exceeded` };
      }

      ancestors.add(val as object);
      stack.push({ type: "EXIT", target: val as object });

      if (Array.isArray(val)) {
        for (let i = val.length - 1; i >= 0; i--) {
          stack.push({ type: "ENTER", value: val[i], depth: depth + 1 });
        }
      } else {
        const entries = Object.entries(val as Record<string, unknown>);
        for (let i = entries.length - 1; i >= 0; i--) {
          const v = entries[i][1];
          if (v !== undefined) {
            stack.push({ type: "ENTER", value: v, depth: depth + 1 });
          }
        }
      }
    }
  }

  return { valid: true };
}

/**
 * 断言值必须为合法的 JSON 兼容结构，若非法则抛出 TypeError。
 *
 * @param value 待断言的目标值
 * @param options 校验配置选项
 */
export function assertJsonValue(
  value: unknown,
  options?: ValidateJsonOptions
): asserts value is JsonValue {
  const result = validateJsonValue(value, options);
  if (!result.valid) {
    throw new TypeError(`Invalid JSON value: ${result.reason}`);
  }
}
