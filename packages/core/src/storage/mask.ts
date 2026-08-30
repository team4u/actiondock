import type { ConfigItemDefinition } from "../project/types";

/**
 * Checks whether a configuration key represents a sensitive secret (API key, password, token, etc.)
 */
export function isSecretConfigKey(
  key: string,
  declaredItem?: ConfigItemDefinition
): boolean {
  if (declaredItem?.secret === true) {
    return true;
  }
  // Check common secret naming patterns
  return /^(.*_)?(PASSWORD|SECRET|TOKEN|KEY|PASS|AUTH|CREDENTIAL|PRIVATE_KEY)(_.*)?$/i.test(key);
}

/**
 * Mask a secret value for safe display in logs and CLI outputs.
 */
export function maskSecretValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return "********";
}
