import { ActionDockCliError, isRecord } from "./error.js";
import { parseInputObject, parseJsonValueInput } from "./input.js";
import type {
  EventSourceDefinition,
  EventTrigger,
  IncomingEventPayload,
  NormalizedEvent,
  ProcessorContext,
  ProcessorDefinition
} from "./types.js";

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

export function parseProcessorDefinition(
  processorJson: string | undefined,
  processorFile: string | undefined
): ProcessorDefinition {
  return parseDefinitionInput<ProcessorDefinition>(processorJson, processorFile, {
    jsonFlag: "`--processor-json`",
    fileFlag: "`--processor-file`"
  });
}

export function parseProcessorContext(
  contextJson: string | undefined,
  contextFile: string | undefined
): ProcessorContext {
  return parseInputObject(contextJson, contextFile, {
    jsonFlag: "`--context-json`",
    fileFlag: "`--context-file`"
  }) as ProcessorContext;
}

export function parseExpectedOutputSchema(
  schemaJson: string | undefined,
  schemaFile: string | undefined
): Record<string, unknown> | undefined {
  return parseOptionalObject<Record<string, unknown>>(schemaJson, schemaFile, {
    jsonFlag: "`--expected-output-schema-json`",
    fileFlag: "`--expected-output-schema-file`"
  });
}

export function parseIncomingEventPayload(
  payloadJson: string | undefined,
  payloadFile: string | undefined
): IncomingEventPayload {
  const payload = parseInputObject(payloadJson, payloadFile, {
    jsonFlag: "`--payload-json`",
    fileFlag: "`--payload-file`"
  });
  const result: IncomingEventPayload = {};
  if ("headers" in payload) {
    result.headers = coerceRecord(payload.headers, "headers");
  }
  if ("query" in payload) {
    result.query = coerceRecord(payload.query, "query");
  }
  if ("body" in payload) {
    result.body = coerceRecord(payload.body, "body");
  }
  if (typeof payload.rawBody === "string") {
    result.rawBody = payload.rawBody;
  }
  if (typeof payload.contentType === "string") {
    result.contentType = payload.contentType;
  }
  return result;
}

export function parseNormalizedEvent(
  eventJson: string | undefined,
  eventFile: string | undefined
): NormalizedEvent {
  return parseDefinitionInput<NormalizedEvent>(eventJson, eventFile, {
    jsonFlag: "`--event-json`",
    fileFlag: "`--event-file`"
  });
}

export function mergeEventSourceDefinition(
  base: EventSourceDefinition,
  overrides: {
    id?: string;
    name?: string;
    key?: string;
    description?: string;
    enabled?: boolean;
    transportType?: string;
  }
): EventSourceDefinition {
  const next = deepMerge({}, base) as EventSourceDefinition;
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

export function mergeEventTriggerDefinition(
  base: EventTrigger,
  overrides: {
    id?: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    sourceId?: string;
    targetScriptId?: string;
    submitMode?: string;
    responseView?: string;
  }
): EventTrigger {
  const next = deepMerge({}, base) as EventTrigger;
  if (overrides.id !== undefined) next.id = overrides.id;
  if (overrides.name !== undefined) next.name = overrides.name;
  if (overrides.description !== undefined) next.description = overrides.description;
  if (overrides.enabled !== undefined) next.enabled = overrides.enabled;
  if (overrides.sourceId !== undefined) next.sourceId = overrides.sourceId;
  if (overrides.targetScriptId !== undefined) next.targetScriptId = overrides.targetScriptId;
  if (overrides.submitMode !== undefined) next.submitMode = overrides.submitMode;
  if (overrides.responseView !== undefined) next.responseView = overrides.responseView;
  return next;
}

export function mergeDefinitionPatch<T extends object>(base: T, patch: Partial<T>): T {
  return deepMerge(base, patch) as T;
}

export function applyProcessorFieldOverrides<T extends object>(
  merged: T,
  patch: Partial<T>,
  processorFields: Array<keyof T>
): T {
  const next = cloneValue(merged) as Record<string, unknown>;
  for (const field of processorFields) {
    const key = String(field);
    if (!(key in (patch as Record<string, unknown>))) {
      continue;
    }
    const value = (patch as Record<string, unknown>)[key];
    if (isProcessorLikeEmptyObject(value)) {
      next[key] = {};
      continue;
    }
    next[key] = cloneValue(value);
  }
  return next as T;
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

function coerceRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new ActionDockCliError(`payload.${label} 必须是 JSON 对象。`, 2);
  }
  return value;
}

function isProcessorLikeEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
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
