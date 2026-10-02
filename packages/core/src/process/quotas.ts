import { QUOTA_EXCEEDED, ProcessError } from "../errors";
import type { ManagedProcessRecord } from "./managed-record";
import type { ProcessManagerQuotas } from "./process-manager";

export interface QuotaContext {
  processes: Map<string, ManagedProcessRecord>;
  quotas: ProcessManagerQuotas;
  defaultLimits: { outputBufferBytes: number };
}

export class ProcessQuotaTracker {
  private readonly ctx: QuotaContext;
  constructor(ctx: QuotaContext) {
    this.ctx = ctx;
  }

  checkSpawnQuotas(_scope?: string, requestedBufferBytes?: number): void {
    let hostActive = 0;

    for (const p of this.ctx.processes.values()) {
      if (
        p.info.state === "starting" ||
        p.info.state === "running" ||
        p.info.state === "stopping"
      ) {
        hostActive += 1;
      }
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
  }
}

