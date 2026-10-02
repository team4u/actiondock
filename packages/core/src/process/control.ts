import { CONTROL_REVOKED } from "../errors";
import type { ManagedProcessRecord, ProcessOwner } from "./managed-record";
import { checkOwnerAuthorized } from "./converters";

export interface ControlManagerOptions {
  persistState: (processId: string, patch: any) => Promise<void>;
  takeoverQueue: (proc: ManagedProcessRecord, reason: string) => void;
}

/**
 * 受管进程控制权状态管理器。
 * 聚焦于 free、quarantined 与 closed 三态流转与输入队列安全接管。
 */
export class ProcessControlManager {
  private readonly options: ControlManagerOptions;

  constructor(options: ControlManagerOptions) {
    this.options = options;
  }

  /**
   * 将进程控制状态原子收敛为已关闭（终态）。
   */
  async close(proc: ManagedProcessRecord): Promise<void> {
    if (proc.info.control === "closed") {
      return;
    }
    proc.info.control = "closed";
    await this.options.persistState(proc.info.id, { control: "closed", controlState: "closed" });
  }

  /**
   * 将进程转入检疫隔离状态，接管待处理输入队列并透传隔离原因。
   */
  async quarantine(proc: ManagedProcessRecord, owner: ProcessOwner, reason?: string): Promise<void> {
    checkOwnerAuthorized(owner, proc.owner);
    if (proc.info.control === "quarantined" || proc.info.control === "closed") {
      return;
    }
    proc.info.control = "quarantined";
    this.options.takeoverQueue(proc, reason ?? CONTROL_REVOKED);
    await this.options.persistState(proc.info.id, { control: "quarantined", controlState: "quarantined" });
  }
}
