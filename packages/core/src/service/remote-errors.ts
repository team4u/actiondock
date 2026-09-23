/**
 * 远端通信错误翻译层。
 *
 * 职责单一：将 profile/client 传输层抛出的底层异常翻译为统一的
 * 结构化异常，供 RemoteActionDockService 各操作边界复用；
 * 优先读取传输层透传的结构化错误码，无法识别时原样透传。
 */

import { ActionDockError, CAPABILITY_UNAVAILABLE, STATE_KEY_NOT_FOUND } from "../errors";
import {
  PROTOCOL_UNSUPPORTED,
  SERVICE_RESULT_UNKNOWN,
  ServiceError,
} from "./types";

/**
 * 将远端通信异常包装翻译为统一的异常。
 *
 * 无法识别的异常按防御与透明原则原样抛出，严禁静默吞没。
 */
export function wrapRemoteError(err: any): never {
  const code = err?.code || "";
  if (
    code === "CAPABILITY_UNAVAILABLE" ||
    code === "TARGET_CAPABILITY_UNAVAILABLE"
  ) {
    throw new ServiceError(
      CAPABILITY_UNAVAILABLE,
      `CAPABILITY_UNAVAILABLE: Management APIs are not enabled on remote service`,
      { originalMessage: err?.message }
    );
  }
  if (
    code === "PROTOCOL_UNSUPPORTED" ||
    code === "TARGET_PROTOCOL_UNSUPPORTED"
  ) {
    throw new ServiceError(
      PROTOCOL_UNSUPPORTED,
      `PROTOCOL_UNSUPPORTED: ${err?.message || ""}`,
      { originalMessage: err?.message }
    );
  }
  if (
    code === "SERVICE_RESULT_UNKNOWN" ||
    code === "TARGET_RESULT_UNKNOWN" ||
    code === "RESULT_UNKNOWN"
  ) {
    throw new ServiceError(
      SERVICE_RESULT_UNKNOWN,
      `SERVICE_RESULT_UNKNOWN: ${err?.message || ""}`,
      { originalMessage: err?.message }
    );
  }
  throw err;
}

/**
 * 判定远端状态键访问异常是否为键不存在。
 * 读取结构化错误码与 HTTP 状态码。
 */
export function isRemoteStateKeyNotFound(err: any): boolean {
  return err?.code === STATE_KEY_NOT_FOUND || err?.code === "NOT_FOUND" || err?.status === 404;
}
