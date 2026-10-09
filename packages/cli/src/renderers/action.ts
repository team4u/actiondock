import {
  inspectActionTextFieldAnnotation,
  formatActionDetail,
  type FormatActionDetailOptions,
} from "@actiondock/core/project";

export {
  formatActionDetail,
  type FormatActionDetailOptions,
};
import { ExecutionError } from "../errors";

/**
 * 解析 Action 注解中的默认正文输出字段声明。
 *
 * 契约规范：
 * - 注解键名固定为 actiondock.cli，值必须为非空非数组对象。
 * - 正文字段键名为 textField，值必须为非空字符串。
 * - 无相关注解或未声明 textField 时返回 undefined。
 * - 注解存在但类型非法时抛出 ExecutionError (INVALID_ANNOTATION)。
 */
export function resolveActionDefaultTextField(
  annotations?: Record<string, unknown>
): string | undefined {
  const inspection = inspectActionTextFieldAnnotation(annotations);
  if (!inspection.valid) {
    throw new ExecutionError(
      inspection.error!,
      undefined,
      "INVALID_ANNOTATION"
    );
  }
  return inspection.textField;
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
 * 格式化渲染 Action 详情（编码顾问 Encoding Advisor）。
 * 统一复用核心 formatActionDetail 实现。
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
export function renderActionValidation(
  results: Array<{ id: string; valid: boolean; errors: string[]; warnings?: string[] }>
): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.valid) {
      if (r.warnings && r.warnings.length > 0) {
        lines.push(`[OK] ${r.id}: Valid (warnings: ${r.warnings.join("; ")})`);
      } else {
        lines.push(`[OK] ${r.id}: Valid`);
      }
    } else {
      let msg = `[FAIL] ${r.id}: ${r.errors.join(", ")}`;
      if (r.warnings && r.warnings.length > 0) {
        msg += ` (warnings: ${r.warnings.join("; ")})`;
      }
      lines.push(msg);
    }
  }
  return lines.join("\n");
}
