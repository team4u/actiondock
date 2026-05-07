import type { ScriptType } from "../shared/types";

function indent(level: number): string {
  return "  ".repeat(level);
}

function formatScalar(value: unknown, language: ScriptType): string {
  if (value === null) {
    return language === "PYTHON" ? "None" : "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    if (language === "PYTHON") {
      return value ? "True" : "False";
    }
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

function formatValue(value: unknown, language: ScriptType, level = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const nextLevel = level + 1;
    return `[\n${value
      .map((item) => `${indent(nextLevel)}${formatValue(item, language, nextLevel)}`)
      .join(",\n")}\n${indent(level)}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return language === "PYTHON" ? "{}" : "[:]";
    }
    const nextLevel = level + 1;
    const opening = language === "PYTHON" ? "{" : "[";
    const closing = language === "PYTHON" ? "}" : "]";
    return `${opening}\n${entries
      .map(
        ([key, item]) =>
          `${indent(nextLevel)}${JSON.stringify(key)}: ${formatValue(item, language, nextLevel)}`
      )
      .join(",\n")}\n${indent(level)}${closing}`;
  }

  return formatScalar(value, language);
}

function isEmptyObject(args: Record<string, unknown>): boolean {
  return Object.keys(args).length === 0;
}

export function buildScriptInvokeSnippet(
  language: ScriptType,
  scriptId: string,
  args: Record<string, unknown>
): string {
  if (isEmptyObject(args)) {
    return `scripts.invoke(${JSON.stringify(scriptId)})`;
  }
  return `scripts.invoke(${JSON.stringify(scriptId)}, ${formatValue(args, language)})`;
}

export function buildPluginInvokeSnippet(
  language: ScriptType,
  pluginId: string,
  action: string,
  args: Record<string, unknown>
): string {
  if (isEmptyObject(args)) {
    return `plugins.invoke(${JSON.stringify(pluginId)}, ${JSON.stringify(action)})`;
  }
  return `plugins.invoke(${JSON.stringify(pluginId)}, ${JSON.stringify(action)}, ${formatValue(args, language)})`;
}
