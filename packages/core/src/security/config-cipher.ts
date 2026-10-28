import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ActionDockError, CONFIG_DECRYPT_FAILED, CONFIG_ENCRYPTION_ERROR } from "../errors";
import { parseJsonWithoutDuplicates } from "../project/digest";
import { validateJsonValue } from "../value-validator";

/** 密文信封统一前缀，任何以该前缀起始的存储值都按密文处理 */
const ENVELOPE_PREFIX = "adenc:";

/** 当前支持的密文格式版本 */
const CURRENT_VERSION = "v1";

/** AES-256-GCM 密钥字节长度 */
const KEY_BYTES = 32;

/** AES-GCM 随机初始向量字节长度 */
const IV_BYTES = 12;

/** AES-GCM 认证标签字节长度 */
const AUTH_TAG_BYTES = 16;

/** 密钥指纹的规范形式：64 位十六进制字符（SHA-256 摘要） */
const KEY_ID_PATTERN = /^[0-9a-f]{64}$/;

/** 密文信封整体规范形式：版本段、指纹段与未填充 base64url 负载段 */
const ENVELOPE_PATTERN = /^adenc:(v[0-9]+):([0-9a-f]{64}):([A-Za-z0-9_-]+)$/;

/** 未填充 base64url 字符集（RFC 4648 第 5 节） */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 序列化递归深度上限，与 canonical JSON 校验单一事实源的最大深度保持一致 */
const MAX_SERIALIZE_DEPTH = 512;

/**
 * 配置加密密钥材料。
 *
 * key 为 32 字节 AES-256 原始密钥；id 为密钥的稳定非敏感指纹
 * （由 configKeyId 计算），随密文信封持久化，用于存储域密钥身份校验。
 */
export interface ConfigEncryptionKey {
  /** 32 字节 AES-256 原始密钥材料 */
  key: Uint8Array;
  /** 密钥的 SHA-256 十六进制指纹（非敏感，可持久化） */
  id: string;
}

/**
 * 配置加密密钥提供器。
 *
 * create 为 true 时允许在缺失时生成并持久化本地密钥与身份标记；
 * 为 false 时绝不生成任何密钥或标记，缺失即抛出 CONFIG_ENCRYPTION_ERROR。
 * 同一提供器实例在首次成功加载后缓存材料，后续调用不再读取环境或文件。
 */
export type ConfigKeyProvider = (create: boolean) => ConfigEncryptionKey;

/**
 * 计算加密密钥的稳定非敏感指纹。
 *
 * 输出为密钥字节 SHA-256 摘要的 64 位小写十六进制字符串（256 位熵的指纹），
 * 可安全持久化与打印，不会泄露密钥材料本身。
 */
export function configKeyId(key: Uint8Array): string {
  if (!(key instanceof Uint8Array) || key.byteLength === 0) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      "Cannot compute config key id: key material must be a non-empty Uint8Array"
    );
  }
  return createHash("sha256").update(key).digest("hex");
}

/**
 * 判定存储值是否为加密信封。
 *
 * 识别任何 adenc: 前缀（含未知版本），调用方必须将命中值交给
 * decryptConfigValue 严格解密；未知版本会在解密时明确报错，绝不降级为明文。
 */
export function isEncryptedConfigValue(raw: string): boolean {
  return typeof raw === "string" && raw.startsWith(ENVELOPE_PREFIX);
}

/**
 * 构造 AES-GCM 附加认证数据。
 *
 * 以 JSON 数组序列化无歧义绑定格式版本、密钥指纹、配置域与配置键，
 * 防止 scope 或 key 含分隔符时的拼接歧义，阻止跨域跨键的密文挪用。
 */
function buildAdditionalAuthenticatedData(
  version: string,
  id: string,
  scope: string,
  key: string
): Buffer {
  return Buffer.from(JSON.stringify([`${ENVELOPE_PREFIX}${version}`, id, scope, key]), "utf8");
}

/**
 * 校验并规范化密钥材料。
 *
 * 要求 key 恰为 32 字节，id 为规范指纹且与 key 实际指纹一致，
 * 身份不符时立即拒绝，防止用错误身份写出无法解密的密文。
 */
function normalizeMaterial(material: ConfigEncryptionKey): { keyBytes: Buffer; id: string } {
  if (material === null || typeof material !== "object") {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      "Invalid config encryption material: expected ConfigEncryptionKey object"
    );
  }
  const { key, id } = material;
  if (!(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Invalid config encryption key: expected ${KEY_BYTES} bytes, got ${
        key instanceof Uint8Array ? key.byteLength : typeof key
      }`
    );
  }
  if (typeof id !== "string" || !KEY_ID_PATTERN.test(id)) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      "Invalid config encryption key id: expected 64 lowercase hex characters"
    );
  }
  if (configKeyId(key) !== id) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      "Config encryption key id does not match key material fingerprint"
    );
  }
  return { keyBytes: Buffer.from(key.buffer, key.byteOffset, key.byteLength), id };
}

/**
 * 校验配置域与配置键参数。
 */
function assertBindingFields(scope: string, key: string): void {
  if (typeof scope !== "string" || scope.length === 0) {
    throw new ActionDockError(CONFIG_ENCRYPTION_ERROR, "Config encryption scope must be a non-empty string");
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new ActionDockError(CONFIG_ENCRYPTION_ERROR, "Config encryption key name must be a non-empty string");
  }
}

/**
 * 严格校验并序列化配置值。
 *
 * 复用 validateJsonValue 作为 canonical JSON 规则的单一事实源：拒绝
 * undefined、函数、符号、BigInt、非有限数值、访问器属性（仅检查描述符，
 * 绝不执行 getter）、非枚举属性、Symbol 键、稀疏数组、非 plain 对象
 * （Date、Map 等）、循环引用与超深嵌套，保证密文解密后能够精确还原。
 * 校验失败只携带固定文案与机器可读的校验错误码，不携带 validator 的
 * reason/path（两者可能嵌入用户对象抛出的异常内容），杜绝秘密外带。
 */
function serializeConfigValue(value: unknown, scope: string, key: string): string {
  const validation = validateJsonValue(value, { maxDepth: MAX_SERIALIZE_DEPTH });
  if (!validation.valid) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config value for key '${key}' in scope '${scope}' is not strictly JSON serializable`,
      { scope, key, code: validation.code }
    );
  }
  try {
    return JSON.stringify(value);
  } catch {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config value for key '${key}' in scope '${scope}' is not strictly JSON serializable`,
      { scope, key }
    );
  }
}

/**
 * 加密单个配置值并返回规范密文信封。
 *
 * 信封格式：adenc:v1:<keyId>:<base64url(iv|ciphertext|authTag)>。
 * 使用 AES-256-GCM 与随机 12 字节初始向量，认证数据无歧义绑定
 * 格式版本、密钥指纹、配置域 scope 与配置键 key。
 * 值必须严格 canonical JSON 可序列化（复用 validateJsonValue 单一事实源），
 * 任何不可精确往返的输入都会抛出 CONFIG_ENCRYPTION_ERROR，错误信息与
 * details 不包含值本身、校验器 reason/path 或密钥材料。
 */
export function encryptConfigValue(
  value: unknown,
  scope: string,
  key: string,
  material: ConfigEncryptionKey
): string {
  assertBindingFields(scope, key);
  const { keyBytes, id } = normalizeMaterial(material);

  const plaintext = serializeConfigValue(value, scope, key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(buildAdditionalAuthenticatedData(CURRENT_VERSION, id, scope, key));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, ciphertext, authTag]).toString("base64url");
  return `${ENVELOPE_PREFIX}${CURRENT_VERSION}:${id}:${payload}`;
}

/**
 * 严格解密 encryptConfigValue 产生的密文信封并返回原始值。
 *
 * 拒绝一切不规范输入：未知版本、非规范指纹、非规范或非未填充的
 * base64url、负载截断、密钥身份不符、认证校验失败与非法 JSON 负载，
 * 全部抛出 CONFIG_DECRYPT_FAILED，绝不将密文降级当作明文返回。
 * 错误信息不包含明文片段、密文负载或密钥材料。
 */
export function decryptConfigValue(
  ciphertext: string,
  scope: string,
  key: string,
  material: ConfigEncryptionKey
): unknown {
  assertBindingFields(scope, key);
  const { keyBytes, id } = normalizeMaterial(material);

  if (typeof ciphertext !== "string" || !ciphertext.startsWith(ENVELOPE_PREFIX)) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Stored config value for key '${key}' in scope '${scope}' is not an encrypted envelope`,
      { scope, key }
    );
  }
  const match = ciphertext.match(ENVELOPE_PATTERN);
  if (!match) {
    const rest = ciphertext.slice(ENVELOPE_PREFIX.length);
    const colon = rest.indexOf(":");
    const version = colon === -1 ? rest : rest.slice(0, colon);
    if (/^v[0-9]+$/.test(version) && version !== CURRENT_VERSION) {
      throw new ActionDockError(
        CONFIG_DECRYPT_FAILED,
        `Encrypted config envelope version '${version}' is not supported (expected '${CURRENT_VERSION}')`,
        { scope, key, version }
      );
    }
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Encrypted config envelope for key '${key}' in scope '${scope}' is malformed`,
      { scope, key }
    );
  }
  const [, version, envelopeId, payload] = match;
  if (version !== CURRENT_VERSION) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Encrypted config envelope version '${version}' is not supported (expected '${CURRENT_VERSION}')`,
      { scope, key, version }
    );
  }
  if (envelopeId !== id) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Encrypted config envelope for key '${key}' in scope '${scope}' was written with a different key identity`,
      { scope, key, envelopeKeyId: envelopeId }
    );
  }
  if (!BASE64URL_PATTERN.test(payload)) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Encrypted config envelope payload for key '${key}' in scope '${scope}' is not canonical base64url`,
      { scope, key }
    );
  }
  const raw = Buffer.from(payload, "base64url");
  if (raw.byteLength < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Encrypted config envelope payload for key '${key}' in scope '${scope}' is truncated`,
      { scope, key }
    );
  }
  if (raw.toString("base64url") !== payload) {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Encrypted config envelope payload for key '${key}' in scope '${scope}' is not canonical base64url`,
      { scope, key }
    );
  }

  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(raw.byteLength - AUTH_TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES, raw.byteLength - AUTH_TAG_BYTES);
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(buildAdditionalAuthenticatedData(version, envelopeId, scope, key));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Decryption of config value for key '${key}' in scope '${scope}' failed authentication`,
      { scope, key }
    );
  }

  try {
    return parseJsonWithoutDuplicates(plaintext.toString("utf8"));
  } catch {
    throw new ActionDockError(
      CONFIG_DECRYPT_FAILED,
      `Decrypted config payload for key '${key}' in scope '${scope}' is not valid JSON`,
      { scope, key }
    );
  }
}
