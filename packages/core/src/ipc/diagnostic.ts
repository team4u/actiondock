import type { Readable, Writable } from "node:stream";

/**
 * 诊断日志限流排空转发器配置选项。
 */
export interface DiagnosticForwarderOptions {
  /** 允许转发的累计最大字节数（默认 512 KB） */
  maxBytes?: number;
  /** 每秒允许转发的最大字节速率（默认 64 KB/秒） */
  maxRateBytesPerSec?: number;
  /** 目标输出流（默认 process.stderr） */
  target?: Writable;
  /** 诊断流标识前缀 */
  prefix?: string;
  /** 触发超限截断时的回调通知 */
  onTruncated?: (reason: "size_limit" | "rate_limit") => void;
}

/**
 * 诊断流受控转发与限流排空器（DiagnosticForwarder）。
 * 
 * 职责：
 * 1. 独占捕获子进程的标准输出与标准错误流，杜绝第三方代码污染父进程标准协议通道。
 * 2. 实时监测字节总量与秒级传输速率上限。
 * 3. 达到阈值后立即停止对外转发、向诊断通道记录截断事件。
 * 4. 持续以非阻塞方式静默排空后续数据流，避免子进程因管道背压堆积死锁。
 */
export class DiagnosticForwarder {
  private readonly maxBytes: number;
  private readonly maxRateBytesPerSec: number;
  private readonly target: Writable;
  private readonly prefix: string;
  private readonly onTruncated?: (reason: "size_limit" | "rate_limit") => void;

  private totalBytesEmitted = 0;
  private windowStartMs = Date.now();
  private bytesInCurrentWindow = 0;
  private truncated = false;
  private attachedStreams = new Map<Readable, (chunk: any) => void>();

  constructor(options: DiagnosticForwarderOptions = {}) {
    this.maxBytes = options.maxBytes ?? 512 * 1024;
    this.maxRateBytesPerSec = options.maxRateBytesPerSec ?? 64 * 1024;
    this.target = options.target ?? process.stderr;
    this.prefix = options.prefix ?? "";
    this.onTruncated = options.onTruncated;
  }

  /**
   * 是否已达到上限并处于截断状态。
   */
  public get isTruncated(): boolean {
    return this.truncated;
  }

  /**
   * 已成功转发的累计字节数。
   */
  public get bytesEmitted(): number {
    return this.totalBytesEmitted;
  }

  /**
   * 绑定并监听可读流（如 childProcess.stdout 或 childProcess.stderr）。
   * 
   * @param stream 待转发的可读流
   * @param label 流标识（如 "stdout" 或 "stderr"）
   */
  public attach(stream: Readable, label?: string): void {
    if (this.attachedStreams.has(stream)) return;

    const handler = (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk;
      const len = buf.length;

      // 刷新秒级速率统计窗口
      const now = Date.now();
      if (now - this.windowStartMs >= 1000) {
        this.windowStartMs = now;
        this.bytesInCurrentWindow = 0;
      }

      if (this.truncated) {
        // 已截断：仅排空丢弃数据，不转发，保持流处于读取排空状态
        return;
      }

      // 检查容量与速率上限
      let exceedReason: "size_limit" | "rate_limit" | null = null;
      if (this.totalBytesEmitted + len > this.maxBytes) {
        exceedReason = "size_limit";
      } else if (this.bytesInCurrentWindow + len > this.maxRateBytesPerSec) {
        exceedReason = "rate_limit";
      }

      if (exceedReason) {
        this.truncated = true;
        const tag = label ? `[${label}] ` : "";
        const notice = `\n[Supervisor] ${tag}Diagnostic output exceeded ${
          exceedReason === "size_limit" ? `size limit (${this.maxBytes} bytes)` : `rate limit (${this.maxRateBytesPerSec} B/s)`
        }. Forwarding suspended; draining stream.\n`;

        try {
          this.target.write(notice);
        } catch {
          // 忽略写入失败
        }

        this.onTruncated?.(exceedReason);
        return;
      }

      // 正常转发
      this.totalBytesEmitted += len;
      this.bytesInCurrentWindow += len;

      try {
        if (this.prefix) {
          this.target.write(`${this.prefix}${buf.toString("utf-8")}`);
        } else {
          this.target.write(buf);
        }
      } catch {
        // 忽略目标写入异常
      }
    };

    stream.on("data", handler);
    this.attachedStreams.set(stream, handler);
  }

  /**
   * 解绑指定的流监听。
   */
  public detach(stream: Readable): void {
    const handler = this.attachedStreams.get(stream);
    if (handler) {
      stream.removeListener("data", handler);
      this.attachedStreams.delete(stream);
    }
  }

  /**
   * 解绑所有已连接的流。
   */
  public detachAll(): void {
    for (const [stream, handler] of this.attachedStreams.entries()) {
      stream.removeListener("data", handler);
    }
    this.attachedStreams.clear();
  }

  /**
   * 重置计数器与截断标志。
   */
  public reset(): void {
    this.totalBytesEmitted = 0;
    this.bytesInCurrentWindow = 0;
    this.windowStartMs = Date.now();
    this.truncated = false;
  }
}
