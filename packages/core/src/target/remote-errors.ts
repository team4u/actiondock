/**
 * 远端通信错误翻译层。
 *
 * 职责单一：将 profile/client 传输层抛出的底层异常翻译为统一的
 * TargetError 结构化异常，供 RemoteActionDockTarget 各操作边界复用；
 * 优先读取传输层透传的结构化错误码，无法识别时原样透传。
 */

import { STATE_KEY_NOT_FOUND } from "../errors";
import {
  TARGET_CAPABILITY_UNAVAILABLE,
  TARGET_PROTOCOL_UNSUPPORTED,
  TARGET_RESULT_UNKNOWN,
  TargetError,
} from "./types";

/**
 * 将远端通信异常包装翻译为统一的 TargetError。
 *
 * 无法识别的异常按防御与透明原则原样抛出，严禁静默吞没。
 */
export function wrapRemoteError(err: any): never {
  const msg = String(err?.message || "");
  const code = err?.code || "";
  if (
    code === "CAPABILITY_UNAVAILABLE" ||
    code === "TARGET_CAPABILITY_UNAVAILABLE" ||
    msg.includes("CAPABILITY_UNAVAILABLE") ||
    msg.includes("TARGET_CAPABILITY_UNAVAILABLE") ||
    msg.includes("Management APIs are not enabled")
  ) {
    throw new TargetError(
      TARGET_CAPABILITY_UNAVAILABLE,
      `TARGET_CAPABILITY_UNAVAILABLE: Management APIs are not enabled on remote target`,
      { originalMessage: msg }
    );
  }
  if (
    code === "PROTOCOL_UNSUPPORTED" ||
    code === "TARGET_PROTOCOL_UNSUPPORTED" ||
    msg.includes("PROTOCOL_UNSUPPORTED") ||
    msg.includes("TARGET_PROTOCOL_UNSUPPORTED")
  ) {
    throw new TargetError(
      TARGET_PROTOCOL_UNSUPPORTED,
      `TARGET_PROTOCOL_UNSUPPORTED: ${msg}`,
      { originalMessage: msg }
    );
  }
  if (
    code === "TARGET_RESULT_UNKNOWN" ||
    code === "RESULT_UNKNOWN" ||
    msg.includes("TARGET_RESULT_UNKNOWN")
  ) {
    throw new TargetError(
      TARGET_RESULT_UNKNOWN,
      `TARGET_RESULT_UNKNOWN: ${msg}`,
      { originalMessage: msg }
    );
  }
  throw err;
}

/**
 * 判定远端状态键访问异常是否为键不存在。
 *
 * 优先读取传输层透传的结构化错误码（fetchRemoteJson 会将响应体 error.code
 * 附加到抛出异常的 code 字段），仅当旧版服务器未透传 code 时回退到
 * HTTP 状态与消息文本兼容嗅探。
 */
export function isRemoteStateKeyNotFound(err: any): boolean {
  if (err?.code === STATE_KEY_NOT_FOUND) {
    return true;
  }
  const msg = String(err?.message || "");
  return err?.status === 404 || msg.includes("404") || msg.includes("not found");
}
