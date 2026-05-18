import fs from "node:fs";
import { ActionDockCliError, isRecord } from "./error.js";
import { parseJsonValueInput } from "./input.js";
export function resolveScriptSource(source, sourceFile, required) {
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
export function resolveOptionalTextInput(value, valueFile, labels) {
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
export function parseSchemaInput(inputJson, inputFile, labels) {
    const parsed = parseJsonValueInput(inputJson, inputFile, labels);
    if (parsed === undefined) {
        return undefined;
    }
    if (!isRecord(parsed)) {
        throw new ActionDockCliError(`${labels.jsonFlag} / ${labels.fileFlag} 顶层必须是 JSON 对象。`, 2);
    }
    return parsed;
}
export function parsePatchObject(patchJson, patchFile) {
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
    return { ...parsed };
}
export function setPatchField(patch, field, value) {
    if (Object.hasOwn(patch, field)) {
        throw new ActionDockCliError(`Patch 字段重复定义: ${field}`, 2);
    }
    patch[field] = value;
}
