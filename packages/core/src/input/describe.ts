import type { ActionSpec } from "../package/types";
import { buildCliInputAdviceV1 } from "./advice";
import { isForbiddenActionInputPropertyName } from "./flat-predicates";
import { analyzeActionOutputContract } from "./output-contract";

/**
 * 字段级异常明细。
 */
export interface ActionDescribeIssue {
  /** 字段路径 */
  path: string;
  /** 异常代码 */
  code: string;
}

/**
 * Action 输入模式建议契约。
 */
export interface ActionDescribeAdvice {
  /** 建议契约版本号 */
  version: 1;
  /** 推荐的输入模式 */
  recommendedMode: "flat" | "full-json" | "none";
  /** 扁平入参赋值操作符字典（属性名 -> "=" 或 ":="） */
  assignments?: Record<string, "=" | ":=">;
  /** 推荐原因代码 */
  reason?: string;
  /** 字段级异常与警告清单 */
  issues?: ActionDescribeIssue[];
}

/**
 * 统一 Action 描述载荷契约。
 */
export interface ActionDescribePayload {
  /** Action 唯一标识 */
  id: string;
  /** 所属包唯一标识 */
  packageId?: string;
  /** Action 描述信息 */
  description?: string;

  /** 输入模式规范 */
  inputSchema?: unknown;
  /** 输出模式规范 */
  outputSchema?: unknown;

  /** 标签列表 */
  tags?: string[];
  /** 协议注解元数据 */
  annotations?: Record<string, unknown>;
  /** 依赖的 Action 列表 */
  uses?: string[];
  /** 入口相对路径 */
  entry?: string;

  /** 统一输入模式建议 */
  inputAdvice: ActionDescribeAdvice;
  /** 扁平输入通用语法速查行列表 */
  syntaxReference?: string[];
}

/**
 * 构造 Action 描述载荷的可选选项。
 */
export interface BuildActionDescribePayloadOptions {
  /** 所属包唯一标识（当 spec 中未携带时作为回退） */
  packageId?: string;
}

/**
 * 计算 Action 输入建议。
 *
 * @param schema Action 的 inputSchema 定义
 * @returns 统一输入建议结构
 */
export function computeActionDescribeAdvice(schema: unknown): ActionDescribeAdvice {
  const v1Advice = buildCliInputAdviceV1(schema);

  const issues: ActionDescribeIssue[] = [];
  for (const field of v1Advice.fields) {
    if (field.reason) {
      issues.push({ path: field.path, code: field.reason });
    }
  }

  // 检查 required 列表中未被 fields 覆盖的禁止属性
  if (typeof schema === "object" && schema !== null) {
    const s = schema as Record<string, any>;
    if (Array.isArray(s.required)) {
      for (const reqKey of s.required) {
        if (typeof reqKey === "string" && isForbiddenActionInputPropertyName(reqKey)) {
          if (!issues.some((i) => i.path === reqKey)) {
            issues.push({ path: reqKey, code: "FORBIDDEN_PROPERTY" });
          }
        }
      }
    }
  }

  if (v1Advice.schemaRecommendedMode === "none") {
    return {
      version: 1,
      recommendedMode: "none",
      reason: v1Advice.feasibilityCode || "SCHEMA_REJECTS_ALL",
      ...(issues.length > 0 ? { issues } : {}),
    };
  }

  // 空对象模式判定：根模式为 object，无声明属性，且必填已满足（即无必填字段）
  const isEmptyObjectSchema =
    v1Advice.schemaState === "object" &&
    v1Advice.requiredSatisfiable === true &&
    v1Advice.fields.length === 0;

  if (v1Advice.schemaRecommendedMode === "flat" || isEmptyObjectSchema) {
    const assignments: Record<string, "=" | ":="> = {};
    for (const field of v1Advice.fields) {
      if (field.flatSafe && field.operator) {
        assignments[field.path] = field.operator;
      }
    }
    return {
      version: 1,
      recommendedMode: "flat",
      assignments,
      ...(issues.length > 0 ? { issues } : {}),
    };
  }

  // full-json 模式原因推导
  let reason: string = "COMPLEX_SCHEMA";
  if (v1Advice.analysisCode) {
    reason = v1Advice.analysisCode;
  } else if (v1Advice.schemaState === "json-only") {
    reason = "NON_OBJECT_SCHEMA";
  } else if (v1Advice.schemaState === "object") {
    if (v1Advice.requiredSatisfiable === false) {
      reason = "REQUIRED_FIELD_NOT_FLAT_SAFE";
    } else if (!v1Advice.flatAvailable) {
      reason = "NO_FLAT_FIELDS";
    } else if (v1Advice.requiredSatisfiable === null) {
      reason = "UNDECLARED_REQUIRED_FIELDS";
    }
  } else if (v1Advice.schemaState === "absent") {
    reason = "NO_SCHEMA";
  } else if (v1Advice.schemaState === "any") {
    reason = "ARBITRARY_SCHEMA";
  }

  return {
    version: 1,
    recommendedMode: "full-json",
    reason,
    ...(issues.length > 0 ? { issues } : {}),
  };
}

/**
 * 构造统一 Action 描述载荷数据。
 * 普通 CLI 与 Standalone 必须通过该函数生成统一数据。
 *
 * @param spec Action 规范信息
 * @param options 可选配置选项
 * @returns 统一 Action 描述载荷
 */
export function buildActionDescribePayload(
  spec: {
    id: string;
    packageId?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    tags?: string[];
    annotations?: Record<string, unknown>;
    uses?: string[];
    entry?: string;
    [key: string]: any;
  },
  options?: BuildActionDescribePayloadOptions
): ActionDescribePayload {
  const packageId = spec.packageId ?? options?.packageId;

  const payload: ActionDescribePayload = {
    id: spec.id,
    ...(packageId !== undefined ? { packageId } : {}),
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.inputSchema !== undefined ? { inputSchema: spec.inputSchema } : {}),
    ...(spec.outputSchema !== undefined ? { outputSchema: spec.outputSchema } : {}),
    ...(spec.tags && spec.tags.length > 0 ? { tags: spec.tags } : {}),
    ...(spec.annotations && Object.keys(spec.annotations).length > 0
      ? { annotations: spec.annotations }
      : {}),
    ...(spec.uses && spec.uses.length > 0 ? { uses: spec.uses } : {}),
    ...(spec.entry !== undefined ? { entry: spec.entry } : {}),
    inputAdvice: computeActionDescribeAdvice(spec.inputSchema),
  };

  const hasAssignments = Boolean(
    payload.inputAdvice.assignments &&
      Object.keys(payload.inputAdvice.assignments).length > 0
  );
  if (payload.inputAdvice.recommendedMode === "flat" || hasAssignments) {
    payload.syntaxReference = [...ACTION_DESCRIBE_SYNTAX_REFERENCE];
  }

  return payload;
}

/**
 * 扁平输入通用语法速查行列表。
 */
export const ACTION_DESCRIBE_SYNTAX_REFERENCE: readonly string[] = [
  "  # String assignment (= keeps raw string, no type coercion)",
  '  key="value"',
  "  # Typed / JSON assignment (:= parses numbers, booleans, arrays, objects)",
  "  count:=10  enabled:=true",
  "  # Array structure (direct JSON array or sequential index)",
  '  tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")',
  "  # Complex or multiline inputs (pass via JSON file)",
  "  --input-file input.json",
];

/**
 * 格式化 Action 详情的可选配置项。
 */
export interface FormatActionDetailOptions {
  /**
   * 是否支持显式与声明式正文选择运行选项（普通 CLI 为 true，目录型 Standalone 默认为 false）。
   * @default true
   */
  supportsTextField?: boolean;
}

/**
 * 格式化渲染 Action 详情人类可读文本。
 * 普通 CLI 与 Standalone 统一复用该函数，避免长期排版漂移。
 *
 * @param input Action 描述载荷或 Action 规范
 * @param options 可选格式化配置项
 * @returns 格式化后的说明文本
 */
export function formatActionDetail(
  input:
    | ActionDescribePayload
    | (Partial<ActionSpec> & { id: string })
    | {
        id: string;
        packageId?: string;
        projectRoot?: string;
        description?: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
        tags?: string[];
        annotations?: Record<string, unknown>;
        uses?: string[];
        entry?: string;
        [key: string]: any;
      },
  options?: FormatActionDetailOptions
): string {
  const payload: ActionDescribePayload =
    "inputAdvice" in input && input.inputAdvice
      ? (input as ActionDescribePayload)
      : buildActionDescribePayload(input as any);

  const lines: string[] = [];
  lines.push(`Action: ${payload.id}`);
  if (payload.packageId) {
    lines.push(`Package: ${payload.packageId}`);
  }
  if (payload.description) {
    lines.push(`Description: ${payload.description}`);
  }
  if (payload.tags && payload.tags.length > 0) {
    lines.push(`Tags: ${payload.tags.join(", ")}`);
  }
  if (payload.uses && payload.uses.length > 0) {
    lines.push(`Uses: ${payload.uses.join(", ")}`);
  }
  if (payload.entry) {
    lines.push(`Entry: ${payload.entry}`);
  }

  if (payload.inputSchema !== undefined) {
    lines.push("");
    lines.push("Input Schema:");
    lines.push(
      typeof payload.inputSchema === "string"
        ? payload.inputSchema
        : JSON.stringify(payload.inputSchema, null, 2)
    );
  }

  if (payload.outputSchema !== undefined) {
    lines.push("");
    lines.push("Output Schema:");
    lines.push(
      typeof payload.outputSchema === "string"
        ? payload.outputSchema
        : JSON.stringify(payload.outputSchema, null, 2)
    );
  }

  lines.push("");
  lines.push(`Recommended Input: ${payload.inputAdvice.recommendedMode}`);

  if (payload.inputAdvice.reason) {
    lines.push(`Reason: ${payload.inputAdvice.reason}`);
  }

  const hasAssignments = Boolean(
    payload.inputAdvice.assignments &&
      Object.keys(payload.inputAdvice.assignments).length > 0
  );

  if (hasAssignments) {
    lines.push("");
    lines.push("Assignments:");
    for (const [key, op] of Object.entries(payload.inputAdvice.assignments!)) {
      lines.push(`  ${key}${op}`);
    }
  }

  if (payload.inputAdvice.recommendedMode === "flat" || hasAssignments) {
    lines.push("");
    lines.push("Syntax Reference:");
    lines.push(...(payload.syntaxReference || ACTION_DESCRIBE_SYNTAX_REFERENCE));
  }

  if (payload.inputAdvice.issues && payload.inputAdvice.issues.length > 0) {
    lines.push("");
    lines.push("Issues:");
    for (const issue of payload.inputAdvice.issues) {
      lines.push(`  - ${issue.path}: ${issue.code}`);
    }
  }

  const supportsTextField = options?.supportsTextField ?? true;
  const outputContract = analyzeActionOutputContract({
    annotations: payload.annotations,
    outputSchema: payload.outputSchema,
  });

  const isAnnotationInvalid = outputContract.diagnostics.some(
    (d) => d.code === "INVALID_ANNOTATION"
  );

  lines.push("");
  lines.push("Output Selection:");
  if (supportsTextField) {
    if (isAnnotationInvalid) {
      lines.push(`  Invalid annotation: ${outputContract.errors.join("; ")}`);
      lines.push("  Default run: Synchronous execution will be rejected before invocation due to invalid annotation");
      lines.push("  Full result: Pass '--json' to bypass default annotation and receive the complete structured envelope");
      lines.push("  Explicit text field: Pass '--text-field <field>' to bypass default annotation and select a specific field");
    } else if (outputContract.declared && outputContract.textField) {
      lines.push(`  Default text field: ${outputContract.textField}`);
      if (outputContract.errors.length > 0) {
        lines.push(`  Contract conflict: ${outputContract.errors.join("; ")}`);
      }
      lines.push(`  stdout: Raw text content of '${outputContract.textField}' (synchronous execution only)`);
      lines.push("  stderr: Remaining fields as JSON metadata, diagnostics, and logs");
      lines.push("  Full result: Pass '--json' to receive the complete structured envelope");
      lines.push("  Override: Pass '--text-field <field>' to select another top-level string field");
    } else {
      lines.push("  Default: Raw string for string results; formatted JSON for objects and arrays");
      lines.push("  Full result: Pass '--json' to receive the complete structured envelope");
      lines.push("  Custom field: Pass '--text-field <field>' to extract a specific top-level string field");
    }
  } else {
    if (isAnnotationInvalid) {
      lines.push(`  Invalid annotation: ${outputContract.errors.join("; ")} (note: ignored in standalone runtime; standalone extracts 'content', 'text', or 'message', falling back to formatted JSON)`);
      lines.push("  stdout: Raw string for scalars; extracts 'content', 'text', or 'message' from objects");
      lines.push("  stderr: Remaining fields as metadata (for extracted fields), diagnostics, and logs");
      lines.push("  Full result: Pass '--json' to receive the complete structured envelope");
    } else if (outputContract.declared && outputContract.textField) {
      lines.push(`  Default text field: ${outputContract.textField} (note: ignored in standalone runtime; standalone extracts 'content', 'text', or 'message', falling back to formatted JSON)`);
      if (outputContract.errors.length > 0) {
        lines.push(`  Contract conflict: ${outputContract.errors.join("; ")}`);
      }
      lines.push("  stdout: Raw string for scalars; extracts 'content', 'text', or 'message' from objects");
      lines.push("  stderr: Remaining fields as metadata (for extracted fields), diagnostics, and logs");
      lines.push("  Full result: Pass '--json' to receive the complete structured envelope");
    } else {
      lines.push("  Default: Raw string for scalars; extracts 'content', 'text', or 'message' from objects (with metadata on stderr), falling back to formatted JSON");
      lines.push("  Full result: Pass '--json' to receive the complete structured envelope");
    }
  }

  return lines.join("\n");
}

