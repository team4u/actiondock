import type { ConfigItemDefinition } from "../project/types";

/**
 * 检查指定配置项是否为敏感数据（密码、私钥、Token、密钥等）。
 * 
 * 判定逻辑：
 * 1. 若 actiondock.json 中显式声明了 `secret: true`，直接判定为敏感。
 * 2. 若未显式声明，使用正则探测包含 PASSWORD/SECRET/TOKEN/KEY/PASS/AUTH/CREDENTIAL/PRIVATE_KEY 的通用敏感命名特征。
 * 
 * @param key 配置键名
 * @param declaredItem 项目中声明的配置元数据（可选）
 */
export function isSecretConfigKey(
  key: string,
  declaredItem?: ConfigItemDefinition
): boolean {
  if (declaredItem?.secret === true) {
    return true;
  }
  // 匹配常见敏感词命名特征
  return /^(.*_)?(PASSWORD|SECRET|TOKEN|KEY|PASS|AUTH|CREDENTIAL|PRIVATE_KEY)(_.*)?$/i.test(key);
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
