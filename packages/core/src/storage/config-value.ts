import { ActionDockError, CONFIG_DECRYPT_FAILED } from "../errors";
import type { ConfigItemDefinition, ConfigValueSchema } from "../project/types";
import {
  type ConfigEncryptionKey,
  decryptConfigValue,
  encryptConfigValue,
} from "../security/config-cipher";
import { isSecretConfigKey } from "./mask";

/**
 * 密文行内部负载信封：业务值与历史保护声明一同加密。
 *
 * 历史保护声明仅保留脱敏所需的结构/类型/secret 信息，供当前声明
 * 弱化后的管理视图脱敏兜底；业务值透明解密后原样返回。
 *
 * 本模块是密文信封编码与保护声明清洗的单一事实源：正常写入路径
 * （SqliteConfigStore）与版本迁移路径（migrations/v2-to-v3）共用，
 * 禁止任何一侧复制 envelope 或保护清洗逻辑。
 */
export interface ConfigValueEnvelope {
  value: unknown;
  protection: ConfigItemDefinition[];
}

/**
 * 对保护声明递归剥离脱敏无关信息。
 *
 * 仅保留结构（properties/additionalProperties/items）、类型与 secret
 * 标记；严禁把 default、enum、env、description 等可能携带值的内容
 * 写入保护元数据，即使信封整体已加密也保持最小化。
 */
function sanitizeProtectionSchema(schema: ConfigValueSchema): ConfigValueSchema {
  const copy: ConfigValueSchema = {};
  if (schema.type !== undefined) copy.type = schema.type;
  if (schema.secret !== undefined) copy.secret = schema.secret;
  if (schema.properties) {
    copy.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, child]) => [
        name,
        sanitizeProtectionSchema(child),
      ])
    );
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === "object") {
    copy.additionalProperties = sanitizeProtectionSchema(schema.additionalProperties);
  }
  if (schema.items !== undefined && typeof schema.items === "object") {
    copy.items = sanitizeProtectionSchema(schema.items);
  }
  return copy;
}

/** 对单条保护声明剥离脱敏无关字段（保留 secret/type/schema 结构信息）。 */
function sanitizeProtectionDeclaration(item: ConfigItemDefinition): ConfigItemDefinition {
  const copy: ConfigItemDefinition = {};
  if (item.secret !== undefined) copy.secret = item.secret;
  if (item.type !== undefined) copy.type = item.type;
  if (item.schema) copy.schema = sanitizeProtectionSchema(item.schema);
  return copy;
}

/**
 * 合并历史保护声明与当前敏感声明，绝不弱化保护强度。
 *
 * - 以规范化 JSON 作为去重标识，防止重复写入导致保护数组无界增长；
 * - 当前声明中仅并入判定敏感的条目（非敏感声明不产生历史保护义务）；
 * - 合并结果为空时保守回退为整项敏感，保证密文行始终有脱敏依据。
 */
export function mergeProtectionDeclarations(
  stored: readonly ConfigItemDefinition[] | undefined,
  current: readonly ConfigItemDefinition[],
  key: string
): ConfigItemDefinition[] {
  const merged: ConfigItemDefinition[] = [];
  const seen = new Set<string>();
  const push = (item: ConfigItemDefinition): void => {
    const sanitized = sanitizeProtectionDeclaration(item);
    const identity = JSON.stringify(sanitized);
    if (!seen.has(identity)) {
      seen.add(identity);
      merged.push(sanitized);
    }
  };
  for (const item of stored ?? []) {
    push(item);
  }
  for (const item of current) {
    if (isSecretConfigKey(key, item)) {
      push(item);
    }
  }
  if (merged.length === 0) {
    merged.push({ secret: true });
  }
  return merged;
}

/** 加密业务值与保护声明构成的完整信封，返回规范密文信封字符串。 */
export function encryptConfigEnvelope(
  value: unknown,
  protection: readonly ConfigItemDefinition[],
  scope: string,
  key: string,
  material: ConfigEncryptionKey
): string {
  const envelope: ConfigValueEnvelope = { value, protection: [...protection] };
  return encryptConfigValue(envelope, scope, key, material);
}

/**
 * 严格解密密文信封并校验负载形态。
 *
 * 信封负载必须为含 value 属性的对象；protection 省略或为声明对象数组。
 * 任何不合规输入抛 CONFIG_DECRYPT_FAILED，绝不把密文降级当作明文返回。
 */
export function decryptConfigEnvelope(
  ciphertext: string,
  scope: string,
  key: string,
  material: ConfigEncryptionKey
): ConfigValueEnvelope {
  const payload = decryptConfigValue(ciphertext, scope, key, material);
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Object.prototype.hasOwnProperty.call(payload, "value")
  ) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Decrypted config payload for key '${key}' in scope '${scope}' is not a valid protection envelope`,
      { scope, key }
    );
  }
  const envelope = payload as { value: unknown; protection?: unknown };
  if (
    envelope.protection !== undefined &&
    (!Array.isArray(envelope.protection) ||
      envelope.protection.some((item) => item === null || typeof item !== "object"))
  ) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Decrypted protection metadata for config key '${key}' in scope '${scope}' is malformed`,
      { scope, key }
    );
  }
  return {
    value: envelope.value,
    protection: (envelope.protection as ConfigItemDefinition[] | undefined) ?? [],
  };
}
