import { INVALID_CURSOR, ProcessError } from "../errors";

/**
 * 已解析的不透明游标完整载荷。
 */
export interface ParsedCursor {
  /** 宿主纪元标识 */
  hostEpoch: string;
  /** 受管进程标识 */
  processId: string;
  /** 日志记录全局单调自增序号 */
  sequence: number;
  /** 记录内字节偏移量 */
  offset: number;
}

/**
 * 游标逻辑位置坐标。
 */
export interface CursorPosition {
  /** 日志记录全局单调自增序号 */
  sequence: number;
  /** 记录内字节偏移量 */
  offset: number;
}

function toBase64Url(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(base64url: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64url, "base64url").toString("utf8");
  }
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * 将内部字段编码为外部不透明游标字符串。
 *
 * 规范约束：
 * - 宿主纪元标识与进程标识必须为非空字符串。
 * - 序号与偏移量必须为非负整数。
 * - 游标对外表现为不透明字符串，调用方严禁假定其格式或拆解字段。
 */
export function encodeCursor(
  hostEpoch: string,
  processId: string,
  sequence: number,
  offset: number
): string {
  if (!hostEpoch || typeof hostEpoch !== "string") {
    throw new ProcessError(INVALID_CURSOR, "Host epoch must be a non-empty string", { hostEpoch });
  }
  if (!processId || typeof processId !== "string") {
    throw new ProcessError(INVALID_CURSOR, "Process ID must be a non-empty string", { processId });
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new ProcessError(INVALID_CURSOR, "Sequence must be a non-negative integer", { sequence });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ProcessError(INVALID_CURSOR, "Offset must be a non-negative integer", { offset });
  }

  const payload = JSON.stringify({
    v: 1,
    e: hostEpoch,
    p: processId,
    s: sequence,
    o: offset,
  });

  return `cur_${toBase64Url(payload)}`;
}

/**
 * 解析不透明游标原始载荷。
 *
 * 遇到格式损坏、非法字段或无法解析的游标均抛出 INVALID_CURSOR 异常。
 */
export function decodeCursor(cursorStr: string): ParsedCursor {
  if (typeof cursorStr !== "string" || cursorStr.trim() === "") {
    throw new ProcessError(INVALID_CURSOR, "Cursor must be a non-empty string", { cursor: cursorStr });
  }

  const raw = cursorStr.startsWith("cur_") ? cursorStr.slice(4) : cursorStr;
  let decodedStr: string;
  try {
    decodedStr = fromBase64Url(raw);
  } catch (err) {
    throw new ProcessError(INVALID_CURSOR, "Failed to decode cursor base64url payload", {
      cursor: cursorStr,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedStr);
  } catch (err) {
    throw new ProcessError(INVALID_CURSOR, "Failed to parse cursor JSON payload", {
      cursor: cursorStr,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as any).e !== "string" ||
    typeof (parsed as any).p !== "string" ||
    !Number.isInteger((parsed as any).s) ||
    (parsed as any).s < 0 ||
    !Number.isInteger((parsed as any).o) ||
    (parsed as any).o < 0
  ) {
    throw new ProcessError(INVALID_CURSOR, "Malformed cursor structure", { cursor: cursorStr });
  }

  return {
    hostEpoch: (parsed as any).e,
    processId: (parsed as any).p,
    sequence: (parsed as any).s,
    offset: (parsed as any).o,
  };
}

/**
 * 校验并解析游标，校验其宿主纪元与受管进程标识与当前目标是否严格匹配。
 *
 * 遇到格式错误、跨宿主纪元或跨受管进程的游标，抛出 INVALID_CURSOR 异常。
 */
export function parseCursor(
  cursorStr: string,
  expectedHostEpoch: string,
  expectedProcessId: string
): CursorPosition {
  const decoded = decodeCursor(cursorStr);

  if (decoded.hostEpoch !== expectedHostEpoch) {
    throw new ProcessError(
      INVALID_CURSOR,
      `Cursor host epoch mismatch: expected '${expectedHostEpoch}', got '${decoded.hostEpoch}'`,
      {
        cursor: cursorStr,
        expectedHostEpoch,
        actualHostEpoch: decoded.hostEpoch,
      }
    );
  }

  if (decoded.processId !== expectedProcessId) {
    throw new ProcessError(
      INVALID_CURSOR,
      `Cursor process ID mismatch: expected '${expectedProcessId}', got '${decoded.processId}'`,
      {
        cursor: cursorStr,
        expectedProcessId,
        actualProcessId: decoded.processId,
      }
    );
  }

  return {
    sequence: decoded.sequence,
    offset: decoded.offset,
  };
}

/**
 * 比较两个游标坐标的先后次序。
 *
 * 返回值：
 * - 负数：a 位于 b 之前。
 * - 0：a 与 b 处于同一位置。
 * - 正数：a 位于 b 之后。
 */
export function compareCursorPos(a: CursorPosition, b: CursorPosition): number {
  if (a.sequence !== b.sequence) {
    return a.sequence - b.sequence;
  }
  return a.offset - b.offset;
}
