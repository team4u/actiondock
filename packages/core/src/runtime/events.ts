import type { ExecutionEvent } from "@actiondock/sdk";
import { EVENT_BACKPRESSURE_LIMIT, EVENT_CURSOR_EXPIRED } from "../errors";

export interface EventSinkSubscribeOptions {
  after?: number | string;
  signal?: AbortSignal;
  maxQueueSize?: number;
}

export interface EventSink {
  emit(event: ExecutionEvent): void;
  subscribe(
    runId: string,
    options?: EventSinkSubscribeOptions
  ): AsyncIterable<ExecutionEvent>;
  clear(runId: string): void;
  close?(): void;
}

export interface InMemoryEventSinkOptions {
  /** 单个运行最大缓冲事件数（默认 1024） */
  maxEventsPerRun?: number;
  /** 单个运行最大缓冲字节数（默认 1024 * 1024 = 1MiB） */
  maxBytesPerRun?: number;
  /** 全局最大缓存运行数（默认 500） */
  maxRuns?: number;
  /** 慢订阅者事件队列背压有界上限（默认 1024） */
  maxSubscriberQueueSize?: number;
}

interface RunEventEntry {
  event: ExecutionEvent;
  bytes: number;
}

/**
 * 订阅者游标确认状态（用于背压终止事件中的续传信息与去重判断）。
 */
interface SubscriberCursor {
  /** 已交付的最大事件序号 */
  lastYieldedSequence: number;
  /** 最后确认的事件 ID（存在时优先作为续传游标） */
  lastConfirmedEventId?: string;
  /** 最后确认的事件序号 */
  lastConfirmedSequence: number;
}

/**
 * 订阅者通道：封装实时事件队列、监听器与终止状态。
 * 职责：
 * - 接收实时推送事件并入队（超出背压上限时推送终止事件并切断通道）。
 * - 维护 done 终止标记与唤醒回调，供生成器编排消费。
 * - 暴露 inactive 注销钩子，供外部在通道切断时注销监听器。
 */
class SubscriberChannel {
  /** 实时事件队列（含背压终止事件） */
  readonly liveQueue: ExecutionEvent[] = [];
  /** 是否已收到终止信号（finish、淘汰、中断或唤醒） */
  done = false;
  /** 实时监听器（入队与背压终止逻辑入口） */
  readonly listener: (evt: ExecutionEvent) => void;
  /** 通道被切断或订阅退出时的注销回调（由订阅方注入） */
  onInactive: (() => void) | null = null;
  /** 等待挂起期间的唤醒回调（由等待方注入） */
  notify: (() => void) | null = null;

  private readonly runId: string;
  private readonly maxQueueSize: number;
  private readonly cursor: SubscriberCursor;
  private readonly allocateEventId: () => string;
  private backpressureTerminated = false;

  constructor(options: {
    runId: string;
    maxQueueSize: number;
    cursor: SubscriberCursor;
    allocateEventId: () => string;
  }) {
    this.runId = options.runId;
    this.maxQueueSize = options.maxQueueSize;
    this.cursor = options.cursor;
    this.allocateEventId = options.allocateEventId;
    this.listener = (evt: ExecutionEvent) => this.receive(evt);
  }

  /**
   * 接收单条实时事件：队列满时推送背压终止事件并切断通道。
   */
  private receive(evt: ExecutionEvent): void {
    if (this.backpressureTerminated || this.done) {
      return;
    }

    if (this.liveQueue.length >= this.maxQueueSize) {
      // 慢订阅者导致队列溢出：向该慢订阅者推送终止事件并切断通道，主运行不受反向阻塞
      this.backpressureTerminated = true;
      this.onInactive?.();

      const termEvt: ExecutionEvent = {
        runId: this.runId,
        rootRunId: evt.rootRunId || this.runId,
        sequence: evt.sequence + 1,
        eventId: this.allocateEventId(),
        timestamp: new Date().toISOString(),
        type: "error",
        error: {
          code: EVENT_BACKPRESSURE_LIMIT,
          message: `Event subscription queue exceeded limit of ${this.maxQueueSize} items due to slow subscriber`,
          details: {
            lastConfirmedCursor:
              this.cursor.lastConfirmedEventId ??
              (this.cursor.lastConfirmedSequence >= 0 ? String(this.cursor.lastConfirmedSequence) : "0"),
            lastConfirmedEventId: this.cursor.lastConfirmedEventId,
            lastConfirmedSequence: this.cursor.lastConfirmedSequence,
          },
        },
      };

      this.liveQueue.length = 0;
      this.liveQueue.push(termEvt);
      if (this.notify) {
        this.notify();
        this.notify = null;
      }
      return;
    }

    this.liveQueue.push(evt);
    if (this.notify) {
      this.notify();
      this.notify = null;
    }
    if (evt.type === "finish") {
      this.done = true;
    }
  }

  /**
   * 标记通道终止并唤醒挂起的等待方。
   */
  terminate(): void {
    this.done = true;
    if (this.notify) {
      this.notify();
      this.notify = null;
    }
  }
}

interface RunBuffer {
  entries: RunEventEntry[];
  totalBytes: number;
  lastAccessedAt: number;
  isTerminal: boolean;
  earliestRetainedSequence?: number;
  earliestRetainedEventId?: string;
}

/**
 * 计算单个事件的 UTF-8 JSON 字节长度。
 */
function estimateEventBytes(event: ExecutionEvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event), "utf8");
  } catch {
    return 256;
  }
}

/**
 * 进程内有界事件缓冲区实现。
 * 遵循设计规范：
 * - 单运行双配额保护：上限 1024 条事件或 1MiB 字节数，优先淘汰日志与进度，保护终态。
 * - 全局有界回收：限制最大运行数（默认 500），溢出时优先淘汰已完成运行。
 * - 原子订阅衔接：先注册实时队列再回放历史快照，去重并杜绝并发丢事件窗口。
 * - 严格生命周期清理：迭代退出或中断时彻底注销监听器与 AbortSignal 事件。
 * - 慢订阅者背压保护：队列超出上限时推送终止事件并切断通道，主运行不受阻。
 * - 游标断点续传：支持全局持久化 eventId 与序列号，过期游标返回 EVENT_CURSOR_EXPIRED。
 */
export class InMemoryEventSink implements EventSink {
  private runs = new Map<string, RunBuffer>();
  private listeners = new Map<string, Set<(evt: ExecutionEvent) => void>>();
  private wakeups = new Map<string, Set<() => void>>();
  private evictions = new Map<string, Set<() => void>>();
  private evictedRuns = new Set<string>();
  private globalEventSeq = 0;

  private maxEventsPerRun: number;
  private maxBytesPerRun: number;
  private maxRuns: number;
  private maxSubscriberQueueSize: number;

  constructor(options: InMemoryEventSinkOptions = {}) {
    this.maxEventsPerRun = options.maxEventsPerRun ?? 1024;
    this.maxBytesPerRun = options.maxBytesPerRun ?? 1024 * 1024; // 1 MiB
    this.maxRuns = options.maxRuns ?? 500;
    this.maxSubscriberQueueSize = options.maxSubscriberQueueSize ?? 1024;
  }

  emit(event: ExecutionEvent): void {
    const runId = event.runId;
    const now = Date.now();
    let run = this.runs.get(runId);

    let processedEvent = event;
    if (!processedEvent.eventId) {
      processedEvent = {
        ...processedEvent,
        eventId: String(++this.globalEventSeq),
      };
    }

    if (!run) {
      // 全局有界淘汰
      if (this.runs.size >= this.maxRuns) {
        this.evictOldestRun();
      }
      run = {
        entries: [],
        totalBytes: 0,
        lastAccessedAt: now,
        isTerminal: false,
        earliestRetainedSequence: processedEvent.sequence,
        earliestRetainedEventId: processedEvent.eventId,
      };
      this.runs.set(runId, run);
      this.evictedRuns.delete(runId);
    } else {
      run.lastAccessedAt = now;
      if (run.earliestRetainedSequence === undefined) {
        run.earliestRetainedSequence = processedEvent.sequence;
        run.earliestRetainedEventId = processedEvent.eventId;
      }
    }

    let eventBytes = estimateEventBytes(processedEvent);

    // 如果单条事件本身超过单运行最大字节限制，尝试截断 log / finish 数据
    if (eventBytes > this.maxBytesPerRun) {
      if (processedEvent.type === "log" && typeof processedEvent.message === "string") {
        const keepChars = Math.max(0, Math.floor(this.maxBytesPerRun / 2));
        processedEvent = {
          ...processedEvent,
          message: `${processedEvent.message.slice(0, keepChars)}... [TRUNCATED]`,
          data: undefined,
        };
        eventBytes = estimateEventBytes(processedEvent);
      } else if (processedEvent.type === "finish" && processedEvent.result) {
        if (processedEvent.result.ok) {
          processedEvent = {
            ...processedEvent,
            result: {
              ok: true,
              runId: processedEvent.result.runId,
              data: { _truncated: true, message: "Output exceeded maximum quota" },
            },
          };
        } else {
          const err = processedEvent.result.error;
          const keepChars = Math.max(0, Math.min(200, Math.floor(this.maxBytesPerRun / 2)));
          const truncatedMsg =
            typeof err?.message === "string"
              ? `${err.message.slice(0, keepChars)}... [TRUNCATED]`
              : "Error exceeded maximum quota";
          processedEvent = {
            ...processedEvent,
            result: {
              ok: false,
              runId: processedEvent.result.runId,
              error: {
                code: err?.code || "EXECUTION_ERROR",
                message: truncatedMsg,
              },
            },
          };
        }
        eventBytes = estimateEventBytes(processedEvent);
      }
    }

    // 严格限制单运行缓存字节配额，超标事件不可入队，杜绝突破 maxBytesPerRun
    if (eventBytes <= this.maxBytesPerRun) {
      // 检查是否超出单运行条数或字节配额，按优先级淘汰
      while (
        run.entries.length > 0 &&
        (run.entries.length >= this.maxEventsPerRun ||
          run.totalBytes + eventBytes > this.maxBytesPerRun)
      ) {
        // 优先淘汰非核心事件：log 或 progress
        const nonEssentialIndex = run.entries.findIndex(
          (e) => e.event.type === "log" || e.event.type === "progress"
        );

        if (nonEssentialIndex >= 0) {
          const removed = run.entries.splice(nonEssentialIndex, 1)[0];
          run.totalBytes -= removed.bytes;
        } else {
          // 无非核心事件时，淘汰最早的非 finish 事件
          const nonTerminalIndex = run.entries.findIndex((e) => e.event.type !== "finish");
          if (nonTerminalIndex >= 0) {
            const removed = run.entries.splice(nonTerminalIndex, 1)[0];
            run.totalBytes -= removed.bytes;
          } else {
            const removed = run.entries.shift()!;
            run.totalBytes -= removed.bytes;
          }
        }
      }

      if (run.entries.length > 0) {
        run.earliestRetainedSequence = run.entries[0].event.sequence;
        run.earliestRetainedEventId = run.entries[0].event.eventId;
      }

      if (run.totalBytes + eventBytes <= this.maxBytesPerRun) {
        run.entries.push({ event: processedEvent, bytes: eventBytes });
        run.totalBytes += eventBytes;
      }
    }

    // 仅在接收到 finish 事件时才标记已终态，防止在终态 status 与 finish 之间的窗口内订阅过早结束
    if (processedEvent.type === "finish") {
      run.isTerminal = true;
    }

    // 广播至当前活跃监听器
    const subs = this.listeners.get(runId);
    if (subs && subs.size > 0) {
      for (const listener of subs) {
        try {
          listener(processedEvent);
        } catch {
          // 忽略单个监听器内部异常
        }
      }
    }
  }

  async *subscribe(
    runId: string,
    options: EventSinkSubscribeOptions = {}
  ): AsyncIterable<ExecutionEvent> {
    let afterSequence: number | undefined;
    let afterEventId: string | undefined;

    if (options.after !== undefined) {
      if (typeof options.after === "number") {
        afterSequence = options.after;
      } else {
        const trimmed = String(options.after).trim();
        if (/^-?\d+$/.test(trimmed)) {
          afterSequence = parseInt(trimmed, 10);
        }
        afterEventId = trimmed;
      }
    }

    const effectiveAfter = afterSequence ?? -1;
    const cursor: SubscriberCursor = {
      lastYieldedSequence: effectiveAfter,
      lastConfirmedEventId: afterEventId,
      lastConfirmedSequence: effectiveAfter,
    };

    if (options.signal?.aborted || this.evictedRuns.has(runId)) {
      return;
    }

    // 检查游标是否在请求前已过期被清理
    const run = this.runs.get(runId);
    if (run && options.after !== undefined) {
      this.assertCursorRetained(run, options.after, afterSequence);
    }

    const channel = new SubscriberChannel({
      runId,
      maxQueueSize: options.maxQueueSize ?? this.maxSubscriberQueueSize,
      cursor,
      allocateEventId: () => String(++this.globalEventSeq),
    });

    let subs = this.listeners.get(runId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(runId, subs);
    }

    const cleanupListener = () => {
      subs?.delete(channel.listener);
      if (subs && subs.size === 0) {
        this.listeners.delete(runId);
      }
    };
    channel.onInactive = cleanupListener;

    let evictSet = this.evictions.get(runId);
    if (!evictSet) {
      evictSet = new Set();
      this.evictions.set(runId, evictSet);
    }

    const onEvict = () => channel.terminate();
    const onAbort = () => channel.terminate();

    let currentWakeupCleanup: (() => void) | null = null;

    // 先挂载实时监听器，防止历史回放与监听注册之间的竞态丢事件
    subs.add(channel.listener);
    evictSet.add(onEvict);
    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      if (currentWakeupCleanup) {
        currentWakeupCleanup();
        currentWakeupCleanup = null;
      }
      cleanupListener();
      evictSet?.delete(onEvict);
      if (evictSet && evictSet.size === 0) {
        this.evictions.delete(runId);
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    try {
      // 回放历史快照
      if (run) {
        run.lastAccessedAt = Date.now();
        const historySnapshot = run.entries.map((e) => e.event);
        for (const evt of historySnapshot) {
          if (options.signal?.aborted) return;
          if (evt.sequence > cursor.lastYieldedSequence) {
            this.trackDeliveredEvent(cursor, evt);
            yield evt;
            if (this.isTerminalDelivery(evt)) {
              channel.done = true;
              return;
            }
          }
        }

        // 若该运行已终态且历史中已无 finish 事件，先排空实时队列已到达的事件
        if (run.isTerminal) {
          while (channel.liveQueue.length > 0) {
            const evt = this.takeNextDeliverable(channel, cursor);
            if (evt) {
              yield evt;
              if (this.isTerminalDelivery(evt)) {
                channel.done = true;
                return;
              }
            }
          }
          channel.done = true;
          return;
        }
      }

      // 无缝衔接消费实时队列中的事件
      while ((channel.liveQueue.length > 0 || !channel.done) && !options.signal?.aborted) {
        if (this.evictedRuns.has(runId)) {
          channel.done = true;
          break;
        }
        if (channel.liveQueue.length > 0) {
          const evt = this.takeNextDeliverable(channel, cursor);
          if (evt) {
            yield evt;
            if (this.isTerminalDelivery(evt)) {
              channel.done = true;
              return;
            }
          }
        } else {
          if (this.evictedRuns.has(runId)) {
            channel.done = true;
            break;
          }
          await this.waitForNextEvent(runId, channel, (cleanupFn) => {
            currentWakeupCleanup = cleanupFn;
          });
        }
      }

      // 消费中止或完成瞬间积压在 liveQueue 中的剩余事件
      while (channel.liveQueue.length > 0) {
        const evt = this.takeNextDeliverable(channel, cursor);
        if (evt) {
          yield evt;
          if (this.isTerminalDelivery(evt)) {
            return;
          }
        }
      }
    } finally {
      cleanup();
    }
  }

  /**
   * 断言请求游标仍处于保留窗口内（过期则抛出 EVENT_CURSOR_EXPIRED 错误）。
   */
  private assertCursorRetained(
    run: RunBuffer,
    after: number | string,
    afterSequence: number | undefined
  ): void {
    const earliestSeq = run.earliestRetainedSequence ?? 0;
    if (afterSequence !== undefined && afterSequence >= 0 && afterSequence < earliestSeq - 1) {
      const earliestCursor = run.earliestRetainedEventId ?? String(earliestSeq);
      const expiredErr = new Error(
        `Event cursor '${after}' has expired; earliest available cursor is '${earliestCursor}'`
      );
      (expiredErr as any).code = EVENT_CURSOR_EXPIRED;
      (expiredErr as any).details = {
        cursor: after,
        earliestCursor,
        earliestRetainedCursor: earliestCursor,
        earliestSequence: earliestSeq,
        earliestEventId: run.earliestRetainedEventId,
      };
      throw expiredErr;
    }
  }

  /**
   * 记录已交付事件并推进游标（已交付序号与最后确认游标）。
   */
  private trackDeliveredEvent(cursor: SubscriberCursor, evt: ExecutionEvent): void {
    cursor.lastYieldedSequence = evt.sequence;
    cursor.lastConfirmedSequence = evt.sequence;
    if (evt.eventId) cursor.lastConfirmedEventId = evt.eventId;
  }

  /**
   * 终止谓词：finish 事件或背压终止事件交付后订阅应立即结束。
   */
  private isTerminalDelivery(evt: ExecutionEvent): boolean {
    return (
      evt.type === "finish" ||
      (evt.type === "error" && evt.error?.code === EVENT_BACKPRESSURE_LIMIT)
    );
  }

  /**
   * 从实时队列取出下一条应交付的事件（跳过已交付序号），并同步推进游标。
   */
  private takeNextDeliverable(
    channel: SubscriberChannel,
    cursor: SubscriberCursor
  ): ExecutionEvent | undefined {
    const evt = channel.liveQueue.shift();
    if (!evt) return undefined;
    if (evt.sequence > cursor.lastYieldedSequence || evt.type === "error") {
      this.trackDeliveredEvent(cursor, evt);
      return evt;
    }
    return undefined;
  }

  /**
   * 挂起等待下一条实时事件、通道终止或运行淘汰唤醒（严格注销监听避免泄漏）。
   */
  private async waitForNextEvent(
    runId: string,
    channel: SubscriberChannel,
    registerCleanup: (cleanup: (() => void) | null) => void
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let runWakeups = this.wakeups.get(runId);
      if (!runWakeups) {
        runWakeups = new Set();
        this.wakeups.set(runId, runWakeups);
      }
      const unregister = () => {
        runWakeups?.delete(onWakeup);
        if (runWakeups && runWakeups.size === 0) {
          this.wakeups.delete(runId);
        }
        registerCleanup(null);
      };
      const onWakeup = () => {
        channel.done = true;
        unregister();
        resolve();
      };
      runWakeups.add(onWakeup);
      registerCleanup(unregister);
      channel.notify = () => {
        unregister();
        resolve();
      };
    });
  }
  /**
   * 手动修剪已终态运行中早于指定序列号的历史事件（用于模拟过期清理）。
   */
  pruneEvents(runId: string, upToSequence: number): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const idx = run.entries.findIndex((e) => e.event.sequence > upToSequence);
    if (idx > 0) {
      const removed = run.entries.splice(0, idx);
      for (const r of removed) {
        run.totalBytes -= r.bytes;
      }
    } else if (idx === -1 && run.entries.length > 0) {
      run.entries = [];
      run.totalBytes = 0;
    }
    if (run.entries.length > 0) {
      run.earliestRetainedSequence = run.entries[0].event.sequence;
      run.earliestRetainedEventId = run.entries[0].event.eventId;
    } else {
      run.earliestRetainedSequence = upToSequence + 1;
      run.earliestRetainedEventId = undefined;
    }
  }

  clear(runId: string): void {
    this.evictedRuns.add(runId);
    if (this.evictedRuns.size > 2000) {
      const first = this.evictedRuns.values().next().value;
      if (first) {
        this.evictedRuns.delete(first);
      }
    }
    this.runs.delete(runId);
    this.listeners.delete(runId);
    const evictCbs = this.evictions.get(runId);
    if (evictCbs) {
      this.evictions.delete(runId);
      for (const cb of Array.from(evictCbs)) {
        try {
          cb();
        } catch {
          // ignore
        }
      }
    }
    const waiting = this.wakeups.get(runId);
    if (waiting) {
      const cbs = Array.from(waiting);
      this.wakeups.delete(runId);
      for (const wake of cbs) {
        try {
          wake();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 获取指定运行的事件统计信息（调试与测试用）。
   */
  getRunStats(runId: string): { count: number; bytes: number; isTerminal: boolean } | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    return {
      count: run.entries.length,
      bytes: run.totalBytes,
      isTerminal: run.isTerminal,
    };
  }

  /**
   * 获取全局缓存的运行数。
   */
  getRunCount(): number {
    return this.runs.size;
  }

  /**
   * 淘汰最久未活跃的运行记录。
   * 优先淘汰已终态运行；若无终态运行则淘汰最旧活动运行，严格保证 runs.size <= maxRuns。
   */
  private evictOldestRun(): void {
    let candidateRunId: string | null = null;
    let candidateAccess = Infinity;

    for (const [id, buffer] of this.runs.entries()) {
      if (buffer.isTerminal) {
        if (buffer.lastAccessedAt < candidateAccess) {
          candidateAccess = buffer.lastAccessedAt;
          candidateRunId = id;
        }
      }
    }

    if (!candidateRunId) {
      for (const [id, buffer] of this.runs.entries()) {
        if (buffer.lastAccessedAt < candidateAccess) {
          candidateAccess = buffer.lastAccessedAt;
          candidateRunId = id;
        }
      }
    }

    if (candidateRunId) {
      this.clear(candidateRunId);
    }
  }

  /**
   * 关闭事件接收器并唤醒所有活跃订阅者退出。
   */
  close(): void {
    for (const wakeups of this.wakeups.values()) {
      for (const onWakeup of wakeups) {
        onWakeup();
      }
    }
    this.wakeups.clear();
    this.listeners.clear();
  }
}

