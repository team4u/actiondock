import type {
  Bytes,
  OutputChunk,
} from "./types";

/**
 * 工具独立性声明：
 * 本文件的字节编解码、流式解码与控制权保护工具是 sdk 作为零依赖公共包的
 * 最小自备实现，有意独立于 core（core 及其他包反向依赖 sdk 引入这些能力）。
 * 禁止为消除「重复」而让 sdk 反向依赖 core 或在此拷贝 core 的通用工具；
 * 新增通用工具时应上提到调用方自身层级，而非下沉到 sdk。
 */

/**
 * 将字符串或二进制字节数组编码为标准 Bytes 结构。
 * @param data 待编码的字符串或字节数组
 */
export function encodeBytes(data: Uint8Array | string): Bytes {
  if (typeof data === "string") {
    return {
      encoding: "base64",
      data: Buffer.from(data, "utf-8").toString("base64"),
    };
  }
  if (data instanceof Uint8Array) {
    return {
      encoding: "base64",
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"),
    };
  }
  throw new TypeError("Data must be a string or Uint8Array");
}

/**
 * 将纯文本字符串编码为标准 Bytes 结构。
 * @param text 待编码的纯文本字符串
 */
export function encodeText(text: string): Bytes {
  return encodeBytes(text);
}

/**
 * 将标准 Bytes 结构解码为二进制 Uint8Array 数组。
 * @param bytes 待解码的 Bytes 结构
 */
export function decodeBytes(bytes: Bytes): Uint8Array {
  if (!bytes || typeof bytes !== "object") {
    throw new TypeError("Invalid Bytes object: expected an object");
  }
  if (bytes.encoding !== "base64") {
    throw new TypeError(`Unsupported encoding: ${(bytes as any).encoding}, expected 'base64'`);
  }
  if (typeof bytes.data !== "string") {
    throw new TypeError("Invalid Bytes data: expected a base64 string");
  }
  const buf = Buffer.from(bytes.data, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * 将标准 Bytes 结构或 OutputChunk 数组解码为 UTF-8 文本字符串。
 * @param bytes 待解码的 Bytes 结构或 OutputChunk 数组
 */
export function decodeText(bytes: Bytes | OutputChunk[]): string {
  if (Array.isArray(bytes)) {
    if (bytes.length === 0) {
      return "";
    }
    const byteArrays = bytes.map((chunk) => decodeBytes(chunk.data));
    const totalLength = byteArrays.reduce((acc, curr) => acc + curr.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of byteArrays) {
      merged.set(arr, offset);
      offset += arr.byteLength;
    }
    return new TextDecoder("utf-8").decode(merged);
  }
  return new TextDecoder("utf-8").decode(decodeBytes(bytes));
}

/**
 * 逐流增量 UTF-8 解码器接口。
 */
export interface StreamDecoder {
  /**
   * 解码单个输出块，基于该块所属流增量解码 UTF-8 文本
   * @param chunk 输出数据块
   */
  decode(chunk: OutputChunk): string;
  /**
   * 按指定流标识与字节数据增量解码 UTF-8 文本
   * @param stream 输出流标识
   * @param data 字节数据
   */
  decode(stream: string, data: Bytes | Uint8Array): string;
  /**
   * 通用重载：支持传入 OutputChunk，或传入流名称与数据
   */
  decode(chunkOrStream: OutputChunk | string, data?: Bytes | Uint8Array): string;
  /**
   * 批量解码输出块数组
   * @param chunks 输出数据块列表
   */
  decodeChunks(chunks: OutputChunk[]): string;
  /**
   * 重置指定流的解码器状态；若未指定流则重置全部流
   * @param stream 可选的流标识
   */
  reset(stream?: string): void;
  /**
   * 刷新并输出指定流中残余的未完成字符缓冲；若未指定流则刷新全部流
   * @param stream 可选的流标识
   */
  flush(stream?: string): string;
}

/**
 * 创建逐流增量 UTF-8 解码器实例。
 * 针对 stdout、stderr、pty 等不同流独立保留残缺多字节序列，避免跨流干扰。
 */
export function createStreamDecoder(): StreamDecoder {
  const decoders = new Map<string, TextDecoder>();

  function getDecoder(stream: string): TextDecoder {
    let decoder = decoders.get(stream);
    if (!decoder) {
      decoder = new TextDecoder("utf-8", { fatal: false });
      decoders.set(stream, decoder);
    }
    return decoder;
  }

  function decode(chunkOrStream: OutputChunk | string, data?: Bytes | Uint8Array): string {
    let streamName: string;
    let rawBytes: Uint8Array;

    if (typeof chunkOrStream === "object" && chunkOrStream !== null && "stream" in chunkOrStream) {
      streamName = chunkOrStream.stream;
      rawBytes = decodeBytes(chunkOrStream.data);
    } else if (typeof chunkOrStream === "string") {
      streamName = chunkOrStream;
      if (!data) {
        throw new TypeError("Missing data parameter for stream decoding");
      }
      rawBytes = data instanceof Uint8Array ? data : decodeBytes(data);
    } else {
      throw new TypeError("Invalid argument: expected OutputChunk or stream name");
    }

    const decoder = getDecoder(streamName);
    return decoder.decode(rawBytes, { stream: true });
  }

  function decodeChunks(chunks: OutputChunk[]): string {
    let result = "";
    for (const chunk of chunks) {
      result += decode(chunk);
    }
    return result;
  }

  function reset(stream?: string): void {
    if (stream !== undefined) {
      decoders.delete(stream);
    } else {
      decoders.clear();
    }
  }

  function flush(stream?: string): string {
    if (stream !== undefined) {
      const decoder = decoders.get(stream);
      if (!decoder) return "";
      const result = decoder.decode();
      decoders.delete(stream);
      return result;
    }
    let result = "";
    for (const decoder of decoders.values()) {
      result += decoder.decode();
    }
    decoders.clear();
    return result;
  }

  return {
    decode,
    decodeChunks,
    reset,
    flush,
  };
}

/**
 * createStreamDecoder 的别名，与设计文档保持对齐。
 */
export const createIncrementalTextDecoder = createStreamDecoder;

