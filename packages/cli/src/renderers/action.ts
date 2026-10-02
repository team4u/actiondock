import type { ActionSpec } from "@actiondock/core";
import {
  buildActionDescribePayload,
  ACTION_DESCRIBE_SYNTAX_REFERENCE,
} from "@actiondock/core/project";

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
