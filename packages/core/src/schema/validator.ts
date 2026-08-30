import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "@actiondock/sdk";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});
addFormats(ajv);

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

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
