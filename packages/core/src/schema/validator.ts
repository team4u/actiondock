import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "@actiondock/sdk";

// 初始化全局 Ajv 实例，预载所有标准 format 格式校验器
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});
addFormats(ajv);

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
 * 校验指定数据是否符合给定的 JSON Schema 契约。
 * 
 * @param schema 期望匹配的 JSON Schema 对象（未提供或为空对象时默认通过）
 * @param data 待校验的原始数据
 * @returns 包含 valid 状态与错误信息列表的 ValidationResult
 */
export function validateSchema(
  schema: JsonSchema | undefined,
  data: unknown
): ValidationResult {
  if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) {
    return { valid: true };
  }

  try {
    const validate = ajv.compile(schema);
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
