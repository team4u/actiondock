/**
 * 默认单次 HTTP 请求体最大字节上限（1 MiB）。
 */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

/**
 * 请求体超出最大允许体积时抛出的异常（对应 HTTP 413 Payload Too Large）。
 */
export class RequestTooLargeError extends Error {
  public code = "REQUEST_TOO_LARGE";
  constructor(message = "Request body exceeds maximum allowed size") {
    super(message);
    this.name = "RequestTooLargeError";
  }
}

/**
 * 请求体非合法 JSON 格式时抛出的异常（对应 HTTP 400 Bad Request）。
 */
export class InvalidJsonError extends Error {
  public code = "INVALID_JSON";
  constructor(message = "Failed to parse request body as JSON") {
    super(message);
    this.name = "InvalidJsonError";
  }
}

/**
 * 请求体安全读取选项。
 */
export interface ReadJsonBodyOptions {
  /** 最大允许的字节数（默认 1 MiB） */
  maxBytes?: number;
}

/**
 * 流式安全地读取 HTTP 请求体并解析为 JSON 对象。
 * 
 * 防护机制：
 * 1. 快速拒绝（Fast-path）：若请求头中存在 `Content-Length` 且超过 `maxBytes`，立即抛出 RequestTooLargeError，不进行内存分配。
 * 2. 流式计数器（Chunk Streaming）：在读取 ReadableStream 过程中实时累计字节数，中途超出上限即刻截断并释放流锁，防止大文件 DoS 与内存耗尽（OOM）。
 * 3. 安全解码：处理空请求体与 UTF-8 字符集解码。
 * 
 * @param req 传入的 Request 对象
 * @param options 读取配置选项
 * @returns 解析后的 JSON 对象
 * @throws {RequestTooLargeError} 若请求体体积超限
 * @throws {InvalidJsonError} 若请求体非合法 JSON
 */
export async function readJsonBody<T = any>(
  req: Request,
  options: ReadJsonBodyOptions = {}
): Promise<T> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  // 1. 快速检查 Content-Length 头部
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const parsedLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(parsedLength) && parsedLength > maxBytes) {
      throw new RequestTooLargeError();
    }
  }

  // 2. 流式读取并实时统计字节数
  if (!req.body) {
    return {} as T;
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          throw new RequestTooLargeError();
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0 || totalBytes === 0) {
    return {} as T;
  }

  // 3. 拼接字节数组并进行 UTF-8 解码
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder("utf-8").decode(merged);
  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (err: any) {
    throw new InvalidJsonError(`Failed to parse request body: ${err.message}`);
  }
}
