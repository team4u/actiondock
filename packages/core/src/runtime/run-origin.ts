import type { RunOrigin } from "@actiondock/sdk";
import { ActionDockError, INVALID_ARGUMENT } from "../errors";

/**
 * 运行来源快照辅助函数（纯领域无副作用，单一事实源）。
 *
 * 仅安全提取 channel、viewName 与 authenticated 3个非秘密字段并冻结对象，
 * 严禁携带额外凭证或扩展字段，防范对象后续被篡改。
 * 若入参缺省则返回 undefined；非法来源严格校验报错，杜绝静默吞没。
 */
export function snapshotRunOrigin(origin?: unknown): RunOrigin | undefined {
  if (origin === undefined || origin === null) {
    return undefined;
  }
  if (typeof origin !== "object" || Array.isArray(origin)) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid run origin: expected an object"
    );
  }
  const raw = origin as Record<string, unknown>;
  const channel = raw.channel;
  if (channel !== "http" && channel !== "mcp") {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid run origin channel: expected 'http' or 'mcp'"
    );
  }
  const viewName = raw.viewName;
  if (typeof viewName !== "string" || viewName.length === 0) {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      "Invalid run origin viewName: expected a non-empty string"
    );
  }
  if (typeof raw.authenticated !== "boolean") {
    throw new ActionDockError(
      INVALID_ARGUMENT,
      `Invalid run origin authenticated: expected boolean, got '${typeof raw.authenticated}'`
    );
  }

  return Object.freeze({
    channel,
    viewName,
    authenticated: raw.authenticated,
  });
}
