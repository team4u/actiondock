import { parseJsonText, prettyJson } from "./utils";

export type SchemaFieldKind = "string" | "number" | "integer" | "boolean" | "enum" | "object" | "array";
export type SchemaFieldWidget = "input" | "textarea" | "markdown" | "json" | "code";

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
  language?: string;
  children?: SchemaFieldDraft[];
  items?: SchemaFieldDraft | null;
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
  language?: string;
  enumValues?: string[];
  children?: SchemaFieldDefinition[];
  childRequiredFields?: string[];
  items?: SchemaFieldDefinition | null;
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
  language?: string;
}

interface ResolvedFieldMeta {
  label: string;
  kind: SchemaFieldKind | null;
  enumValues?: string[];
  description?: string;
  defaultValue?: unknown;
  examples?: unknown[];
  ui: ResolvedFieldUiConfig;
  childProperties?: Record<string, unknown>;
  childRequired?: string[];
  itemsSchema?: Record<string, unknown>;
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
const FIELD_KEYS = new Set(["type", "title", "description", "default", "enum", "x-ui", "properties", "items", "required"]);
const UI_KEYS = new Set(["widget", "rows", "language"]);
const DEFAULT_TEXTAREA_ROWS = 6;
const MAX_SCHEMA_DEPTH = 3;
const DEFAULT_CODE_LANGUAGE = "plaintext";

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

function normalizeStringWidget(widget: SchemaFieldWidget | undefined): SchemaFieldWidget {
  if (widget === "json") {
    return "code";
  }
  return widget ?? "input";
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

export function createSchemaFieldDraftForObject(): SchemaFieldDraft {
  return {
    ...createSchemaFieldDraft(),
    type: "object",
    defaultValue: undefined,
    children: []
  };
}

export function createSchemaFieldDraftForArray(): SchemaFieldDraft {
  return {
    ...createSchemaFieldDraft(),
    type: "array",
    defaultValue: undefined,
    items: null
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

    if (field.type === "object" && (!field.children || field.children.length === 0)) {
      fieldErrors.name = fieldErrors.name
        ? `${fieldErrors.name}；object 类型必须包含至少一个子字段`
        : "object 类型必须包含至少一个子字段";
    }

    if (field.type === "array" && !field.items) {
      fieldErrors.name = fieldErrors.name
        ? `${fieldErrors.name}；array 类型必须定义 items 类型`
        : "array 类型必须定义 items 类型";
    }

    if ((field.widget === "textarea" || field.widget === "json" || field.widget === "code") && (!Number.isInteger(field.rows) || field.rows <= 0)) {
      fieldErrors.rows = "请输入大于 0 的整数行数";
    }

    if (field.type !== "object" && field.type !== "array"
      && field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
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

    if (field.type === "object" && field.children) {
      const childErrors = validateSchemaFields(field.children);
      Object.assign(errors, childErrors);
    }

    if (field.type === "array" && field.items) {
      if (field.items.type === "object" && field.items.children) {
        const itemChildErrors = validateSchemaFields(field.items.children);
        Object.assign(errors, itemChildErrors);
      }
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

function parseCodeLanguage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const language = value.trim();
  return language ? language : null;
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
  if (
    widgetValue !== undefined &&
    widgetValue !== "input" &&
    widgetValue !== "textarea" &&
    widgetValue !== "markdown" &&
    widgetValue !== "json" &&
    widgetValue !== "code"
  ) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui.widget 仅支持 input、textarea、markdown、json 或 code`);
    }
    return {};
  }

  const rowsValue = ui.rows;
  const rows = rowsValue === undefined ? DEFAULT_TEXTAREA_ROWS : parseTextareaRows(rowsValue);
  const language = parseCodeLanguage(ui.language);
  const widget = normalizeStringWidget(widgetValue as SchemaFieldWidget | undefined);
  const legacyJsonWidget = widgetValue === "json";
  const resolvedLanguage = language ?? (legacyJsonWidget ? "json" : DEFAULT_CODE_LANGUAGE);

  if (widget === "input") {
    if (rowsValue !== undefined || language !== null) {
      if (options.strict) {
        throw new Error(`字段 ${fieldName} 的 x-ui.rows / x-ui.language 仅能用于 textarea 或 code`);
      }
      return {};
    }
    return {};
  }

  if (widget === "markdown") {
    if (rowsValue !== undefined || language !== null) {
      if (options.strict) {
        throw new Error(`字段 ${fieldName} 的 x-ui.rows / x-ui.language 仅能用于 textarea 或 code`);
      }
      return {};
    }
    return {
      widget: "markdown"
    };
  }

  if (widget === "code") {
    if (rowsValue !== undefined && rows === null) {
      if (options.strict) {
        throw new Error(`字段 ${fieldName} 的 x-ui.rows 必须是大于 0 的整数`);
      }
      return {
        widget: "code",
        rows: DEFAULT_TEXTAREA_ROWS,
        language: resolvedLanguage
      };
    }
    return {
      widget: "code",
      rows: rows ?? DEFAULT_TEXTAREA_ROWS,
      language: resolvedLanguage
    };
  }

  if (widget !== "textarea") {
    return {};
  }

  if (language !== null) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui.language 仅能用于 code`);
    }
    return {};
  }

  if (rowsValue !== undefined && rows === null) {
    if (options.strict) {
      throw new Error(`字段 ${fieldName} 的 x-ui.rows 必须是大于 0 的整数`);
    }
    return {
      widget: "textarea",
      rows: DEFAULT_TEXTAREA_ROWS
    };
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
    const type = typeof meta.type === "string" ? meta.type : null;
    if (type === "string" || type === "number" || type === "integer" || type === "boolean") {
      kind = type;
    } else if (type === "object" && isRecord(meta.properties)) {
      kind = "object";
    } else if (type === "array" && isRecord(meta.items)) {
      kind = "array";
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
    }),
    childProperties: kind === "object" && isRecord(meta.properties) ? (meta.properties as Record<string, unknown>) : undefined,
    childRequired: kind === "object" && Array.isArray(meta.required)
      ? meta.required.filter((item): item is string => typeof item === "string")
      : undefined,
    itemsSchema: kind === "array" && isRecord(meta.items) ? (meta.items as Record<string, unknown>) : undefined
  };
}

function deserializeFieldDraftsFromProperties(
  properties: Record<string, unknown>,
  requiredSet: Set<string>,
  schema: Record<string, unknown>,
  jsonText: string | undefined,
  depth: number
): SchemaFieldDraft[] | null {
  const fields: SchemaFieldDraft[] = [];

  for (const [name, metaValue] of Object.entries(properties)) {
    if (!isRecord(metaValue)) {
      return null;
    }
    if (hasUnsupportedKeys(metaValue, FIELD_KEYS)) {
      return null;
    }

    const fieldMeta = resolveFieldMeta(name, metaValue, { strictUi: true });

    if (fieldMeta.kind === "object") {
      if (depth >= MAX_SCHEMA_DEPTH) {
        return null;
      }
      const childProps = fieldMeta.childProperties!;
      const childRequired = new Set(fieldMeta.childRequired ?? []);
      const childFields = deserializeFieldDraftsFromProperties(
        childProps, childRequired, schema, jsonText, depth + 1
      );
      if (childFields === null) {
        return null;
      }
      fields.push({
        id: createDraftId(),
        name,
        title: fieldMeta.label === name ? "" : fieldMeta.label,
        type: "object",
        required: requiredSet.has(name),
        description: fieldMeta.description ?? "",
        defaultValue: undefined,
        enumText: "",
        widget: "input",
        rows: DEFAULT_TEXTAREA_ROWS,
        children: childFields
      });
    } else if (fieldMeta.kind === "array") {
      if (depth >= MAX_SCHEMA_DEPTH) {
        return null;
      }
      const itemsDraft = deserializeArrayItemsDraft(
        fieldMeta.itemsSchema!, schema, jsonText, depth + 1
      );
      if (itemsDraft === null) {
        return null;
      }
      fields.push({
        id: createDraftId(),
        name,
        title: fieldMeta.label === name ? "" : fieldMeta.label,
        type: "array",
        required: requiredSet.has(name),
        description: fieldMeta.description ?? "",
        defaultValue: undefined,
        enumText: "",
        widget: "input",
        rows: DEFAULT_TEXTAREA_ROWS,
        items: itemsDraft
      });
    } else if (fieldMeta.kind === "enum") {
      if (!Array.isArray(metaValue.enum) || metaValue.enum.some((item) => typeof item !== "string")) {
        return null;
      }
      if ("type" in metaValue && metaValue.type !== "string") {
        return null;
      }
      const defaultState = parseFieldDefaultValue(metaValue, name, {
        strict: true,
        kind: "enum",
        enumValues: fieldMeta.enumValues
      });
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
    } else {
      if (!fieldMeta.kind) {
        return null;
      }
      const defaultState = parseFieldDefaultValue(metaValue, name, {
        strict: true,
        kind: fieldMeta.kind,
        enumValues: fieldMeta.enumValues
      });
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
        rows: fieldMeta.ui.rows ?? DEFAULT_TEXTAREA_ROWS,
        language: fieldMeta.ui.language
      });
    }
  }

  return fields;
}

function deserializeArrayItemsDraft(
  itemsSchema: Record<string, unknown>,
  schema: Record<string, unknown>,
  jsonText: string | undefined,
  depth: number
): SchemaFieldDraft | null {
  const itemsMeta = resolveFieldMeta("items", itemsSchema, { strictUi: true });

  if (itemsMeta.kind === "object") {
    const childProps = itemsMeta.childProperties!;
    const childRequired = new Set(itemsMeta.childRequired ?? []);
    const childFields = deserializeFieldDraftsFromProperties(
      childProps, childRequired, schema, jsonText, depth
    );
    if (childFields === null) {
      return null;
    }
    return {
      id: createDraftId(),
      name: "items",
      title: "",
      type: "object",
      required: false,
      description: itemsMeta.description ?? "",
      defaultValue: undefined,
      enumText: "",
      widget: "input",
      rows: DEFAULT_TEXTAREA_ROWS,
      children: childFields
    };
  }

  if (itemsMeta.kind && itemsMeta.kind !== "array") {
    return {
      id: createDraftId(),
      name: "items",
      title: "",
      type: itemsMeta.kind,
      required: false,
      description: itemsMeta.description ?? "",
      defaultValue: undefined,
      enumText: itemsMeta.kind === "enum" ? (itemsMeta.enumValues?.join(", ") ?? "") : "",
      widget: itemsMeta.ui.widget ?? "input",
      rows: itemsMeta.ui.rows ?? DEFAULT_TEXTAREA_ROWS,
      language: itemsMeta.ui.language,
      ...(itemsMeta.kind === "enum" && itemsMeta.enumValues
        ? { enumText: itemsMeta.enumValues.join(", ") }
        : {})
    };
  }

  return null;
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

  const fields = deserializeFieldDraftsFromProperties(
    properties, requiredSet, schema, jsonText, 0
  );
  if (fields === null) {
    return failJson("Schema 包含 builder 不支持的复杂嵌套结构", schema, jsonText);
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

function buildPropertyFromDraft(field: SchemaFieldDraft): Record<string, unknown> | null {
  const name = field.name.trim();
  if (!name) return null;

  const title = field.title.trim();
  const description = field.description.trim();

  if (field.type === "object") {
    if (!field.children || field.children.length === 0) return null;
    const childResult = buildSchemaFromDrafts(field.children);
    if (!childResult) return null;
    const property: Record<string, unknown> = {
      type: "object",
      properties: childResult.properties
    };
    if (childResult.required.length > 0) {
      property.required = childResult.required;
    }
    if (title) property.title = title;
    if (description) property.description = description;
    return property;
  }

  if (field.type === "array") {
    if (!field.items) return null;
    const itemsProperty = buildPropertyFromDraft(field.items);
    if (!itemsProperty) return null;
    const property: Record<string, unknown> = {
      type: "array",
      items: itemsProperty
    };
    if (title) property.title = title;
    if (description) property.description = description;
    return property;
  }

  const property: Record<string, unknown> = {
    type: field.type === "enum" ? "string" : field.type
  };
  if (title) property.title = title;
  if (description) property.description = description;
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
    const ui: Record<string, unknown> = { widget: "textarea" };
    if (field.rows !== DEFAULT_TEXTAREA_ROWS) {
      ui.rows = field.rows;
    }
    property["x-ui"] = ui;
  } else if (field.type === "string" && field.widget === "markdown") {
    const ui: Record<string, unknown> = { widget: "markdown" };
    property["x-ui"] = ui;
  } else if (field.type === "string" && (field.widget === "json" || field.widget === "code")) {
    const ui: Record<string, unknown> = { widget: "code" };
    if (field.rows !== DEFAULT_TEXTAREA_ROWS) {
      ui.rows = field.rows;
    }
    ui.language = field.widget === "json" ? "json" : field.language?.trim() || DEFAULT_CODE_LANGUAGE;
    property["x-ui"] = ui;
  }
  return property;
}

function buildSchemaFromDrafts(fields: SchemaFieldDraft[]): {
  properties: Record<string, unknown>;
  required: string[];
} | null {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fields) {
    const prop = buildPropertyFromDraft(field);
    if (!prop) continue;
    const name = field.name.trim();
    properties[name] = prop;
    if (field.required) required.push(name);
  }
  return { properties, required };
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

  const result = buildSchemaFromDrafts(fields);
  const schema: Record<string, unknown> = {
    type: "object",
    properties: result?.properties ?? {}
  };
  if (result && result.required.length > 0) {
    schema.required = result.required;
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

function resolveSchemaFieldsRecursive(
  properties: Record<string, unknown>,
  requiredFields: Set<string>
): {
  supportedFields: SchemaFieldDefinition[];
  unsupportedFields: string[];
} {
  const supportedFields: SchemaFieldDefinition[] = [];
  const unsupportedFields: string[] = [];

  Object.entries(properties).forEach(([name, value]) => {
    const meta = isRecord(value) ? value : {};
    const fieldMeta = resolveFieldMeta(name, meta, { strictUi: false });

    if (fieldMeta.kind === "object") {
      const childProps = fieldMeta.childProperties ?? {};
      const childRequiredSet = new Set(fieldMeta.childRequired ?? []);
      const childResult = resolveSchemaFieldsRecursive(childProps, childRequiredSet);
      supportedFields.push({
        name,
        label: fieldMeta.label,
        kind: "object",
        required: requiredFields.has(name),
        description: fieldMeta.description,
        children: childResult.supportedFields,
        childRequiredFields: [...childRequiredSet]
      });
      unsupportedFields.push(...childResult.unsupportedFields);
      return;
    }

    if (fieldMeta.kind === "array") {
      const itemsSchema = fieldMeta.itemsSchema ?? {};
      const itemsMeta = resolveFieldMeta("items", itemsSchema, { strictUi: false });

      if (itemsMeta.kind === "object") {
        const childProps = isRecord(itemsSchema.properties) ? itemsSchema.properties : {};
        const childRequiredSet = new Set(
          Array.isArray(itemsSchema.required)
            ? itemsSchema.required.filter((item): item is string => typeof item === "string")
            : []
        );
        const childResult = resolveSchemaFieldsRecursive(childProps, childRequiredSet);
        supportedFields.push({
          name,
          label: fieldMeta.label,
          kind: "array",
          required: requiredFields.has(name),
          description: fieldMeta.description,
          items: {
            name: "items",
            label: "items",
            kind: "object",
            required: false,
            children: childResult.supportedFields,
            childRequiredFields: [...childRequiredSet]
          }
        });
        unsupportedFields.push(...childResult.unsupportedFields);
      } else if (itemsMeta.kind) {
        supportedFields.push({
          name,
          label: fieldMeta.label,
          kind: "array",
          required: requiredFields.has(name),
          description: fieldMeta.description,
          items: {
            name: "items",
            label: itemsMeta.label,
            kind: itemsMeta.kind,
            required: false,
            description: itemsMeta.description,
            enumValues: itemsMeta.enumValues,
            widget: itemsMeta.ui.widget,
            rows: itemsMeta.ui.rows
          }
        });
      } else {
        unsupportedFields.push(fieldMeta.label);
      }
      return;
    }

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
        rows: fieldMeta.ui.rows,
        language: fieldMeta.ui.language
      });
      return;
    }

    unsupportedFields.push(fieldMeta.label);
  });

  return { supportedFields, unsupportedFields };
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
  return resolveSchemaFieldsRecursive(properties, requiredFields);
}
