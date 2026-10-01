import type { ExecutionEvent } from "@actiondock/sdk";

export interface EventSinkSubscribeOptions {
  /** 起始游标位置（序号或事件标识） */
  after?: number | string;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 订阅者事件队列上限（默认 1000） */
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
  /** 单个运行最大缓冲事件数（默认 1000） */
  maxEventsPerRun?: number;
  /** 全局最大缓存运行数（默认 500） */
  maxRuns?: number;
  /** 订阅者事件队列上限（默认 1000） */
  maxSubscriberQueueSize?: number;
}

interface RunBuffer {
  entries: ExecutionEvent[];
  lastAccessedAt: number;
  isTerminal: boolean;
  droppedCount: number;
}

/**
 * 订阅者通道：管理单个订阅者的事件缓冲队列与唤醒通知。
 * 队列满时丢弃最旧事件并累计计数，不阻塞主流程，不切断通道。
 */
class SubscriberChannel {
  readonly liveQueue: ExecutionEvent[] = [];
  droppedCount = 0;
  done = false;
  notify: (() => void) | null = null;
  readonly maxQueueSize: number;

  constructor(maxQueueSize: number) {
    this.maxQueueSize = maxQueueSize;
  }

  receive(evt: ExecutionEvent): void {
    if (this.done) return;

    if (this.liveQueue.length >= this.maxQueueSize) {
      this.liveQueue.shift();
      this.droppedCount++;
    }
    this.liveQueue.push(evt);

    if (this.notify) {
      const cb = this.notify;
      this.notify = null;
      cb();
    }
  }

  terminate(): void {
    this.done = true;
    if (this.notify) {
      const cb = this.notify;
      this.notify = null;
      cb();
    }
  }
}

/**
 * 进程内轻量发布订阅事件广播器。
 * 遵循设计规范：
 * - 轻量发布订阅：保留订阅、退订、按 runId 过滤与事件分发。
 * - 纯净广播：事件原样广播，绝不进行字节估算，绝不篡改用户执行结果。
 * - 有界缓冲队列：简单条数上限（如 1000 条），队列满时丢弃最旧并计数，不切断通道。
 * - 全局有界回收：限制最大运行数（默认 500），溢出时优先淘汰已完成运行。
 * - 错误隔离保护：单个订阅者监听器异常不扩散，保障系统整体稳定性。
 */
export class InMemoryEventSink implements EventSink {
  private runs = new Map<string, RunBuffer>();
  private listeners = new Map<string, Set<(evt: ExecutionEvent) => void>>();
  private evictions = new Map<string, Set<() => void>>();
  private evictedRuns = new Set<string>();
  private globalEventSeq = 0;

  private maxEventsPerRun: number;
  private maxRuns: number;
  private maxSubscriberQueueSize: number;

  constructor(options: InMemoryEventSinkOptions = {}) {
    this.maxEventsPerRun = options.maxEventsPerRun ?? 1000;
    this.maxRuns = options.maxRuns ?? 500;
    this.maxSubscriberQueueSize = options.maxSubscriberQueueSize ?? 1000;
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
      if (this.runs.size >= this.maxRuns) {
        this.evictOldestRun();
      }
      run = {
        entries: [],
        lastAccessedAt: now,
        isTerminal: false,
        droppedCount: 0,
      };
      this.runs.set(runId, run);
      this.evictedRuns.delete(runId);
    } else {
      run.lastAccessedAt = now;
    }

    while (run.entries.length >= this.maxEventsPerRun) {
      run.entries.shift();
      run.droppedCount++;
    }
    run.entries.push(processedEvent);

    if (processedEvent.type === "finish") {
      run.isTerminal = true;
    }

    // 广播至当前活跃监听器，错误隔离保护
    const subs = this.listeners.get(runId);
    if (subs && subs.size > 0) {
      for (const listener of Array.from(subs)) {
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
    if (options.signal?.aborted || this.evictedRuns.has(runId)) {
      return;
    }

    let afterSequence = -1;
    let afterEventId: string | undefined;
    if (options.after !== undefined) {
      if (typeof options.after === "number") {
        afterSequence = options.after;
      } else {
        const trimmed = String(options.after).trim();
        if (/^-?\d+$/.test(trimmed)) {
          afterSequence = parseInt(trimmed, 10);
        } else {
          afterEventId = trimmed;
        }
      }
    }

    let lastYieldedSequence = afterSequence;
    const maxQueueSize = options.maxQueueSize ?? this.maxSubscriberQueueSize;
    const channel = new SubscriberChannel(maxQueueSize);
    const listener = (evt: ExecutionEvent) => channel.receive(evt);

    let subs = this.listeners.get(runId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(runId, subs);
    }
    subs.add(listener);

    let evictSet = this.evictions.get(runId);
    if (!evictSet) {
      evictSet = new Set();
      this.evictions.set(runId, evictSet);
    }
    const onEvict = () => channel.terminate();
    evictSet.add(onEvict);

    const onAbort = () => channel.terminate();
    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      subs?.delete(listener);
      if (subs && subs.size === 0) {
        this.listeners.delete(runId);
      }
      evictSet?.delete(onEvict);
      if (evictSet && evictSet.size === 0) {
        this.evictions.delete(runId);
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    const isDeliverable = (evt: ExecutionEvent): boolean => {
      if (afterEventId) {
        if (evt.eventId === afterEventId) {
          lastYieldedSequence = Math.max(lastYieldedSequence, evt.sequence);
          afterEventId = undefined;
        }
        return false;
      }
      return evt.sequence > lastYieldedSequence;
    };

    try {
      // 1. 回放历史快照
      const run = this.runs.get(runId);
      if (run) {
        run.lastAccessedAt = Date.now();
        const snapshot = [...run.entries];
        for (const evt of snapshot) {
          if (options.signal?.aborted) return;
          if (isDeliverable(evt)) {
            lastYieldedSequence = evt.sequence;
            yield evt;
            if (evt.type === "finish") {
              channel.done = true;
              return;
            }
          }
        }

        // 若历史记录已终态，排空实时队列后直接结束
        if (run.isTerminal) {
          while (channel.liveQueue.length > 0) {
            const evt = channel.liveQueue.shift()!;
            if (isDeliverable(evt)) {
              lastYieldedSequence = evt.sequence;
              yield evt;
              if (evt.type === "finish") {
                channel.done = true;
                return;
              }
            }
          }
          channel.done = true;
          return;
        }
      }

      // 2. 消费实时事件队列
      while (!options.signal?.aborted) {
        if (this.evictedRuns.has(runId)) {
          break;
        }

        if (channel.liveQueue.length > 0) {
          const evt = channel.liveQueue.shift()!;
          if (isDeliverable(evt)) {
            lastYieldedSequence = evt.sequence;
            yield evt;
            if (evt.type === "finish") {
              channel.done = true;
              return;
            }
          }
        } else {
          if (channel.done) {
            break;
          }
          await new Promise<void>((resolve) => {
            channel.notify = resolve;
          });
        }
      }

      // 3. 消费中止或完成瞬间积压的剩余事件
      while (channel.liveQueue.length > 0) {
        const evt = channel.liveQueue.shift()!;
        if (isDeliverable(evt)) {
          lastYieldedSequence = evt.sequence;
          yield evt;
          if (evt.type === "finish") {
            return;
          }
        }
      }
    } finally {
      cleanup();
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
  }

  getRunStats(runId: string): { count: number; isTerminal: boolean; droppedCount: number } | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    return {
      count: run.entries.length,
      isTerminal: run.isTerminal,
      droppedCount: run.droppedCount,
    };
  }

  getRunCount(): number {
    return this.runs.size;
  }

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

  close(): void {
    for (const evictSet of this.evictions.values()) {
      for (const onEvict of evictSet) {
        try {
          onEvict();
        } catch {
          // ignore
        }
      }
    }
    this.evictions.clear();
    this.listeners.clear();
  }
}
