export function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 19);
}

export function prettyJson(value: Record<string, unknown> | undefined): string {
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
