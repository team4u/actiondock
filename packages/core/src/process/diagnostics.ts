import type { Logger } from "@actiondock/sdk";

/**
 * 内部诊断日志汇聚器。
 *
 * 持有最近的持久化失败与驱动终止失败等诊断信息：优先写入注入的 logger，
 * 缺失时保留在内存环形缓冲区，避免静默吞没异常。
 */
export class DiagnosticsSink {
  static readonly DEFAULT_BUFFER_LIMIT = 100;

  private readonly logger?: Logger;
  private readonly bufferLimit: number;
  private readonly diagnostics: string[] = [];

  constructor(options?: { logger?: Logger; bufferLimit?: number }) {
    this.logger = options?.logger;
    this.bufferLimit = options?.bufferLimit ?? DiagnosticsSink.DEFAULT_BUFFER_LIMIT;
  }

  record(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : err !== undefined ? String(err) : "";
    const line = detail ? `${message} (${detail})` : message;
    this.diagnostics.push(`${new Date().toISOString()} ${line}`);
    if (this.diagnostics.length > this.bufferLimit) {
      this.diagnostics.shift();
    }
    try {
      this.logger?.warn("[ProcessManager] " + line);
    } catch {
      // 防御与透明：避免外部 Logger 故障反向干扰核心生命周期流程
    }
  }

  recent(): string[] {
    return [...this.diagnostics].reverse();
  }
}
