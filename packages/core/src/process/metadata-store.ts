import { ActionDockError, PROCESS_NOT_FOUND } from "../errors";

/**
 * 受管进程运行状态。
 */
export type ProcessState =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "lost"
  | "killed"
  | "completed"
  | string;

/**
 * 受管进程控制通道状态。
 */
export type ProcessControlState = "open" | "closing" | "closed" | string;

/**
 * 进程终止原因。
 */
export type ProcessEndReason =
  | "exit"
  | "host-lost"
  | "timeout"
  | "signal"
  | "error"
  | "killed"
  | string;

/**
 * 进程输入输出配置。
 */
export interface ProcessIOConfig {
  [key: string]: unknown;
}

/**
 * 进程能力集定义。
 */
export interface ProcessCapabilities {
  [key: string]: unknown;
}

/**
 * 进程生效资源限制配置。
 */
export interface ProcessEffectiveLimits {
  [key: string]: unknown;
}

/**
 * 受管进程核心模型信息。
 */
export interface ProcessInfo {
  processId: string;
  hostEpoch: string;
  state: ProcessState;
  controlState?: ProcessControlState;
  control?: ProcessControlState;
  ioConfig?: ProcessIOConfig;
  capabilities?: ProcessCapabilities;
  createdAt?: string;
  exitCode?: number | null;
  exitSignal?: string | null;
  endReason?: ProcessEndReason | null;
  outputClosed?: boolean;
  outputEndReason?: string | null;
  /** 输入通道是否已发送 EOF 彻底关闭 */
  inputClosed?: boolean;
  effectiveLimits?: ProcessEffectiveLimits;
}

/**
 * 带有归属所有者与请求凭据的持久化进程记录。
 */
export type StoredProcessRecord = ProcessInfo & {
  tenantId: string;
  principalId: string;
  packageInstanceId: string;
  generationId: string;
  startRequestId?: string;
};

/**
 * 进程所有者过滤条件。
 */
export interface ProcessOwnerFilter {
  tenantId: string;
  principalId: string;
  packageInstanceId: string;
  generationId: string;
}

/**
 * 操作请求去重查询键。
 */
export interface ProcessRequestKey {
  hostEpoch: string;
  scope: string;
  processId?: string;
  requestId: string;
}

/**
 * 操作回执凭证。
 */
export interface OperationReceipt {
  status?: string;
  result?: unknown;
  error?: unknown;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * 操作请求记录项。
 */
export interface RequestRecord {
  receipt: OperationReceipt;
  payloadHash?: string;
  createdAt?: string;
}

/**
 * 受管进程元数据存储契约接口。
 */
export interface ProcessMetadataStore {
  /**
   * 保存或替换受管进程元数据。
   */
  saveProcess(process: StoredProcessRecord): Promise<void>;

  /**
   * 按进程标识获取受管进程元数据详情。
   */
  getProcess(processId: string): Promise<StoredProcessRecord | undefined>;

  /**
   * 分页列出指定所有者归属下的受管进程列表。
   */
  listProcesses(
    owner: ProcessOwnerFilter,
    pageToken?: string,
    limit?: number
  ): Promise<{ processes: ProcessInfo[]; nextPageToken?: string }>;

  /**
   * 局部更新受管进程状态字段。
   */
  updateProcessState(processId: string, patch: Partial<ProcessInfo>): Promise<void>;

  /**
   * 记录幂等请求与操作凭据。
   */
  recordRequest(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void>;

  /**
   * 获取幂等请求已记录的操作凭据。
   */
  getRequest(
    key: ProcessRequestKey
  ): Promise<{ receipt: OperationReceipt; payloadHash?: string } | undefined>;

  /**
   * 宿主生命周期初始化与故障收敛：
   * 将所有不属于当前 hostEpoch 且处于非终态（starting/running/stopping）的旧进程状态更新为 lost。
   */
  initializeHost(hostEpoch: string): Promise<number>;

  /**
   * 释放存储资源（如关闭数据库连接）。
   */
  close?(): Promise<void> | void;
}

/**
 * 解析分页游标偏移量。
 */
function parsePageToken(pageToken?: string): number {
  if (!pageToken) {
    return 0;
  }
  const parsed = parseInt(pageToken, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 0;
}

/**
 * 内存型受管进程元数据存储实现。
 * 适用于确定性测试与无持久化文件系统运行场景。
 */
export class MemoryProcessMetadataStore implements ProcessMetadataStore {
  private processes = new Map<string, StoredProcessRecord>();
  private requests = new Map<string, { receipt: OperationReceipt; payloadHash?: string; createdAt: string }>();

  private formatRequestKey(key: ProcessRequestKey): string {
    return `${key.hostEpoch}:${key.scope}:${key.processId ?? ""}:${key.requestId}`;
  }

  async saveProcess(process: StoredProcessRecord): Promise<void> {
    const createdAt = process.createdAt ?? new Date().toISOString();
    const ctrl = process.controlState ?? process.control;
    const cloned: StoredProcessRecord = {
      ...process,
      createdAt,
      controlState: ctrl,
      control: ctrl,
      outputClosed: Boolean(process.outputClosed),
      inputClosed: Boolean(process.inputClosed),
    };
    this.processes.set(process.processId, cloned);
  }

  async getProcess(processId: string): Promise<StoredProcessRecord | undefined> {
    const record = this.processes.get(processId);
    if (!record) {
      return undefined;
    }
    return { ...record };
  }

  async listProcesses(
    owner: ProcessOwnerFilter,
    pageToken?: string,
    limit?: number
  ): Promise<{ processes: ProcessInfo[]; nextPageToken?: string }> {
    const actualLimit = typeof limit === "number" && limit > 0 ? limit : 50;
    const offset = parsePageToken(pageToken);

    const matched = Array.from(this.processes.values()).filter(
      (p) =>
        p.tenantId === owner.tenantId &&
        p.principalId === owner.principalId &&
        p.packageInstanceId === owner.packageInstanceId &&
        p.generationId === owner.generationId
    );

    matched.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      return a.processId.localeCompare(b.processId);
    });

    const sliced = matched.slice(offset, offset + actualLimit + 1);
    const hasMore = sliced.length > actualLimit;
    const resultRows = hasMore ? sliced.slice(0, actualLimit) : sliced;
    const processes = resultRows.map((p) => ({ ...p }));
    const nextPageToken = hasMore ? String(offset + actualLimit) : undefined;

    return { processes, nextPageToken };
  }

  async updateProcessState(processId: string, patch: Partial<ProcessInfo>): Promise<void> {
    const target = this.processes.get(processId);
    if (!target) {
      throw new ActionDockError(PROCESS_NOT_FOUND, `Process '${processId}' not found`);
    }

    const ctrl = patch.controlState !== undefined ? patch.controlState : patch.control;
    const updated: StoredProcessRecord = {
      ...target,
      ...patch,
      controlState: ctrl !== undefined ? ctrl : target.controlState,
      control: ctrl !== undefined ? ctrl : target.control,
    };
    this.processes.set(processId, updated);
  }

  async recordRequest(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void> {
    const k = this.formatRequestKey(key);
    this.requests.set(k, {
      receipt: JSON.parse(JSON.stringify(receipt)),
      payloadHash,
      createdAt: new Date().toISOString(),
    });
  }

  async getRequest(
    key: ProcessRequestKey
  ): Promise<{ receipt: OperationReceipt; payloadHash?: string } | undefined> {
    const k = this.formatRequestKey(key);
    const item = this.requests.get(k);
    if (!item) {
      return undefined;
    }
    return {
      receipt: JSON.parse(JSON.stringify(item.receipt)),
      payloadHash: item.payloadHash,
    };
  }

  async initializeHost(hostEpoch: string): Promise<number> {
    let recoveredCount = 0;
    for (const [id, proc] of Array.from(this.processes.entries())) {
      if (
        proc.hostEpoch !== hostEpoch &&
        (proc.state === "starting" || proc.state === "running" || proc.state === "stopping")
      ) {
        this.processes.set(id, {
          ...proc,
          state: "lost",
          controlState: "closed",
          control: "closed",
          endReason: "host-lost",
          outputClosed: true,
          outputEndReason: "host-lost",
        });
        recoveredCount += 1;
      }
    }
    return recoveredCount;
  }

  clear(): void {
    this.processes.clear();
    this.requests.clear();
  }
}
