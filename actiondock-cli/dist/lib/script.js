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
/**
 * 构建用于替换 schema 的 Merge Patch。
 * <p>
 * 当用户通过 --input-schema-json / --output-schema-json 提供新 schema 时，
 * 期望的是"全量替换"语义（省略字段即删除），而非 RFC 7396 的增量合并。
 * 此函数对比当前 schema 和新 schema，为被删除的 properties 生成 null 条目，
 * 使得后端的 merge 逻辑能正确移除字段。
 */
export function buildSchemaReplacePatch(currentSchema, newSchema) {
    const currentProps = extractSchemaProperties(currentSchema);
    const newProps = extractSchemaProperties(newSchema);
    // 为当前存在但新 schema 中不存在的属性添加 null 条目
    const patchProps = { ...newProps };
    for (const key of Object.keys(currentProps)) {
        if (!(key in patchProps)) {
            patchProps[key] = null;
        }
    }
    // 构建结果：使用新 schema 的所有顶层键，替换 properties 为 null 增强版本
    const result = { ...newSchema };
    result.properties = patchProps;
    return result;
}
function extractSchemaProperties(schema) {
    if (!schema || !("properties" in schema)) {
        return {};
    }
    const props = schema.properties;
    return typeof props === "object" && props !== null && !Array.isArray(props)
        ? props
        : {};
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
    return normalizeScriptPatchAliases({ ...parsed });
}
export function setPatchField(patch, field, value) {
    if (Object.hasOwn(patch, field)) {
        throw new ActionDockCliError(`Patch 字段重复定义: ${field}`, 2);
    }
    patch[field] = value;
}
function normalizeScriptPatchAliases(patch) {
    movePatchAlias(patch, "desc", "description");
    movePatchAlias(patch, "inputSchemaPatch", "inputSchema");
    movePatchAlias(patch, "outputSchemaPatch", "outputSchema");
    return patch;
}
function movePatchAlias(patch, alias, field) {
    if (!Object.hasOwn(patch, alias)) {
        return;
    }
    if (Object.hasOwn(patch, field)) {
        throw new ActionDockCliError(`Patch 字段重复定义: ${field}`, 2);
    }
    patch[field] = patch[alias];
    delete patch[alias];
}
