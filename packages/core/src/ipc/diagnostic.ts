import type { Readable, Writable } from "node:stream";

/**
 * 诊断日志转发器配置选项。
 */
export interface DiagnosticForwarderOptions {
  /** 允许转发的累计最大字节数（保留配置兼容） */
  maxBytes?: number;
  /** 每秒允许转发的最大字节速率（保留配置兼容） */
  maxRateBytesPerSec?: number;
  /** 目标输出流（默认 process.stderr） */
  target?: Writable;
  /** 诊断流标识前缀 */
  prefix?: string;
  /** 触发超限截断时的回调通知（保留配置兼容） */
  onTruncated?: (reason: "size_limit" | "rate_limit") => void;
  /** 写入错误处理回调 */
  onError?: (err: Error) => void;
}

/**
 * 诊断流极简转发器（DiagnosticForwarder）。
 *
 * 将子进程输出流（stdout/stderr）的数据转发至目标流。
 * 严禁静默丢数据，遇到写入异常即时透传。
 */
export class DiagnosticForwarder {
  private readonly target: Writable;
  private readonly prefix: string;
  private readonly onError?: (err: Error) => void;
  private readonly attachedStreams = new Map<Readable, (chunk: unknown) => void>();

  constructor(options: DiagnosticForwarderOptions = {}) {
    this.target = options.target ?? process.stderr;
    this.prefix = options.prefix ?? "";
    this.onError = options.onError;
  }

  /**
   * 绑定并监听可读流（如 childProcess.stdout 或 childProcess.stderr）。
   *
   * @param stream 待转发的可读流
   * @param label 流标识（如 "stdout" 或 "stderr"）
   */
  public attach(stream: Readable, label?: string): void {
    if (this.attachedStreams.has(stream)) return;

    const handler = (chunk: unknown) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : (chunk as Buffer);
      const effectivePrefix = this.prefix || (label ? `[${label}] ` : "");
      const data = effectivePrefix
        ? Buffer.concat([Buffer.from(effectivePrefix, "utf-8"), buf])
        : buf;

      try {
        this.target.write(data, (err) => {
          if (err) {
            if (this.onError) {
              this.onError(err);
            } else {
              this.target.emit("error", err);
            }
          }
        });
      } catch (err: any) {
        if (this.onError) {
          this.onError(err);
        } else {
          this.target.emit("error", err);
        }
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
}
