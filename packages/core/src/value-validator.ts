import type { JsonValue } from "@actiondock/sdk";
import { isForbiddenActionInputPropertyName } from "./input/flat-predicates";

/** 默认 JSON 最大嵌套深度限制（防止恶意超深结构） */
export const DEFAULT_MAX_JSON_DEPTH = 256;

/** 最大安全递归调用栈深度，防止超大自定义 maxDepth 导致栈溢出 */
const MAX_SAFE_RECURSION_DEPTH = 2048;

/**
 * JSON 结构校验选项。
 */
export interface ValidateJsonOptions {
  /** 最大允许嵌套深度（默认 256） */
  maxDepth?: number;
}

/**
 * Action 输入校验选项。
 */
export interface ValidateActionInputOptions extends ValidateJsonOptions {}

/**
 * JSON 值校验错误码类型。
 */
export type JsonValueValidationErrorCode =
  | "NON_FINITE_NUMBER"
  | "MAX_JSON_DEPTH"
  | "CIRCULAR_REFERENCE"
  | "UNSUPPORTED_JSON_TYPE"
  | "INVALID_JSON_OBJECT"
  | "UNDEFINED_JSON_VALUE";

/**
 * Canonical JsonValue 校验结果。
 */
export type JsonValueValidationResult =
  | { valid: true }
  | {
      valid: false;
      code: JsonValueValidationErrorCode;
      reason: string;
      path?: string;
    };

/**
 * Action 输入值校验结果（包含策略违规分支）。
 */
export type ActionInputValidationResult =
  | { valid: true }
  | {
      valid: false;
      kind: "json-value";
      code: JsonValueValidationErrorCode;
      reason: string;
      path?: string;
    }
  | {
      valid: false;
      kind: "input-policy";
      code: "FORBIDDEN_PROPERTY";
      property: string;
      path: string;
      reason: string;
    };

/**
 * 按照 RFC 6901 转义单个 JSON Pointer 路径段。
 *
 * @param segment 路径段（属性名或数组索引）
 * @returns 转义后的路径段
 */
export function escapeJsonPointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * 将路径段追加到基础 RFC 6901 JSON Pointer 路径后。
 *
 * @param basePath 基础路径
 * @param segment 待追加的路径段
 * @returns 拼接后的 JSON Pointer
 */
export function appendJsonPointer(
  basePath: string,
  segment: string | number
): string {
  return `${basePath}/${escapeJsonPointerSegment(segment)}`;
}

type InternalValidationResult =
  | { valid: true }
  | {
      valid: false;
      kind: "json-value";
      code: JsonValueValidationErrorCode;
      reason: string;
      path: string;
    }
  | {
      valid: false;
      kind: "input-policy";
      code: "FORBIDDEN_PROPERTY";
      property: string;
      path: string;
      reason: string;
    };

function walkJsonValue(
  val: unknown,
  depth: number,
  path: string,
  maxDepth: number,
  ancestors: Set<object>,
  checkForbidden: boolean
): InternalValidationResult {
  if (val === null || typeof val === "boolean" || typeof val === "string") {
    return { valid: true };
  }

  if (typeof val === "number") {
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      return {
        valid: false,
        kind: "json-value",
        code: "NON_FINITE_NUMBER",
        reason: `Number is non-finite or NaN (${val})`,
        path,
      };
    }
    return { valid: true };
  }

  if (typeof val === "undefined") {
    return {
      valid: false,
      kind: "json-value",
      code: "UNDEFINED_JSON_VALUE",
      reason: "Undefined value is not allowed in JSON",
      path,
    };
  }

  if (
    typeof val === "function" ||
    typeof val === "symbol" ||
    typeof val === "bigint"
  ) {
    return {
      valid: false,
      kind: "json-value",
      code: "UNSUPPORTED_JSON_TYPE",
      reason: `Unsupported JSON type '${typeof val}'`,
      path,
    };
  }

  if (typeof val === "object") {
    if (depth > maxDepth || depth > MAX_SAFE_RECURSION_DEPTH) {
      return {
        valid: false,
        kind: "json-value",
        code: "MAX_JSON_DEPTH",
        reason: `Max JSON depth limit (${maxDepth}) exceeded`,
        path,
      };
    }

    if (ancestors.has(val)) {
      return {
        valid: false,
        kind: "json-value",
        code: "CIRCULAR_REFERENCE",
        reason: "Circular reference detected in object structure",
        path,
      };
    }

    try {
      if (Array.isArray(val)) {
        if (Object.getPrototypeOf(val) !== Array.prototype) {
          return {
            valid: false,
            kind: "json-value",
            code: "INVALID_JSON_OBJECT",
            reason: "Array prototype must be Array.prototype",
            path,
          };
        }

        // 稀疏数组（存在 hole）不是合法 JSON 结构
        for (let i = 0; i < val.length; i++) {
          if (!(i in val)) {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: `Sparse array (hole at index ${i}) is not allowed in JSON`,
              path: appendJsonPointer(path, i),
            };
          }
        }

        // 数组只允许索引元素，拒绝额外字符串属性或 Symbol 属性（忽略不可枚举的内建属性如 length）
        const extraKeys = Reflect.ownKeys(val).filter((k) => {
          if (typeof k === "symbol") return true;
          if (!/^\d+$/.test(k) || Number(k) >= val.length) {
            const desc = Object.getOwnPropertyDescriptor(val, k as string);
            // 不可枚举属性（如数组内建 length）不视为额外属性
            return desc?.enumerable === true;
          }
          return false;
        });
        if (extraKeys.length > 0) {
          return {
            valid: false,
            kind: "json-value",
            code: "INVALID_JSON_OBJECT",
            reason: "Arrays must not carry extra properties beyond indexed elements",
            path,
          };
        }

        ancestors.add(val);
        try {
          for (let i = 0; i < val.length; i++) {
            const res = walkJsonValue(
              val[i],
              depth + 1,
              appendJsonPointer(path, i),
              maxDepth,
              ancestors,
              checkForbidden
            );
            if (!res.valid) return res;
          }
        } finally {
          ancestors.delete(val);
        }

        return { valid: true };
      }

      const proto = Object.getPrototypeOf(val);
      if (proto !== Object.prototype && proto !== null) {
        return {
          valid: false,
          kind: "json-value",
          code: "INVALID_JSON_OBJECT",
          reason: "Object prototype must be Object.prototype or null",
          path,
        };
      }

      const ownKeys = Reflect.ownKeys(val);

      if (checkForbidden) {
        for (let i = 0; i < ownKeys.length; i++) {
          const key = ownKeys[i];
          if (typeof key === "string" && isForbiddenActionInputPropertyName(key)) {
            return {
              valid: false,
              kind: "input-policy",
              code: "FORBIDDEN_PROPERTY",
              property: key,
              path: appendJsonPointer(path, key),
              reason: `Forbidden property "${key}" is not allowed in Action input`,
            };
          }
        }
      }

      ancestors.add(val);
      try {
        for (let i = 0; i < ownKeys.length; i++) {
          const key = ownKeys[i];
          if (typeof key !== "string") {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: "Symbol-keyed properties are not allowed in JSON object",
              path: appendJsonPointer(path, String(key)),
            };
          }

          const propPath = appendJsonPointer(path, key);
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc) continue;

          if (desc.get !== undefined || desc.set !== undefined) {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: `Accessor properties (getters/setters) are not allowed for key "${key}"`,
              path: propPath,
            };
          }

          if (!desc.enumerable) {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: `Non-enumerable properties are not allowed for key "${key}"`,
              path: propPath,
            };
          }

          if (desc.value === undefined) {
            return {
              valid: false,
              kind: "json-value",
              code: "UNDEFINED_JSON_VALUE",
              reason: `Undefined value is not allowed for key "${key}"`,
              path: propPath,
            };
          }

          const res = walkJsonValue(
            desc.value,
            depth + 1,
            propPath,
            maxDepth,
            ancestors,
            checkForbidden
          );
          if (!res.valid) return res;
        }
      } finally {
        ancestors.delete(val);
      }

      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        kind: "json-value",
        code: "INVALID_JSON_OBJECT",
        reason: `Failed to inspect object: ${err instanceof Error ? err.message : String(err)}`,
        path,
      };
    }
  }

  return { valid: true };
}

/**
 * 校验值是否为合法的 Canonical JSON 兼容结构。
 *
 * @param value 待校验的目标值
 * @param options 校验配置选项
 * @returns 校验结果对象
 */
export function validateJsonValue(
  value: unknown,
  options?: ValidateJsonOptions
): JsonValueValidationResult {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const res = walkJsonValue(value, 0, "", maxDepth, new Set<object>(), false);
  if (res.valid) {
    return { valid: true };
  }
  if (res.kind !== "input-policy") {
    return {
      valid: false,
      code: res.code,
      reason: res.reason,
      path: res.path,
    };
  }
  return {
    valid: false,
    code: "INVALID_JSON_OBJECT",
    reason: res.reason,
    path: res.path,
  };
}

/**
 * 校验 Action 输入值是否满足 Canonical JsonValue 规范且符合 ActionDock 安全策略。
 * 在遍历过程中递归检查是否存在禁止属性（__proto__、constructor、prototype）。
 *
 * @param value 待校验的 Action 输入值
 * @param options 校验配置选项
 * @returns 校验结果对象
 */
export function validateActionInputValue(
  value: unknown,
  options?: ValidateActionInputOptions
): ActionInputValidationResult {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  return walkJsonValue(value, 0, "", maxDepth, new Set<object>(), true);
}

/**
 * 递归检查数据中是否包含危险的原型污染属性键名（__proto__、constructor、prototype）。
 * 针对环路对象与有向无环图（DAG）保证安全遍历且具有深度上限防御。
 *
 * @param data 待检查的目标数据
 * @param maxDepth 最大允许嵌套深度（默认 256）
 * @returns 若存在危险键名则返回 true，否则返回 false
 */
export function hasDangerousKeys(
  data: unknown,
  maxDepth = DEFAULT_MAX_JSON_DEPTH
): boolean {
  const visited = new Set<object>();

  function scan(val: unknown, depth: number): boolean {
    if (!val || typeof val !== "object" || depth > maxDepth) {
      return false;
    }
    if (visited.has(val)) {
      return false;
    }
    visited.add(val);

    try {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (scan(val[i], depth + 1)) return true;
        }
        return false;
      }

      const keys = Reflect.ownKeys(val);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (typeof k === "string" && isForbiddenActionInputPropertyName(k)) {
          return true;
        }
      }

      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (typeof k === "string") {
          const desc = Object.getOwnPropertyDescriptor(val, k);
          if (desc && desc.value !== undefined) {
            if (scan(desc.value, depth + 1)) return true;
          }
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  return scan(data, 0);
}

/**
 * 断言值必须为合法的 Canonical JSON 兼容结构，若非法则抛出 TypeError。
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
