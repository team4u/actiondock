import { ActionDockCliError, isRecord } from "./error.js";
import { parseInputObject, parseJsonValueInput } from "./input.js";
import type { WebhookDefinition, WebhookRequest } from "./types.js";

type JsonSourceFlags = {
  jsonFlag: string;
  fileFlag: string;
};

export function parseDefinitionInput<T extends object>(
  definitionJson: string | undefined,
  definitionFile: string | undefined,
  labels: JsonSourceFlags
): T {
  return parseRequiredObject<T>(parseInputObject(definitionJson, definitionFile, labels), labels.jsonFlag, labels.fileFlag);
}

export function parseOptionalObject<T extends object>(
  inputJson: string | undefined,
  inputFile: string | undefined,
  labels: JsonSourceFlags
): T | undefined {
  const value = parseJsonValueInput(inputJson, inputFile, labels);
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ActionDockCliError(`${labels.jsonFlag} / ${labels.fileFlag} 顶层必须是 JSON 对象。`, 2);
  }
  return value as T;
}

export function parseWebhookRequest(
  payloadJson: string | undefined,
  payloadFile: string | undefined
): WebhookRequest {
  const payload = parseInputObject(payloadJson, payloadFile, {
    jsonFlag: "`--payload-json`",
    fileFlag: "`--payload-file`"
  });
  const result: WebhookRequest = {};
  if (typeof payload.method === "string") {
    result.method = payload.method;
  }
  if (typeof payload.path === "string") {
    result.path = payload.path;
  }
  if ("headers" in payload) {
    result.headers = coerceStringListRecord(payload.headers, "headers");
  }
  if ("query" in payload) {
    result.query = coerceStringListRecord(payload.query, "query");
  }
  if (typeof payload.rawBody === "string") {
    result.rawBody = payload.rawBody;
  }
  if (typeof payload.contentType === "string") {
    result.contentType = payload.contentType;
  }
  return result;
}

export function mergeWebhookDefinition(
  base: WebhookDefinition,
  overrides: {
    id?: string;
    name?: string;
    key?: string;
    description?: string;
    enabled?: boolean;
    transportType?: string;
  }
): WebhookDefinition {
  const next = deepMerge({}, base) as WebhookDefinition;
  if (overrides.id !== undefined) next.id = overrides.id;
  if (overrides.name !== undefined) next.name = overrides.name;
  if (overrides.key !== undefined) next.key = overrides.key;
  if (overrides.description !== undefined) next.description = overrides.description;
  if (overrides.enabled !== undefined) next.enabled = overrides.enabled;
  if (overrides.transportType !== undefined) {
    next.transport = {
      ...(next.transport ?? {}),
      type: overrides.transportType
    };
  }
  return next;
}

export function mergeDefinitionPatch<T extends object>(base: T, patch: Partial<T>): T {
  return deepMerge(base, patch) as T;
}
export function resolveEnabledFlag(params: {
  enabledFlag?: boolean;
  disabledFlag?: boolean;
  fallback?: boolean;
}): boolean | undefined {
  const { enabledFlag, disabledFlag, fallback } = params;
  if (enabledFlag && disabledFlag) {
    throw new ActionDockCliError("不能同时指定启用和停用参数。", 2);
  }
  if (enabledFlag) {
    return true;
  }
  if (disabledFlag) {
    return false;
  }
  return fallback;
}

function parseRequiredObject<T extends object>(
  value: Record<string, unknown>,
  jsonFlag: string,
  fileFlag: string
): T {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new ActionDockCliError(`需要提供 ${jsonFlag} 或 ${fileFlag}，且顶层必须是 JSON 对象。`, 2);
  }
  return value as T;
}

function coerceStringListRecord(value: unknown, label: string): Record<string, string[]> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new ActionDockCliError(`payload.${label} 必须是 JSON 对象。`, 2);
  }
  const result: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      result[key] = item.map((entry) => String(entry));
      continue;
    }
    result[key] = [String(item)];
  }
  return result;
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!isRecord(target) || !isRecord(source)) {
    return cloneValue(source);
  }

  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = result[key];
    if (isRecord(existing) && isRecord(value)) {
      result[key] = deepMerge(existing, value);
      continue;
    }
    result[key] = cloneValue(value);
  }
  return result;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}
