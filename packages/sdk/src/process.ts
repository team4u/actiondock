import type {
  Bytes,
  ControlGrant,
  OutputChunk,
  ProcessAPI,
} from "./types";

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

/**
 * 控制权保护执行选项。
 */
export interface WithControlOptions {
  /** 控制申请幂等标识 */
  requestId: string;
  /** 最长排队等待时间（毫秒），默认为 30000 */
  waitMs?: number;
  /** 控制权有效存活时长（毫秒），默认为 30000 */
  ttlMs?: number;
  /** 是否自动在有效期间定期续租，默认为 true */
  autoRenew?: boolean;
  /** 调用取消信号 */
  signal?: AbortSignal;
}

/**
 * 发出非致命警告：优先使用 Node 的进程级警告机制，不可用时回退控制台输出。
 */
function emitWarning(message: string): void {
  if (typeof (globalThis as any).process?.emitWarning === "function") {
    (globalThis as any).process.emitWarning(message, "ActionDockProcessWarning");
    return;
  }
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[ActionDockProcessWarning] ${message}`);
  }
}

/**
 * 在受管进程独占控制权保护下执行业务操作。
 * 具备以下核心保证：
 * - 自动申请独占控制令牌；
 * - 可选在生命周期内按三分之一 TTL 定期自动续租；
 * - 操作正常成功完成时显式调用 release 释放控制权；
 * - 操作异常、续租失败或取消中断时严禁调用 release，按契约调用 stop 进行隔离或终止并向外抛出异常。
 *
 * @param api 进程操作接口
 * @param processId 目标受管进程标识
 * @param options 控制选项
 * @param fn 在持有有效控制令牌下执行的异步函数
 */
export async function withControl<T>(
  api: ProcessAPI,
  processId: string,
  options: WithControlOptions,
  fn: (grant: ControlGrant) => Promise<T>
): Promise<T> {
  const ttlMs = options.ttlMs ?? 30000;
  const waitMs = options.waitMs ?? 30000;
  const autoRenew = options.autoRenew ?? true;

  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Aborted");
  }

  // 申请独占控制令牌
  const grant = await api.acquire(
    processId,
    {
      requestId: options.requestId,
      waitMs,
      ttlMs,
    },
    options.signal ? { signal: options.signal } : undefined
  );

  let currentToken = grant.token;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  let renewError: unknown | undefined;
  let isSettled = false;
  let isReleased = false;
  let activeRenewPromise: Promise<void> | undefined;

  // 启动后台自动续租
  if (autoRenew && ttlMs > 0) {
    const intervalMs = Math.max(100, Math.floor(ttlMs / 3));
    renewTimer = setInterval(() => {
      if (isSettled || isReleased) return;
      activeRenewPromise = (async () => {
        try {
          const renewed = await api.renew(
            processId,
            currentToken,
            ttlMs,
            options.signal ? { signal: options.signal } : undefined
          );
          if (isSettled || isReleased) return;
          currentToken = renewed.token;
          grant.token = renewed.token;
          grant.expiresAt = renewed.expiresAt;
        } catch (err) {
          if (isSettled || isReleased) return;
          renewError = err;
          if (renewTimer) {
            clearInterval(renewTimer);
            renewTimer = undefined;
          }
          // 续租失败且业务仍在进行中：按设计契约第 6.3 节要求调用 stop 隔离或终止进程
          try {
            await api.stop(processId, {
              requestId: `${options.requestId}-renew-stop`,
              graceMs: 1000,
            });
          } catch {
            // 忽略清理阶段次级异常，保留主要续租错误
          }
        } finally {
          activeRenewPromise = undefined;
        }
      })();
    }, intervalMs);

    if (typeof renewTimer.unref === "function") {
      renewTimer.unref();
    }
  }

  // 监听取消信号
  const onAbort = async () => {
    if (isSettled || isReleased) return;
    isSettled = true;
    if (renewTimer) {
      clearInterval(renewTimer);
      renewTimer = undefined;
    }
    if (!isReleased) {
      try {
        await api.stop(processId, {
          requestId: `${options.requestId}-abort-stop`,
          graceMs: 1000,
        });
      } catch {
        // 忽略清理阶段次级异常
      }
    }
  };

  if (options.signal) {
    options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const result = await fn(grant);

    // 业务逻辑执行结束，立刻标记已结算并清理定时器
    isSettled = true;
    if (renewTimer) {
      clearInterval(renewTimer);
      renewTimer = undefined;
    }

    // 等待任何正在进行的异步续租请求收敛，避免续租与 release 交错竞态
    if (activeRenewPromise) {
      try {
        await activeRenewPromise;
      } catch {
        // 忽略已结算后的续租异常
      }
    }

    // 检查续租过程中是否发生异常
    if (renewError) {
      throw renewError;
    }

    // 检查是否已被取消信号中断
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("Aborted");
    }

    // 正常协议完成后显式 release
    try {
      await api.release(
        processId,
        currentToken,
        options.signal ? { signal: options.signal } : undefined
      );
      isReleased = true;
    } catch (releaseErr: any) {
      // 区分释放失败性质：控制权已失效（进程隔离或终态）维持 stop+rethrow 契约；
      // 临时性队列繁忙错误不终止进程，保留业务结果并记录警告
      const releaseCode = releaseErr?.code;
      const isTransient =
        releaseCode === "CONTROL_BUSY" ||
        releaseCode === "CONTROL_EXPIRED" ||
        releaseCode === "SERVER_ERROR" ||
        releaseCode === "STORAGE_BUSY";

      if (isTransient) {
        emitWarning(
          `withControl: release failed transiently (code: ${releaseCode ?? "UNKNOWN"}, message: ${releaseErr?.message ?? String(releaseErr)}); business result preserved and process left running`
        );
        return result;
      }

      throw releaseErr;
    }

    return result;
  } catch (err) {
    isSettled = true;
    if (renewTimer) {
      clearInterval(renewTimer);
      renewTimer = undefined;
    }

    // 失败路径：仅在未成功 release 时按契约调用 stop 进行隔离或终止
    if (!isReleased) {
      try {
        await api.stop(processId, {
          requestId: `${options.requestId}-error-stop`,
          graceMs: 1000,
        });
      } catch {
        // 忽略清理阶段次级异常，保留原错误向上抛出
      }
    }

    throw err;
  } finally {
    isSettled = true;
    if (renewTimer) {
      clearInterval(renewTimer);
      renewTimer = undefined;
    }
    if (options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}
