import type { Clock } from "@actiondock/core";

/**
 * 待触发的计划计时器项。
 */
interface ScheduledSleep {
  id: number;
  targetMonotonic: number;
  targetNow: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * 模拟时钟初始化选项。
 */
export interface FakeClockOptions {
  /** 初始时间戳或日期对象 */
  now?: Date | number | string;
  /** 初始单调时间戳毫秒数 */
  startMonotonic?: number;
}

/**
 * 确定性测试模拟时钟实现。
 * 遵循 Clock 接口契约，支持手动单调推进时间并调度计时器。
 */
export class FakeClock implements Clock {
  private currentNow: number;
  private currentMonotonic: number;
  private nextTimerId = 1;
  private pendingSleeps: ScheduledSleep[] = [];

  constructor(options: FakeClockOptions = {}) {
    this.currentNow =
      options.now !== undefined ? new Date(options.now).getTime() : Date.now();
    this.currentMonotonic = options.startMonotonic ?? 0;
  }

  /**
   * 获取当前模拟墙上时间。
   */
  now(): Date {
    return new Date(this.currentNow);
  }

  /**
   * 获取当前模拟单调时间戳（毫秒）。
   */
  monotonic(): number {
    return this.currentMonotonic;
  }

  /**
   * 异步休眠指定毫秒。
   * 等待通过 advance 方法推进时间至目标时刻后完成。
   *
   * @param ms 休眠毫秒数
   */
  sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const targetMonotonic = this.currentMonotonic + ms;
      const targetNow = this.currentNow + ms;
      this.pendingSleeps.push({
        id: this.nextTimerId++,
        targetMonotonic,
        targetNow,
        resolve,
        reject,
      });
      this.pendingSleeps.sort((a, b) => a.targetMonotonic - b.targetMonotonic);
    });
  }

  /**
   * 手动向前推进指定毫秒时间。
   * 严格按时间戳递增顺序触发并完成所有到期的休眠计时器；
   * 每轮触发后经排空检查点再复查队列，确保多层 async 边界内链式注册的
   * 已到期 sleep 在本次 advance 终点前全部触发（含链首有 await 边界的场景）。
   *
   * @param ms 推进的毫秒数
   */
  async advance(ms: number): Promise<void> {
    if (ms < 0) {
      throw new Error("Cannot advance clock by negative time");
    }

    const destinationMonotonic = this.currentMonotonic + ms;
    const destinationNow = this.currentNow + ms;

    // 先同步处理当前已到期项，再经检查点复查：resolve 触发的回调链
    // 可能在任意深度的 await 边界后注册新的到期 sleep，每轮排空后重新检查。
    // 首轮无到期项时全程不经过 await，保持「无等待计时器时同步推进时间」契约
    for (;;) {
      const nextSleep = this.pendingSleeps[0];
      if (!nextSleep || nextSleep.targetMonotonic > destinationMonotonic) {
        break;
      }
      this.pendingSleeps.shift();
      this.currentMonotonic = nextSleep.targetMonotonic;
      this.currentNow = nextSleep.targetNow;
      nextSleep.resolve();
      await this.drainMicrotasks();
    }

    this.currentMonotonic = destinationMonotonic;
    this.currentNow = destinationNow;
    await this.drainMicrotasks();
  }

  /**
   * 循环排空微任务队列直至稳定（一轮排空后无新的已到期 sleep 注册），
   * 保证链式 sleep 在本次 advance 终点前全部触发。
   *
   * 排空手段说明：链式 sleep 依赖的 async 回调链由微任务驱动，但纯微任务
   * 轮询无法可靠观测「已排空」；因此借助 setImmediate 作为观测哨兵——
   * setImmediate 回调只能从事件循环检查点进入，它的执行必然意味着
   * 在它之前排队的全部微任务（无论多少层 await 边界）都已完成，
   * 以此获得不依赖拍数猜测的精确稳定性判定。过程会跨过事件循环
   * 检查点（宏任务边界），但等待的对象始终只是微任务队列排空。
   */
  private drainMicrotasks(): Promise<void> {
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        // setImmediate 触发时本轮微任务已全部排空；若排空期间注册了新的
        // 已到期 sleep，再排一轮直至稳定。上限保护防御异常场景下的
        // 自续注册（正常链式回调远达不到此深度）。
        let rounds = 0;
        const check = (): void => {
          const pendingBefore = this.pendingSleeps.length;
          setImmediate(() => {
            if (this.pendingSleeps.length === pendingBefore) {
              resolve();
              return;
            }
            if (++rounds >= 10000) {
              resolve();
              return;
            }
            check();
          });
        };
        check();
      });
    });
  }

  /**
   * 获取当前等待中的计时器数量。
   */
  get pendingCount(): number {
    return this.pendingSleeps.length;
  }

  /**
   * 清除并取消所有等待中的计时器。
   */
  clear(): void {
    const sleeps = this.pendingSleeps;
    this.pendingSleeps = [];
    for (const item of sleeps) {
      item.reject(new Error("FakeClock timer cancelled"));
    }
  }
}
