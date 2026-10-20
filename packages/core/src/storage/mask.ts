import type { JsonValue } from "@actiondock/sdk";
import type { ConfigItemDefinition, ConfigValueSchema } from "../project/types";

/**
 * 递归检查 Schema 是否包含任何标记为 secret: true 的节点。
 */
function schemaHasSecret(schema?: ConfigValueSchema | boolean): boolean {
  if (!schema || typeof schema !== "object") {
    return false;
  }
  if (schema.secret === true) {
    return true;
  }
  if (schema.properties) {
    for (const propSchema of Object.values(schema.properties)) {
      if (schemaHasSecret(propSchema)) {
        return true;
      }
    }
  }
  if (schema.items && schemaHasSecret(schema.items)) {
    return true;
  }
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object" &&
    schemaHasSecret(schema.additionalProperties)
  ) {
    return true;
  }
  return false;
}

/**
 * 检查指定配置项是否为敏感数据（顶层 secret: true 或模式中嵌套 secret: true）。
 * 不进行基于正则或键名的自动探测，调用方若涉及模板应先解析具体声明项。
 * 
 * @param _key 配置键名（保留入参以兼容契约）
 * @param declaredItem 项目中声明的配置元数据（可选）
 */
export function isSecretConfigKey(
  _key?: string,
  declaredItem?: ConfigItemDefinition
): boolean {
  if (declaredItem?.secret === true) {
    return true;
  }
  if (declaredItem?.schema && schemaHasSecret(declaredItem.schema)) {
    return true;
  }
  return false;
}

/**
 * 对敏感数据的值进行掩码脱敏处理（返回 "********"）。
 * 
 * @param value 原始数据值
 * @returns 掩码脱敏后的安全展示字符串
 */
export function maskSecretValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return "********";
}

/**
 * 配置值脱敏安全视图产物。
 */
export interface RedactResult {
  /** 脱敏后的数据值（顶层敏感时为 undefined） */
  value: JsonValue | undefined;
  /** 是否包含敏感信息或发生了保守脱敏 */
  secret: boolean;
  /** 发生脱敏替换的字段路径集合（标准 JSON Pointer 格式） */
  redactedPaths: string[];
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isTypeMatch(val: unknown, expectedType: string | undefined): boolean {
  if (!expectedType) return true;
  switch (expectedType) {
    case "string":
      return typeof val === "string";
    case "number":
      return typeof val === "number" && Number.isFinite(val);
    case "integer":
      return typeof val === "number" && Number.isInteger(val);
    case "boolean":
      return typeof val === "boolean";
    case "array":
      return Array.isArray(val);
    case "object":
      return val !== null && typeof val === "object" && !Array.isArray(val);
    default:
      return true;
  }
}

interface NodeRedactInternal {
  value: JsonValue;
  redacted: boolean;
  paths: string[];
}

function redactNode(
  val: unknown,
  schema: ConfigValueSchema | undefined,
  path: string
): NodeRedactInternal {
  // 模式显式标记敏感节点：直接掩码并终止下钻
  if (schema?.secret === true) {
    return {
      value: "********",
      redacted: true,
      paths: [path],
    };
  }

  // 即使省略 type，结构关键字也不能让标量绕过子字段的秘密保护。
  const objectShape = schema?.properties !== undefined || schema?.additionalProperties !== undefined || schema?.required !== undefined;
  const arrayShape = schema?.items !== undefined;
  const incompatibleShape = !schema?.type && (objectShape || arrayShape) &&
    !(objectShape && val !== null && typeof val === "object" && !Array.isArray(val)) &&
    !(arrayShape && Array.isArray(val));
  // 结构与声明类型不符：保守隐藏该节点
  if (incompatibleShape || (schema?.type && !isTypeMatch(val, schema.type))) {
    return {
      value: "********",
      redacted: true,
      paths: [path],
    };
  }

  // 数组节点处理
  if (Array.isArray(val)) {
    const newArr: JsonValue[] = [];
    const childPaths: string[] = [];
    let childRedacted = false;

    if (schema?.items && typeof schema.items === "object") {
      for (let i = 0; i < val.length; i++) {
        const elemPath = path === "" ? `/${i}` : `${path}/${i}`;
        const res = redactNode(val[i], schema.items, elemPath);
        newArr.push(res.value);
        if (res.redacted) childRedacted = true;
        childPaths.push(...res.paths);
      }
    } else {
      // 数组按 items 遍历，无对应声明则元素隐藏
      for (let i = 0; i < val.length; i++) {
        const elemPath = path === "" ? `/${i}` : `${path}/${i}`;
        newArr.push("********");
        childPaths.push(elemPath);
      }
      if (val.length > 0) {
        childRedacted = true;
      }
    }

    return {
      value: newArr,
      redacted: childRedacted,
      paths: childPaths,
    };
  }

  // 普通对象节点处理
  if (val !== null && typeof val === "object") {
    const entries: Array<[string, JsonValue]> = [];
    const childPaths: string[] = [];
    let childRedacted = false;

    for (const k of Object.keys(val as Record<string, unknown>)) {
      const childVal = (val as Record<string, unknown>)[k];
      const token = escapePointerToken(k);
      const propPath = path === "" ? `/${token}` : `${path}/${token}`;

      if (schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, k)) {
        const res = redactNode(childVal, schema.properties[k], propPath);
        entries.push([k, res.value]);
        if (res.redacted) childRedacted = true;
        childPaths.push(...res.paths);
      } else if (schema?.additionalProperties && typeof schema.additionalProperties === "object") {
        // additionalProperties 声明为模式时继续递归
        const res = redactNode(childVal, schema.additionalProperties, propPath);
        entries.push([k, res.value]);
        if (res.redacted) childRedacted = true;
        childPaths.push(...res.paths);
      } else {
        // 对象未知属性值隐藏
        entries.push([k, "********"]);
        childRedacted = true;
        childPaths.push(propPath);
      }
    }

    return {
      value: Object.fromEntries(entries),
      redacted: childRedacted,
      paths: childPaths,
    };
  }

  // 标量基元节点
  return {
    value: val as JsonValue,
    redacted: false,
    paths: [],
  };
}

/**
 * 依据单项配置声明对配置值执行纯函数脱敏处理。
 *
 * @param value 待脱敏的配置原始数据值
 * @param item 对应的单项配置定义元数据
 */
export function redactConfigValue(
  value: unknown,
  item?: ConfigItemDefinition
): RedactResult {
  // 外层 secret: true 判定
  if (item?.secret === true) {
    if (value === undefined) {
      return { value: undefined, secret: true, redactedPaths: [] };
    }
    return { value: undefined, secret: true, redactedPaths: [""] };
  }

  // 未声明 schema 且非顶层 secret 维持旧行为
  if (!item?.schema) {
    return { value: value as JsonValue, secret: false, redactedPaths: [] };
  }

  // 数据值未配置时，不生成虚假脱敏路径，但反映声明敏感性
  if (value === undefined) {
    return {
      value: undefined,
      secret: schemaHasSecret(item.schema),
      redactedPaths: [],
    };
  }

  const res = redactNode(value, item.schema, "");
  const declarationHasSecret = schemaHasSecret(item.schema);
  const secret = declarationHasSecret || res.redacted;

  return {
    value: res.value,
    secret,
    redactedPaths: res.paths,
  };
}

function isAncestorPath(parent: string, child: string): boolean {
  return parent === "" ? child !== "" : child.startsWith(parent + "/");
}

/** 根据可信隐藏路径应用幂等掩码，绝不把远端提供的路径本身当成已脱敏的证据。 */
export function redactConfigValueAtPaths(value: unknown, paths: string[]): RedactResult {
  const hideRoot = (): RedactResult => ({ value: undefined, secret: true, redactedPaths: [""] });
  if (paths.some((path) => typeof path !== "string" || (path !== "" && (!path.startsWith("/") || /~(?![01])/.test(path))))) {
    return hideRoot();
  }
  if (paths.includes("")) return hideRoot();
  const unique = [...new Set(paths)];
  const minimal = unique.filter((path) => !unique.some((parent) => parent !== path && isAncestorPath(parent, path))).sort();
  const copy = structuredClone(value);
  for (const path of minimal) {
    const tokens = path.slice(1).split("/").map(unescapePointerToken);
    let node: any = copy;
    for (const token of tokens.slice(0, -1)) {
      if (node === null || typeof node !== "object") return hideRoot();
      if (!Object.hasOwn(node, token)) { node = undefined; break; }
      node = node[token];
    }
    if (node === undefined) continue;
    if (node === null || typeof node !== "object") return hideRoot();
    const leaf = tokens[tokens.length - 1];
    if (Object.hasOwn(node, leaf)) {
      Object.defineProperty(node, leaf, { value: "********", enumerable: true, writable: true, configurable: true });
    }
  }
  return { value: copy as JsonValue | undefined, secret: minimal.length > 0, redactedPaths: minimal };
}

/**
 * 依据跨包多重声明对配置值执行合并脱敏处理（取脱敏路径并集，祖先路径覆盖子路径）。
 *
 * @param value 待脱敏的配置原始数据值
 * @param items 各相关包分别解析得到的配置声明集合
 */
export function redactConfigValueForDeclarations(
  value: unknown,
  items: ConfigItemDefinition[]
): RedactResult {
  if (!items || items.length === 0) {
    return { value: value as JsonValue, secret: false, redactedPaths: [] };
  }

  // 任何声明要求整项敏感，直接隐藏整个根节点
  if (items.some((item) => item.secret === true)) {
    if (value === undefined) {
      return { value: undefined, secret: true, redactedPaths: [] };
    }
    return { value: undefined, secret: true, redactedPaths: [""] };
  }

  if (value === undefined) {
    const hasSecret = items.some((item) => isSecretConfigKey("", item));
    return { value: undefined, secret: hasSecret, redactedPaths: [] };
  }

  let anySecret = false;
  const allPaths = new Set<string>();

  for (const item of items) {
    const res = redactConfigValue(value, item);
    if (res.secret) {
      anySecret = true;
    }
    for (const p of res.redactedPaths) {
      allPaths.add(p);
    }
  }

  const merged = redactConfigValueAtPaths(value, [...allPaths]);
  return { ...merged, secret: anySecret || merged.secret };
}

function sanitizeSchemaNode(schema: ConfigValueSchema, inheritedSecret = false): ConfigValueSchema {
  const copy: ConfigValueSchema = { ...schema };
  const hidden = inheritedSecret || schema.secret === true;

  // 祖先枚举也可能携带子字段秘密，未知结构同样不可借约束回显。
  if (hidden || schemaHasSecret(schema) || schema.enum?.some((value) => redactNode(value, schema, "").redacted)) {
    delete copy.enum;
  }

  if (copy.properties) {
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties).map(([key, child]) => [key, sanitizeSchemaNode(child, hidden)])
    );
  }

  if (copy.additionalProperties && typeof copy.additionalProperties === "object") {
    copy.additionalProperties = sanitizeSchemaNode(copy.additionalProperties, hidden);
  }

  if (copy.items && typeof copy.items === "object") {
    copy.items = sanitizeSchemaNode(copy.items, hidden);
  }

  return copy;
}

/**
 * 对配置定义字典进行脱敏处理：
 * - 针对外层 secret: true 或嵌套包含敏感字段的项，剥离其 default 默认值，避免敏感默认值泄露或误用于执行；
 * - 针对模式中敏感节点的 enum 约束列表进行清洗，杜绝约束文本泄露秘密；
 * - 仅返回安全副本，严禁修改清单原始数据。
 *
 * @param config 声明的配置定义字典
 */
export function sanitizeConfigDefinitions(
  config?: Record<string, ConfigItemDefinition>
): Record<string, ConfigItemDefinition> | undefined {
  if (!config) return config;
  return Object.fromEntries(Object.entries(config).map(([key, item]) => {
    if (!item) return [key, item];
    const copy: ConfigItemDefinition = { ...item };
    if (isSecretConfigKey(key, item) || redactConfigValue(item.default, item).redactedPaths.length > 0) {
      delete copy.default;
    }
    if (copy.schema) {
      copy.schema = sanitizeSchemaNode(copy.schema, copy.secret === true);
    }
    return [key, copy];
  }));
}
