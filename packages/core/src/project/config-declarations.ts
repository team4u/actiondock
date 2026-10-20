import type { JsonSchema } from "@actiondock/sdk";
import type { ConfigItemDefinition, ConfigValueSchema } from "./types";
import {
  ActionDockError,
  CONFIG_VALUE_INVALID,
  INVALID_ARGUMENT,
  MANIFEST_INVALID,
} from "../errors";
import { validateSchema, validateSchemaOnly } from "../schema/validator";

/**
 * 判定指定配置键名是否为通配模板键。
 *
 * @param key 待检测的配置键名
 */
export function isConfigTemplate(key: string): boolean {
  return typeof key === "string" && key.includes("*");
}

/**
 * 断言键名为具体配置键，拒绝空字符串、非字符串以及模板通配键。
 *
 * @param key 待检查的具体配置键名
 */
export function assertConcreteConfigKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.includes("*")) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Concrete configuration key expected, received invalid key: '${key}'`
    );
  }
}

/**
 * 解析配置项命中结果结构。
 */
export interface ResolvedConfigDeclaration {
  /** 命中声明所登记的原始键名（具体键或模板键） */
  key: string;
  /** 声明的配置定义元数据 */
  item: ConfigItemDefinition;
  /** 若通过模板匹配命中，则返回命中的模板表达式 */
  template?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 解析并匹配指定配置键在声明字典中的定义项。
 * 
 * 匹配优先级规则：
 * - 具体声明键严格优先于任何模板通配键；
 * - 模板只允许包含单个星号（*），匹配一个或多个合法标识字符（[A-Za-z0-9_.-]）；
 * - 多个模板同时命中时，优先选取前缀最长者，前缀长度相同时选取后缀最长者，杜绝对象枚举遍历顺序影响。
 *
 * @param config 声明的配置定义字典
 * @param key 实际访问或配置的具体键名
 */
export function resolveConfigDeclaration(
  config: Record<string, ConfigItemDefinition> | undefined,
  key: string
): ResolvedConfigDeclaration | undefined {
  if (!config || typeof config !== "object" || typeof key !== "string") {
    return undefined;
  }

  // 具体键严格优先
  if (Object.prototype.hasOwnProperty.call(config, key)) {
    return {
      key,
      item: config[key],
    };
  }

  interface MatchCandidate {
    templateKey: string;
    item: ConfigItemDefinition;
    prefixLength: number;
    suffixLength: number;
  }

  const candidates: MatchCandidate[] = [];

  for (const [declaredKey, item] of Object.entries(config)) {
    if (!isConfigTemplate(declaredKey)) {
      continue;
    }
    const parts = declaredKey.split("*");
    if (parts.length !== 2) {
      continue;
    }
    const [prefix, suffix] = parts;
    const pattern = new RegExp(
      `^${escapeRegex(prefix)}([A-Za-z0-9_.-]+)${escapeRegex(suffix)}$`
    );
    if (pattern.exec(key)?.[0] === key) {
      candidates.push({
        templateKey: declaredKey,
        item,
        prefixLength: prefix.length,
        suffixLength: suffix.length,
      });
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  // 判定最长前缀再最长后缀，稳定按字典序平局兜底
  candidates.sort((a, b) => {
    if (b.prefixLength !== a.prefixLength) {
      return b.prefixLength - a.prefixLength;
    }
    if (b.suffixLength !== a.suffixLength) {
      return b.suffixLength - a.suffixLength;
    }
    return a.templateKey.localeCompare(b.templateKey);
  });

  const best = candidates[0];
  return {
    key: best.templateKey,
    item: best.item,
    template: best.templateKey,
  };
}

/** 受限 JSON Schema 允许的白名单关键字集合 */
const ALLOWED_SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "secret",
]);

/** 模板键中严禁声明的保留字段 */
const FORBIDDEN_TEMPLATE_FIELDS = ["required", "default", "env"] as const;

function validateSchemaNode(
  schemaNode: unknown,
  path: string,
  errors: string[]
): void {
  if (typeof schemaNode !== "object" || schemaNode === null || Array.isArray(schemaNode)) {
    errors.push(`Schema at '${path}' must be an object`);
    return;
  }

  for (const k of Object.keys(schemaNode)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(k)) {
      errors.push(`Schema at '${path}' contains unsupported keyword '${k}'`);
    }
  }

  const node = schemaNode as Record<string, unknown>;

  if (node.type !== undefined) {
    if (
      typeof node.type !== "string" ||
      !["object", "array", "string", "integer", "number", "boolean"].includes(node.type)
    ) {
      errors.push(
        `Schema at '${path}' property 'type' must be one of "object", "array", "string", "integer", "number", "boolean"`
      );
    }
  }

  if (node.properties !== undefined) {
    if (
      typeof node.properties !== "object" ||
      node.properties === null ||
      Array.isArray(node.properties)
    ) {
      errors.push(`Schema at '${path}' property 'properties' must be an object`);
    } else {
      for (const [propName, child] of Object.entries(node.properties)) {
        validateSchemaNode(child, `${path}/properties/${propName}`, errors);
      }
    }
  }

  if (node.required !== undefined) {
    if (
      !Array.isArray(node.required) ||
      node.required.some((r) => typeof r !== "string")
    ) {
      errors.push(`Schema at '${path}' property 'required' must be an array of strings`);
    }
  }

  if (node.additionalProperties !== undefined) {
    if (typeof node.additionalProperties === "boolean") {
      // 允许布尔配置
    } else if (
      typeof node.additionalProperties === "object" &&
      node.additionalProperties !== null &&
      !Array.isArray(node.additionalProperties)
    ) {
      validateSchemaNode(node.additionalProperties, `${path}/additionalProperties`, errors);
    } else {
      errors.push(
        `Schema at '${path}' property 'additionalProperties' must be a boolean or a schema object`
      );
    }
  }

  if (node.items !== undefined) {
    if (
      typeof node.items === "object" &&
      node.items !== null &&
      !Array.isArray(node.items)
    ) {
      validateSchemaNode(node.items, `${path}/items`, errors);
    } else {
      errors.push(`Schema at '${path}' property 'items' must be a schema object`);
    }
  }

  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum)) {
      errors.push(`Schema at '${path}' property 'enum' must be an array`);
    }
  }

  if (node.minLength !== undefined) {
    if (
      typeof node.minLength !== "number" ||
      !Number.isInteger(node.minLength) ||
      node.minLength < 0
    ) {
      errors.push(`Schema at '${path}' property 'minLength' must be a non-negative integer`);
    }
  }

  if (node.maxLength !== undefined) {
    if (
      typeof node.maxLength !== "number" ||
      !Number.isInteger(node.maxLength) ||
      node.maxLength < 0
    ) {
      errors.push(`Schema at '${path}' property 'maxLength' must be a non-negative integer`);
    }
  }

  if (node.minimum !== undefined) {
    if (typeof node.minimum !== "number" || !Number.isFinite(node.minimum)) {
      errors.push(`Schema at '${path}' property 'minimum' must be a number`);
    }
  }

  if (node.maximum !== undefined) {
    if (typeof node.maximum !== "number" || !Number.isFinite(node.maximum)) {
      errors.push(`Schema at '${path}' property 'maximum' must be a number`);
    }
  }

  if (node.secret !== undefined) {
    if (typeof node.secret !== "boolean") {
      errors.push(`Schema at '${path}' property 'secret' must be a boolean`);
    }
  }
}

/**
 * 校验配置声明集合中的通配模板与受限 Schema 规范。
 * 针对历史无模板、无 Schema 项保持完全兼容。
 *
 * @param config 待校验的配置声明定义
 * @returns 错误信息字符串数组，无错误返回空数组
 */
export function validateConfigDeclarations(config: unknown): string[] {
  if (config === undefined || config === null) {
    return [];
  }

  if (typeof config !== "object" || Array.isArray(config)) {
    return ["Config declaration must be an object"];
  }

  const errors: string[] = [];

  for (const [key, item] of Object.entries(config)) {
    const isTemplate = isConfigTemplate(key);

    if (isTemplate) {
      const starCount = (key.match(/\*/g) || []).length;
      if (starCount !== 1) {
        errors.push(`Config template key '${key}' must contain exactly one '*' wildcard`);
      }

      if (item && typeof item === "object") {
        for (const forbidden of FORBIDDEN_TEMPLATE_FIELDS) {
          if (forbidden in item) {
            errors.push(`Config template '${key}' must not declare '${forbidden}' property`);
          }
        }
      }
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      if (isTemplate) errors.push(`Config template '${key}' must declare an object`);
      continue;
    }

    const itemDef = item as ConfigItemDefinition;
    if ((isTemplate || "schema" in itemDef) && itemDef.secret !== undefined && typeof itemDef.secret !== "boolean") {
      errors.push(`Config item '${key}' property 'secret' must be a boolean`);
    }

    if ("schema" in itemDef && itemDef.schema !== undefined) {
      if (
        typeof itemDef.schema !== "object" ||
        itemDef.schema === null ||
        Array.isArray(itemDef.schema)
      ) {
        errors.push(`Config item '${key}' schema must be an object`);
        continue;
      }

      // 递归白名单与属性类型校验
      validateSchemaNode(itemDef.schema, `config['${key}'].schema`, errors);

      // 外层 type 与根 schema.type 一致性检查（外层 number 与模式 integer 允许兼容）
      if (itemDef.type !== undefined && itemDef.schema.type !== undefined) {
        if (itemDef.type === "number") {
          if (itemDef.schema.type !== "number" && itemDef.schema.type !== "integer") {
            errors.push(
              `Config item '${key}' outer type 'number' is incompatible with schema type '${itemDef.schema.type}'`
            );
          }
        } else if (itemDef.type !== itemDef.schema.type) {
          errors.push(
            `Config item '${key}' outer type '${itemDef.type}' is incompatible with schema type '${itemDef.schema.type}'`
          );
        }
      }

      // 利用现有 Ajv 进行 Schema 编译合法性校验
      const ajvCheck = validateSchemaOnly(itemDef.schema as JsonSchema, {});
      if (!ajvCheck.valid && ajvCheck.errors) {
        for (const err of ajvCheck.errors) {
          if (err.startsWith("Schema compilation error:")) {
            errors.push(`Config item '${key}' schema failed compilation: ${err}`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * 断言配置声明集合完全合法。
 * 若存在非法模板或不合规 Schema 抛出 MANIFEST_INVALID 异常。
 *
 * @param config 待校验的配置声明定义
 */
export function assertValidConfigDeclarations(config: unknown): void {
  const errors = validateConfigDeclarations(config);
  if (errors.length > 0) {
    throw new ActionDockError(
      MANIFEST_INVALID,
      `Invalid configuration declarations: ${errors.join("; ")}`,
      { errors }
    );
  }
}

/**
 * 校验指定配置数据值是否符合绑定的 Schema 契约。
 * 仅在声明了 schema 且数据值不为 undefined 时执行校验。
 * 错误信息输出键名与失败路径原因，严禁包含实际数据值。
 *
 * @param key 配置项键名
 * @param value 待校验的具体数据值
 * @param item 配置项元数据定义
 */
export function validateConfigValue(
  key: string,
  value: unknown,
  item?: ConfigItemDefinition
): void {
  if (!item?.schema || value === undefined) {
    return;
  }

  const result = validateSchema(item.schema as JsonSchema, value);
  if (!result.valid) {
    const reasons = (result.errors || []).join("; ");
    throw new ActionDockError(
      CONFIG_VALUE_INVALID,
      `Configuration value for '${key}' failed schema validation: ${reasons}`,
      { key, errors: result.errors }
    );
  }
}
