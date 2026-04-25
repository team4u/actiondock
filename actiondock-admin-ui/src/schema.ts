import { parseJsonText, prettyJson } from "./utils";

export type SchemaFieldKind = "string" | "number" | "integer" | "boolean" | "enum";
export type SchemaFieldWidget = "input" | "textarea";

export interface SchemaFieldDraft {
  id: string;
  name: string;
  title: string;
  type: SchemaFieldKind;
  required: boolean;
  description: string;
  defaultValue?: unknown;
  enumText: string;
  widget: SchemaFieldWidget;
  rows: number;
}

export interface SchemaFieldDefinition {
  name: string;
  label: string;
  kind: SchemaFieldKind;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  examples?: unknown[];
  widget?: SchemaFieldWidget;
  rows?: number;
  enumValues?: string[];
}

export interface SchemaFieldValidationErrors {
  name?: string;
  enumText?: string;
  rows?: string;
  defaultValue?: string;
}

interface ResolvedFieldUiConfig {
  widget?: SchemaFieldWidget;
  rows?: number;
}

interface ResolvedFieldMeta {
  label: string;
  kind: SchemaFieldKind | null;
  enumValues?: string[];
  description?: string;
  defaultValue?: unknown;
  examples?: unknown[];
  ui: ResolvedFieldUiConfig;
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
const FIELD_KEYS = new Set(["type", "title", "description", "default", "enum", "x-ui"]);
const UI_KEYS = new Set(["widget", "rows"]);
const DEFAULT_TEXTAREA_ROWS = 6;

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
    description: "",
    defaultValue: "",
    enumText: "",
    widget: "input",
    rows: DEFAULT_TEXTAREA_ROWS
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function createDraftDefaultValue(kind: SchemaFieldKind): unknown {
  switch (kind) {
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    default:
      return "";
  }
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

    if (field.widget === "textarea" && (!Number.isInteger(field.rows) || field.rows <= 0)) {
      fieldErrors.rows = "请输入大于 0 的整数行数";
    }

    if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
      if (field.type === "boolean") {
        if (typeof field.defaultValue !== "boolean") {
          fieldErrors.defaultValue = "布尔默认值必须是 true 或 false";
        }
      } else if (field.type === "number") {
        if (!isFiniteNumber(field.defaultValue)) {
          fieldErrors.defaultValue = "数字默认值必须是合法数字";
        }
      } else if (field.type === "integer") {
        if (!isFiniteNumber(field.defaultValue) || !Number.isInteger(field.defaultValue)) {
          fieldErrors.defaultValue = "整数默认值必须是整数";
        }
      } else if (field.type === "enum") {
        const enumValues = parseEnumValues(field.enumText);
        if (typeof field.defaultValue !== "string" || !enumValues.includes(field.defaultValue)) {
          fieldErrors.defaultValue = "默认值必须是枚举值之一";
        }
      } else if (typeof field.defaultValue !== "string") {
        fieldErrors.defaultValue = "字符串默认值必须是文本";
      }
    }

    if (fieldErrors.name || fieldErrors.enumText || fieldErrors.rows || fieldErrors.defaultValue) {
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

function parseTextareaRows(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseFieldUi(
  meta: Record<string, unknown>,
  fieldName: string,
  options: { strict: boolean; kind: SchemaFieldKind | null }
): ResolvedFieldUiConfig {
  if (options.kind !== "string") {
    return {};
  }

  const ui = meta["x-ui"];

  if (ui === undefined) {
    return {};
  }
  if (!isRecord(ui)) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui 必须是对象`);
    }
    return {};
  }
  if (hasUnsupportedKeys(ui, UI_KEYS)) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui 含有 builder 不支持的扩展配置`);
    }
    return {};
  }

  const widgetValue = ui.widget;
  if (widgetValue !== undefined && widgetValue !== "input" && widgetValue !== "textarea") {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui.widget 仅支持 input 或 textarea`);
    }
    return {};
  }

  const rowsValue = ui.rows;
  const rows = rowsValue === undefined ? DEFAULT_TEXTAREA_ROWS : parseTextareaRows(rowsValue);
  if (rowsValue !== undefined && rows === null) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui.rows 必须是大于 0 的整数`);
    }
    return {
      widget: widgetValue === "textarea" ? "textarea" : undefined,
      rows: widgetValue === "textarea" ? DEFAULT_TEXTAREA_ROWS : undefined
    };
  }

  if ((widgetValue ?? "input") !== "textarea" && rowsValue !== undefined) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui.rows 仅能用于 textarea`);
    }
    return {};
  }

  if (widgetValue !== "textarea") {
    return {};
  }

  return {
    widget: "textarea",
    rows: rows ?? DEFAULT_TEXTAREA_ROWS
  };
}

function parseFieldDefaultValue(
  meta: Record<string, unknown>,
  fieldName: string,
  options: {
    strict: boolean;
    kind: SchemaFieldKind | null;
    enumValues?: string[];
  }
): { hasDefaultValue: boolean; defaultValue?: unknown } {
  if (!("default" in meta)) {
    return {
      hasDefaultValue: false,
      defaultValue: options.kind ? createDraftDefaultValue(options.kind) : undefined
    };
  }

  const defaultValue = meta.default;
  let valid = true;

  switch (options.kind) {
    case "boolean":
      valid = typeof defaultValue === "boolean";
      break;
    case "number":
      valid = isFiniteNumber(defaultValue);
      break;
    case "integer":
      valid = isFiniteNumber(defaultValue) && Number.isInteger(defaultValue);
      break;
    case "enum":
      valid =
        typeof defaultValue === "string" &&
        Array.isArray(options.enumValues) &&
        options.enumValues.includes(defaultValue);
      break;
    case "string":
      valid = typeof defaultValue === "string";
      break;
    default:
      valid = false;
      break;
  }

  if (!valid) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 default 与字段类型不匹配`);
    }
    return {
      hasDefaultValue: true,
      defaultValue
    };
  }

  return {
    hasDefaultValue: true,
    defaultValue
  };
}

function resolveFieldMeta(
  name: string,
  meta: Record<string, unknown>,
  options: { strictUi: boolean }
): ResolvedFieldMeta {
  const label = typeof meta.title === "string" && meta.title.trim() ? meta.title : name;
  const description = typeof meta.description === "string" ? meta.description : undefined;
  const defaultValue = "default" in meta ? meta.default : undefined;
  const examples = Array.isArray(meta.examples) ? meta.examples : undefined;
  const enumValues = Array.isArray(meta.enum)
    ? meta.enum.filter((item): item is string => typeof item === "string")
    : undefined;

  let kind: SchemaFieldKind | null = null;
  if (enumValues && enumValues.length > 0) {
    kind = "enum";
  } else {
    const type = typeof meta.type === "string" ? meta.type : "string";
    if (type === "string" || type === "number" || type === "integer" || type === "boolean") {
      kind = type;
    }
  }

  return {
    label,
    kind,
    description,
    defaultValue,
    examples,
    enumValues,
    ui: parseFieldUi(meta, name, {
      strict: options.strictUi,
      kind
    })
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

    const fieldMeta = resolveFieldMeta(name, metaValue, { strictUi: true });
    const defaultState = parseFieldDefaultValue(metaValue, name, {
      strict: true,
      kind: fieldMeta.kind,
      enumValues: fieldMeta.enumValues
    });

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
        title: fieldMeta.label === name ? "" : fieldMeta.label,
        type: "enum",
        required: requiredSet.has(name),
        description: fieldMeta.description ?? "",
        defaultValue: defaultState.hasDefaultValue ? defaultState.defaultValue : undefined,
        enumText: metaValue.enum.join(", "),
        widget: "input",
        rows: DEFAULT_TEXTAREA_ROWS
      });
      continue;
    }

    if (!fieldMeta.kind || fieldMeta.kind === "enum") {
      return failJson(`字段 ${name} 的类型不在 builder 支持范围内`, schema, jsonText);
    }

    fields.push({
      id: createDraftId(),
      name,
      title: fieldMeta.label === name ? "" : fieldMeta.label,
      type: fieldMeta.kind,
      required: requiredSet.has(name),
      description: fieldMeta.description ?? "",
      defaultValue: defaultState.hasDefaultValue ? defaultState.defaultValue : undefined,
      enumText: "",
      widget: fieldMeta.ui.widget ?? "input",
      rows: fieldMeta.ui.rows ?? DEFAULT_TEXTAREA_ROWS
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
    const description = field.description.trim();
    const property: Record<string, unknown> = {
      type: field.type === "enum" ? "string" : field.type
    };

    if (title) {
      property.title = title;
    }
    if (description) {
      property.description = description;
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
      property.default = field.defaultValue;
    }
    if (field.type === "enum") {
      const enumValues = parseEnumValues(field.enumText);
      if (enumValues.length > 0) {
        property.enum = enumValues;
      }
    }
    if (field.type === "string" && field.widget === "textarea") {
      const ui: Record<string, unknown> = {
        widget: "textarea"
      };
      if (field.rows !== DEFAULT_TEXTAREA_ROWS) {
        ui.rows = field.rows;
      }
      property["x-ui"] = ui;
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
    const fieldMeta = resolveFieldMeta(name, meta, { strictUi: false });

    if (fieldMeta.kind === "enum") {
      supportedFields.push({
        name,
        label: fieldMeta.label,
        kind: "enum",
        required: requiredFields.has(name),
        description: fieldMeta.description,
        defaultValue: fieldMeta.defaultValue,
        examples: fieldMeta.examples,
        enumValues: fieldMeta.enumValues
      });
      return;
    }

    if (fieldMeta.kind) {
      supportedFields.push({
        name,
        label: fieldMeta.label,
        kind: fieldMeta.kind,
        required: requiredFields.has(name),
        description: fieldMeta.description,
        defaultValue: fieldMeta.defaultValue,
        examples: fieldMeta.examples,
        widget: fieldMeta.ui.widget,
        rows: fieldMeta.ui.rows
      });
      return;
    }

    unsupportedFields.push(fieldMeta.label);
  });

  return { supportedFields, unsupportedFields };
}
