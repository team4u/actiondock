/**
 * Action 输出正文字段与 Schema 契约静态分析工具。
 *
 * 核心设计原则：
 * - 纯数据分析：仅基于 Action 清单与 Schema 纯元数据推导，无数据库、无模块加载、无业务执行副作用。
 * - 静态契约门禁：区分确定矛盾（错误）与无法证明安全（风险警告），不将不确定误判为合法，亦不为证明安全而试跑动作。
 * - 单一事实源：声明解析、展示描述与门禁校验共用同一套底层纯规则。
 */

/**
 * 契约诊断项。
 */
export interface OutputContractDiagnostic {
  type: "error" | "warning";
  code: string;
  message: string;
}

/**
 * 注解解析与检验结果。
 */
export interface AnnotationInspectionResult {
  declared: boolean;
  valid: boolean;
  textField?: string;
  error?: string;
}

/**
 * 输出契约分析输入项。
 */
export interface ActionOutputContractInput {
  annotations?: unknown;
  outputSchema?: unknown;
}

/**
 * 输出契约全量分析结果。
 */
export interface ActionOutputContractAnalysis {
  declared: boolean;
  valid: boolean;
  textField?: string;
  errors: string[];
  warnings: string[];
  diagnostics: OutputContractDiagnostic[];
}

/**
 * 纯静态解析并校验 Action annotations 中的 actiondock.cli 声明。
 *
 * 契约规范：
 * - 注解键名固定为 actiondock.cli，值必须为非空非数组对象。
 * - 正文字段键名为 textField，值必须为非空字符串。
 * - 无相关注解或未声明 textField 时返回 declared: false, valid: true。
 * - 注解存在但类型非法时返回 valid: false 与对应错误描述。
 */
export function inspectActionTextFieldAnnotation(
  annotations?: unknown
): AnnotationInspectionResult {
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    return { declared: false, valid: true };
  }

  const record = annotations as Record<string, unknown>;
  if (!Object.hasOwn(record, "actiondock.cli")) {
    return { declared: false, valid: true };
  }

  const cli = record["actiondock.cli"];
  if (cli === undefined) {
    return { declared: false, valid: true };
  }

  if (typeof cli !== "object" || cli === null || Array.isArray(cli)) {
    return {
      declared: true,
      valid: false,
      error: `Invalid 'actiondock.cli' annotation: expected an object, but received ${
        cli === null ? "null" : Array.isArray(cli) ? "an array" : typeof cli
      }.`,
    };
  }

  const cliRecord = cli as Record<string, unknown>;
  if (!Object.hasOwn(cliRecord, "textField") || cliRecord.textField === undefined) {
    return { declared: false, valid: true };
  }

  const textField = cliRecord.textField;
  if (typeof textField !== "string") {
    return {
      declared: true,
      valid: false,
      error: `Invalid 'actiondock.cli.textField' annotation: expected a string, but received ${
        textField === null ? "null" : Array.isArray(textField) ? "an array" : typeof textField
      }.`,
    };
  }

  if (textField.trim() === "") {
    return {
      declared: true,
      valid: false,
      error: "Invalid 'actiondock.cli.textField' annotation: cannot be an empty string.",
    };
  }

  return {
    declared: true,
    valid: true,
    textField,
  };
}

/**
 * 静态分析 Action 输出契约（textField 注解与 outputSchema 的兼容性）。
 *
 * 错误判断（确定矛盾）：
 * - 注解结构非法或 textField 不是非空字符串；
 * - Schema 明确拒绝所有结果（boolean false）；
 * - Schema 明确只允许非对象根类型；
 * - Schema 明确禁止目标属性（property schema 为 false）；
 * - Schema 明确要求目标属性为非字符串类型；
 * - 目标属性不存在且 Schema 明确禁止额外属性（additionalProperties 为 false）。
 *
 * 风险提示（无法完全静态证明安全）：
 * - 目标字段未声明为 required；
 * - 目标字段允许 null 等非字符串类型；
 * - outputSchema 缺失或为布尔 true；
 * - 未声明 properties 但允许额外属性，或未声明目标属性但允许额外属性；
 * - Schema 包含 oneOf/anyOf/allOf/$ref 复杂组合无法简单静态推导。
 */
export function analyzeActionOutputContract(
  input: ActionOutputContractInput
): ActionOutputContractAnalysis {
  const inspection = inspectActionTextFieldAnnotation(input.annotations);

  if (!inspection.valid) {
    const errorMsg = inspection.error!;
    return {
      declared: true,
      valid: false,
      errors: [errorMsg],
      warnings: [],
      diagnostics: [
        {
          type: "error",
          code: "INVALID_ANNOTATION",
          message: errorMsg,
        },
      ],
    };
  }

  if (!inspection.declared || !inspection.textField) {
    return {
      declared: false,
      valid: true,
      errors: [],
      warnings: [],
      diagnostics: [],
    };
  }

  const textField = inspection.textField;
  const errors: string[] = [];
  const warnings: string[] = [];
  const diagnostics: OutputContractDiagnostic[] = [];

  function addError(code: string, message: string) {
    errors.push(message);
    diagnostics.push({ type: "error", code, message });
  }

  function addWarning(code: string, message: string) {
    warnings.push(message);
    diagnostics.push({ type: "warning", code, message });
  }

  const schema = input.outputSchema;

  if (schema === undefined) {
    addWarning(
      "OUTPUT_SCHEMA_ABSENT",
      `Output schema is absent; cannot statically verify text field '${textField}'. Runtime validation will apply.`
    );
    return {
      declared: true,
      valid: true,
      textField,
      errors,
      warnings,
      diagnostics,
    };
  }

  if (schema === false) {
    addError(
      "OUTPUT_SCHEMA_REJECTS_ALL",
      `Output schema explicitly rejects all outputs (schema is false); cannot produce object containing text field '${textField}'.`
    );
    return {
      declared: true,
      valid: false,
      textField,
      errors,
      warnings,
      diagnostics,
    };
  }

  if (schema === true) {
    addWarning(
      "OUTPUT_SCHEMA_ARBITRARY",
      `Output schema allows arbitrary values (schema is true); text field '${textField}' is not guaranteed to exist or be a string.`
    );
    return {
      declared: true,
      valid: true,
      textField,
      errors,
      warnings,
      diagnostics,
    };
  }

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    addError(
      "INVALID_OUTPUT_SCHEMA",
      "Invalid outputSchema: expected a schema object or boolean."
    );
    return {
      declared: true,
      valid: false,
      textField,
      errors,
      warnings,
      diagnostics,
    };
  }

  const s = schema as Record<string, unknown>;

  // 1. 检查根节点类型约束
  if (s.type === undefined) {
    addWarning(
      "ROOT_TYPE_UNSPECIFIED",
      `Output schema does not explicitly specify root type as 'object'; non-object outputs cannot satisfy text field '${textField}'.`
    );
  } else {
    const rootTypes = Array.isArray(s.type) ? s.type : [s.type];
    if (!rootTypes.includes("object")) {
      addError(
        "ROOT_TYPE_NOT_OBJECT",
        `Output schema root type is '${String(s.type)}', which does not allow an object required for text field '${textField}'.`
      );
      return {
        declared: true,
        valid: false,
        textField,
        errors,
        warnings,
        diagnostics,
      };
    }
    const nonObjectTypes = rootTypes.filter((t) => t !== "object");
    if (nonObjectTypes.length > 0) {
      addWarning(
        "ROOT_TYPE_ALLOWS_NON_OBJECT",
        `Output schema root type allows non-object types (${nonObjectTypes.join(
          ", "
        )}); text output requires an object at runtime.`
      );
    }
  }

  // 2. 检查复杂组合关键字（oneOf, anyOf, allOf, $ref）
  if (s.oneOf || s.anyOf || s.allOf || s.$ref) {
    addWarning(
      "COMPLEX_SCHEMA_COMPOSITION",
      `Output schema contains complex composition keywords (oneOf/anyOf/allOf/$ref); text field '${textField}' cannot be fully verified statically.`
    );
  }

  const hasPatternProps = Boolean(
    s.patternProperties &&
      typeof s.patternProperties === "object" &&
      !Array.isArray(s.patternProperties) &&
      Object.keys(s.patternProperties).length > 0
  );

  // 3. 检查属性定义与目标字段
  if (s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)) {
    const props = s.properties as Record<string, unknown>;
    if (Object.hasOwn(props, textField)) {
      const fieldSchema = props[textField];
      if (fieldSchema === false) {
        addError(
          "TEXT_FIELD_FORBIDDEN",
          `Output schema property '${textField}' is explicitly forbidden (property schema is false).`
        );
      } else if (fieldSchema === true) {
        addWarning(
          "TEXT_FIELD_UNTYPED",
          `Property '${textField}' does not specify a type; cannot guarantee it will be a string.`
        );
      } else if (
        typeof fieldSchema === "object" &&
        fieldSchema !== null &&
        !Array.isArray(fieldSchema)
      ) {
        const propObj = fieldSchema as Record<string, unknown>;
        if (propObj.oneOf || propObj.anyOf || propObj.allOf || propObj.$ref) {
          addWarning(
            "TEXT_FIELD_COMPLEX_COMPOSITION",
            `Property '${textField}' contains complex composition keywords (oneOf/anyOf/allOf/$ref); text output cannot be fully verified statically.`
          );
        }

        if (propObj.type === undefined) {
          addWarning(
            "TEXT_FIELD_UNTYPED",
            `Property '${textField}' does not specify a type; cannot guarantee it will be a string.`
          );
        } else {
          const fieldTypes = Array.isArray(propObj.type) ? propObj.type : [propObj.type];
          if (!fieldTypes.includes("string")) {
            addError(
              "TEXT_FIELD_NOT_STRING",
              `Output schema property '${textField}' has type '${String(
                propObj.type
              )}', which does not allow string.`
            );
          } else {
            const nonStringTypes = fieldTypes.filter((t) => t !== "string");
            if (nonStringTypes.length > 0) {
              addWarning(
                "TEXT_FIELD_ALLOWS_NON_STRING",
                `Property '${textField}' allows non-string types (${nonStringTypes.join(
                  ", "
                )}); text output requires a string at runtime.`
              );
            }
          }
        }
      }
    } else {
      // 字段未在 properties 中明确定义
      if (s.additionalProperties === false) {
        if (hasPatternProps) {
          addWarning(
            "TEXT_FIELD_PATTERN_PROPERTIES",
            `Text field '${textField}' is not declared in properties; presence may be governed by patternProperties and cannot be fully verified statically.`
          );
        } else {
          addError(
            "TEXT_FIELD_DISALLOWED_ADDITIONAL",
            `Text field '${textField}' is not declared in outputSchema properties and additionalProperties is false.`
          );
        }
      } else {
        addWarning(
          "TEXT_FIELD_UNDECLARED_ADDITIONAL",
          `Text field '${textField}' is not declared in outputSchema properties (allowed via additionalProperties); existence and type cannot be statically verified.`
        );
      }
    }
  } else {
    // 未定义 properties
    if (s.additionalProperties === false) {
      if (hasPatternProps) {
        addWarning(
          "TEXT_FIELD_PATTERN_PROPERTIES",
          `Text field '${textField}' is not declared in properties; presence may be governed by patternProperties and cannot be fully verified statically.`
        );
      } else {
        addError(
          "TEXT_FIELD_DISALLOWED_NO_PROPERTIES",
          `Output schema has no properties declared and additionalProperties is false; text field '${textField}' cannot exist.`
        );
      }
    } else {
      addWarning(
        "TEXT_FIELD_NO_PROPERTIES",
        `Output schema does not define properties; text field '${textField}' existence cannot be statically verified.`
      );
    }
  }

  // 4. 检查 required 约束（若无确定阻止字段存在的错误）
  if (errors.length === 0) {
    const isRequired = Array.isArray(s.required) && s.required.includes(textField);
    if (!isRequired) {
      addWarning(
        "TEXT_FIELD_NOT_REQUIRED",
        `Text field '${textField}' is not marked as required in outputSchema; if absent at runtime, text extraction will fail with OUTPUT_FORMAT_ERROR (business execution remains successful in run records).`
      );
    }
  }

  return {
    declared: true,
    valid: errors.length === 0,
    textField,
    errors,
    warnings,
    diagnostics,
  };
}
