import { parseJsonText, prettyJson } from "./utils";

export function buildSchemaObjectEditorJsonText(
  jsonText: string,
  label: string,
  formValue: Record<string, unknown>
): string {
  const baseValue = parseJsonText(jsonText, label);
  return prettyJson({ ...baseValue, ...formValue });
}

export function parseSchemaObjectEditorJsonText(
  jsonText: string,
  label: string
): Record<string, unknown> {
  return parseJsonText(jsonText, label);
}
