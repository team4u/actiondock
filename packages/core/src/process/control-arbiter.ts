import { randomUUID } from "node:crypto";
import type { ControlGrant } from "@actiondock/sdk";
import {
  ACCESS_DENIED,
  CONTROL_BUSY,
  CONTROL_EXPIRED,
  CONTROL_REVOKED,
  PROCESS_QUARANTINED,
  QUOTA_EXCEEDED,
  ProcessError,
} from "../errors";
import type {
  AcquireWaiter,
  ManagedProcessRecord,
  ProcessOwner,
} from "./managed-record";
import type { StoredProcessRecord } from "./metadata-store";

/**
 * 控制权仲裁器宿主协作回调集合。
 *
 * 持有者始终为 ProcessManager：仲裁器仅经回调透传副作用，不反向依赖管理器。
 */
export interface ControlArbiterHost {
  /** 控制权状态落盘（异步尽力而为） */
  persistState(processId: string, patch: Partial<StoredProcessRecord>): unknown;
  /** 排队路径授予成功时的凭据落盘（异步尽力而为） */
  persistGrantReceipt(
    grant: ControlGrant,
    wait: { requestId: string; waitMs: number; ttlMs: number },
    proc: ManagedProcessRecord
  ): unknown;
  /** 控制权事件后的空闲定时器刷新（授予、续租与成功输入均触发） */
  refreshIdleTimer(proc: ManagedProcessRecord): void;
  /** 到期复核通过后的隔离处置（隔离而非释放） */
  quarantineProcess(
    owner: ProcessOwner,
    processId: string,
    token?: string,
    reason?: string
  ): unknown;
  /** 宿主级等待者配额统计（含全部进程的排队等待者） */
  countHostAcquireWaiters(): number;
  /** 宿主等待者配额上限 */
  readonly maxWaitersPerProcess: number;
  /** 单进程等待者配额上限 */
  readonly maxWaitersPerHost: number;
}

/**
 * 控制权仲裁器。
 *
 * 单一职责：独占控制权状态机的全部推进路径——
 * - 直接授予与 FIFO 等待队列（唯一唤醒）
 * - TTL 定时器生命周期（设置、续租换新、清理）
 * - 到期复核（复合控制态与凭据双重校验，转隔离而非释放）
 * - 操作授权校验（write/control 提交前与调度复核共用）
 * - 终态等待者单一拒绝入口
 */
export class ControlArbiter {
  private readonly host: ControlArbiterHost;

  constructor(host: ControlArbiterHost) {
    this.host = host;
  }

  /**
   * 尝试立即授予控制权：控制权空闲且无等待者时直接授予，
   * 否则按 FIFO 进入等待队列并返回等待 Promise。
   *
   * 调用方（原 acquire 请求）在排队路径 resolve 后负责预约结算；
   * 唤醒方负责凭据落盘，保持两阶段时序不变。
   */
  tryAcquire(
    proc: ManagedProcessRecord,
    input: { requestId: string; waitMs: number; ttlMs: number },
    call?: { signal?: AbortSignal },
    runId?: string
  ): { granted: boolean; waiter?: Promise<ControlGrant> } {
    // 若控制权空闲且无等待者，直接授予
    if (proc.info.control === "free" && proc.acquireWaiters.length === 0) {
      const grant = this.grantControl(proc, input.requestId, input.ttlMs, runId);
      return { granted: true, waiter: Promise.resolve(grant) };
    }

    // 控制权已被持有，检查等待队列配额并进入 FIFO 排队
    if (proc.acquireWaiters.length >= this.host.maxWaitersPerProcess) {
      throw new ProcessError(QUOTA_EXCEEDED, "Process acquire waiter quota exceeded", {
        limit: this.host.maxWaitersPerProcess,
      });
    }

    const totalHostWaiters = this.host.countHostAcquireWaiters();
    if (totalHostWaiters >= this.host.maxWaitersPerHost) {
      throw new ProcessError(QUOTA_EXCEEDED, "Host acquire waiter quota exceeded", {
        limit: this.host.maxWaitersPerHost,
      });
    }

    // 排队路径：由唤醒方在授予时落盘凭据；原请求 resolve 后负责预约 commit
    const waiter = this.enqueueWaiter(proc, input, call, runId);
    return { granted: false, waiter };
  }

  /**
   * FIFO 入队单个等待者：注册超时定时器、中止监听与自清理钩子。
   */
  private enqueueWaiter(
    proc: ManagedProcessRecord,
    input: { requestId: string; waitMs: number; ttlMs: number },
    call?: { signal?: AbortSignal },
    runId?: string
  ): Promise<ControlGrant> {
    return new Promise<ControlGrant>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const waiter: AcquireWaiter = {
        requestId: input.requestId,
        waitMs: input.waitMs,
        ttlMs: input.ttlMs,
        runId,
        resolve: (granted) => {
          cleanup();
          resolve(granted);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        const idx = proc.acquireWaiters.indexOf(waiter);
        if (idx !== -1) {
          proc.acquireWaiters.splice(idx, 1);
        }
        if (call?.signal && waiter.onAbort) {
          call.signal.removeEventListener("abort", waiter.onAbort);
        }
      };

      if (call?.signal) {
        if (call.signal.aborted) {
          reject(call.signal.reason ?? new ProcessError(CONTROL_BUSY, "Acquire cancelled"));
          return;
        }
        waiter.onAbort = () => {
          cleanup();
          reject(call.signal?.reason ?? new ProcessError(CONTROL_BUSY, "Acquire cancelled"));
        };
        call.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new ProcessError(CONTROL_BUSY, "Timed out waiting for process control", {
          waitMs: input.waitMs,
        }));
      }, input.waitMs);
      if (typeof (timer as any)?.unref === "function") {
        (timer as any).unref();
      }

      proc.acquireWaiters.push(waiter);
    });
  }

  /**
   * 授予指定受管进程控制令牌：递增控制纪元、登记凭据并设置 TTL 定时器。
   */
  grantControl(
    proc: ManagedProcessRecord,
    requestId: string,
    ttlMs: number,
    runId?: string
  ): ControlGrant {
    proc.controlEpoch += 1;
    const token = `tok_${proc.info.id}_${proc.controlEpoch}_${randomUUID().replace(/-/g, "")}`;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    proc.info.control = "held";
    proc.currentGrant = {
      token,
      epoch: proc.controlEpoch,
      ttlMs,
      expiresAt,
      runId,
      requestId,
    };

    proc.ttlTimer = setTimeout(() => {
      this.handleGrantTtlExpired(proc);
    }, ttlMs);
    if (typeof proc.ttlTimer.unref === "function") {
      proc.ttlTimer.unref();
    }

    void this.host.persistState(proc.info.id, {
      control: "held",
      controlState: "held",
    });

    return {
      token,
      expiresAt,
    };
  }

  /**
   * 续租当前有效控制令牌：先清理旧 TTL 定时器再设置新定时器，
   * 刷新到期时刻并联动空闲定时器。
   */
  renewGrant(proc: ManagedProcessRecord, ttlMs: number): ControlGrant {
    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
    }

    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    proc.currentGrant!.ttlMs = ttlMs;
    proc.currentGrant!.expiresAt = expiresAt;

    proc.ttlTimer = setTimeout(() => {
      this.handleGrantTtlExpired(proc);
    }, ttlMs);
    if (typeof proc.ttlTimer.unref === "function") {
      proc.ttlTimer.unref();
    }

    // 延长控制权刷新 idleTimeout
    this.host.refreshIdleTimer(proc);

    return {
      token: proc.currentGrant!.token,
      expiresAt,
    };
  }

  /**
   * 显式释放控制令牌：清理 TTL 定时器、凭据置空并唤醒下一个等待者。
   */
  releaseGrant(proc: ManagedProcessRecord): void {
    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
      proc.ttlTimer = undefined;
    }
    proc.currentGrant = undefined;
    proc.info.control = "free";

    void this.host.persistState(proc.info.id, {
      control: "free",
      controlState: "free",
    });

    // 正常 release 唤醒下一个等待者
    this.wakeNextAcquireWaiter(proc);
  }

  /**
   * 唤醒排队等待控制权的下一个调用者（唯一唤醒入口）：
   * 授予令牌、由唤醒方落盘排队凭据并 resolve 原等待 Promise。
   */
  private wakeNextAcquireWaiter(proc: ManagedProcessRecord): void {
    if (proc.acquireWaiters.length === 0) {
      return;
    }

    const next = proc.acquireWaiters.shift()!;
    const grant = this.grantControl(proc, next.requestId, next.ttlMs, next.runId);

    void this.host.persistGrantReceipt(grant, next, proc);

    next.resolve(grant);
  }

  /**
   * 控制权到期未释放时的复核：仍处于 held 且凭据有效时转隔离（隔离而非释放）。
   */
  handleGrantTtlExpired(proc: ManagedProcessRecord): void {
    if (proc.info.control !== "held" || !proc.currentGrant) {
      return;
    }
    void this.host.quarantineProcess(
      proc.owner,
      proc.info.id,
      proc.currentGrant.token,
      "Control token TTL expired"
    );
  }

  /**
   * 操作提交前校验持有者令牌与授权（write/control 入队前与调度链路共用）。
   */
  validateOperation(proc: ManagedProcessRecord, token: string): void {
    if (proc.info.control === "quarantined") {
      throw new ProcessError(PROCESS_QUARANTINED, "Process is in quarantined state");
    }

    if (proc.info.control !== "held" || !proc.currentGrant) {
      throw new ProcessError(ACCESS_DENIED, "Process control is not currently held");
    }

    if (proc.currentGrant.token !== token) {
      throw new ProcessError(ACCESS_DENIED, "Invalid control token");
    }

    if (new Date(proc.currentGrant.expiresAt).getTime() <= Date.now()) {
      throw new ProcessError(CONTROL_EXPIRED, "Control token has expired");
    }
  }

  /**
   * 校验当前持有凭据有效性（token 匹配且未过期），供 renew/release 提交前判定。
   */
  validateHeldGrant(proc: ManagedProcessRecord, token: string): void {
    if (proc.info.control === "quarantined") {
      throw new ProcessError(PROCESS_QUARANTINED, "Process is in quarantined state");
    }

    if (proc.info.control !== "held" || !proc.currentGrant) {
      throw new ProcessError(CONTROL_REVOKED, "Process control is not currently held");
    }

    if (proc.currentGrant.token !== token) {
      throw new ProcessError(ACCESS_DENIED, "Invalid control token");
    }

    if (new Date(proc.currentGrant.expiresAt).getTime() <= Date.now()) {
      throw new ProcessError(CONTROL_EXPIRED, "Control token has expired");
    }
  }

  /**
   * 终态等待者单一拒绝入口：按 FIFO 拒绝全部排队等待者。
   *
   * 终态转移（exit/error/stop/quarantine）必须经由此方法清空等待队列，
   * 禁止直接操作 acquireWaiters 数组。
   */
  revokeAllWaiters(proc: ManagedProcessRecord, reason: { code: string; message: string }): void {
    while (proc.acquireWaiters.length > 0) {
      const waiter = proc.acquireWaiters.shift()!;
      waiter.reject(new ProcessError(reason.code, reason.message));
    }
  }

  /**
   * 清理进程全部控制权相关定时器与等待队列（stop/退出/故障路径统一入口）。
   */
  disposeProcess(proc: ManagedProcessRecord): void {
    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
      proc.ttlTimer = undefined;
    }
    proc.currentGrant = undefined;
  }
}
