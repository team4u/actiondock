import { inputFileReadFailed, inputLimitExceeded } from "./flat-errors";
import { decodeUtf8Strict } from "./utf8";
import { DEFAULT_MAX_INPUT_BYTES } from "./file-input";

/**
 * 标准输入有界读取选项。
 */
export interface ReadStdinBoundedOptions {
  /** 最大允许输入字节数（默认 10MB） */
  maxInputBytes?: number;
  /** 可选的中断信号 */
  signal?: AbortSignal;
  /** 是否仅允许纯字节流（在 CLI 策略下开启，若接收到 string chunk 则立即报错） */
  byteStreamOnly?: boolean;
  /** 是否执行严格 UTF-8 校验与解码（默认 true） */
  strictUtf8?: boolean;
}

/**
 * 以有界大小限制从标准输入流中安全读取全部内容。
 *
 * 核心契约：
 * - 纯字节流策略拦截：若启用 byteStreamOnly 且流发射 string chunk，抛出 INPUT_FILE_READ_FAILED（reason: "INVALID_STREAM_CHUNK_TYPE"）。
 * - 终态竞态裁决（First Observed Terminal Event Wins）：EOF、limit、abort 谁先观测谁生效，后续事件仅执行清理，不篡改已确定的错误与结果。
 * - 严格 UTF-8 校验：在 strictUtf8 下通过 decodeUtf8Strict 校验并抛出结构化 INVALID_JSON 异常。
 *
 * @param stream 标准输入可读流，默认为 process.stdin
 * @param options 读取配置选项
 * @returns 解码后的 UTF-8 文本
 */
export async function readStdinBounded(
  stream: NodeJS.ReadableStream = process.stdin,
  options?: ReadStdinBoundedOptions
): Promise<string> {
  const maxBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const signal = options?.signal;
  const byteStreamOnly = options?.byteStreamOnly ?? false;
  const strictUtf8 = options?.strictUtf8 ?? true;

  // 启动前检查 abort
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
  }

  return new Promise<string>((resolve, reject) => {
    let terminalEvent: "eof" | "limit" | "abort" | "error" | null = null;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      if (typeof (stream as any).pause === "function") {
        (stream as any).pause();
      }
      if (typeof (stream as any).destroy === "function") {
        (stream as any).destroy();
      }
    };

    const onAbort = () => {
      if (terminalEvent !== null) return;
      terminalEvent = "abort";
      cleanup();
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };

    const onError = (err: unknown) => {
      if (terminalEvent !== null) return;
      terminalEvent = "error";
      cleanup();
      reject(inputFileReadFailed("stdin", err));
    };

    const onData = (chunk: unknown) => {
      if (terminalEvent !== null) return;

      if (typeof chunk === "string") {
        if (byteStreamOnly) {
          terminalEvent = "error";
          cleanup();
          reject(
            inputFileReadFailed(
              "stdin",
              new Error("Invalid stream chunk type: expected Buffer, got string"),
              { reason: "INVALID_STREAM_CHUNK_TYPE" }
            )
          );
          return;
        }
        const buf = Buffer.from(chunk, "utf8");
        totalBytes += buf.length;
        if (totalBytes > maxBytes) {
          terminalEvent = "limit";
          cleanup();
          reject(
            inputLimitExceeded(
              `Stdin input exceeds maximum limit of ${maxBytes} bytes`,
              { reason: "MAX_INPUT_BYTES" }
            )
          );
          return;
        }
        chunks.push(buf);
        return;
      }

      if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        terminalEvent = "error";
        cleanup();
        reject(
          inputFileReadFailed(
            "stdin",
            new Error(
              `Invalid stream chunk type: expected Buffer, got ${typeof chunk}`
            ),
            { reason: "INVALID_STREAM_CHUNK_TYPE" }
          )
        );
        return;
      }

      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      totalBytes += buf.length;

      if (totalBytes > maxBytes) {
        terminalEvent = "limit";
        cleanup();
        reject(
          inputLimitExceeded(
            `Stdin input exceeds maximum limit of ${maxBytes} bytes`,
            { reason: "MAX_INPUT_BYTES" }
          )
        );
        return;
      }

      chunks.push(buf);
    };

    const onEnd = () => {
      if (terminalEvent !== null) return;
      terminalEvent = "eof";
      cleanup();

      try {
        const fullBuffer = Buffer.concat(chunks);
        if (strictUtf8) {
          const text = decodeUtf8Strict(fullBuffer, "full-json-stdin");
          resolve(text);
        } else {
          resolve(fullBuffer.toString("utf8"));
        }
      } catch (err) {
        reject(err);
      }
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);

    if (typeof (stream as any).resume === "function") {
      (stream as any).resume();
    }
  });
}
