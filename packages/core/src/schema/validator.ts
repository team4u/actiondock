import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "@actiondock/sdk";

// 初始化全局 Ajv 实例，预载所有标准 format 格式校验器
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});
addFormats(ajv);

// 缓存已编译的 ValidateFunction，提升性能并支持同对象引用复用
const validatorCache = new WeakMap<object, ValidateFunction>();

/**
 * JSON Schema 校验结果对象。
 */
export interface ValidationResult {
  /** 数据是否完全符合 Schema 规范 */
  valid: boolean;
  /** 校验失败时的具体错误详情列表 */
  errors?: string[];
}

/**
 * 递归检查数据中是否包含危险的原型污染属性键名（__proto__、constructor、prototype）。
 */
export function hasDangerousKeys(data: unknown): boolean {
  if (data === null || typeof data !== "object") {
    return false;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (hasDangerousKeys(item)) return true;
    }
    return false;
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return true;
    }
    if (hasDangerousKeys(obj[key])) {
      return true;
    }
  }
  return false;
}

/**
 * 校验指定数据是否符合给定的 JSON Schema 契约。
 * 
 * 行为与策略约定：
 * 1. 严格契约校验：当 Schema 中定义 additionalProperties: false 时，包含未声明属性的输入将被直接拒绝（返回 valid: false），系统不会静默过滤或篡改用户输入。
 * 2. 危险原型键硬拦截：输入数据或其任意嵌套对象中若出现 __proto__、constructor 或 prototype 键名，即使 Schema 允许亦立即拒绝，彻底杜绝原型污染。
 * 3. 布尔 Schema：false 显式拒绝所有输入；true 或未定义时允许所有合法非污染数据。
 * 4. 无原型对象支持：完全支持 Object.create(null) 创建的无原型对象校验。
 * 
 * @param schema 期望匹配的 JSON Schema 对象（未提供或为空对象/true 时默认通过；为 false 时拒绝所有数据）
 * @param data 待校验的原始数据
 * @returns 包含 valid 状态与错误信息列表的 ValidationResult
 */
export function validateSchema(
  schema: JsonSchema | undefined,
  data: unknown
): ValidationResult {
  // 1. 布尔 Schema 支持：false 拒绝一切输入；true/undefined 允许一切输入
  if (schema === false) {
    return {
      valid: false,
      errors: ["Schema is false, rejecting all data"],
    };
  }

  if (schema === true || !schema) {
    if (hasDangerousKeys(data)) {
      return {
        valid: false,
        errors: ["Data contains prohibited prototype pollution keys (__proto__, constructor, or prototype)"],
      };
    }
    return { valid: true };
  }

  if (typeof schema !== "object" || Object.keys(schema).length === 0) {
    if (hasDangerousKeys(data)) {
      return {
        valid: false,
        errors: ["Data contains prohibited prototype pollution keys (__proto__, constructor, or prototype)"],
      };
    }
    return { valid: true };
  }

  // 2. 危险原型键拦截
  if (hasDangerousKeys(data)) {
    return {
      valid: false,
      errors: ["Data contains prohibited prototype pollution keys (__proto__, constructor, or prototype)"],
    };
  }

  try {
    let validate = validatorCache.get(schema);
    if (!validate) {
      // 避免因相同 $id 误用全局旧验证器，剥离 $id 进行独立编译
      if ("$id" in schema) {
        const { $id, ...cleanSchema } = schema as Record<string, unknown>;
        validate = ajv.compile(cleanSchema);
      } else {
        validate = ajv.compile(schema);
      }
      validatorCache.set(schema, validate);
    }
    const valid = validate(data);

    if (valid) {
      return { valid: true };
    }

    const errors = (validate.errors || []).map((err) => {
      const path = err.instancePath ? `at '${err.instancePath}' ` : "";
      return `${path}${err.message || "failed validation"}`.trim();
    });

    return {
      valid: false,
      errors: errors.length > 0 ? errors : ["Schema validation failed"],
    };
  } catch (err: any) {
    return {
      valid: false,
      errors: [`Schema compilation error: ${err.message || String(err)}`],
    };
  }
}
