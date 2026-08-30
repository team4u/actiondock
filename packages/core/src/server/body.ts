export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

export class RequestTooLargeError extends Error {
  public code = "REQUEST_TOO_LARGE";
  constructor(message = "Request body exceeds maximum allowed size") {
    super(message);
    this.name = "RequestTooLargeError";
  }
}

export class InvalidJsonError extends Error {
  public code = "INVALID_JSON";
  constructor(message = "Failed to parse request body as JSON") {
    super(message);
    this.name = "InvalidJsonError";
  }
}

export interface ReadJsonBodyOptions {
  maxBytes?: number;
}

/**
 * Safely reads and parses request body as JSON with maximum size limit enforcement.
 */
export async function readJsonBody<T = any>(
  req: Request,
  options: ReadJsonBodyOptions = {}
): Promise<T> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  // 1. Fast path: check Content-Length header if present
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const parsedLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(parsedLength) && parsedLength > maxBytes) {
      throw new RequestTooLargeError();
    }
  }

  // 2. Stream-safe body reader with byte counter
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

  // 3. Concatenate and decode UTF-8 text
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
