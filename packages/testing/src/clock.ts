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
    if (options.now !== undefined) {
      this.currentNow = new Date(options.now).getTime();
    } else {
      this.currentNow = Date.now();
    }
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
   * 严格按时间戳递增顺序触发并完成所有到期的休眠计时器。
   *
   * @param ms 推进的毫秒数
   */
  async advance(ms: number): Promise<void> {
    if (ms < 0) {
      throw new Error("Cannot advance clock by negative time");
    }
    if (ms === 0) {
      await Promise.resolve();
      return;
    }

    const destinationMonotonic = this.currentMonotonic + ms;
    const destinationNow = this.currentNow + ms;

    while (this.pendingSleeps.length > 0) {
      const nextSleep = this.pendingSleeps[0];
      if (nextSleep.targetMonotonic > destinationMonotonic) {
        break;
      }

      this.pendingSleeps.shift();
      this.currentMonotonic = nextSleep.targetMonotonic;
      this.currentNow = nextSleep.targetNow;
      nextSleep.resolve();

      await Promise.resolve();
    }

    this.currentMonotonic = destinationMonotonic;
    this.currentNow = destinationNow;
    await Promise.resolve();
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
