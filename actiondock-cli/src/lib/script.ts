import fs from "node:fs";

import { ActionDockCliError, isRecord } from "./error.js";
import { parseJsonValueInput } from "./input.js";

export function resolveScriptSource(source: string | undefined, sourceFile: string | undefined, required: boolean): string | undefined {
  if (source && sourceFile) {
    throw new ActionDockCliError("`--source` 和 `--source-file` 不能同时使用。", 2);
  }
  if (source !== undefined) {
    return source;
  }
  if (sourceFile) {
    return fs.readFileSync(sourceFile, "utf8");
  }
  if (required) {
    throw new ActionDockCliError("必须提供 `--source` 或 `--source-file`。", 2);
  }
  return undefined;
}

export function resolveOptionalTextInput(
  value: string | undefined,
  valueFile: string | undefined,
  labels: { valueFlag: string; fileFlag: string }
): string | undefined {
  if (value !== undefined && valueFile) {
    throw new ActionDockCliError(`${labels.valueFlag} 和 ${labels.fileFlag} 不能同时使用。`, 2);
  }
  if (value !== undefined) {
    return value;
  }
  if (valueFile) {
    return fs.readFileSync(valueFile, "utf8");
  }
  return undefined;
}

export function parseSchemaInput(
  inputJson: string | undefined,
  inputFile: string | undefined,
  labels: { jsonFlag: string; fileFlag: string }
): Record<string, unknown> | undefined {
  const parsed = parseJsonValueInput(inputJson, inputFile, labels);
  if (parsed === undefined) {
    return undefined;
  }
  if (!isRecord(parsed)) {
    throw new ActionDockCliError(`${labels.jsonFlag} / ${labels.fileFlag} 顶层必须是 JSON 对象。`, 2);
  }
  return parsed;
}

export function parsePatchObject(
  patchJson: string | undefined,
  patchFile: string | undefined
): Record<string, unknown> {
  const parsed = parseJsonValueInput(patchJson, patchFile, {
    jsonFlag: "`--patch-json`",
    fileFlag: "`--patch-file`"
  });
  if (parsed === undefined) {
    return {};
  }
  if (!isRecord(parsed)) {
    throw new ActionDockCliError("`--patch-json` / `--patch-file` 顶层必须是 JSON 对象。", 2);
  }
  return normalizeScriptPatchAliases({ ...parsed });
}

export function setPatchField(
  patch: Record<string, unknown>,
  field: "name" | "description" | "source" | "pythonRequirements" | "inputSchema" | "outputSchema",
  value: unknown
): void {
  if (Object.hasOwn(patch, field)) {
    throw new ActionDockCliError(`Patch 字段重复定义: ${field}`, 2);
  }
  patch[field] = value;
}

function normalizeScriptPatchAliases(patch: Record<string, unknown>): Record<string, unknown> {
  movePatchAlias(patch, "desc", "description");
  movePatchAlias(patch, "inputSchemaPatch", "inputSchema");
  movePatchAlias(patch, "outputSchemaPatch", "outputSchema");
  return patch;
}

function movePatchAlias(patch: Record<string, unknown>, alias: string, field: string): void {
  if (!Object.hasOwn(patch, alias)) {
    return;
  }
  if (Object.hasOwn(patch, field)) {
    throw new ActionDockCliError(`Patch 字段重复定义: ${field}`, 2);
  }
  patch[field] = patch[alias];
  delete patch[alias];
}
