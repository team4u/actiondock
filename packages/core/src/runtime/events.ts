import type { ExecutionEvent } from "@actiondock/sdk";

export interface EventSink {
  emit(event: ExecutionEvent): void;
  subscribe(
    runId: string,
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent>;
  clear(runId: string): void;
}

export interface InMemoryEventSinkOptions {
  /** 单个运行最大缓冲事件数（默认 1024） */
  maxEventsPerRun?: number;
  /** 单个运行最大缓冲字节数（默认 1024 * 1024 = 1MiB） */
  maxBytesPerRun?: number;
  /** 全局最大缓存运行数（默认 500） */
  maxRuns?: number;
}

interface RunEventEntry {
  event: ExecutionEvent;
  bytes: number;
}

interface RunBuffer {
  entries: RunEventEntry[];
  totalBytes: number;
  lastAccessedAt: number;
  isTerminal: boolean;
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
 * 1. 单运行双配额保护：上限 1024 条事件或 1MiB 字节数，优先淘汰日志与进度，保护终态。
 * 2. 全局有界回收：限制最大运行数（默认 500），溢出时优先淘汰已完成运行。
 * 3. 原子订阅衔接：先注册实时队列再回放历史快照，去重并杜绝并发丢事件窗口。
 * 4. 严格生命周期清理：迭代退出或中断时彻底注销监听器与 AbortSignal 事件。
 */
export class InMemoryEventSink implements EventSink {
  private runs = new Map<string, RunBuffer>();
  private listeners = new Map<string, Set<(event: ExecutionEvent) => void>>();
  private wakeups = new Map<string, Set<() => void>>();
  private readonly maxEventsPerRun: number;
  private readonly maxBytesPerRun: number;
  private readonly maxRuns: number;

  constructor(options: InMemoryEventSinkOptions = {}) {
    this.maxEventsPerRun = options.maxEventsPerRun ?? 1024;
    this.maxBytesPerRun = options.maxBytesPerRun ?? 1024 * 1024; // 1 MiB
    this.maxRuns = options.maxRuns ?? 500;
  }

  emit(event: ExecutionEvent): void {
    const runId = event.runId;
    const now = Date.now();
    let run = this.runs.get(runId);

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
      };
      this.runs.set(runId, run);
    } else {
      run.lastAccessedAt = now;
    }

    let processedEvent = event;
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
        processedEvent = {
          ...processedEvent,
          result: processedEvent.result.ok
            ? {
                ok: true,
                runId: processedEvent.result.runId,
                data: { _truncated: true, message: "Output exceeded maximum quota" },
              }
            : processedEvent.result,
        };
        eventBytes = estimateEventBytes(processedEvent);
      }
    }

    // 若单条事件在截断后仍超标，则拒绝入队缓冲以保护内存
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
            // 只剩 finish 事件，强行中断淘汰以避免死循环
            break;
          }
        }
      }

      run.entries.push({ event: processedEvent, bytes: eventBytes });
      run.totalBytes += eventBytes;
    }

    if (
      processedEvent.type === "finish" ||
      (processedEvent.type === "status" && processedEvent.status !== "running")
    ) {
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
    options: { after?: number; signal?: AbortSignal } = {}
  ): AsyncIterable<ExecutionEvent> {
    const after = options.after ?? -1;
    let lastYieldedSequence = after;

    if (options.signal?.aborted) {
      return;
    }

    const liveQueue: ExecutionEvent[] = [];
    let notify: (() => void) | null = null;
    let done = false;

    // 第一步：先挂载实时监听器，防止历史回放与监听注册之间的竞态丢事件
    const listener = (evt: ExecutionEvent) => {
      liveQueue.push(evt);
      if (notify) {
        notify();
        notify = null;
      }
      if (
        evt.type === "finish" ||
        (evt.type === "status" && evt.status !== "running")
      ) {
        done = true;
      }
    };

    let currentWakeupCleanup: (() => void) | null = null;
    let subs = this.listeners.get(runId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(runId, subs);
    }
    subs.add(listener);

    const onAbort = () => {
      done = true;
      if (notify) {
        notify();
        notify = null;
      }
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      if (currentWakeupCleanup) {
        currentWakeupCleanup();
        currentWakeupCleanup = null;
      }
      subs?.delete(listener);
      if (subs && subs.size === 0) {
        this.listeners.delete(runId);
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    try {
      // 第二步：回放历史快照
      const run = this.runs.get(runId);
      if (run) {
        run.lastAccessedAt = Date.now();
        const historySnapshot = run.entries.map((e) => e.event);
        for (const evt of historySnapshot) {
          if (options.signal?.aborted) return;
          if (evt.sequence > lastYieldedSequence) {
            lastYieldedSequence = evt.sequence;
            yield evt;
            if (
              evt.type === "finish" ||
              (evt.type === "status" && evt.status !== "running")
            ) {
              done = true;
              return;
            }
          }
        }

        const lastHist = historySnapshot[historySnapshot.length - 1];
        if (
          lastHist &&
          (lastHist.type === "finish" ||
            (lastHist.type === "status" && lastHist.status !== "running"))
        ) {
          done = true;
          return;
        }
      }

      // 第三步：无缝衔接消费实时队列中的事件
      while (!done && !options.signal?.aborted) {
        if (liveQueue.length > 0) {
          const evt = liveQueue.shift()!;
          if (evt.sequence > lastYieldedSequence) {
            lastYieldedSequence = evt.sequence;
            yield evt;
            if (
              evt.type === "finish" ||
              (evt.type === "status" && evt.status !== "running")
            ) {
              done = true;
              return;
            }
          }
        } else {
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
              currentWakeupCleanup = null;
            };
            const onWakeup = () => {
              done = true;
              unregister();
              resolve();
            };
            runWakeups.add(onWakeup);
            currentWakeupCleanup = unregister;
            notify = () => {
              unregister();
              resolve();
            };
          });
        }
      }

      // 消费中止或完成瞬间积压在 liveQueue 中的剩余事件
      while (liveQueue.length > 0) {
        const evt = liveQueue.shift()!;
        if (evt.sequence > lastYieldedSequence) {
          lastYieldedSequence = evt.sequence;
          yield evt;
          if (
            evt.type === "finish" ||
            (evt.type === "status" && evt.status !== "running")
          ) {
            return;
          }
        }
      }
    } finally {
      cleanup();
    }
  }

  clear(runId: string): void {
    this.runs.delete(runId);
    this.listeners.delete(runId);
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
   * 淘汰最久未活跃的运行记录（严格只淘汰已终态运行，保护活跃运行）。
   */
  private evictOldestRun(): void {
    let oldestTerminalRunId: string | null = null;
    let oldestTerminalAccess = Infinity;

    for (const [id, buffer] of this.runs.entries()) {
      if (buffer.isTerminal) {
        if (buffer.lastAccessedAt < oldestTerminalAccess) {
          oldestTerminalAccess = buffer.lastAccessedAt;
          oldestTerminalRunId = id;
        }
      }
    }

    if (oldestTerminalRunId) {
      this.clear(oldestTerminalRunId);
    }
  }
}

let defaultEventSink: EventSink = new InMemoryEventSink();

export function getDefaultEventSink(): EventSink {
  return defaultEventSink;
}

export function setDefaultEventSink(sink: EventSink): void {
  defaultEventSink = sink;
}

