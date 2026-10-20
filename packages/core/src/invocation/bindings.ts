import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ActionDockError,
  INVALID_ACTION_REF,
  INVALID_ARGUMENT,
  INVALID_JSON,
  NOT_FOUND,
} from "../errors";
import { parseActionRef } from "../catalog/resolve-action";
import { PACKAGE_ID_REGEX } from "../utils";
import { ACTION_ID_REGEX } from "../project/manifest";

/**
 * 动作绑定目标描述。
 */
export type ActionBindingTarget =
  | { type: "local" }
  | { type: "remote"; profile: string };

/**
 * 动作命名绑定字典单一事实源类型。
 */
export type ActionBindings = Readonly<
  Record<string, Readonly<Record<string, ActionBindingTarget>>>
>;

/** 绑定文件名与目录常量 */
export const BINDINGS_DIR_NAME = ".actiondock";
export const BINDINGS_FILE_NAME = "bindings.json";

/** 绑定名称正则约束（稳定简单标识符） */
export const ACTION_BINDING_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** 环境配置名称正则约束 */
export const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

/** 空冻结绑定快照单一事实源 */
const EMPTY_ACTION_BINDINGS: ActionBindings = Object.freeze(
  Object.create(null)
) as ActionBindings;

/**
 * 校验并规范化完全限定的动作引用字符串。
 * 铁律：必须为完全限定包与动作，禁止通配符、路径逃逸、空白与冒号。
 */
export function validateCanonicalActionRef(ref: unknown): string {
  if (typeof ref !== "string") {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      "Invalid action reference: must be a string"
    );
  }

  if (ref.length === 0 || /\s/.test(ref)) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action reference '${ref}': cannot be empty or contain whitespace`
    );
  }

  if (ref.includes(":")) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action reference '${ref}': colon syntax is not permitted, use '/'`
    );
  }

  if (ref.includes("*") || ref.includes("?")) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action reference '${ref}': wildcards are not permitted`
    );
  }

  if (ref.includes("..")) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action reference '${ref}': path traversal is not permitted`
    );
  }

  if (!ref.includes("/")) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action reference '${ref}': must be fully qualified with package and action (e.g. 'pkg/action')`
    );
  }

  const parsed = parseActionRef(ref);

  if (!parsed.packageId || !parsed.actionId) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action reference '${ref}': must be fully qualified with package and action`
    );
  }

  const isScoped = /^@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(parsed.packageId);
  if (!PACKAGE_ID_REGEX.test(parsed.packageId) && !isScoped) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid package ID '${parsed.packageId}' in action reference '${ref}'`
    );
  }

  if (!ACTION_ID_REGEX.test(parsed.actionId)) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid action ID '${parsed.actionId}' in action reference '${ref}'`
    );
  }

  return `${parsed.packageId}/${parsed.actionId}`;
}

/**
 * 校验绑定名称合法性。
 */
export function validateBindingName(name: unknown, actionRef?: string): string {
  if (typeof name !== "string") {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid binding name: must be a string"
    );
  }

  if (name.length === 0 || /\s/.test(name)) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Invalid binding name '${name}': cannot be empty or contain whitespace`
    );
  }

  if (name === "__proto__" || name === "constructor" || name === "prototype") {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Invalid binding name '${name}': prototype property names are forbidden`
    );
  }

  if (!ACTION_BINDING_NAME_REGEX.test(name)) {
    const actionMsg = actionRef ? ` for action '${actionRef}'` : "";
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Invalid binding name '${name}'${actionMsg}: must match ${ACTION_BINDING_NAME_REGEX}`
    );
  }

  return name;
}

/**
 * 校验单个绑定目标对象的合法性并返回深拷贝冻结快照。
 */
export function validateBindingTarget(
  target: unknown,
  bindingName: string,
  actionRef: string
): ActionBindingTarget {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Invalid binding target for action '${actionRef}' binding '${bindingName}': expected a JSON object`
    );
  }

  if (!Object.prototype.hasOwnProperty.call(target, "type")) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Missing 'type' in binding '${bindingName}' for action '${actionRef}'`
    );
  }

  const keys = Object.keys(target);
  const type = (target as { type?: unknown }).type;

  if (type === "local") {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
      if (key !== "type") {
        throw new ActionDockError(
          INVALID_ARGUMENT,
          `Invalid property '${key}' in local binding '${bindingName}' for action '${actionRef}': local targets do not permit extra properties`
        );
      }
    }
    return Object.freeze({ type: "local" });
  }

  if (type === "remote") {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
      if (key !== "type" && key !== "profile") {
        throw new ActionDockError(
          INVALID_ARGUMENT,
          `Invalid property '${key}' in remote binding '${bindingName}' for action '${actionRef}': remote targets only permit 'type' and 'profile'`
        );
      }
    }

    if (!Object.prototype.hasOwnProperty.call(target, "profile")) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Missing 'profile' in remote binding '${bindingName}' for action '${actionRef}'`
      );
    }

    const profile = (target as { profile?: unknown }).profile;
    if (
      typeof profile !== "string" ||
      profile.length === 0 ||
      /\s/.test(profile) ||
      !PROFILE_NAME_REGEX.test(profile)
    ) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Invalid profile '${String(profile)}' in remote binding '${bindingName}' for action '${actionRef}': profile must be non-empty and cannot contain whitespace`
      );
    }

    return Object.freeze({ type: "remote", profile });
  }

  throw new ActionDockError(
    INVALID_ARGUMENT,
    `Invalid target type '${String(type)}' in binding '${bindingName}' for action '${actionRef}': expected 'local' or 'remote'`
  );
}

/**
 * 校验并深拷贝冻结动作绑定配置快照。
 */
export function validateActionBindings(value: unknown): ActionBindings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid action bindings: expected a JSON object"
    );
  }

  const result: Record<string, Record<string, ActionBindingTarget>> = Object.create(null);

  for (const rawRef of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(value, rawRef)) {
      continue;
    }

    const canonicalRef = validateCanonicalActionRef(rawRef);
    const rawGroup = (value as Record<string, unknown>)[rawRef];

    if (rawGroup === null || typeof rawGroup !== "object" || Array.isArray(rawGroup)) {
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Invalid bindings group for action '${canonicalRef}': expected a JSON object`
      );
    }

    const group: Record<string, ActionBindingTarget> = Object.create(null);

    for (const rawBindingName of Object.keys(rawGroup)) {
      if (!Object.prototype.hasOwnProperty.call(rawGroup, rawBindingName)) {
        continue;
      }

      const bindingName = validateBindingName(rawBindingName, canonicalRef);
      const rawTarget = (rawGroup as Record<string, unknown>)[rawBindingName];
      const target = validateBindingTarget(rawTarget, bindingName, canonicalRef);

      group[bindingName] = target;
    }

    result[canonicalRef] = Object.freeze(group);
  }

  return Object.freeze(result) as ActionBindings;
}

/**
 * 从调用方项目目录读取动作绑定配置。
 * 若文件不存在则返回空冻结映射，其余 IO 或 JSON 异常统一转换为 ActionDockError 透传。
 */
export function loadActionBindings(projectRoot: string): ActionBindings {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid projectRoot: must be a non-empty string"
    );
  }

  const filePath = join(projectRoot, BINDINGS_DIR_NAME, BINDINGS_FILE_NAME);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return EMPTY_ACTION_BINDINGS;
    }
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Failed to read action bindings at ${filePath}: ${err.message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new ActionDockError(
      INVALID_JSON,
      `Failed to parse action bindings JSON at ${filePath}: ${err.message}`
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Invalid action bindings format in ${filePath}: expected a JSON object`
    );
  }

  const rootKeys = Object.keys(parsed);
  for (const key of rootKeys) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      continue;
    }
    if (key === "bindings") {
      continue;
    }
    if (key === "schemaVersion") {
      const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
      if (v !== 1) {
        throw new ActionDockError(
          INVALID_ARGUMENT,
          `Invalid schemaVersion '${String(v)}' in ${filePath}: only schemaVersion 1 is supported`
        );
      }
      continue;
    }
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Unknown property '${key}' in ${filePath}: only 'bindings' is allowed`
    );
  }

  if (!Object.prototype.hasOwnProperty.call(parsed, "bindings")) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Missing 'bindings' property in ${filePath}`
    );
  }

  return validateActionBindings((parsed as { bindings?: unknown }).bindings);
}

/**
 * 解析目标动作引用在当前项目中的具体绑定。
 * 未显式传入 binding 则仅检索 default；若 default 亦不存在则返回 undefined。
 * 若显式传入的 binding 不存在，抛出 ActionDockError(NOT_FOUND) 并在 details 中携带 action 与 binding。
 */
export function resolveActionBinding(
  bindings: ActionBindings,
  ref: string,
  binding?: string
): ActionBindingTarget | undefined {
  const canonicalRef = validateCanonicalActionRef(ref);

  const group =
    bindings &&
    typeof bindings === "object" &&
    Object.prototype.hasOwnProperty.call(bindings, canonicalRef)
      ? bindings[canonicalRef]
      : undefined;

  if (binding === undefined) {
    if (!group) {
      return undefined;
    }
    return Object.prototype.hasOwnProperty.call(group, "default")
      ? group["default"]
      : undefined;
  }

  if (!group || !Object.prototype.hasOwnProperty.call(group, binding)) {
    throw new ActionDockError(
      NOT_FOUND,
      `Action binding '${binding}' not found for action '${canonicalRef}'`,
      { action: canonicalRef, binding }
    );
  }

  return group[binding];
}

/**
 * 检测指定动作是否存在任意 remote 类型的命名绑定。
 * 仅做完全限定精确匹配，供构建工具快速识别可外置的跨节点依赖。
 */
export function hasRemoteActionBinding(
  bindings: ActionBindings,
  ref: string
): boolean {
  const canonicalRef = validateCanonicalActionRef(ref);

  if (!bindings || typeof bindings !== "object") {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(bindings, canonicalRef)) {
    return false;
  }

  const group = bindings[canonicalRef];
  if (!group || typeof group !== "object") {
    return false;
  }

  for (const name of Object.keys(group)) {
    if (!Object.prototype.hasOwnProperty.call(group, name)) {
      continue;
    }
    const target = group[name];
    if (target?.type === "remote") {
      return true;
    }
  }

  return false;
}
