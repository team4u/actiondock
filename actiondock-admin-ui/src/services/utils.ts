import type { ExecutionStatus } from "../shared/types";

export function getExecutionStatusColor(status?: ExecutionStatus): string {
  switch (status) {
    case "SUCCESS":
      return "green";
    case "FAILED":
      return "red";
    case "CANCELED":
      return "default";
    case "RUNNING":
      return "processing";
    case "PENDING":
      return "gold";
    default:
      return "default";
  }
}

export function isExecutionActive(status: ExecutionStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}

export function getErrorMessage(error: unknown, fallback = "操作失败"): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 19);
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function parseJsonText(value: string, fieldName: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("JSON 顶层必须是对象");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "格式错误";
    throw new Error(`${fieldName} 不是合法 JSON: ${reason}`);
  }
}

export function parseJsonValueOrText(value: string): Record<string, unknown> | string {
  if (!value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return value;
  } catch {
    return value;
  }
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const success = document.execCommand("copy");
    if (!success) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export function toSingleLineCommand(value: string): string {
  return value.replace(/ \\\n\s*/g, " ").trim();
}
