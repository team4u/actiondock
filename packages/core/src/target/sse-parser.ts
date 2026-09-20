/**
 * 手写 SSE（Server-Sent Events）流解析器。
 *
 * 职责单一：将远端字节流增量解析为 SSE 消息，完整承载协议细节：
 * - 跨 chunk 行分隔符缓冲（行尾 \r 需暂存等待下个 chunk 判定是否为 \r\n）
 * - 兼容 \n、\r 与 \r\n 三种行分隔符
 * - 冒号字段解析（冒号后单空格剔除，其余空格原样保留）
 * - 注释行（冒号开头）忽略与未知字段忽略
 * - 多行 data 按换行拼接合并
 * - 含空字符的非法事件标识忽略
 * - 流结束时未以空行收尾的剩余事件兜底分发
 *
 * 本模块为纯流转换函数，不感知 HTTP 传输、候选路由与 ActionDock 事件语义，
 * 可独立单测；底层流在提前退出（break/异常/中止）时防御性取消，避免连接泄漏。
 */

/**
 * SSE 消息解析结果。
 */
export interface SseMessage {
  /** 事件类型（未声明时缺省 message） */
  event: string;
  /** 事件标识（含空字符的非法标识会被忽略，保持 undefined） */
  id?: string;
  /** 多行 data 按换行拼接后的完整数据载荷 */
  data: string;
}

/**
 * 将 SSE 字节流增量解析为 SSE 消息。
 *
 * @param body 远端响应字节流
 * @param options.signal 外部取消信号：中止后立即停止读取，不进行剩余事件兜底分发
 */
export async function* parseSseMessages(
  body: ReadableStream<Uint8Array>,
  options?: { signal?: AbortSignal }
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let eventType = "message";
  let eventId: string | undefined;
  let dataLines: string[] = [];

  function dispatchCurrentEvent(): SseMessage | undefined {
    if (dataLines.length === 0) {
      eventType = "message";
      eventId = undefined;
      dataLines = [];
      return undefined;
    }

    const dataStr = dataLines.join("\n");
    const currentType = eventType;
    const currentId = eventId;

    eventType = "message";
    eventId = undefined;
    dataLines = [];

    if (!dataStr) {
      return undefined;
    }

    return {
      event: currentType,
      id: currentId,
      data: dataStr,
    };
  }

  function processLine(line: string): SseMessage | undefined {
    // 遇到空行分发事件
    if (line === "") {
      return dispatchCurrentEvent();
    }

    // 以冒号开头的为注释忽略
    if (line.startsWith(":")) {
      return undefined;
    }

    let field = line;
    let value = "";
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      field = line.slice(0, colonIdx);
      const rawVal = line.slice(colonIdx + 1);
      value = rawVal.startsWith(" ") ? rawVal.slice(1) : rawVal;
    }

    if (field === "event") {
      eventType = value;
    } else if (field === "data") {
      dataLines.push(value);
    } else if (field === "id") {
      if (!value.includes("\0")) {
        eventId = value;
      }
    }

    return undefined;
  }

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      } else if (done) {
        buffer += decoder.decode();
      }

      let pos = 0;
      while (pos < buffer.length) {
        const cr = buffer.indexOf("\r", pos);
        const lf = buffer.indexOf("\n", pos);

        let nextSepPos = -1;
        let sepLen = 0;

        if (cr !== -1 && (lf === -1 || cr < lf)) {
          if (cr === buffer.length - 1) {
            if (!done) {
              // 遇到未完结的 \r 暂存等待下个 chunk
              break;
            } else {
              nextSepPos = cr;
              sepLen = 1;
            }
          } else {
            if (buffer[cr + 1] === "\n") {
              nextSepPos = cr;
              sepLen = 2;
            } else {
              nextSepPos = cr;
              sepLen = 1;
            }
          }
        } else if (lf !== -1 && (cr === -1 || lf < cr)) {
          nextSepPos = lf;
          sepLen = 1;
        } else {
          break;
        }

        const line = buffer.slice(pos, nextSepPos);
        pos = nextSepPos + sepLen;
        const evt = processLine(line);
        if (evt) yield evt;
      }
      buffer = buffer.slice(pos);

      if (done) {
        if (buffer.length > 0) {
          const line = buffer;
          buffer = "";
          const evt = processLine(line);
          if (evt) yield evt;
        }
        // 流读取完成时若有剩余待分发事件则进行分发
        const remainingEvt = dispatchCurrentEvent();
        if (remainingEvt) yield remainingEvt;
        break;
      }
    }
  } finally {
    // 防御性取消底层流：仅 releaseLock 会让连接保持挂起，造成连接泄漏
    try {
      await reader.cancel();
    } catch {
      // 流已自然结束或已被取消时忽略次级异常
    }
    try {
      reader.releaseLock();
    } catch {}
  }
}
