import type { JsonValue } from "@actiondock/sdk";
import { isForbiddenActionInputPropertyName } from "../input/flat-predicates";

/** 默认 JSON 最大嵌套深度限制（防止恶意超深结构） */
export const DEFAULT_MAX_JSON_DEPTH = 256;

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

type StackFrame =
  | { type: "ENTER"; value: unknown; depth: number; path: string }
  | { type: "EXIT"; target: object };

/**
 * 内部统一 JSON 值与输入策略遍历校验引擎。
 *
 * 遍历规范：
 * - 迭代式显式栈遍历：模拟调用栈，杜绝深层结构造成的堆栈溢出。
 * - 严格数值有限性：全链路检查所有数值满足 Number.isFinite，拦截 NaN 与 Infinity。
 * - 活跃祖先集合环路检测：仅在当前子树遍历期间在祖先集合中保留，完美放行有向无环（DAG）共享子结构。
 * - 严格对象与原型校验：仅允许 Object.prototype 与 null 原型，拒绝 Date、Map、Set 等非纯数据对象与类实例。
 * - 严格数组紧凑性：校验 0..length-1 全部存在，拒绝稀疏数组、额外属性与访问器元素。
 * - Proxy 异常防御：对所有反射与属性检查执行防护拦截，杜绝未分类异常泄漏。
 * - RFC 6901 路径追踪：全链路维护转义标准 JSON Pointer 路径。
 */
function walkJsonValue(
  value: unknown,
  options?: ValidateJsonOptions,
  checkForbiddenProperties = false
): InternalValidationResult {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const ancestors = new Set<object>();

  const stack: StackFrame[] = [{ type: "ENTER", value, depth: 0, path: "" }];

  while (stack.length > 0) {
    const frame = stack.pop()!;

    if (frame.type === "EXIT") {
      ancestors.delete(frame.target);
      continue;
    }

    const { value: val, depth, path } = frame;

    if (val === null || typeof val === "boolean" || typeof val === "string") {
      continue;
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
      continue;
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
      try {
        if (ancestors.has(val as object)) {
          return {
            valid: false,
            kind: "json-value",
            code: "CIRCULAR_REFERENCE",
            reason: "Circular reference detected in object structure",
            path,
          };
        }

        if (depth > maxDepth) {
          return {
            valid: false,
            kind: "json-value",
            code: "MAX_JSON_DEPTH",
            reason: `Max JSON depth limit (${maxDepth}) exceeded`,
            path,
          };
        }

        const proto = Object.getPrototypeOf(val);
        const isArr = Array.isArray(val);

        if (isArr) {
          if (proto !== Array.prototype) {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: "Array prototype must be Array.prototype",
              path,
            };
          }

          const len = (val as unknown[]).length;
          if (
            typeof len !== "number" ||
            !Number.isInteger(len) ||
            len < 0 ||
            len > Number.MAX_SAFE_INTEGER
          ) {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: "Array length is invalid",
              path,
            };
          }

          const ownKeys = Reflect.ownKeys(val);
          if (ownKeys.length !== len + 1) {
            return {
              valid: false,
              kind: "json-value",
              code: "INVALID_JSON_OBJECT",
              reason: "Array must be dense without extra properties or holes",
              path,
            };
          }

          ancestors.add(val as object);
          stack.push({ type: "EXIT", target: val as object });

          for (let i = len - 1; i >= 0; i--) {
            const keyStr = String(i);
            const desc = Object.getOwnPropertyDescriptor(val, keyStr);
            const elemPath = appendJsonPointer(path, i);

            if (!desc) {
              return {
                valid: false,
                kind: "json-value",
                code: "INVALID_JSON_OBJECT",
                reason: `Sparse array (missing element at index ${i})`,
                path: elemPath,
              };
            }

            if (desc.get !== undefined || desc.set !== undefined) {
              return {
                valid: false,
                kind: "json-value",
                code: "INVALID_JSON_OBJECT",
                reason: `Accessor property not allowed at array index ${i}`,
                path: elemPath,
              };
            }

            if (!desc.enumerable) {
              return {
                valid: false,
                kind: "json-value",
                code: "INVALID_JSON_OBJECT",
                reason: `Non-enumerable property not allowed at array index ${i}`,
                path: elemPath,
              };
            }

            if (desc.value === undefined) {
              return {
                valid: false,
                kind: "json-value",
                code: "UNDEFINED_JSON_VALUE",
                reason: `Undefined value is not allowed at array index ${i}`,
                path: elemPath,
              };
            }

            stack.push({
              type: "ENTER",
              value: desc.value,
              depth: depth + 1,
              path: elemPath,
            });
          }
        } else {
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

          ancestors.add(val as object);
          stack.push({ type: "EXIT", target: val as object });

          for (let i = ownKeys.length - 1; i >= 0; i--) {
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

            if (
              checkForbiddenProperties &&
              isForbiddenActionInputPropertyName(key)
            ) {
              return {
                valid: false,
                kind: "input-policy",
                code: "FORBIDDEN_PROPERTY",
                property: key,
                path: propPath,
                reason: `Forbidden property "${key}" is not allowed in Action input`,
              };
            }

            const desc = Object.getOwnPropertyDescriptor(val, key);
            if (!desc) {
              return {
                valid: false,
                kind: "json-value",
                code: "INVALID_JSON_OBJECT",
                reason: `Property descriptor missing for key "${key}"`,
                path: propPath,
              };
            }

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

            stack.push({
              type: "ENTER",
              value: desc.value,
              depth: depth + 1,
              path: propPath,
            });
          }
        }
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
  const res = walkJsonValue(value, options, false);
  if (res.valid) {
    return { valid: true };
  }
  if (res.kind === "input-policy") {
    return {
      valid: false,
      code: "INVALID_JSON_OBJECT",
      reason: res.reason,
      path: res.path,
    };
  }
  return {
    valid: false,
    code: res.code,
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
  return walkJsonValue(value, options, true);
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
