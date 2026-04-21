import { parseJsonText, prettyJson } from "./utils";

export type SchemaFieldKind = "string" | "number" | "integer" | "boolean" | "enum";

export interface SchemaFieldDraft {
  id: string;
  name: string;
  title: string;
  type: SchemaFieldKind;
  required: boolean;
  enumText: string;
}

export interface SchemaFieldDefinition {
  name: string;
  label: string;
  kind: SchemaFieldKind;
  required: boolean;
  enumValues?: string[];
}

export interface SchemaFieldValidationErrors {
  name?: string;
  enumText?: string;
}

export type SchemaEditorState =
  | {
      mode: "builder";
      fields: SchemaFieldDraft[];
    }
  | {
      mode: "json";
      jsonText: string;
      reason: string;
    };

const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const ROOT_KEYS = new Set(["type", "properties", "required"]);
const FIELD_KEYS = new Set(["type", "title", "enum"]);

let schemaFieldSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createDraftId(): string {
  schemaFieldSequence += 1;
  return `schema-field-${schemaFieldSequence}`;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function hasUnsupportedKeys(source: Record<string, unknown>, supportedKeys: Set<string>): boolean {
  return Object.keys(source).some((key) => !supportedKeys.has(key));
}

export function createEmptySchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {}
  };
}

export function createSchemaFieldDraft(): SchemaFieldDraft {
  return {
    id: createDraftId(),
    name: "",
    title: "",
    type: "string",
    required: false,
    enumText: ""
  };
}

export function createEmptySchemaEditorState(): SchemaEditorState {
  return {
    mode: "builder",
    fields: []
  };
}

export function parseEnumValues(enumText: string): string[] {
  return dedupeStrings(
    enumText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function validateSchemaFields(
  fields: SchemaFieldDraft[]
): Record<string, SchemaFieldValidationErrors> {
  const errors: Record<string, SchemaFieldValidationErrors> = {};
  const firstFieldByName = new Map<string, string>();

  fields.forEach((field) => {
    const fieldErrors: SchemaFieldValidationErrors = {};
    const name = field.name.trim();

    if (!name) {
      fieldErrors.name = "请输入字段名";
    } else if (!FIELD_NAME_PATTERN.test(name)) {
      fieldErrors.name = "字段名仅支持字母、数字和下划线";
    } else {
      const duplicatedFieldId = firstFieldByName.get(name);
      if (duplicatedFieldId) {
        fieldErrors.name = "字段名不能重复";
        errors[duplicatedFieldId] = {
          ...errors[duplicatedFieldId],
          name: "字段名不能重复"
        };
      } else {
        firstFieldByName.set(name, field.id);
      }
    }

    if (field.type === "enum" && parseEnumValues(field.enumText).length === 0) {
      fieldErrors.enumText = "请输入至少一个枚举值";
    }

    if (fieldErrors.name || fieldErrors.enumText) {
      errors[field.id] = {
        ...errors[field.id],
        ...fieldErrors
      };
    }
  });

  return errors;
}

export function hasSchemaFieldErrors(fields: SchemaFieldDraft[]): boolean {
  return Object.keys(validateSchemaFields(fields)).length > 0;
}

function failJson(reason: string, schema: Record<string, unknown>, jsonText?: string): SchemaEditorState {
  return {
    mode: "json",
    jsonText: jsonText ?? prettyJson(schema),
    reason
  };
}

export function deserializeSchema(
  schema?: Record<string, unknown>,
  jsonText?: string
): SchemaEditorState {
  if (!schema || Object.keys(schema).length === 0) {
    return createEmptySchemaEditorState();
  }

  if (!isRecord(schema)) {
    return failJson("顶层 schema 不是对象", {}, jsonText);
  }

  if (hasUnsupportedKeys(schema, ROOT_KEYS)) {
    return failJson("根节点包含 builder 不支持的扩展配置", schema, jsonText);
  }

  if ("type" in schema && schema.type !== "object") {
    return failJson("根节点 type 必须是 object", schema, jsonText);
  }

  if ("required" in schema) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string")) {
      return failJson("required 必须是字符串数组", schema, jsonText);
    }
  }

  if ("properties" in schema && !isRecord(schema.properties)) {
    return failJson("properties 必须是对象", schema, jsonText);
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const requiredSet = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : []
  );
  const fields: SchemaFieldDraft[] = [];

  for (const [name, metaValue] of Object.entries(properties)) {
    if (!isRecord(metaValue)) {
      return failJson(`字段 ${name} 的定义不是对象`, schema, jsonText);
    }
    if (hasUnsupportedKeys(metaValue, FIELD_KEYS)) {
      return failJson(`字段 ${name} 含有 builder 不支持的扩展配置`, schema, jsonText);
    }
    if ("properties" in metaValue || "items" in metaValue) {
      return failJson(`字段 ${name} 使用了嵌套结构`, schema, jsonText);
    }

    const title = typeof metaValue.title === "string" ? metaValue.title : "";

    if ("enum" in metaValue) {
      if (!Array.isArray(metaValue.enum) || metaValue.enum.some((item) => typeof item !== "string")) {
        return failJson(`字段 ${name} 的 enum 必须是字符串数组`, schema, jsonText);
      }
      if ("type" in metaValue && metaValue.type !== "string") {
        return failJson(`字段 ${name} 的 enum 仅支持 string 类型`, schema, jsonText);
      }
      fields.push({
        id: createDraftId(),
        name,
        title,
        type: "enum",
        required: requiredSet.has(name),
        enumText: metaValue.enum.join(", ")
      });
      continue;
    }

    const type = metaValue.type;
    if (
      type !== "string" &&
      type !== "number" &&
      type !== "integer" &&
      type !== "boolean"
    ) {
      return failJson(`字段 ${name} 的类型不在 builder 支持范围内`, schema, jsonText);
    }

    fields.push({
      id: createDraftId(),
      name,
      title,
      type,
      required: requiredSet.has(name),
      enumText: ""
    });
  }

  return {
    mode: "builder",
    fields
  };
}

export function deserializeSchemaJsonText(
  jsonText: string,
  fieldName: string
): SchemaEditorState {
  const schema = parseJsonText(jsonText, fieldName);
  return deserializeSchema(schema, jsonText);
}

function buildSchemaFromFields(
  fields: SchemaFieldDraft[],
  options: {
    fieldName?: string;
    validate: boolean;
  }
): Record<string, unknown> {
  if (options.validate) {
    const errors = validateSchemaFields(fields);
    if (Object.keys(errors).length > 0) {
      throw new Error(`${options.fieldName ?? "Schema"}存在未完成或不合法的字段，请先修正`);
    }
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  fields.forEach((field) => {
    const name = field.name.trim();
    if (!name) {
      return;
    }
    const title = field.title.trim();
    const property: Record<string, unknown> = {
      type: field.type === "enum" ? "string" : field.type
    };

    if (title) {
      property.title = title;
    }
    if (field.type === "enum") {
      const enumValues = parseEnumValues(field.enumText);
      if (enumValues.length > 0) {
        property.enum = enumValues;
      }
    }

    properties[name] = property;
    if (field.required) {
      required.push(name);
    }
  });

  const schema: Record<string, unknown> = {
    type: "object",
    properties
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

export function formatSchemaEditorState(state: SchemaEditorState): string {
  if (state.mode === "json") {
    return state.jsonText;
  }
  return prettyJson(buildSchemaFromFields(state.fields, { validate: false }));
}

export function serializeSchemaEditorState(
  state: SchemaEditorState,
  fieldName: string
): Record<string, unknown> {
  if (state.mode === "json") {
    return parseJsonText(state.jsonText, fieldName);
  }
  return buildSchemaFromFields(state.fields, { fieldName, validate: true });
}

export function resolveSchemaFields(schema?: Record<string, unknown>): {
  supportedFields: SchemaFieldDefinition[];
  unsupportedFields: string[];
} {
  if (!isRecord(schema)) {
    return { supportedFields: [], unsupportedFields: [] };
  }

  const requiredFields = Array.isArray(schema.required)
    ? new Set(schema.required.filter((item): item is string => typeof item === "string"))
    : new Set<string>();

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const supportedFields: SchemaFieldDefinition[] = [];
  const unsupportedFields: string[] = [];

  Object.entries(properties).forEach(([name, value]) => {
    const meta = isRecord(value) ? value : {};
    const label = typeof meta.title === "string" && meta.title.trim() ? meta.title : name;
    const enumValues = Array.isArray(meta.enum)
      ? meta.enum.filter((item): item is string => typeof item === "string")
      : undefined;

    if (enumValues && enumValues.length > 0) {
      supportedFields.push({
        name,
        label,
        kind: "enum",
        required: requiredFields.has(name),
        enumValues
      });
      return;
    }

    const type = typeof meta.type === "string" ? meta.type : "string";
    if (type === "string" || type === "number" || type === "integer" || type === "boolean") {
      supportedFields.push({
        name,
        label,
        kind: type,
        required: requiredFields.has(name)
      });
      return;
    }

    unsupportedFields.push(label);
  });

  return { supportedFields, unsupportedFields };
}
