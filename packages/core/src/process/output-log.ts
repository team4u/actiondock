import {
  INVALID_CURSOR,
  OUTPUT_GAP,
  PROCESS_CANCELLED,
  QUOTA_EXCEEDED,
  ProcessError,
} from "../errors";
import { compareCursorPos, encodeCursor, parseCursor } from "./cursor";

/**
 * 内部存储的原始字节输出记录。
 */
interface InternalOutputRecord {
  /** 日志全局单调递增序号 */
  sequence: number;
  /** 输出流标签 */
  stream: "stdout" | "stderr" | "pty";
  /** 当前保留的原始字节切片 */
  data: Uint8Array;
  /** 当前保留切片在原记录中的起始字节偏移量 */
  offset: number;
  /** 记录原始完整字节长度 */
  originalLength: number;
}

/**
 * 外部输出分块数据。
 */
export interface OutputChunk {
  /** 输出流标识 */
  stream: "stdout" | "stderr" | "pty";
  /** 原始字节数据 */
  data: Uint8Array;
}

/**
 * 游标读取返回结果快照。
 */
export interface OutputReadResult {
  /** 本次读取到的数据切片列表 */
  chunks: OutputChunk[];
  /** 下次读取应使用的推进游标 */
  nextCursor: string;
  /** 当前保留窗口的最早游标 */
  earliestCursor: string;
  /** 当前日志末尾的最新游标 */
  tailCursor: string;
  /** 是否由于淘汰跳过了缺口数据 */
  truncated: boolean;
  /** 发生缺口跳过时的跨度信息 */
  gap?: {
    fromCursor: string;
    toCursor: string;
  };
  /** 是否已在输出通道关闭后读尽全部数据 */
  eof: boolean;
}

/**
 * 输出日志配置选项。
 */
export interface ProcessOutputLogOptions {
  /** 缓冲区最大保留字节数，默认 4 MiB */
  maxBufferBytes?: number;
  /** 单个进程最大并发等待者上限，默认 8 */
  maxWaiters?: number;
  /** 初始日志序号，默认 0 */
  initialSequence?: number;
}

/**
 * 读取长轮询等待配置选项。
 */
export interface OutputReadOptions {
  /** 单次读取最大原始字节数，默认 64 KiB */
  maxBytes?: number;
  /** 遇到淘汰缺口时的处理策略，error 抛出异常，skip 自动跳过缺口 */
  onGap?: "error" | "skip";
}

/**
 * 基于内存有界环形缓冲区的受管进程原始字节输出日志。
 *
 * 职责与不变量：
 * - 保留原始字节流，不做字符集猜测与跨流重排序。
 * - 维护单调推进的游标系统，支持按记录切分与不透明游标寻址。
 * - 缓冲区超额时淘汰最旧数据并更新最早保留游标。
 * - 长轮询等待机制保证状态检查与等待者注册处于同一同步边界，杜绝漏唤醒。
 * - 严格遵循等待者配额，超额抛出配额超限异常。
 */
export class ProcessOutputLog {
  public readonly hostEpoch: string;
  public readonly processId: string;
  public readonly maxBufferBytes: number;
  public readonly maxWaiters: number;

  private records: InternalOutputRecord[] = [];
  private totalBytes = 0;
  private nextSequence: number;
  private earliestCursorState: string;
  private tailCursorState: string;
  private outputClosedState = false;
  private outputEndReasonState?: "natural" | "drain-timeout" | "host-lost";
  private waiters = new Set<() => void>();

  constructor(
    hostEpoch: string,
    processId: string,
    options: ProcessOutputLogOptions = {}
  ) {
    this.hostEpoch = hostEpoch;
    this.processId = processId;
    this.maxBufferBytes = options.maxBufferBytes ?? 4 * 1024 * 1024;
    this.maxWaiters = options.maxWaiters ?? 8;
    this.nextSequence = options.initialSequence ?? 0;

    const initial = encodeCursor(this.hostEpoch, this.processId, this.nextSequence, 0);
    this.earliestCursorState = initial;
    this.tailCursorState = initial;
  }

  /**
   * 当前保留日志的最早可用游标。
   */
  public get earliestCursor(): string {
    return this.earliestCursorState;
  }

  /**
   * 当前日志尾部的下一写入游标。
   */
  public get tailCursor(): string {
    return this.tailCursorState;
  }

  /**
   * 输出通道是否已关闭。
   */
  public get outputClosed(): boolean {
    return this.outputClosedState;
  }

  /**
   * 输出通道关闭原因。
   */
  public get outputEndReason(): "natural" | "drain-timeout" | "host-lost" | undefined {
    return this.outputEndReasonState;
  }

  /**
   * 当前缓冲区占用的原始字节总数。
   */
  public get currentBytes(): number {
    return this.totalBytes;
  }

  /**
   * 当前正在挂起等待的读取者数量。
   */
  public get waiterCount(): number {
    return this.waiters.size;
  }

  /**
   * 向输出日志追加新的原始字节数据。
   *
   * 行为约束：
   * - 记录新数据并更新日志尾部游标。
   * - 若总字节数超出缓冲区上限，淘汰最旧记录并更新最早保留游标。
   * - 同步唤醒所有挂起等待者。
   */
  public append(stream: "stdout" | "stderr" | "pty", data: Uint8Array): void {
    if (data.byteLength === 0) {
      return;
    }

    const sequence = this.nextSequence++;
    const record: InternalOutputRecord = {
      sequence,
      stream,
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      offset: 0,
      originalLength: data.byteLength,
    };

    this.records.push(record);
    this.totalBytes += record.data.byteLength;
    this.tailCursorState = encodeCursor(this.hostEpoch, this.processId, this.nextSequence, 0);

    while (this.totalBytes > this.maxBufferBytes && this.records.length > 0) {
      if (this.records.length > 1) {
        const evicted = this.records.shift()!;
        this.totalBytes -= evicted.data.byteLength;
        const first = this.records[0];
        this.earliestCursorState = encodeCursor(
          this.hostEpoch,
          this.processId,
          first.sequence,
          first.offset
        );
      } else {
        const single = this.records[0];
        const overflow = this.totalBytes - this.maxBufferBytes;
        single.offset += overflow;
        single.data = single.data.subarray(overflow);
        this.totalBytes = single.data.byteLength;
        this.earliestCursorState = encodeCursor(
          this.hostEpoch,
          this.processId,
          single.sequence,
          single.offset
        );
        break;
      }
    }

    this.notifyWaiters();
  }

  /**
   * 标记输出通道关闭并唤醒所有等待者。
   */
  public closeOutput(reason: "natural" | "drain-timeout" | "host-lost" = "natural"): void {
    if (this.outputClosedState) {
      return;
    }
    this.outputClosedState = true;
    this.outputEndReasonState = reason;
    this.notifyWaiters();
  }

  /**
   * 从指定游标处读取输出数据。
   *
   * 行为约束：
   * - 校验游标是否超出当前日志末尾，超出则抛出 INVALID_CURSOR 异常。
   * - 检查游标是否落后于最早保留游标：
   *   - 若落后且 onGap 为 error，抛出 OUTPUT_GAP 异常并附带当前最早游标。
   *   - 若落后且 onGap 为 skip，从最早可用游标开始读取，标记 truncated 为 true 并提供缺口范围。
   * - 支持记录切分并生成带有内部偏移量的不透明推进游标。
   */
  public read(
    cursor: string,
    maxBytes?: number,
    onGap?: "error" | "skip"
  ): OutputReadResult {
    const limitBytes = maxBytes !== undefined && maxBytes > 0 ? maxBytes : 64 * 1024;
    const gapMode = onGap ?? "error";

    const requestedPos = parseCursor(cursor, this.hostEpoch, this.processId);
    const tailPos = parseCursor(this.tailCursorState, this.hostEpoch, this.processId);
    const earliestPos = parseCursor(this.earliestCursorState, this.hostEpoch, this.processId);

    if (compareCursorPos(requestedPos, tailPos) > 0) {
      throw new ProcessError(INVALID_CURSOR, "Cursor is beyond tail cursor", {
        cursor,
        tailCursor: this.tailCursorState,
      });
    }

    let readPos = requestedPos;
    let skippedGap = false;
    let gapInfo: { fromCursor: string; toCursor: string } | undefined;

    if (compareCursorPos(requestedPos, earliestPos) < 0) {
      if (gapMode === "error") {
        throw new ProcessError(
          OUTPUT_GAP,
          "Output log cursor has fallen behind earliest retained cursor",
          {
            cursor,
            earliestCursor: this.earliestCursorState,
          }
        );
      }
      skippedGap = true;
      readPos = earliestPos;
      gapInfo = {
        fromCursor: cursor,
        toCursor: this.earliestCursorState,
      };
    }

    if (compareCursorPos(readPos, tailPos) === 0) {
      const eof = Boolean(this.outputClosedState);
      return {
        chunks: [],
        nextCursor: skippedGap ? this.earliestCursorState : cursor,
        earliestCursor: this.earliestCursorState,
        tailCursor: this.tailCursorState,
        truncated: skippedGap,
        gap: gapInfo,
        eof,
      };
    }

    let curSeq = readPos.sequence;
    let curOffset = readPos.offset;
    let remainingBytes = limitBytes;
    const chunks: OutputChunk[] = [];

    for (const record of this.records) {
      if (record.sequence < curSeq) {
        continue;
      }
      if (record.sequence > curSeq) {
        curSeq = record.sequence;
        curOffset = record.offset;
      }
      if (remainingBytes <= 0) {
        break;
      }

      if (curOffset > record.originalLength) {
        throw new ProcessError(INVALID_CURSOR, "Cursor offset exceeds record length", {
          cursor,
          sequence: curSeq,
          offset: curOffset,
          recordLength: record.originalLength,
        });
      }

      if (curOffset < record.offset) {
        curOffset = record.offset;
      }

      const localOffset = curOffset - record.offset;
      const availableInRecord = record.data.byteLength - localOffset;

      if (availableInRecord > 0) {
        const take = Math.min(availableInRecord, remainingBytes);
        const chunkBytes = record.data.subarray(localOffset, localOffset + take);
        chunks.push({
          stream: record.stream,
          data: chunkBytes,
        });
        remainingBytes -= take;
        curOffset += take;
      }

      if (curOffset >= record.originalLength) {
        curSeq = record.sequence + 1;
        curOffset = 0;
      }

      if (remainingBytes <= 0) {
        break;
      }
    }

    const nextCursor = encodeCursor(this.hostEpoch, this.processId, curSeq, curOffset);
    const currentEndPos = { sequence: curSeq, offset: curOffset };
    const isAtTail = compareCursorPos(currentEndPos, tailPos) === 0;
    const eof = Boolean(this.outputClosedState && isAtTail);

    return {
      chunks,
      nextCursor,
      earliestCursor: this.earliestCursorState,
      tailCursor: this.tailCursorState,
      truncated: skippedGap,
      gap: gapInfo,
      eof,
    };
  }

  /**
   * 长轮询等待输出数据或通道关闭。
   *
   * 行为约束：
   * - 状态检查与等待者登记位于同一同步边界，杜绝漏唤醒竞态。
   * - 若已有数据、通道已关闭或超时时长小于等于 0，立即返回读取结果。
   * - 严格校验等待者配额，超额抛出 QUOTA_EXCEEDED 异常。
   * - 外部信号中止时立即清理等待者并不修改日志游标状态。
   * - 等待超时且无新数据时返回空分块结果。
   */
  public waitForData(
    cursor: string,
    waitMs: number,
    signal?: AbortSignal,
    options?: OutputReadOptions
  ): Promise<OutputReadResult> {
    const requestedPos = parseCursor(cursor, this.hostEpoch, this.processId);
    const tailPos = parseCursor(this.tailCursorState, this.hostEpoch, this.processId);
    const earliestPos = parseCursor(this.earliestCursorState, this.hostEpoch, this.processId);

    if (compareCursorPos(requestedPos, tailPos) > 0) {
      throw new ProcessError(INVALID_CURSOR, "Cursor is beyond tail cursor", {
        cursor,
        tailCursor: this.tailCursorState,
      });
    }

    const isBehind = compareCursorPos(requestedPos, earliestPos) < 0;
    const hasData = compareCursorPos(requestedPos, tailPos) < 0;

    if (isBehind || hasData || this.outputClosedState || waitMs <= 0) {
      return Promise.resolve(this.read(cursor, options?.maxBytes, options?.onGap));
    }

    if (signal?.aborted) {
      return Promise.reject(
        new ProcessError(PROCESS_CANCELLED, "Wait aborted", { reason: signal.reason })
      );
    }

    if (this.waiters.size >= this.maxWaiters) {
      return Promise.reject(
        new ProcessError(
          QUOTA_EXCEEDED,
          `Read waiters quota exceeded: ${this.maxWaiters}`,
          {
            maxWaiters: this.maxWaiters,
            currentWaiters: this.waiters.size,
          }
        )
      );
    }

    return new Promise<OutputReadResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
          abortHandler = null;
        }
        this.waiters.delete(wake);
      };

      const wake = () => {
        cleanup();
        try {
          const result = this.read(cursor, options?.maxBytes, options?.onGap);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };

      if (signal) {
        abortHandler = () => {
          cleanup();
          reject(
            new ProcessError(PROCESS_CANCELLED, "Wait aborted by signal", {
              reason: signal.reason,
            })
          );
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      if (waitMs > 0 && waitMs !== Infinity) {
        timer = setTimeout(() => {
          cleanup();
          try {
            const result = this.read(cursor, options?.maxBytes, options?.onGap);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }, waitMs);
        if (typeof (timer as any)?.unref === "function") {
          (timer as any).unref();
        }
      }

      this.waiters.add(wake);
    });
  }

  private notifyWaiters(): void {
    if (this.waiters.size === 0) {
      return;
    }
    const pending = Array.from(this.waiters);
    this.waiters.clear();
    for (const wake of pending) {
      wake();
    }
  }
}
