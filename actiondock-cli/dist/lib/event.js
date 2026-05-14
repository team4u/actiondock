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
export function parseWebhookRequest(payloadJson, payloadFile) {
    const payload = parseInputObject(payloadJson, payloadFile, {
        jsonFlag: "`--payload-json`",
        fileFlag: "`--payload-file`"
    });
    const result = {};
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
export function mergeWebhookDefinition(base, overrides) {
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
export function mergeDefinitionPatch(base, patch) {
    return deepMerge(base, patch);
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
function coerceStringListRecord(value, label) {
    if (value === undefined || value === null) {
        return {};
    }
    if (!isRecord(value)) {
        throw new ActionDockCliError(`payload.${label} 必须是 JSON 对象。`, 2);
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (Array.isArray(item)) {
            result[key] = item.map((entry) => String(entry));
            continue;
        }
        result[key] = [String(item)];
    }
    return result;
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
