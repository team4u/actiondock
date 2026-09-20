/**
 * 统一时间与时钟基础契约。
 *
 * 单一事实源：Clock 接口与 SystemClock 实现定义于此，runtime/clock.ts 与
 * storage/types.ts 一律从本文件引用或转发，禁止重复实现。
 */

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
