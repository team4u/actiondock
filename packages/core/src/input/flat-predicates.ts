/**
 * 属性名与路径谓词定义。
 *
 * 职责：
 * - 提供扁平入参路径属性名与全局禁止属性名的校验谓词。
 * - 作为输入解析器与编码顾问共享的属性安全判定单一事实源。
 */

const FLAT_PATH_PROPERTY_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const FORBIDDEN_PROPERTY_SET = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * 全局禁止的 Action 输入属性名只读列表。
 */
export const FORBIDDEN_ACTION_INPUT_PROPERTIES = Object.freeze([
  "__proto__",
  "constructor",
  "prototype",
] as const);

/**
 * 校验属性名是否符合扁平路径段命名规范。
 * 规范：必须以英文字母或下划线开头，仅包含英文字母、数字、下划线与中划线。
 *
 * @param key 待校验的属性名
 * @returns 是否符合扁平路径段规范
 */
export function isFlatPathPropertyName(key: string): boolean {
  return FLAT_PATH_PROPERTY_NAME_REGEX.test(key);
}

/**
 * 判定属性名是否属于全局禁止的 Action 输入危险属性名。
 * 禁止属性：__proto__、constructor、prototype。
 *
 * @param key 待判定的属性名
 * @returns 是否属于禁止属性
 */
export function isForbiddenActionInputPropertyName(key: string): boolean {
  return FORBIDDEN_PROPERTY_SET.has(key);
}

/**
 * 判定属性名是否既符合扁平路径段规范且不属于禁止属性。
 *
 * @param key 待判定的属性名
 * @returns 是否为扁平安全的属性名
 */
export function isFlatSafePropertyName(key: string): boolean {
  return isFlatPathPropertyName(key) && !isForbiddenActionInputPropertyName(key);
}
