/**
 * 统一时间与时钟接口。
 */
export interface Clock {
  /** 获取当前系统墙上时间 */
  now(): Date;
  /** 获取单调递增时间戳（单位：毫秒） */
  monotonic(): number;
  /** 异步休眠指定毫秒 */
  sleep(ms: number): Promise<void>;
}

/**
 * 生产环境系统时钟实现。
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  monotonic(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let defaultClock: Clock = new SystemClock();

export function getSystemClock(): Clock {
  return defaultClock;
}

export function setSystemClock(clock: Clock): void {
  defaultClock = clock;
}
