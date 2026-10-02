import { QUOTA_EXCEEDED, ProcessError } from "../errors";
import type { ManagedProcessRecord } from "./managed-record";
import type { ProcessManagerQuotas } from "./process-manager";

export interface QuotaContext {
  processes: Map<string, ManagedProcessRecord>;
  quotas: ProcessManagerQuotas;
  defaultLimits: { outputBufferBytes: number };
  countRetainedOutputBufferBytes: () => number;
  evictLRUUntil: (targetBytes: number) => number;
}

export class ProcessQuotaTracker {
  private readonly ctx: QuotaContext;
  constructor(ctx: QuotaContext) {
    this.ctx = ctx;
  }

  checkSpawnQuotas(scope: string, requestedBufferBytes?: number): void {
    let scopeActive = 0;
    let hostActive = 0;
    let totalBuffer = 0;

    for (const p of this.ctx.processes.values()) {
      if (
        p.info.state === "starting" ||
        p.info.state === "running" ||
        p.info.state === "stopping"
      ) {
        hostActive += 1;
        totalBuffer += p.effectiveLimits.outputBufferBytes;
        if (p.scope === scope) {
          scopeActive += 1;
        }
      }
    }

    if (scopeActive >= this.ctx.quotas.maxActiveProcessesPerScope) {
      throw new ProcessError(QUOTA_EXCEEDED, "Scope active process quota exceeded", {
        scope,
        limit: this.ctx.quotas.maxActiveProcessesPerScope,
      });
    }

    if (hostActive >= this.ctx.quotas.maxActiveProcessesPerHost) {
      throw new ProcessError(QUOTA_EXCEEDED, "Host active process quota exceeded", {
        limit: this.ctx.quotas.maxActiveProcessesPerHost,
      });
    }

    const perProcBuf = requestedBufferBytes ?? this.ctx.defaultLimits.outputBufferBytes;
    if (perProcBuf > this.ctx.quotas.maxOutputBufferBytesPerProcess) {
      throw new ProcessError(QUOTA_EXCEEDED, "Output buffer per process quota exceeded", {
        requested: perProcBuf,
        limit: this.ctx.quotas.maxOutputBufferBytesPerProcess,
      });
    }

    // 终态保留输出日志实际占用字节数纳入宿主预算
    const retainedBefore = this.ctx.countRetainedOutputBufferBytes();
    totalBuffer += retainedBefore;

    // 若新进程申请的缓冲使总预算超限，优先淘汰已有的终态保留日志（LRU 策略）
    if (totalBuffer + perProcBuf > this.ctx.quotas.maxOutputBufferBytesPerHost) {
      const activeBufferBytes = totalBuffer - retainedBefore;
      const evictedBytes = this.ctx.evictLRUUntil(
        this.ctx.quotas.maxOutputBufferBytesPerHost - perProcBuf - activeBufferBytes
      );
      totalBuffer -= evictedBytes;
    }

    if (totalBuffer + perProcBuf > this.ctx.quotas.maxOutputBufferBytesPerHost) {
      throw new ProcessError(QUOTA_EXCEEDED, "Host output buffer quota exceeded", {
        limit: this.ctx.quotas.maxOutputBufferBytesPerHost,
      });
    }
  }
}
