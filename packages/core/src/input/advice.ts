import {
  isFlatSafePropertyName,
  isFlatPathPropertyName,
  isForbiddenActionInputPropertyName,
} from "./flat-predicates";

/**
 * 单个字段的输入建议明细（v1 机器契约）。
 */
export interface CliInputFieldAdviceV1 {
  /** 字段路径（属性名） */
  path: string;
  /** 是否允许作为输入传入 */
  inputAllowed: boolean;
  /** 是否可通过扁平语法安全赋值 */
  flatSafe: boolean;
  /** 是否为必填字段 */
  required?: boolean;
  /** 字段模式类型 */
  type?: string;
  /** 赋值操作符（"=" 或 ":="） */
  operator?: "=" | ":=";
  /** 编码类型标识 */
  encoding?:
    | "string"
    | "json-number"
    | "json-boolean"
    | "json-null"
    | "json-array"
    | "json-object"
    | "json"
    | string;
  /** 赋值模板样例 */
  assignmentTemplate?: string;
  /** 无法通过扁平赋值或被禁止的原因代码 */
  reason?: "FORBIDDEN_PROPERTY" | "UNSAFE_FLAT_PROPERTY" | "PROPERTY_SCHEMA_FALSE" | string;
  /** 推荐的降级输入通道 */
  fallback?: "stdin-json" | null;
  /** 字段描述信息 */
  description?: string;
  /** 人类提示信息 */
  hint?: string;
}

/**
 * Action 输入模式编码顾问分析报告（v1 机器契约）。
 */
export interface CliInputAdviceV1 {
  version: 1;

  analysisMode: "declared-properties-only";
  analysisStatus: "ok" | "unsupported" | "malformed";

  analysisCode?:
    | "MALFORMED_SCHEMA"
    | "COMPLEX_SCHEMA"
    | "UNSUPPORTED_SCHEMA_SHAPE";

  analysisMessage?: string;

  schemaState:
    | "absent"
    | "reject-all"
    | "any"
    | "object"
    | "json-only"
    | "complex";

  inputFeasibility:
    | "known-impossible"
    | "possible-or-unknown";

  flatAvailable: boolean;
  requiredSatisfiable: boolean | null;
  flatCandidate: boolean;

  schemaRecommendedMode:
    | "none"
    | "flat"
    | "full-json";

  feasibilityCode?:
    | "SCHEMA_REJECTS_ALL"
    | "REQUIRED_FIELD_FORBIDDEN"
    | "REQUIRED_FIELD_REJECTS_ALL"
    | "REQUIRED_FIELD_DISALLOWED_BY_ADDITIONAL_PROPERTIES";

  fields: CliInputFieldAdviceV1[];
}

const RECOGNIZED_SCHEMA_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

const COMPLEX_KEYWORDS = [
  "oneOf",
  "anyOf",
  "allOf",
  "$ref",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "dependentSchemas",
  "dependentRequired",
  "propertyNames",
  "unevaluatedProperties",
] as const;

function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isJsonValueLike(val: unknown): boolean {
  if (
    typeof val === "function" ||
    typeof val === "symbol" ||
    typeof val === "undefined" ||
    typeof val === "bigint"
  ) {
    return false;
  }
  if (typeof val === "number" && (!Number.isFinite(val) || Number.isNaN(val))) {
    return false;
  }
  return true;
}

function createMalformedAdvice(message: string): CliInputAdviceV1 {
  return {
    version: 1,
    analysisMode: "declared-properties-only",
    analysisStatus: "malformed",
    analysisCode: "MALFORMED_SCHEMA",
    analysisMessage: message,
    schemaState: "complex",
    inputFeasibility: "possible-or-unknown",
    flatAvailable: false,
    requiredSatisfiable: null,
    flatCandidate: false,
    schemaRecommendedMode: "full-json",
    fields: [],
  };
}

/**
 * 构造无字段可用、推荐 full-json 的 ok 状态报告骨架（absent / any 语义共用单一事实源）。
 * 字段顺序与既有契约保持一致，禁止调整键序。
 */
function createNonFlatOkAdvice(schemaState: "absent" | "any"): CliInputAdviceV1 {
  return {
    version: 1,
    analysisMode: "declared-properties-only",
    analysisStatus: "ok",
    schemaState,
    inputFeasibility: "possible-or-unknown",
    flatAvailable: false,
    requiredSatisfiable: null,
    flatCandidate: false,
    schemaRecommendedMode: "full-json",
    fields: [],
  };
}

/**
 * type 关键字结构校验结果原因码（根级与属性级共用单一事实源）。
 *
 * 消息拼接规则（措辞模板由调用方持有，保证既有消息逐字节不变）：
 * - UNRECOGNIZED_TYPE：字符串型 type 非法；
 * - UNRECOGNIZED_TYPE_IN_ARRAY：数组型 type 内元素非法；
 * - EMPTY_TYPE_ARRAY / NOT_STRING_OR_ARRAY：无插值；
 * - DUPLICATE_TYPE：数组内重复元素。
 */
interface TypeKeywordIssue {
  code:
    | "UNRECOGNIZED_TYPE"
    | "UNRECOGNIZED_TYPE_IN_ARRAY"
    | "EMPTY_TYPE_ARRAY"
    | "DUPLICATE_TYPE"
    | "NOT_STRING_OR_ARRAY";
  /** 参与消息插值的目标类型值（非法与重复场景提供） */
  value?: string;
}

/**
 * 校验 schema 节点的 type 关键字结构合法性（根级与属性级重复逻辑的单一事实源）。
 *
 * 判定规则：
 * - 字符串型 type 必须属于 RECOGNIZED_SCHEMA_TYPES；
 * - 数组型 type 不得为空、元素必须是受认可字符串且不得重复；
 * - 其余形态（数字、对象等）非法。
 *
 * @param type 待校验的 type 关键字值
 * @returns 非法时返回结构化原因，合法时返回 undefined
 */
function validateTypeKeyword(type: unknown): TypeKeywordIssue | undefined {
  if (typeof type === "string") {
    if (!RECOGNIZED_SCHEMA_TYPES.has(type)) {
      return { code: "UNRECOGNIZED_TYPE", value: type };
    }
    return undefined;
  }
  if (Array.isArray(type)) {
    if (type.length === 0) {
      return { code: "EMPTY_TYPE_ARRAY" };
    }
    const seen = new Set<string>();
    for (const t of type) {
      if (typeof t !== "string" || !RECOGNIZED_SCHEMA_TYPES.has(t)) {
        return { code: "UNRECOGNIZED_TYPE_IN_ARRAY", value: String(t) };
      }
      if (seen.has(t)) {
        return { code: "DUPLICATE_TYPE", value: t };
      }
      seen.add(t);
    }
    return undefined;
  }
  return { code: "NOT_STRING_OR_ARRAY" };
}

/**
 * 依 TypeKeywordIssue 构造根级 type 关键字 malformed 消息（措辞与历史实现逐字节一致）。
 */
function formatRootTypeKeywordMessage(issue: TypeKeywordIssue): string {
  switch (issue.code) {
    case "UNRECOGNIZED_TYPE":
      return `Unrecognized type keyword: '${issue.value}'`;
    case "UNRECOGNIZED_TYPE_IN_ARRAY":
      return `Unrecognized type in type array: '${issue.value}'`;
    case "EMPTY_TYPE_ARRAY":
      return "Type array must not be empty";
    case "DUPLICATE_TYPE":
      return `Duplicate type in type array: '${issue.value}'`;
    case "NOT_STRING_OR_ARRAY":
      return "Type keyword must be a string or array of strings";
  }
}

/**
 * 依 TypeKeywordIssue 构造属性级 type 关键字 malformed 消息（措辞与历史实现逐字节一致）。
 */
function formatPropertyTypeKeywordMessage(issue: TypeKeywordIssue, propKey: string): string {
  switch (issue.code) {
    case "UNRECOGNIZED_TYPE":
    case "UNRECOGNIZED_TYPE_IN_ARRAY":
      return `Unrecognized type '${issue.value}' in property '${propKey}'`;
    case "EMPTY_TYPE_ARRAY":
      return `Type array in property '${propKey}' must not be empty`;
    case "DUPLICATE_TYPE":
      return `Duplicate type '${issue.value}' in property '${propKey}'`;
    case "NOT_STRING_OR_ARRAY":
      return `Type in property '${propKey}' must be string or array of strings`;
  }
}

/**
 * 依据 inputSchema 构造 v1 版本的 Action 输入编码顾问报告（机器契约）。
 *
 * @param schema Action 的 inputSchema 定义
 * @returns 遵循技术设计文档规范的结构化输入建议
 */
export function buildCliInputAdviceV1(schema: unknown): CliInputAdviceV1 {
  // 1. Schema Sanity 阶段（Section 44）
  // 1.1 根形状检查（Section 44.1）
  if (schema === undefined) {
    return createNonFlatOkAdvice("absent");
  }

  if (typeof schema === "boolean") {
    if (schema === false) {
      return {
        version: 1,
        analysisMode: "declared-properties-only",
        analysisStatus: "ok",
        schemaState: "reject-all",
        inputFeasibility: "known-impossible",
        feasibilityCode: "SCHEMA_REJECTS_ALL",
        flatAvailable: false,
        requiredSatisfiable: false,
        flatCandidate: false,
        schemaRecommendedMode: "none",
        fields: [],
      };
    }
    return createNonFlatOkAdvice("any");
  }

  if (!isPlainObject(schema)) {
    return {
      version: 1,
      analysisMode: "declared-properties-only",
      analysisStatus: "malformed",
      analysisCode: "MALFORMED_SCHEMA",
      analysisMessage: "Schema root must be undefined, boolean, or a plain object",
      schemaState: "complex",
      inputFeasibility: "possible-or-unknown",
      flatAvailable: false,
      requiredSatisfiable: null,
      flatCandidate: false,
      schemaRecommendedMode: "full-json",
      fields: [],
    };
  }

  const s = schema as Record<string, any>;

  // 1.2 关键字形状检查（Section 44.2）
  // 检查 type（结构校验单一事实源，根级消息模板独立持有）
  if (s.type !== undefined) {
    const issue = validateTypeKeyword(s.type);
    if (issue) {
      return createMalformedAdvice(formatRootTypeKeywordMessage(issue));
    }
  }

  // 检查 properties
  if (s.properties !== undefined) {
    if (!isPlainObject(s.properties)) {
      return createMalformedAdvice("Properties keyword must be a plain object");
    }
    for (const [propKey, propVal] of Object.entries(s.properties)) {
      if (typeof propVal !== "boolean" && !isPlainObject(propVal)) {
        return createMalformedAdvice(
          `Property '${propKey}' schema must be a boolean or plain object`
        );
      }
      if (isPlainObject(propVal)) {
        if (propVal.type !== undefined) {
          const issue = validateTypeKeyword(propVal.type);
          if (issue) {
            return createMalformedAdvice(formatPropertyTypeKeywordMessage(issue, propKey));
          }
        }
        if (propVal.enum !== undefined) {
          if (!Array.isArray(propVal.enum) || propVal.enum.length === 0) {
            return createMalformedAdvice(`Enum in property '${propKey}' must be a non-empty array`);
          }
        }
        if (propVal.const !== undefined) {
          if (!isJsonValueLike(propVal.const)) {
            return createMalformedAdvice(
              `Const in property '${propKey}' must be a valid JSON value literal`
            );
          }
        }
        if (propVal.items !== undefined) {
          if (
            typeof propVal.items !== "boolean" &&
            !isPlainObject(propVal.items) &&
            !Array.isArray(propVal.items)
          ) {
            return createMalformedAdvice(
              `Items in property '${propKey}' must be boolean, plain object, or array`
            );
          }
        }
      }
    }
  }

  // 检查 required
  if (s.required !== undefined) {
    if (!Array.isArray(s.required)) {
      return createMalformedAdvice("Required keyword must be an array of strings");
    }
    const seen = new Set<string>();
    for (const item of s.required) {
      if (typeof item !== "string") {
        return createMalformedAdvice("Every item in required array must be a string");
      }
      if (seen.has(item)) {
        return createMalformedAdvice(`Duplicate required property: '${item}'`);
      }
      seen.add(item);
    }
  }

  // 检查 additionalProperties
  if (s.additionalProperties !== undefined) {
    if (
      typeof s.additionalProperties !== "boolean" &&
      !isPlainObject(s.additionalProperties)
    ) {
      return createMalformedAdvice(
        "AdditionalProperties keyword must be a boolean or plain object"
      );
    }
  }

  // 检查 items
  let isTupleItems = false;
  if (s.items !== undefined) {
    if (typeof s.items === "boolean" || isPlainObject(s.items)) {
      // 合法
    } else if (Array.isArray(s.items)) {
      isTupleItems = true;
    } else {
      return createMalformedAdvice("Items keyword must be boolean, plain object, or array");
    }
  }

  // 检查 enum
  if (s.enum !== undefined) {
    if (!Array.isArray(s.enum) || s.enum.length === 0) {
      return createMalformedAdvice("Enum keyword must be a non-empty array");
    }
  }

  // 检查 const
  if (s.const !== undefined) {
    if (!isJsonValueLike(s.const)) {
      return createMalformedAdvice("Const keyword must be a valid JSON value literal");
    }
  }

  // 检查 applicators
  if (s.oneOf !== undefined && !Array.isArray(s.oneOf)) {
    return createMalformedAdvice("OneOf keyword must be an array");
  }
  if (s.anyOf !== undefined && !Array.isArray(s.anyOf)) {
    return createMalformedAdvice("AnyOf keyword must be an array");
  }
  if (s.allOf !== undefined && !Array.isArray(s.allOf)) {
    return createMalformedAdvice("AllOf keyword must be an array");
  }
  if (s.$ref !== undefined && typeof s.$ref !== "string") {
    return createMalformedAdvice("$ref keyword must be a string");
  }
  if (s.not !== undefined && typeof s.not !== "boolean" && !isPlainObject(s.not)) {
    return createMalformedAdvice("Not keyword must be a boolean or plain object");
  }
  if (s.if !== undefined && typeof s.if !== "boolean" && !isPlainObject(s.if)) {
    return createMalformedAdvice("If keyword must be a boolean or plain object");
  }
  if (s.then !== undefined && typeof s.then !== "boolean" && !isPlainObject(s.then)) {
    return createMalformedAdvice("Then keyword must be a boolean or plain object");
  }
  if (s.else !== undefined && typeof s.else !== "boolean" && !isPlainObject(s.else)) {
    return createMalformedAdvice("Else keyword must be a boolean or plain object");
  }

  // 2. 语义分类阶段（Section 45）
  if (Object.keys(s).length === 0) {
    return createNonFlatOkAdvice("any");
  }

  const hasComplexKeyword =
    isTupleItems ||
    COMPLEX_KEYWORDS.some((kw) => s[kw] !== undefined);

  let schemaState: CliInputAdviceV1["schemaState"];
  if (hasComplexKeyword) {
    schemaState = "complex";
  } else if (s.type === "object") {
    schemaState = "object";
  } else if (typeof s.type === "string" && s.type !== "object") {
    schemaState = "json-only";
  } else if (Array.isArray(s.type)) {
    schemaState = "complex";
  } else if (
    s.type === undefined &&
    (s.properties !== undefined || s.required !== undefined || s.additionalProperties !== undefined)
  ) {
    schemaState = "complex";
  } else {
    schemaState = "complex";
  }

  const analysisStatus: CliInputAdviceV1["analysisStatus"] =
    schemaState === "complex" ? "unsupported" : "ok";
  const analysisCode =
    schemaState === "complex"
      ? isTupleItems
        ? "UNSUPPORTED_SCHEMA_SHAPE"
        : "COMPLEX_SCHEMA"
      : undefined;
  const analysisMessage =
    schemaState === "complex"
      ? "Complex schema structure is not supported for flat encoding"
      : undefined;

  // 3. 输入可行性判定（Section 47）
  const requiredList: string[] = Array.isArray(s.required) ? s.required : [];
  const properties: Record<string, any> = isPlainObject(s.properties) ? s.properties : {};

  let inputFeasibility: CliInputAdviceV1["inputFeasibility"] = "possible-or-unknown";
  let feasibilityCode: CliInputAdviceV1["feasibilityCode"] | undefined;

  if (requiredList.some(isForbiddenActionInputPropertyName)) {
    inputFeasibility = "known-impossible";
    feasibilityCode = "REQUIRED_FIELD_FORBIDDEN";
  } else if (requiredList.some((k) => properties[k] === false)) {
    inputFeasibility = "known-impossible";
    feasibilityCode = "REQUIRED_FIELD_REJECTS_ALL";
  } else if (
    s.additionalProperties === false &&
    requiredList.some((k) => !(k in properties))
  ) {
    inputFeasibility = "known-impossible";
    feasibilityCode = "REQUIRED_FIELD_DISALLOWED_BY_ADDITIONAL_PROPERTIES";
  }

  // 4. 字段建议生成（Section 50）
  const fields: CliInputFieldAdviceV1[] = [];
  for (const [key, propSchema] of Object.entries(properties)) {
    const isReq = requiredList.includes(key);

    if (isForbiddenActionInputPropertyName(key)) {
      fields.push({
        path: key,
        inputAllowed: false,
        flatSafe: false,
        required: isReq,
        reason: "FORBIDDEN_PROPERTY",
        fallback: null,
        ...(isPlainObject(propSchema) && propSchema.description
          ? { description: propSchema.description }
          : {}),
        hint: "Globally forbidden property",
      });
      continue;
    }

    if (propSchema === false) {
      fields.push({
        path: key,
        inputAllowed: false,
        flatSafe: false,
        required: isReq,
        reason: "PROPERTY_SCHEMA_FALSE",
        fallback: null,
        hint: "Property schema rejects all values",
      });
      continue;
    }

    if (!isFlatPathPropertyName(key)) {
      const typeStr =
        isPlainObject(propSchema) && propSchema.type
          ? String(propSchema.type)
          : "any";
      fields.push({
        path: key,
        inputAllowed: true,
        flatSafe: false,
        required: isReq,
        type: typeStr,
        reason: "UNSAFE_FLAT_PROPERTY",
        fallback: "stdin-json",
        ...(isPlainObject(propSchema) && propSchema.description
          ? { description: propSchema.description }
          : {}),
        hint: "Property name contains unsafe characters for flat encoding",
      });
      continue;
    }

    // Flat-safe property
    if (propSchema === true) {
      fields.push({
        path: key,
        inputAllowed: true,
        flatSafe: true,
        required: isReq,
        type: "any",
        operator: ":=",
        encoding: "json",
        assignmentTemplate: `${key}:=JSON`,
      });
      continue;
    }

    const propObj = propSchema as Record<string, any>;
    const propType = propObj.type;
    const desc = propObj.description;

    // Section 46: enum/const 规则：
    // enum/const 绝不改变 operator 选择，仅显式单一 schema.type 决定 operator。
    // 无显式 type 时不推断类型，推荐 full-json，flatSafe: false。
    if (typeof propType === "string") {
      // Flat-safe 显式单一类型的编码参数表（string/number/integer/boolean/null/array/object）。
      // 各分支仅在 type、encoding、assignmentTemplate 与 hint 上差异，结构完全一致。
      const flatSafeTypeTable: Record<
        string,
        { encoding: string; assignmentTemplate: string; hint?: string }
      > = {
        string: { encoding: "string", assignmentTemplate: `${key}=TEXT` },
        number: { encoding: "json-number", assignmentTemplate: `${key}:=NUMBER` },
        integer: { encoding: "json-number", assignmentTemplate: `${key}:=NUMBER` },
        boolean: { encoding: "json-boolean", assignmentTemplate: `${key}:=BOOLEAN` },
        null: { encoding: "json-null", assignmentTemplate: `${key}:=null` },
        array: {
          encoding: "json-array",
          assignmentTemplate: `${key}:=JSON`,
          hint: "建议使用 --input-file 或标准输入传递数组结构",
        },
        object: {
          encoding: "json-object",
          assignmentTemplate: `${key}:=JSON`,
          hint: "大型结构建议使用 --input-file",
        },
      };
      const flatSafeEntry = flatSafeTypeTable[propType];
      if (flatSafeEntry) {
        fields.push({
          path: key,
          inputAllowed: true,
          flatSafe: true,
          required: isReq,
          type: propType,
          operator: propType === "string" ? "=" : ":=",
          encoding: flatSafeEntry.encoding,
          assignmentTemplate: flatSafeEntry.assignmentTemplate,
          ...(flatSafeEntry.hint ? { hint: flatSafeEntry.hint } : {}),
          ...(desc ? { description: desc } : {}),
        });
      } else {
        fields.push({
          path: key,
          inputAllowed: true,
          flatSafe: false,
          required: isReq,
          type: propType,
          reason: "UNSAFE_FLAT_PROPERTY",
          fallback: "stdin-json",
          ...(desc ? { description: desc } : {}),
        });
      }
    } else {
      // 无显式单一类型（如 union type 或无 type 的 enum/const）
      fields.push({
        path: key,
        inputAllowed: true,
        flatSafe: false,
        required: isReq,
        type: Array.isArray(propType) ? propType.join(" | ") : "any",
        reason: "UNSAFE_FLAT_PROPERTY",
        fallback: "stdin-json",
        ...(desc ? { description: desc } : {}),
      });
    }
  }

  // 5. requiredSatisfiable 计算（Section 48）
  let requiredSatisfiable: boolean | null = null;
  if (schemaState === "json-only") {
    requiredSatisfiable = false;
  } else if (schemaState === "complex") {
    requiredSatisfiable = null;
  } else if (schemaState === "object") {
    if (requiredList.length === 0) {
      requiredSatisfiable = true;
    } else {
      let hasNull = false;
      let allSafe = true;
      for (const reqKey of requiredList) {
        if (isForbiddenActionInputPropertyName(reqKey)) {
          requiredSatisfiable = false;
          allSafe = false;
          break;
        }
        const field = fields.find((f) => f.path === reqKey);
        if (!field) {
          if (s.additionalProperties === false) {
            requiredSatisfiable = false;
            allSafe = false;
            break;
          } else {
            hasNull = true;
            continue;
          }
        }
        if (
          !field.inputAllowed ||
          field.flatSafe === false ||
          !field.operator ||
          !field.encoding
        ) {
          requiredSatisfiable = false;
          allSafe = false;
          break;
        }
      }
      if (allSafe) {
        requiredSatisfiable = hasNull ? null : true;
      }
    }
  }

  // 6. flatAvailable, flatCandidate, schemaRecommendedMode（Section 49）
  const flatAvailable = fields.some((f) => f.flatSafe && f.operator !== undefined);
  const flatCandidate =
    schemaState === "object" && requiredSatisfiable === true && flatAvailable;

  let schemaRecommendedMode: CliInputAdviceV1["schemaRecommendedMode"];
  if (inputFeasibility === "known-impossible") {
    schemaRecommendedMode = "none";
  } else if (schemaState === "json-only" || schemaState === "complex") {
    schemaRecommendedMode = "full-json";
  } else if (schemaState === "object" && flatCandidate) {
    schemaRecommendedMode = "flat";
  } else {
    schemaRecommendedMode = "full-json";
  }

  return {
    version: 1,
    analysisMode: "declared-properties-only",
    analysisStatus,
    ...(analysisCode ? { analysisCode } : {}),
    ...(analysisMessage ? { analysisMessage } : {}),
    schemaState,
    inputFeasibility,
    flatAvailable,
    requiredSatisfiable,
    flatCandidate,
    schemaRecommendedMode,
    ...(feasibilityCode ? { feasibilityCode } : {}),
    fields,
  };
}

/**
 * 扁平编码通用指引文案。
 * 属性名安全判定统一引用 flat-predicates 的单一事实源（含禁止属性排除），
 * 禁止在本文件另建独立正则分叉。
 */
export const FLAT_ENCODING_GUIDELINES: readonly string[] = [
  "字符串: path=TEXT",
  "JSON 标量与结构: path:=JSON (例如 count:=1, enabled:=true)",
  "数组元素: path.INDEX=... (例如 items.0=first)",
  "提示: 复杂嵌套或大段文本建议使用 --input 或 --input-file",
];

/**
 * 单个字段的输入建议明细。
 */
export interface ActionInputFieldAdvice {
  /** 字段路径（属性名） */
  path: string;
  /** 字段类型字符串 */
  type: string;
  /** 是否为必填字段 */
  required: boolean;
  /** 字段名是否满足扁平编码安全规范 */
  flatSafe: boolean;
  /** 编码模板（如 "name=TEXT"、"age:=NUMBER"、"meta:=JSON"），非直接可执行 token */
  assignmentTemplate?: string;
  /** 人类说明文字，如 "大型结构建议使用 --input-file" */
  hint?: string;
  /** 字段描述信息 */
  description?: string;
}

/**
 * Action 输入模式整体编码顾问分析报告。
 */
export interface ActionInputAdvice {
  /** 根模式是否支持扁平入参赋值（仅当根模式为对象且所有 required 字段均具备 flatSafe 赋值方案时为 true） */
  flatSupported: boolean;
  /** 是否存在至少一个可扁平化的字段 */
  hasFlatFields: boolean;
  /** 字段明细清单 */
  fields: ActionInputFieldAdvice[];
  /** 所有必填字段的编码模板数组 */
  requiredTemplates: string[];
  /** 可选字段的编码模板数组 */
  optionalTemplates: string[];
  /** 结构化提示与降级说明清单 */
  notes: string[];
}

/**
 * 构造无扁平能力、无字段明细的空结果建议报告（各降级早退分支共用单一事实源）。
 * 键序与既有契约保持一致，禁止调整。
 */
function createEmptyFlatAdvice(notes: string[]): ActionInputAdvice {
  return {
    flatSupported: false,
    hasFlatFields: false,
    fields: [],
    requiredTemplates: [],
    optionalTemplates: [],
    notes,
  };
}

/**
 * 依据 inputSchema 构造统一的 Action 输入编码建议。
 *
 * @param schema Action 的 inputSchema 定义
 * @returns 结构化编码建议报告
 */
export function buildActionInputAdvice(schema: unknown): ActionInputAdvice {
  if (typeof schema === "boolean") {
    if (schema === false) {
      return createEmptyFlatAdvice(["布尔模式 false：拒绝所有输入，任何调用参数均判定为非法"]);
    }
    return createEmptyFlatAdvice([
      "布尔模式 true：接受任意合法 JSON 输入；调用时无需指定必填参数，非对象根输入请使用 --input-file 或 --input",
    ]);
  }

  if (!schema || typeof schema !== "object") {
    return createEmptyFlatAdvice(["根模式未声明输入字段，直接调用或使用 --input-file / --input '{}'"]);
  }

  const s = schema as Record<string, any>;

  // 校验根模式是否为 object 类型
  if (s.type !== undefined && s.type !== "object") {
    return createEmptyFlatAdvice([
      `根模式类型为 '${s.type}'，不支持扁平赋值，建议使用 --input-file 或 --input`,
    ]);
  }

  const properties = (s.properties || {}) as Record<string, any>;
  const required = Array.isArray(s.required) ? (s.required as string[]) : [];
  const propKeys = Object.keys(properties);

  if (propKeys.length === 0) {
    return createEmptyFlatAdvice(["根模式无声明属性，不支持扁平赋值，建议使用 --input-file 或 --input '{}'"]);
  }

  const fields: ActionInputFieldAdvice[] = [];
  const requiredTemplates: string[] = [];
  const optionalTemplates: string[] = [];
  const notes: string[] = [];

  for (const key of propKeys) {
    const prop = properties[key] || {};
    const typeStr = prop.type ? String(prop.type) : "any";
    const isReq = required.includes(key);
    const isFlatSafe = isFlatSafePropertyName(key);

    let assignmentTemplate: string | undefined;
    let hint: string | undefined;

    if (isFlatSafe) {
      // 数组元素标量类型到扁平元素赋值模板的参数表（共用同一守卫与拼接规则）。
      // 命中时模板形态为 `${key}.0<operator><占位符>`，未命中回退数组整体 JSON 模板。
      const itemsTypeTemplates: Record<string, string> = {
        string: `${key}.0=TEXT`,
        number: `${key}.0:=NUMBER`,
        integer: `${key}.0:=NUMBER`,
        boolean: `${key}.0:=BOOLEAN`,
      };
      const itemsTemplate =
        prop.type === "array" && prop.items && typeof prop.items === "object"
          ? itemsTypeTemplates[prop.items.type]
          : undefined;

      if (prop.type === "string") {
        assignmentTemplate = `${key}=TEXT`;
      } else if (prop.type === "number" || prop.type === "integer") {
        assignmentTemplate = `${key}:=NUMBER`;
      } else if (prop.type === "boolean") {
        assignmentTemplate = `${key}:=BOOLEAN`;
      } else if (itemsTemplate) {
        assignmentTemplate = itemsTemplate;
      } else if (prop.type === "array") {
        assignmentTemplate = `${key}:=JSON`;
        hint = "数组结构建议使用 --input-file";
      } else if (prop.type === "object") {
        assignmentTemplate = `${key}:=JSON`;
        hint = "大型结构建议使用 --input-file";
      } else {
        assignmentTemplate = `${key}:=JSON`;
        hint = "复杂或未知类型建议使用 --input-file";
      }

      if (isReq) {
        if (assignmentTemplate) {
          requiredTemplates.push(assignmentTemplate);
        }
      } else {
        if (assignmentTemplate) {
          optionalTemplates.push(assignmentTemplate);
        }
      }
    } else {
      hint = "包含非安全字符，建议使用 --input-file";
      notes.push(`属性 '${key}' 包含非安全字符，不支持扁平赋值，建议使用 --input-file`);
    }

    fields.push({
      path: key,
      type: typeStr,
      required: isReq,
      flatSafe: isFlatSafe,
      assignmentTemplate,
      hint,
      description: prop.description,
    });
  }

  const hasFlatFields = fields.some((f) => f.flatSafe && f.assignmentTemplate !== undefined);

  // 仅当根模式为对象且所有 required 字段均具备 flatSafe 赋值方案时为 true
  const allRequiredFlatSafe = required.every((reqKey) => {
    const f = fields.find((field) => field.path === reqKey);
    return f !== undefined && f.flatSafe && f.assignmentTemplate !== undefined;
  });

  const flatSupported = hasFlatFields && allRequiredFlatSafe;

  return {
    flatSupported,
    hasFlatFields,
    fields,
    requiredTemplates,
    optionalTemplates,
    notes,
  };
}
export { formatActionDetail } from "./describe";
