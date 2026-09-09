import type { ConfigItemDefinition } from "../project/types";

/**
 * 检查指定配置项是否为敏感数据（密码、私钥、Token、密钥等）。
 * 
 * 判定逻辑：
 * 严格依据配置项元数据属性判定：若声明了 `secret: true`，直接判定为敏感数据；否则不视为敏感数据。
 * 不进行基于正则或键名的自动探测，由开发者显式配置驱动。
 * 
 * @param _key 配置键名（保留入参以兼容契约）
 * @param declaredItem 项目中声明的配置元数据（可选）
 */
export function isSecretConfigKey(
  _key?: string,
  declaredItem?: ConfigItemDefinition
): boolean {
  return declaredItem?.secret === true;
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
