import {
  INPUT_NOT_JSON,
  INPUT_VALIDATION_FAILED,
} from "../errors";
import {
  InputError,
  invalidJson,
  invalidJsonLiteral,
  flatInputLimitExceeded,
  inputLimitExceeded,
  inputPolicyViolation,
  type InputValidationSource,
} from "./flat-errors";
import type {
  ActionInputValidationResult,
  JsonValueValidationResult,
} from "../json/value-validator";

/**
 * 校验失败结构化输入描述。
 */
export type ValidationFailureInput =
  | Exclude<ActionInputValidationResult, { valid: true }>
  | Exclude<JsonValueValidationResult, { valid: true }>
  | {
      valid: false;
      kind?: "json-value" | "input-policy";
      code: string;
      reason: string;
      path?: string;
      property?: string;
      [key: string]: unknown;
    };

/**
 * 将校验失败结果根据输入来源映射为统一结构化异常。
 * 遵循技术设计文档第 19 节 Mapping Table 规范。
 *
 * @param source 输入校验来源
 * @param result 校验失败结果对象
 * @returns 映射后的结构化输入异常
 */
export function mapInputValidationFailure(
  source: InputValidationSource,
  result: ActionInputValidationResult | JsonValueValidationResult | ValidationFailureInput
): InputError {
  const failure = result as any;
  const code: string = failure.code;
  const reason: string = failure.reason;
  const path: string | undefined = failure.path;
  const isPolicyViolation =
    failure.kind === "input-policy" || code === "FORBIDDEN_PROPERTY";

  switch (source) {
    case "flat-json-literal": {
      if (code === "SYNTAX_ERROR") {
        return invalidJsonLiteral(reason || "Invalid JSON literal syntax", {
          reason: "SYNTAX_ERROR",
          path,
        });
      }
      if (code === "NON_FINITE_NUMBER") {
        return invalidJsonLiteral(reason || "Non-finite number in JSON literal", {
          reason: "NON_FINITE_NUMBER",
          path,
        });
      }
      if (code === "MAX_JSON_DEPTH") {
        return invalidJsonLiteral(reason || "Max JSON depth limit exceeded in JSON literal", {
          reason: "MAX_JSON_DEPTH",
          path,
        });
      }
      return invalidJsonLiteral(reason || "Invalid JSON literal value", {
        reason: "INVALID_JSON_VALUE",
        path,
      });
    }

    case "full-json-inline":
    case "full-json-file":
    case "full-json-stdin": {
      const cliSource =
        source === "full-json-inline"
          ? "inline-json"
          : source === "full-json-file"
            ? "file"
            : "stdin";

      if (code === "SYNTAX_ERROR") {
        return invalidJson(reason || "Invalid JSON syntax", {
          reason: "SYNTAX_ERROR",
          source: cliSource,
          path,
        });
      }
      if (code === "INVALID_UTF8") {
        return invalidJson(reason || "Invalid UTF-8 encoding in JSON input", {
          reason: "INVALID_UTF8",
          source: cliSource,
          path,
        });
      }
      if (code === "NON_FINITE_NUMBER") {
        return invalidJson(reason || "Number is non-finite or NaN", {
          reason: "NON_FINITE_NUMBER",
          source: cliSource,
          path,
        });
      }
      if (code === "MAX_JSON_DEPTH") {
        return invalidJson(reason || "Max JSON depth limit exceeded", {
          reason: "MAX_JSON_DEPTH",
          source: cliSource,
          path,
        });
      }
      return invalidJson(reason || "Invalid JSON value", {
        reason: "INVALID_JSON_VALUE",
        source: cliSource,
        path,
      });
    }

    case "flat-materialized": {
      if (code === "MAX_JSON_DEPTH") {
        return flatInputLimitExceeded(
          reason || "Materialized JSON depth limit exceeded",
          {
            reason: "MAX_MATERIALIZED_JSON_DEPTH",
            path,
          }
        );
      }
      if (code === "MAX_MATERIALIZED_BYTES") {
        return flatInputLimitExceeded(
          reason || "Materialized input size exceeds limit",
          {
            reason: "MAX_MATERIALIZED_BYTES",
            path,
          }
        );
      }
      return flatInputLimitExceeded(
        reason || "Materialized input validation failed",
        {
          reason: "INVALID_JSON_VALUE",
          path,
        }
      );
    }

    case "cli-pre-target": {
      if (isPolicyViolation) {
        const property = failure.property;
        return inputPolicyViolation(
          reason || `Forbidden property "${property}" is not allowed in Action input`,
          {
            reason: "FORBIDDEN_PROPERTY",
            property,
            path,
          }
        );
      }
      if (code === "MAX_JSON_DEPTH") {
        return inputLimitExceeded(reason || "Max JSON depth limit exceeded", {
          reason: "MAX_JSON_DEPTH",
          path,
        });
      }
      if (code === "NON_FINITE_NUMBER") {
        return invalidJson(reason || "Number is non-finite or NaN", {
          reason: "NON_FINITE_NUMBER",
          path,
        });
      }
      return invalidJson(reason || "Invalid JSON value in Action input", {
        reason: "INVALID_JSON_VALUE",
        path,
      });
    }

    case "runtime": {
      if (isPolicyViolation) {
        return new InputError(
          INPUT_VALIDATION_FAILED,
          reason || "Action input contains forbidden property",
          [reason || "Forbidden property in input"]
        );
      }
      return new InputError(
        INPUT_NOT_JSON,
        reason || "Input is not a valid JSON value",
        {
          reason: code,
          path,
        }
      );
    }

    default: {
      return new InputError(
        INPUT_NOT_JSON,
        reason || "Input validation failed",
        {
          reason: code,
          path,
        }
      );
    }
  }
}
