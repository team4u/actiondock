import type { ActionSpec } from "@actiondock/core";
import {
  buildActionDescribePayload,
  ACTION_DESCRIBE_SYNTAX_REFERENCE,
} from "@actiondock/core/project";
import { ExecutionError } from "../errors";

/**
 * 解析 Action 注解中的默认正文输出字段声明。
 *
 * 契约规范：
 * - 注解键名固定为 actiondock.cli，值必须为非空非数组对象。
 * - 正文字段键名为 textField，值必须为非空字符串。
 * - 无相关注解或未声明 textField 时返回 undefined。
 * - 注解存在但类型非法时抛出 ExecutionError。
 */
export function resolveActionDefaultTextField(
  annotations?: Record<string, unknown>
): string | undefined {
  if (!annotations || typeof annotations !== "object") {
    return undefined;
  }

  if (!Object.hasOwn(annotations, "actiondock.cli")) {
    return undefined;
  }

  const cli = annotations["actiondock.cli"];
  if (cli === undefined) {
    return undefined;
  }

  if (typeof cli !== "object" || cli === null || Array.isArray(cli)) {
    throw new ExecutionError(
      `Invalid 'actiondock.cli' annotation: expected an object, but received ${
        cli === null ? "null" : Array.isArray(cli) ? "an array" : typeof cli
      }.`,
      undefined,
      "INVALID_ANNOTATION"
    );
  }

  if (!Object.hasOwn(cli, "textField") || (cli as Record<string, unknown>).textField === undefined) {
    return undefined;
  }

  const textField = (cli as Record<string, unknown>).textField;
  if (typeof textField !== "string") {
    throw new ExecutionError(
      `Invalid 'actiondock.cli.textField' annotation: expected a string, but received ${
        textField === null ? "null" : Array.isArray(textField) ? "an array" : typeof textField
      }.`,
      undefined,
      "INVALID_ANNOTATION"
    );
  }

  if (textField.trim() === "") {
    throw new ExecutionError(
      "Invalid 'actiondock.cli.textField' annotation: cannot be an empty string.",
      undefined,
      "INVALID_ANNOTATION"
    );
  }

  return textField;
}

/**
 * 结构化正文与元数据抽取结果。
 */
export interface TextFieldExtractionResult {
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * 从 Action 执行数据中抽取指定自有顶层正文字段及剩余元数据。
 *
 * 契约规范：
 * - 仅支持结果数据的顶层自有字符串字段，拒绝通过原型链提取。
 * - 结果数据本身必须为对象且不能为数组。
 * - 目标字段必须存在且值为字符串（空字符串为合法有效正文）。
 * - 剩余元数据安全构造，杜绝原型污染；元数据为空时返回 undefined。
 */
export function extractTextFieldPayload(
  data: unknown,
  textField: string
): TextFieldExtractionResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ExecutionError(
      `CLI output format error: expected result data to be an object, but received ${
        data === null ? "null" : Array.isArray(data) ? "an array" : typeof data
      }.`,
      undefined,
      "OUTPUT_FORMAT_ERROR"
    );
  }

  if (!Object.hasOwn(data, textField)) {
    throw new ExecutionError(
      `CLI output format error: text field '${textField}' was not found in result data.`,
      undefined,
      "OUTPUT_FORMAT_ERROR"
    );
  }

  const textValue = (data as Record<string, unknown>)[textField];
  if (typeof textValue !== "string") {
    throw new ExecutionError(
      `CLI output format error: text field '${textField}' must be a string, but received ${
        textValue === null ? "null" : Array.isArray(textValue) ? "an array" : typeof textValue
      }.`,
      undefined,
      "OUTPUT_FORMAT_ERROR"
    );
  }

  const metadata: Record<string, unknown> = {};
  let hasMetadata = false;

  for (const key of Object.keys(data)) {
    if (key === textField) {
      continue;
    }
    Object.defineProperty(metadata, key, {
      value: (data as Record<string, unknown>)[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    hasMetadata = true;
  }

  return {
    text: textValue,
    metadata: hasMetadata ? metadata : undefined,
  };
}

/**
 * 格式化渲染 Action 列表。
 */
export function renderActionList(
  items: Array<{ id: string; description: string; packageId?: string }>,
  title: string = "Actions",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`${title}:\n`);
  if (isFallback && intent) {
    lines.push(`(No actions matched intent '${intent}', showing all actions)\n`);
  }
  if (items.length === 0) {
    lines.push("  (no actions found)");
  } else {
    for (const a of items) {
      lines.push(`  - ${a.id.padEnd(28)} ${a.description}`);
    }
  }
  lines.push("\nTip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures.");
  return lines.join("\n");
}

/**
 * 格式化渲染 Action 详情人类可读文本。
 *
 * @param input Action 描述载荷或 Action 规范
 * @returns 格式化后的说明文本
 */
export function formatActionDetail(
  input:
    | ReturnType<typeof buildActionDescribePayload>
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
  const payload =
    "inputAdvice" in input && (input as any).inputAdvice
      ? (input as ReturnType<typeof buildActionDescribePayload>)
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

  return lines.join("\n");
}

/**
 * 格式化渲染 Action 详情（编码顾问 Encoding Advisor）。
 * 统一复用 formatActionDetail 实现。
 */
export function renderActionDetail(action: {
  id: string;
  packageId?: string;
  projectRoot?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}): string {
  return formatActionDetail(action);
}

/**
 * 格式化渲染 Action 校验结果。
 */
export function renderActionValidation(results: Array<{ id: string; valid: boolean; errors: string[] }>): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.valid) {
      lines.push(`[OK] ${r.id}: Valid`);
    } else {
      lines.push(`[FAIL] ${r.id}: ${r.errors.join(", ")}`);
    }
  }
  return lines.join("\n");
}
