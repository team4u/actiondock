import { ActionDockCliError, isRecord } from "./error.js";
import { parseInputObject, parseJsonValueInput } from "./input.js";
export function parseDefinitionInput(definitionJson, definitionFile, labels) {
    return parseRequiredObject(parseInputObject(definitionJson, definitionFile, labels), labels.jsonFlag, labels.fileFlag);
}
export function parseOptionalObject(inputJson, inputFile, labels) {
    const value = parseJsonValueInput(inputJson, inputFile, labels);
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new ActionDockCliError(`${labels.jsonFlag} / ${labels.fileFlag} 顶层必须是 JSON 对象。`, 2);
    }
    return value;
}
export function parseProcessorDefinition(processorJson, processorFile) {
    return parseDefinitionInput(processorJson, processorFile, {
        jsonFlag: "`--processor-json`",
        fileFlag: "`--processor-file`"
    });
}
export function parseProcessorContext(contextJson, contextFile) {
    return parseInputObject(contextJson, contextFile, {
        jsonFlag: "`--context-json`",
        fileFlag: "`--context-file`"
    });
}
export function parseExpectedOutputSchema(schemaJson, schemaFile) {
    return parseOptionalObject(schemaJson, schemaFile, {
        jsonFlag: "`--expected-output-schema-json`",
        fileFlag: "`--expected-output-schema-file`"
    });
}
export function parseIncomingEventPayload(payloadJson, payloadFile) {
    const payload = parseInputObject(payloadJson, payloadFile, {
        jsonFlag: "`--payload-json`",
        fileFlag: "`--payload-file`"
    });
    const result = {};
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
export function parseNormalizedEvent(eventJson, eventFile) {
    return parseDefinitionInput(eventJson, eventFile, {
        jsonFlag: "`--event-json`",
        fileFlag: "`--event-file`"
    });
}
export function mergeEventSourceDefinition(base, overrides) {
    const next = deepMerge({}, base);
    if (overrides.id !== undefined)
        next.id = overrides.id;
    if (overrides.name !== undefined)
        next.name = overrides.name;
    if (overrides.key !== undefined)
        next.key = overrides.key;
    if (overrides.description !== undefined)
        next.description = overrides.description;
    if (overrides.enabled !== undefined)
        next.enabled = overrides.enabled;
    if (overrides.transportType !== undefined) {
        next.transport = {
            ...(next.transport ?? {}),
            type: overrides.transportType
        };
    }
    return next;
}
export function mergeEventTriggerDefinition(base, overrides) {
    const next = deepMerge({}, base);
    if (overrides.id !== undefined)
        next.id = overrides.id;
    if (overrides.name !== undefined)
        next.name = overrides.name;
    if (overrides.description !== undefined)
        next.description = overrides.description;
    if (overrides.enabled !== undefined)
        next.enabled = overrides.enabled;
    if (overrides.sourceId !== undefined)
        next.sourceId = overrides.sourceId;
    if (overrides.targetScriptId !== undefined)
        next.targetScriptId = overrides.targetScriptId;
    if (overrides.submitMode !== undefined)
        next.submitMode = overrides.submitMode;
    if (overrides.responseView !== undefined)
        next.responseView = overrides.responseView;
    return next;
}
export function mergeDefinitionPatch(base, patch) {
    return deepMerge(base, patch);
}
export function applyProcessorFieldOverrides(merged, patch, processorFields) {
    const next = cloneValue(merged);
    for (const field of processorFields) {
        const key = String(field);
        if (!(key in patch)) {
            continue;
        }
        const value = patch[key];
        if (isProcessorLikeEmptyObject(value)) {
            next[key] = {};
            continue;
        }
        if (isRecord(value) && "mode" in value) {
            next[key] = cloneValue(value);
        }
    }
    return next;
}
export function resolveEnabledFlag(params) {
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
function parseRequiredObject(value, jsonFlag, fileFlag) {
    if (!isRecord(value) || Object.keys(value).length === 0) {
        throw new ActionDockCliError(`需要提供 ${jsonFlag} 或 ${fileFlag}，且顶层必须是 JSON 对象。`, 2);
    }
    return value;
}
function coerceRecord(value, label) {
    if (value === undefined || value === null) {
        return {};
    }
    if (!isRecord(value)) {
        throw new ActionDockCliError(`payload.${label} 必须是 JSON 对象。`, 2);
    }
    return value;
}
function isProcessorLikeEmptyObject(value) {
    return isRecord(value) && Object.keys(value).length === 0;
}
function deepMerge(target, source) {
    if (!isRecord(target) || !isRecord(source)) {
        return cloneValue(source);
    }
    const result = { ...target };
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
function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneValue(item));
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
    return value;
}
