import type { Logger } from "@actiondock/sdk";

/**
 * 内部诊断日志汇聚器。
 *
 * 持有最近的持久化失败与驱动终止失败等诊断信息：优先写入注入的 logger，
 * 缺失时保留在内存环形缓冲区，避免静默吞没异常。
 */
export class DiagnosticsSink {
  /** 注入的 logger 缺失时保留最近诊断条目的环形缓冲容量，默认 100 */
  static readonly DEFAULT_BUFFER_LIMIT = 100;

  private readonly logger?: Logger;
  private readonly bufferLimit: number;
  private readonly diagnostics: string[] = [];

  constructor(options?: { logger?: Logger; bufferLimit?: number }) {
    this.logger = options?.logger;
    this.bufferLimit = options?.bufferLimit ?? DiagnosticsSink.DEFAULT_BUFFER_LIMIT;
  }

  /**
   * 记录内部诊断信息：优先写入注入的 logger，缺失时保留在内存环形缓冲区。
   */
  record(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : err !== undefined ? String(err) : "";
    const line = detail ? `${message} (${detail})` : message;
    this.diagnostics.push(`${new Date().toISOString()} ${line}`);
    if (this.diagnostics.length > this.bufferLimit) {
      this.diagnostics.shift();
    }
    this.logger?.warn("[ProcessManager] " + line);
  }

  /**
   * 获取最近的内部诊断日志快照（最近条目在前）。
   */
  recent(): string[] {
    return [...this.diagnostics].reverse();
  }
}
