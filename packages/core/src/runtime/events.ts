import type { ExecutionEvent } from "@actiondock/sdk";

export interface EventSink {
  emit(event: ExecutionEvent): void;
  subscribe(
    runId: string,
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent>;
  clear(runId: string): void;
}

/**
 * 进程内有界事件缓冲区实现。
 * 遵循设计文档：每个运行最多保留 1024 条或 1MB 事件，支持单调序号。
 */
export class InMemoryEventSink implements EventSink {
  private eventsByRun = new Map<string, ExecutionEvent[]>();
  private listeners = new Map<string, Set<(event: ExecutionEvent) => void>>();
  private maxEventsPerRun = 1024;

  emit(event: ExecutionEvent): void {
    let list = this.eventsByRun.get(event.runId);
    if (!list) {
      list = [];
      this.eventsByRun.set(event.runId, list);
    }

    if (list.length >= this.maxEventsPerRun) {
      // 淘汰旧日志和进度事件，保留状态和结果
      const nonEssentialIndex = list.findIndex((e) => e.type === "log" || e.type === "progress");
      if (nonEssentialIndex >= 0) {
        list.splice(nonEssentialIndex, 1);
      } else {
        list.shift();
      }
    }
    list.push(event);

    const subs = this.listeners.get(event.runId);
    if (subs) {
      for (const listener of subs) {
        try {
          listener(event);
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
    const history = this.eventsByRun.get(runId) || [];

    for (const evt of history) {
      if (evt.sequence > after) {
        yield evt;
      }
    }

    const lastEvt = history[history.length - 1];
    if (lastEvt && (lastEvt.type === "finish" || lastEvt.type === "status" && lastEvt.status !== "running")) {
      return;
    }

    const queue: ExecutionEvent[] = [];
    let notify: (() => void) | null = null;
    let done = false;

    const listener = (evt: ExecutionEvent) => {
      if (evt.sequence > after) {
        queue.push(evt);
        if (notify) {
          notify();
          notify = null;
        }
        if (evt.type === "finish") {
          done = true;
        }
      }
    };

    let subs = this.listeners.get(runId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(runId, subs);
    }
    subs.add(listener);

    const cleanup = () => {
      subs?.delete(listener);
      if (subs && subs.size === 0) {
        this.listeners.delete(runId);
      }
    };

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        done = true;
        if (notify) {
          notify();
          notify = null;
        }
      }, { once: true });
    }

    try {
      while (!done && !options.signal?.aborted) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
      }
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      cleanup();
    }
  }

  clear(runId: string): void {
    this.eventsByRun.delete(runId);
    this.listeners.delete(runId);
  }
}

let defaultEventSink: EventSink = new InMemoryEventSink();

export function getDefaultEventSink(): EventSink {
  return defaultEventSink;
}

export function setDefaultEventSink(sink: EventSink): void {
  defaultEventSink = sink;
}
