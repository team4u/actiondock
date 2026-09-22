import type { ActionSpec } from "../app/types";
import { buildCliInputAdviceV1 } from "./advice";
import { isForbiddenActionInputPropertyName } from "./flat-predicates";

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

  if (v1Advice.schemaRecommendedMode === "flat") {
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
    ...(spec.tags !== undefined ? { tags: spec.tags } : {}),
    ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
    ...(spec.uses !== undefined ? { uses: spec.uses } : {}),
    ...(spec.entry !== undefined ? { entry: spec.entry } : {}),
    inputAdvice: computeActionDescribeAdvice(spec.inputSchema),
  };

  return payload;
}

/**
 * 格式化渲染 Action 详情人类可读文本。
 * 普通 CLI 与 Standalone 统一复用该函数，避免长期排版漂移。
 *
 * @param input Action 描述载荷或 Action 规范
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
      }
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

  if (payload.inputAdvice.assignments && Object.keys(payload.inputAdvice.assignments).length > 0) {
    lines.push("");
    lines.push("Assignments:");
    for (const [key, op] of Object.entries(payload.inputAdvice.assignments)) {
      lines.push(`  ${key}${op}`);
    }
  }

  if (payload.inputAdvice.issues && payload.inputAdvice.issues.length > 0) {
    lines.push("");
    lines.push("Issues:");
    for (const issue of payload.inputAdvice.issues) {
      lines.push(`  - ${issue.path}: ${issue.code}`);
    }
  }

  return lines.join("\n");
}
