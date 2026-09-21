import type { ProcessOutputLog } from "./output-log";

/**
 * 已淘汰输出日志的墓碑信息。
 */
export interface EvictedOutputTombstone {
  tailCursor: string;
  earliestCursor: string;
  evictedAt: number;
}

/**
 * 终态输出日志缓存条目：附带驱逐时间戳支撑 TTL 过期回收与 LRU 淘汰。
 */
interface RetainedOutputLogEntry {
  log: ProcessOutputLog;
  evictedAt: number;
}

/**
 * 终态输出日志保留缓存。
 *
 * 独立持有已驱逐进程的输出日志缓存与墓碑登记：内存输出无法从持久层恢复，
 * 保留缓存支撑后续游标读取；TTL 过期转墓碑与 LRU 淘汰均保持同步原子。
 */
export class TerminalOutputCache {
  /** 保留日志最大条目数上限（默认） */
  static readonly DEFAULT_MAX_ENTRIES = 512;
  /** 墓碑最大登记条数上限（默认） */
  static readonly DEFAULT_MAX_TOMBSTONES = 2048;

  private readonly entries = new Map<string, RetainedOutputLogEntry>();
  private readonly tombstones = new Map<string, EvictedOutputTombstone>();
  private readonly retentionMs: number;
  private readonly maxHostBufferBytes: number;
  private readonly maxEntries: number;
  private readonly maxTombstones: number;

  constructor(options: {
    /** 保留时长（毫秒） */
    retentionMs: number;
    /** 宿主输出缓冲区字节总配额 */
    maxHostBufferBytes: number;
    /** 保留日志最大条目数，默认 512 */
    maxEntries?: number;
    /** 墓碑最大登记条数，默认 2048 */
    maxTombstones?: number;
  }) {
    this.retentionMs = options.retentionMs;
    this.maxHostBufferBytes = options.maxHostBufferBytes;
    this.maxEntries = options.maxEntries ?? TerminalOutputCache.DEFAULT_MAX_ENTRIES;
    this.maxTombstones = options.maxTombstones ?? TerminalOutputCache.DEFAULT_MAX_TOMBSTONES;
  }

  /**
   * 记录已淘汰输出日志的墓碑信息（超出容量时淘汰最旧登记，防止内存无限积压）。
   */
  private recordTombstone(processId: string, tombstone: EvictedOutputTombstone): void {
    if (this.tombstones.size >= this.maxTombstones) {
      const oldestKey = this.tombstones.keys().next().value;
      if (oldestKey) {
        this.tombstones.delete(oldestKey);
      }
    }
    this.tombstones.set(processId, tombstone);
  }

  /**
   * 清理已过期的终态输出日志条目并转为墓碑。
   */
  private cleanExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries.entries()) {
      if (now - entry.evictedAt > this.retentionMs) {
        this.recordTombstone(id, {
          tailCursor: entry.log.tailCursor,
          earliestCursor: entry.log.earliestCursor,
          evictedAt: now,
        });
        this.entries.delete(id);
      }
    }
  }

  /**
   * 获取指定进程的墓碑登记信息。
   */
  getTombstone(processId: string): EvictedOutputTombstone | undefined {
    return this.tombstones.get(processId);
  }

  /**
   * 统计终态保留日志当前在内存中实际占用的输出缓冲字节总数（附带过期清理）。
   */
  retainedBytes(): number {
    this.cleanExpired();
    let bytes = 0;
    for (const entry of this.entries.values()) {
      bytes += entry.log.currentBytes;
    }
    return bytes;
  }

  /**
   * 将终态输出日志存入保留缓存，并根据宿主配额执行 LRU 与 TTL 淘汰。
   */
  retain(processId: string, log: ProcessOutputLog): void {
    this.cleanExpired();

    // 若新加入条目会导致总输出配额超限或数量超限，按 LRU 顺序淘汰最旧条目
    while (
      (this.retainedBytes() + log.currentBytes > this.maxHostBufferBytes ||
        this.entries.size >= this.maxEntries) &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldestEntry = this.entries.get(oldestKey);
      if (oldestEntry) {
        this.recordTombstone(oldestKey, {
          tailCursor: oldestEntry.log.tailCursor,
          earliestCursor: oldestEntry.log.earliestCursor,
          evictedAt: Date.now(),
        });
      }
      this.entries.delete(oldestKey);
    }

    this.entries.set(processId, {
      log,
      evictedAt: Date.now(),
    });
  }

  /**
   * 获取终态保留日志（附带过期清理与 LRU 触达更新）。
   */
  get(processId: string): ProcessOutputLog | undefined {
    this.cleanExpired();
    const entry = this.entries.get(processId);
    if (!entry) return undefined;
    // 触达刷新 LRU 顺序
    this.entries.delete(processId);
    this.entries.set(processId, entry);
    return entry.log;
  }

  /**
   * 按 LRU 顺序逐条淘汰最旧保留日志并转为墓碑，直至剩余保留字节数不超过给定的可容纳上限。
   * 返回被淘汰条目释放的字节总数，供宿主输出缓冲预算扣减复用。
   */
  evictLRUUntil(fits: number): number {
    let evictedBytes = 0;
    while (this.entries.size > 0 && this.retainedBytes() > fits) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) {
        this.recordTombstone(oldestKey, {
          tailCursor: oldest.log.tailCursor,
          earliestCursor: oldest.log.earliestCursor,
          evictedAt: Date.now(),
        });
        evictedBytes += oldest.log.currentBytes;
      }
      this.entries.delete(oldestKey);
    }
    return evictedBytes;
  }
}
