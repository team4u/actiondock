import {
  REQUEST_CONFLICT,
  ProcessError,
} from "../errors";
import type { ProcessRequestKey } from "./metadata-store";

/**
 * 同步幂等预占条目：在异步落盘窗口内锁定同作用域、进程、操作类型与请求标识的并发请求。
 */
export interface RequestReservation {
  payloadHash: string;
  operation: string;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * 格式化同步幂等预占键。
 */
function formatReservationKey(key: ProcessRequestKey, operation: string): string {
  return `${key.hostEpoch}:${key.scope}:${key.processId ?? ""}:${operation}:${key.requestId}`;
}

/**
 * 同步幂等预占表。
 *
 * 以复合键在异步落盘窗口内锁定并发重复请求，独立持有全部预占条目：
 * commit 与 reject 均为「查表、删除、resolve/reject」同步原子序列。
 */
export class ReservationTable {
  private readonly reservations = new Map<string, RequestReservation>();

  /**
   * 同步预占幂等请求：跨 await 的检查与落盘窗口内锁定同复合键并发调用。
   * 返回 undefined 表示预占成功，调用方继续异步路径并在完成时调用 commit/reject。
   * 返回 RequestReservation 表示已有同请求进行中，调用方可等待其结果。
   * 若已有请求负载或操作类型不同，立即抛出 REQUEST_CONFLICT 杜绝混用结果。
   */
  reserve(
    key: ProcessRequestKey,
    payloadHash: string,
    operation: string
  ): RequestReservation | undefined {
    const reservationKey = formatReservationKey(key, operation);
    const existing = this.reservations.get(reservationKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.operation !== operation) {
        throw new ProcessError(
          REQUEST_CONFLICT,
          "Request conflict: identical requestId with different payload",
          { requestId: key.requestId }
        );
      }
      return existing;
    }
    let resolveFn: (value: unknown) => void = () => {};
    let rejectFn: (err: unknown) => void = () => {};
    const promise = new Promise<unknown>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    // 预占 promise 可能永远无人等待：预先挂接空捕获，避免拒绝时触发 unhandledRejection
    promise.catch(() => {});
    const reservation: RequestReservation = {
      payloadHash,
      operation,
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    };
    this.reservations.set(reservationKey, reservation);
    return undefined;
  }

  /**
   * 结算预占：同步完成查表、删除与 resolve 的原子序列。
   */
  commit(key: ProcessRequestKey, operation: string, value: unknown): void {
    const reservationKey = formatReservationKey(key, operation);
    const reservation = this.reservations.get(reservationKey);
    if (reservation) {
      this.reservations.delete(reservationKey);
      reservation.resolve(value);
    }
  }

  /**
   * 拒绝预占：同步完成查表、删除与 reject 的原子序列。
   */
  reject(key: ProcessRequestKey, operation: string, err: unknown): void {
    const reservationKey = formatReservationKey(key, operation);
    const reservation = this.reservations.get(reservationKey);
    if (reservation) {
      this.reservations.delete(reservationKey);
      reservation.reject(err);
    }
  }

  /**
   * 逐条拒绝并删除全部残余预占，供宿主关闭时唤醒全部等待方。
   */
  rejectAll(err: unknown): void {
    for (const [reservationKey, res] of Array.from(this.reservations.entries())) {
      this.reservations.delete(reservationKey);
      res.reject(err);
    }
  }
}
