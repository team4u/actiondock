import type { ProcessOutputLog } from "./output-log";

/**
 * 终态输出日志保留缓存配置选项。
 */
export interface TerminalOutputCacheOptions {
  /** 保留时长（毫秒） */
  retentionMs?: number;
  /** 宿主输出缓冲区字节总配额 */
  maxHostBufferBytes?: number;
  /** 保留日志最大条目数，默认 512 */
  maxEntries?: number;
}

interface CacheEntry {
  log: ProcessOutputLog;
  retainedAt: number;
}

/**
 * 终态输出日志保留缓存。
 *
 * 维护已退出进程的输出日志，提供基于最大条目数与宿主缓冲总量的有界内存缓存。
 */
export class TerminalOutputCache {
  /** 保留日志最大条目数上限（默认） */
  static readonly DEFAULT_MAX_ENTRIES = 512;

  private readonly entries = new Map<string, CacheEntry>();
  private readonly retentionMs: number;
  private readonly maxHostBufferBytes: number;
  private readonly maxEntries: number;
  private totalBytes = 0;

  constructor(options: TerminalOutputCacheOptions = {}) {
    this.retentionMs = options.retentionMs ?? 5 * 60 * 1000;
    this.maxHostBufferBytes = options.maxHostBufferBytes ?? 64 * 1024 * 1024;
    this.maxEntries = options.maxEntries ?? TerminalOutputCache.DEFAULT_MAX_ENTRIES;
  }

  /**
   * 清理已过期的终态输出日志条目。
   */
  private cleanExpired(): void {
    if (this.retentionMs <= 0) return;
    const now = Date.now();
    for (const [id, entry] of this.entries.entries()) {
      if (now - entry.retainedAt > this.retentionMs) {
        this.totalBytes -= entry.log.currentBytes;
        this.entries.delete(id);
      }
    }
    if (this.totalBytes < 0) {
      this.totalBytes = 0;
    }
  }

  /**
   * 统计终态保留日志当前在内存中实际占用的输出缓冲字节总数。
   */
  retainedBytes(): number {
    this.cleanExpired();
    return this.totalBytes;
  }

  /**
   * 将终态输出日志存入保留缓存，并根据容量上限淘汰旧条目。
   */
  retain(processId: string, log: ProcessOutputLog): void {
    this.cleanExpired();

    const existing = this.entries.get(processId);
    if (existing) {
      this.totalBytes -= existing.log.currentBytes;
      this.entries.delete(processId);
    }

    while (
      this.entries.size > 0 &&
      (this.entries.size >= this.maxEntries ||
        this.totalBytes + log.currentBytes > this.maxHostBufferBytes)
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) {
        this.totalBytes -= oldest.log.currentBytes;
      }
      this.entries.delete(oldestKey);
    }

    this.entries.set(processId, {
      log,
      retainedAt: Date.now(),
    });
    this.totalBytes += log.currentBytes;
  }

  /**
   * 获取终态保留日志（附带过期清理与 LRU 触达更新）。
   */
  get(processId: string): ProcessOutputLog | undefined {
    this.cleanExpired();
    const entry = this.entries.get(processId);
    if (!entry) return undefined;
    this.entries.delete(processId);
    this.entries.set(processId, entry);
    return entry.log;
  }

  /**
   * 按 LRU 顺序逐条淘汰最旧保留日志，直至剩余保留字节数不超过给定的可容纳上限。
   * 返回被淘汰条目释放的字节总数。
   */
  evictLRUUntil(fits: number): number {
    this.cleanExpired();
    let evictedBytes = 0;
    while (this.entries.size > 0 && this.totalBytes > fits) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) {
        const bytes = oldest.log.currentBytes;
        this.totalBytes -= bytes;
        evictedBytes += bytes;
      }
      this.entries.delete(oldestKey);
    }
    return evictedBytes;
  }

  /**
   * 清空所有缓存。
   */
  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}
