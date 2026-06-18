import * as z from "zod";
/**
 * Convert a JSON Schema value into a {@link z.ZodTypeAny}.
 *
 * <p>Supported {@code type} values: {@code string} (with optional {@code enum}),
 * {@code number}, {@code integer}, {@code boolean}, {@code array}, and
 * {@code object}. Unrecognized or non-object schemas fall back to
 * {@link z.unknown}.
 *
 * @param schema  the JSON Schema fragment to convert
 * @param isRoot  when {@code true} a non-object root is wrapped as
 *                {@code z.object({ input: z.record(z.unknown()) })}
 */
export function jsonSchemaToZod(schema, isRoot = false) {
    if (schema === null || schema === undefined || typeof schema !== "object") {
        return isRoot ? z.object({ input: z.record(z.unknown()) }) : z.unknown();
    }
    const node = schema;
    const type = typeof node.type === "string" ? node.type : undefined;
    if (type === "string") {
        if (Array.isArray(node.enum) && node.enum.every((item) => typeof item === "string")) {
            const values = node.enum;
            return values.length > 0 ? z.enum(values) : z.string();
        }
        return z.string();
    }
    if (type === "number") {
        return z.number();
    }
    if (type === "integer") {
        return z.number().int();
    }
    if (type === "boolean") {
        return z.boolean();
    }
    if (type === "array") {
        return z.array(jsonSchemaToZod(node.items, false));
    }
    if (type === "object") {
        const properties = isRecord(node.properties) ? node.properties : null;
        if (!properties) {
            return z.record(z.unknown());
        }
        const required = new Set(Array.isArray(node.required) ? node.required.filter((item) => typeof item === "string") : []);
        const shape = {};
        for (const [name, meta] of Object.entries(properties)) {
            const fieldSchema = jsonSchemaToZod(meta, false);
            shape[name] = required.has(name) ? fieldSchema : fieldSchema.optional();
        }
        return z.object(shape);
    }
    return isRoot ? z.object({ input: z.record(z.unknown()) }) : z.unknown();
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
